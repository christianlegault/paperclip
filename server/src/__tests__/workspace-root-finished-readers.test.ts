import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, agents, authUsers, companies, companyMemberships, createDb, executionWorkspaceRepositoryAccess, executionWorkspaces, heartbeatRuns, issues } from "@paperclipai/db";
import { executionWorkspaceRepositoryService } from "../services/execution-workspace-repositories.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("releasing finished readers of a shared workspace root", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const roots: string[] = [];
  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "enforce");
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-root-readers-");
    db = createDb(temporary.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await temporary?.cleanup();
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
  });

  // An outsider's past run read the shared folder; the owner's private task is now admitted there.
  async function fixture(pastRunStatus: string) {
    const cwd = await mkdtemp(path.join(tmpdir(), "paperclip-root-readers-files-"));
    roots.push(cwd);
    const canonicalCwd = await realpath(cwd);
    const [company] = await db.insert(companies).values({ name: randomUUID(), issuePrefix: `R${randomUUID().slice(0, 5)}` }).returning();
    const owner = randomUUID(), outsider = randomUUID();
    await db.insert(authUsers).values([owner, outsider].map(id => ({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([owner, outsider].map(principalId => ({ companyId: company.id, principalType: "user", principalId, status: "active", membershipRole: "operator" })));
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker", adapterType: "process", status: "idle" }).returning();
    const workspace = async (name: string) => (await db.insert(executionWorkspaces).values({ companyId: company.id, name, cwd,
      mode: "shared_workspace", strategyType: "operator_directory" }).returning())[0];
    const sharedWorkspace = await workspace("Shared task files");
    const [sharedTask] = await db.insert(issues).values({ companyId: company.id, title: "Shared task", assigneeAgentId: agent.id, executionWorkspaceId: sharedWorkspace.id }).returning();
    const [pastRun] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, status: pastRunStatus,
      responsibleUserId: outsider, contextSnapshot: { issueId: sharedTask.id } }).returning();
    await db.insert(executionWorkspaceRepositoryAccess).values({ companyId: company.id, canonicalCwd,
      rootKey: createHash("sha256").update(canonicalCwd).digest("hex"), kind: "reader", scopeId: pastRun.id,
      issueId: sharedTask.id, agentId: agent.id, responsibleUserId: outsider });
    const privateWorkspace = await workspace("Private task files");
    const privateId = randomUUID();
    await db.insert(issues).values({ id: privateId, companyId: company.id, title: "Owner-only task", visibility: "private",
      privacyRootIssueId: privateId, responsibleUserId: owner, assigneeAgentId: agent.id, executionWorkspaceId: privateWorkspace.id });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, status: "running",
      responsibleUserId: owner, contextSnapshot: { issueId: privateId } }).returning();
    return () => executionWorkspaceRepositoryService(db).prepareForAdmission({ companyId: company.id, issueId: privateId,
      workspaceId: privateWorkspace.id, cwd, agentId: agent.id, runId: run.id, responsibleUserId: owner });
  }

  it("keeps checking every retained reader by default", async () => {
    vi.stubEnv("PAPERCLIP_WORKSPACE_ROOT_RELEASE_FINISHED_READERS", "");
    await expect((await fixture("succeeded"))()).rejects.toThrow(/workspace access|authorization boundary/);
  });

  it("stops a finished reader from constraining the root when enabled", async () => {
    vi.stubEnv("PAPERCLIP_WORKSPACE_ROOT_RELEASE_FINISHED_READERS", "true");
    await expect((await fixture("succeeded"))()).resolves.toEqual([]);
  });

  it("still checks a reader whose run is active when enabled", async () => {
    vi.stubEnv("PAPERCLIP_WORKSPACE_ROOT_RELEASE_FINISHED_READERS", "true");
    await expect((await fixture("running"))()).rejects.toThrow(/workspace access|authorization boundary/);
  });
});
