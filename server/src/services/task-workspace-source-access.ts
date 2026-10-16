import { executionWorkspaces, issues, type Db } from "@paperclipai/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { forbidden } from "../errors.js";
import { accessService } from "./access.js";
import { createAuthorizationLookupMemo, executionWorkspaceReadSqlCondition, type AuthorizationActor, type AuthorizationLookupMemo } from "./authorization.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type WorkspaceAccessContext = { write?: boolean; issueId?: string | null; parentIssueId?: string | null; assigneeAgentId?: string | null; assigneeUserId?: string | null };
type WorkspaceRow = typeof executionWorkspaces.$inferSelect;

/** Shared state for many workspace checks inside one bounded operation (one
 * locked transaction). Row reads and actor-independent facts are reused;
 * every authorization decision is still made for every actor and workspace. */
export type TaskWorkspaceAccessMemo = {
  lookups: AuthorizationLookupMemo;
  sourceIssueIds: Map<string, string[]>;
};

export function createTaskWorkspaceAccessMemo(): TaskWorkspaceAccessMemo {
  return { lookups: createAuthorizationLookupMemo(), sourceIssueIds: new Map() };
}

const ID_BATCH_SIZE = 1000;
function chunks<T>(values: T[]) {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += ID_BATCH_SIZE) out.push(values.slice(i, i + ID_BATCH_SIZE));
  return out;
}
function retainedIssueIdsFor(workspace: WorkspaceRow) {
  const retained = Object.keys(workspace.metadata?._issuePrivacySources ?? {});
  if (workspace.sourceIssueId) retained.push(workspace.sourceIssueId);
  return retained;
}
function sourceIssueKey(workspace: WorkspaceRow, retained: string[]) {
  return `${workspace.id}:${JSON.stringify(retained)}`;
}

export async function assertTaskWorkspaceSourceProjectAccess(
  db: Db | DbTransaction, actor: AuthorizationActor, companyId: string, projectId: string | null, options: WorkspaceAccessContext = {},
) {
  if (!projectId) return;
  const decision = await accessService(db as Db).decide({
    actor, action: "project:read", resource: { type: "project", companyId, projectId },
  });
  if (!decision.allowed) throw forbidden(decision.explanation);
  if (options.write) {
    const [task] = actor.type === "board" && options.issueId
      ? await db.select({ assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId }).from(issues)
        .where(and(eq(issues.id, options.issueId), eq(issues.companyId, companyId)))
      : [];
    const assigneeAgentId = actor.type === "agent" ? actor.agentId ?? null : task?.assigneeAgentId ?? options.assigneeAgentId ?? null;
    const assigneeUserId = actor.type === "agent" ? null : task?.assigneeUserId ?? options.assigneeUserId ?? null;
    const assignment = await accessService(db as Db).decide({
      actor, action: "project:write_workspace",
      resource: { type: "issue", companyId, projectId, assigneeAgentId, assigneeUserId,
        issueId: options.issueId, parentIssueId: options.parentIssueId },
      scope: { projectId, assigneeAgentId, assigneeUserId },
    });
    if (!assignment.allowed) throw forbidden(assignment.explanation);
  }
}

export async function assertTaskWorkspaceAccess(
  db: Db | DbTransaction, actor: AuthorizationActor, companyId: string, workspaceId: string, options: WorkspaceAccessContext = {},
) {
  const [workspace] = await db.select().from(executionWorkspaces).where(and(
    eq(executionWorkspaces.id, workspaceId), eq(executionWorkspaces.companyId, companyId),
    await executionWorkspaceReadSqlCondition(db, actor),
  ));
  if (!workspace) throw forbidden("Task workspace access is no longer available");
  await assertTaskWorkspaceSourceProjectAccess(db, actor, companyId, workspace.projectId, { ...options, write: options.write && workspace.strategyType !== "git_worktree" });
  const retainedIssueIds = Object.keys(workspace.metadata?._issuePrivacySources ?? {});
  if (workspace.sourceIssueId) retainedIssueIds.push(workspace.sourceIssueId);
  const sources = await db.select({ id: issues.id }).from(issues).where(and(
    eq(issues.companyId, companyId),
    or(eq(issues.executionWorkspaceId, workspaceId), retainedIssueIds.length > 0
      ? inArray(sql<string>`${issues.id}::text`, retainedIssueIds) : undefined),
  ));
  const sourceIds = new Set(sources.map(source => source.id));
  if (retainedIssueIds.some(id => !sourceIds.has(id))) throw forbidden("Task workspace source is no longer accessible");
  const access = accessService(db as Db);
  if (sources.length === 0 && !workspace.projectId) {
    const decision = await access.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden("An unscoped workspace is outside this actor's authorization boundary");
  }
  for (const source of sources) {
    const decision = await access.decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId: source.id } });
    if (!decision.allowed) throw forbidden("Task workspace retains files outside this actor's authorization boundary");
  }
}

/** Same checks, order and errors as calling assertTaskWorkspaceAccess (read
 * access, no options) once per id, with set-based reads instead of per-id ones. */
export async function assertTaskWorkspacesAccess(
  db: Db | DbTransaction, actor: AuthorizationActor, companyId: string, workspaceIds: Iterable<string>,
  memo: TaskWorkspaceAccessMemo = createTaskWorkspaceAccessMemo(),
) {
  const ids = [...new Set(workspaceIds)];
  if (!ids.length) return;
  const readable = await executionWorkspaceReadSqlCondition(db, actor);
  const rows = new Map<string, WorkspaceRow>();
  for (const batch of chunks(ids)) {
    for (const row of await db.select().from(executionWorkspaces).where(and(
      inArray(executionWorkspaces.id, batch), eq(executionWorkspaces.companyId, companyId), readable,
    ))) rows.set(row.id, row);
  }

  // Which tasks a workspace retains does not depend on who asks.
  const pending = [...rows.values()].filter(row => !memo.sourceIssueIds.has(sourceIssueKey(row, retainedIssueIdsFor(row))));
  if (pending.length) {
    const retainedIds = [...new Set(pending.flatMap(retainedIssueIdsFor))];
    const linked: Array<{ id: string; executionWorkspaceId: string | null }> = [];
    for (const batch of chunks(pending.map(row => row.id))) {
      linked.push(...await db.select({ id: issues.id, executionWorkspaceId: issues.executionWorkspaceId }).from(issues)
        .where(and(eq(issues.companyId, companyId), inArray(issues.executionWorkspaceId, batch))));
    }
    for (const batch of chunks(retainedIds)) {
      linked.push(...await db.select({ id: issues.id, executionWorkspaceId: issues.executionWorkspaceId }).from(issues)
        .where(and(eq(issues.companyId, companyId), inArray(sql<string>`${issues.id}::text`, batch))));
    }
    for (const row of pending) {
      const retained = retainedIssueIdsFor(row);
      const ids = new Set(linked.filter(issue => issue.executionWorkspaceId === row.id || retained.includes(issue.id)).map(issue => issue.id));
      memo.sourceIssueIds.set(sourceIssueKey(row, retained), [...ids]);
    }
  }

  const access = accessService(db as Db, { lookupMemo: memo.lookups });
  const projectDecisions = new Map<string, ReturnType<typeof access.decide>>();
  const issueDecisions = new Map<string, ReturnType<typeof access.decide>>();
  let companyDecision: ReturnType<typeof access.decide> | null = null;
  for (const id of ids) {
    const workspace = rows.get(id);
    if (!workspace) throw forbidden("Task workspace access is no longer available");
    if (workspace.projectId) {
      const projectId = workspace.projectId;
      let decision = projectDecisions.get(projectId);
      if (!decision) {
        decision = access.decide({ actor, action: "project:read", resource: { type: "project", companyId, projectId } });
        projectDecisions.set(projectId, decision);
      }
      const resolved = await decision;
      if (!resolved.allowed) throw forbidden(resolved.explanation);
    }
    const retained = retainedIssueIdsFor(workspace);
    const sourceIds = memo.sourceIssueIds.get(sourceIssueKey(workspace, retained))!;
    const present = new Set(sourceIds);
    if (retained.some(issueId => !present.has(issueId))) throw forbidden("Task workspace source is no longer accessible");
    if (sourceIds.length === 0 && !workspace.projectId) {
      companyDecision ??= access.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId } });
      if (!(await companyDecision).allowed) throw forbidden("An unscoped workspace is outside this actor's authorization boundary");
    }
    for (const issueId of sourceIds) {
      let decision = issueDecisions.get(issueId);
      if (!decision) {
        decision = access.decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId } });
        issueDecisions.set(issueId, decision);
      }
      if (!(await decision).allowed) throw forbidden("Task workspace retains files outside this actor's authorization boundary");
    }
  }
}
