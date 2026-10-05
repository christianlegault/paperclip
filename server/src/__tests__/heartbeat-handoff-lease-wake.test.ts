import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => ({ track: vi.fn() }),
}));

import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres handoff lease wake tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// An agent handing an issue to another agent cancels its own run before the
// run's environment lease is released. The incoming assignee's wake is admitted
// inside that window and must not be lost.
describeEmbeddedPostgres("heartbeat handoff wake behind an outgoing run's lease cleanup", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-handoff-lease-wake-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 60_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    await db.delete(environmentLeases);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedHandoff() {
    const companyId = randomUUID();
    const coderAgentId = randomUUID();
    const reviewerAgentId = randomUUID();
    const issueId = randomUUID();
    const outgoingRunId = randomUUID();
    const leaseId = randomUUID();
    const issuePrefix = `H${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values([
      { id: coderAgentId, companyId, name: "Coder", role: "engineer", status: "idle",
        adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions: {} },
      // One busy slot keeps the promoted run queued instead of executing.
      { id: reviewerAgentId, companyId, name: "Reviewer", role: "designer", status: "idle",
        adapterType: "process", adapterConfig: {},
        runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } }, permissions: {} },
    ]);
    await db.insert(heartbeatRuns).values({
      id: randomUUID(), companyId, agentId: reviewerAgentId, invocationSource: "automation",
      triggerDetail: "system", status: "running", contextSnapshot: { wakeReason: "test_busy_slot" },
      startedAt: new Date(),
    });

    // The issue is already handed to the reviewer; the coder's run that made
    // the handoff is cancelled but still holds its environment lease.
    await db.insert(issues).values({
      id: issueId, companyId, title: "Handoff behind lease cleanup", status: "in_review",
      priority: "medium", assigneeAgentId: reviewerAgentId, issueNumber: 1, identifier: `${issuePrefix}-1`,
    });
    await db.insert(heartbeatRuns).values({
      id: outgoingRunId, companyId, agentId: coderAgentId, invocationSource: "assignment",
      triggerDetail: "system", status: "cancelled", runtimeMode: "legacy",
      error: "Cancelled before issue reassignment", errorCode: "issue_reassigned",
      startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(),
      runnerProfileJson: { adapterDispatch: { adapterType: "copilot_local" } },
      // Shape of a real run stopped by an agent-to-agent handoff.
      resultJson: {
        stopReason: "cancelled",
        executionCancellation: { state: "acknowledged", acknowledgedAt: new Date().toISOString() },
        conversationContinuation: "continue_conversation_v1",
        reassignmentStopConfirmed: true,
      },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_assigned" },
    });
    await db.insert(environmentLeases).values({
      id: leaseId, companyId, issueId, heartbeatRunId: outgoingRunId, status: "active",
    });

    return { companyId, coderAgentId, reviewerAgentId, issueId, outgoingRunId, leaseId };
  }

  function wakeReviewer(reviewerAgentId: string, issueId: string, source: "assignment" | "automation" = "assignment") {
    return heartbeat.wakeup(reviewerAgentId, {
      source,
      triggerDetail: "system",
      reason: "execution_review_requested",
      payload: { issueId, mutation: "update" },
      contextSnapshot: { issueId, taskId: issueId, wakeReason: "execution_review_requested" },
      requestedByActorType: "agent",
      requestedByActorId: randomUUID(),
    });
  }

  async function reviewerWakes(reviewerAgentId: string) {
    return db.select({ id: agentWakeupRequests.id, status: agentWakeupRequests.status, runId: agentWakeupRequests.runId })
      .from(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, reviewerAgentId));
  }

  it("parks the incoming assignee's handoff wake instead of skipping it", async () => {
    const { reviewerAgentId, issueId } = await seedHandoff();

    expect(await wakeReviewer(reviewerAgentId, issueId)).toBeNull();

    const wakes = await reviewerWakes(reviewerAgentId);
    expect(wakes.map((wake) => wake.status)).toEqual(["deferred_issue_execution"]);
  });

  it("still records a non-handoff wake blocked by the outgoing owner as skipped", async () => {
    const { reviewerAgentId, issueId } = await seedHandoff();

    expect(await wakeReviewer(reviewerAgentId, issueId, "automation")).toBeNull();

    const wakes = await reviewerWakes(reviewerAgentId);
    expect(wakes.map((wake) => wake.status)).toEqual(["skipped"]);
  });

  it("promotes the parked handoff wake once the outgoing lease is released", async () => {
    const { reviewerAgentId, issueId, leaseId } = await seedHandoff();
    await wakeReviewer(reviewerAgentId, issueId);
    const [parked] = await reviewerWakes(reviewerAgentId);
    expect(parked?.status).toBe("deferred_issue_execution");

    await db.update(environmentLeases)
      .set({ status: "expired", releasedAt: new Date(), updatedAt: new Date() })
      .where(eq(environmentLeases.id, leaseId));
    // The sweep only revisits parked wakes that missed the post-cleanup promotion.
    await db.update(agentWakeupRequests)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(agentWakeupRequests.id, parked!.id));

    await heartbeat.resumeQueuedRuns();

    const [readmitted] = await db.select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests).where(eq(agentWakeupRequests.id, parked!.id));
    expect(readmitted?.status).toBe("coalesced");
    const wakes = await reviewerWakes(reviewerAgentId);
    expect(wakes.filter((wake) => wake.status === "deferred_issue_execution")).toEqual([]);
    const reviewRuns = await db.select({ status: heartbeatRuns.status, contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.agentId, reviewerAgentId)));
    const reviewRun = reviewRuns.find((run) => run.contextSnapshot?.issueId === issueId);
    expect(reviewRun?.contextSnapshot?.wakeReason).toBe("execution_review_requested");
    expect(reviewRun?.status).toBe("queued");
  });

  it("leaves the parked handoff wake alone while the outgoing lease is still held", async () => {
    const { reviewerAgentId, issueId } = await seedHandoff();
    await wakeReviewer(reviewerAgentId, issueId);
    const [parked] = await reviewerWakes(reviewerAgentId);
    await db.update(agentWakeupRequests)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(agentWakeupRequests.id, parked!.id));

    await heartbeat.resumeQueuedRuns();

    const [still] = await db.select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests).where(eq(agentWakeupRequests.id, parked!.id));
    expect(still?.status).toBe("deferred_issue_execution");
  });
});
