import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, executionWorkspaces, heartbeatRuns, issues, projects, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { executionWorkspaceReadSqlCondition, type AuthorizationActor } from "../services/authorization.js";
import { assertTaskWorkspaceAccess, assertTaskWorkspacesAccess, createTaskWorkspaceAccessMemo } from "../services/task-workspace-source-access.js";

// The batched check must allow and deny exactly like one assertTaskWorkspaceAccess call per workspace.
describe("batched task workspace access", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = "enforce";
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-batched-workspace-access-");
    db = createDb(tempDb.connectionString);
  }, 120_000);
  afterAll(async () => { await tempDb?.cleanup(); });

  async function fixture() {
    const [company] = await db.insert(companies).values({ name: randomUUID(), issuePrefix: `B${randomUUID().slice(0, 5)}` }).returning();
    const owner = randomUUID(), outsider = randomUUID();
    await db.insert(authUsers).values([owner, outsider].map(id => ({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([owner, outsider].map(principalId => ({ companyId: company.id, principalType: "user", principalId, status: "active", membershipRole: "operator" })));
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker", role: "engineer", adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions: {} }).returning();
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Open project" }).returning();
    const [publicIssue] = await db.insert(issues).values({ companyId: company.id, title: "Public", projectId: project.id, assigneeAgentId: agent.id }).returning();
    const privateId = randomUUID();
    const [privateIssue] = await db.insert(issues).values({ id: privateId, companyId: company.id, title: "Private", visibility: "private", privacyRootIssueId: privateId, responsibleUserId: owner }).returning();
    const workspace = async (values: Partial<typeof executionWorkspaces.$inferInsert>) => (await db.insert(executionWorkspaces).values({
      companyId: company.id, mode: "shared_workspace", strategyType: "project_primary", name: randomUUID(), ...values,
    }).returning())[0];
    // The provenance trigger rebuilds retained keys from canonical ids. Bypass it
    // to cover keys that only legacy or hand-edited rows could contain.
    const retain = async (values: Partial<typeof executionWorkspaces.$inferInsert>, keys: string[]) => {
      const row = await workspace(values);
      await db.transaction(async tx => {
        await tx.execute(sql`alter table execution_workspaces disable trigger execution_workspaces_privacy_sources`);
        await tx.update(executionWorkspaces).set({ metadata: { _issuePrivacySources: Object.fromEntries(keys.map(key => [key, true])) } })
          .where(eq(executionWorkspaces.id, row.id));
        await tx.execute(sql`alter table execution_workspaces enable trigger execution_workspaces_privacy_sources`);
      });
      return row;
    };
    const open = await workspace({ projectId: project.id, sourceIssueId: publicIssue.id });
    const privateLinked = await workspace({ projectId: project.id });
    await db.update(issues).set({ executionWorkspaceId: privateLinked.id }).where(eq(issues.id, privateIssue.id));
    const retainedPrivate = await retain({ projectId: project.id }, [privateIssue.id]);
    const retainedUppercase = await retain({ projectId: project.id }, [publicIssue.id.toUpperCase()]);
    const retainedMalformed = await retain({ projectId: project.id }, ["not-a-uuid"]);
    const retainedMissing = await retain({ projectId: project.id }, [randomUUID()]);
    const unscoped = await workspace({});
    const run = async (onBehalfOf: string) => (await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id,
      status: "running", responsibleUserId: onBehalfOf, contextSnapshot: { issueId: publicIssue.id } }).returning())[0];
    const actors: Record<string, AuthorizationActor> = {
      owner: { type: "board", userId: owner, source: "session", companyIds: [company.id] },
      outsider: { type: "board", userId: outsider, source: "session", companyIds: [company.id] },
      agentForOwner: { type: "agent", source: "agent_jwt", companyId: company.id, agentId: agent.id, runId: (await run(owner)).id, onBehalfOfUserId: owner },
      agentForOutsider: { type: "agent", source: "agent_jwt", companyId: company.id, agentId: agent.id, runId: (await run(outsider)).id, onBehalfOfUserId: outsider },
    };
    const workspaces = { open, privateLinked, retainedPrivate, retainedUppercase, retainedMalformed, retainedMissing, unscoped };
    return { company, actors, workspaces };
  }
  const outcome = (promise: Promise<unknown>) => promise.then(() => "allowed", (error: Error) => `denied: ${error.message}`);

  it("matches per-workspace checks for every actor and workspace shape", async () => {
    const f = await fixture();
    const memo = createTaskWorkspaceAccessMemo();
    const seen = new Set<string>();
    for (const [actorName, actor] of Object.entries(f.actors)) {
      for (const [name, workspace] of Object.entries(f.workspaces)) {
        const expected = await outcome(assertTaskWorkspaceAccess(db, actor, f.company.id, workspace.id));
        seen.add(expected);
        expect.soft(await outcome(assertTaskWorkspacesAccess(db, actor, f.company.id, [workspace.id], memo)), `${actorName}/${name}`).toBe(expected);
        expect.soft(await outcome(assertTaskWorkspacesAccess(db, actor, f.company.id, [workspace.id])), `${actorName}/${name} without memo`).toBe(expected);
      }
    }
    // The fixture must exercise both outcomes, or the comparison proves nothing.
    expect(seen.has("allowed")).toBe(true);
    expect([...seen].some(value => value.startsWith("denied"))).toBe(true);
  });

  it("reports the first per-workspace failure for a list, in order", async () => {
    const f = await fixture();
    const ids = Object.values(f.workspaces).map(workspace => workspace.id);
    for (const actor of Object.values(f.actors)) {
      for (const order of [ids, [...ids].reverse()]) {
        let expected = "allowed";
        for (const id of order) {
          const result = await outcome(assertTaskWorkspaceAccess(db, actor, f.company.id, id));
          if (result !== "allowed") { expected = result; break; }
        }
        expect(await outcome(assertTaskWorkspacesAccess(db, actor, f.company.id, order))).toBe(expected);
      }
    }
  });

  it("keeps exact text matching for retained source keys without casting malformed ones", async () => {
    const f = await fixture();
    const readable = await db.select({ id: executionWorkspaces.id }).from(executionWorkspaces).where(and(
      inArray(executionWorkspaces.id, Object.values(f.workspaces).map(workspace => workspace.id)),
      await executionWorkspaceReadSqlCondition(db, f.actors.owner),
    ));
    const ids = new Set(readable.map(row => row.id));
    expect(ids.has(f.workspaces.open.id)).toBe(true);
    expect(ids.has(f.workspaces.retainedPrivate.id)).toBe(true);
    expect(ids.has(f.workspaces.retainedUppercase.id)).toBe(false);
    expect(ids.has(f.workspaces.retainedMalformed.id)).toBe(false);
    expect(ids.has(f.workspaces.retainedMissing.id)).toBe(false);
  });
});
