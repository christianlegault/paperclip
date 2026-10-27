import type { Agent } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { deriveCopilotRequestCard, derivePausedAgentBanner } from "./Dashboard";

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    name: "Agent",
    status: "idle",
    pauseReason: null,
    ...overrides,
  } as unknown as Agent;
}

describe("derivePausedAgentBanner", () => {
  it("returns null with no agents loaded or an empty company", () => {
    expect(derivePausedAgentBanner(undefined)).toBeNull();
    expect(derivePausedAgentBanner([])).toBeNull();
  });

  it("prefers the imported banner and lists only import-paused agents", () => {
    const banner = derivePausedAgentBanner([
      agent({ id: "a", status: "paused", pauseReason: "import" }),
      agent({ id: "b", status: "paused", pauseReason: "manual" }),
      agent({ id: "c", status: "idle" }),
    ]);
    expect(banner).toEqual({ kind: "imported", pausedImportedAgentIds: ["a"] });
  });

  it("falls back to the all-paused banner when no import pauses exist", () => {
    const banner = derivePausedAgentBanner([
      agent({ id: "a", status: "paused", pauseReason: "manual" }),
      agent({ id: "b", status: "paused", pauseReason: "system" }),
    ]);
    expect(banner).toEqual({ kind: "all-paused" });
  });

  it("shows nothing while at least one agent can run and none are import-paused", () => {
    const banner = derivePausedAgentBanner([
      agent({ id: "a", status: "paused", pauseReason: "manual" }),
      agent({ id: "b", status: "idle" }),
    ]);
    expect(banner).toBeNull();
  });
});

describe("deriveCopilotRequestCard", () => {
  const copilotRequests = { monthPremiumRequests: 12, monthRuns: 4 };
  const copilotAgents = [{ adapterType: "copilot_local" }];
  const codexAgents = [{ adapterType: "codex_local" }];

  it("keeps the spend card while the experimental flag is off", () => {
    expect(deriveCopilotRequestCard(false, copilotAgents, { copilotRequests })).toBeNull();
  });

  it("keeps the spend card when the server sent no Copilot counts", () => {
    expect(deriveCopilotRequestCard(true, copilotAgents, {})).toBeNull();
    expect(deriveCopilotRequestCard(true, copilotAgents, undefined)).toBeNull();
  });

  it("shows request counts for a company with a GitHub Copilot agent", () => {
    expect(
      deriveCopilotRequestCard(true, copilotAgents, { copilotRequests: { monthPremiumRequests: 0, monthRuns: 0 } }),
    ).toEqual({ monthPremiumRequests: 0, monthRuns: 0 });
  });

  it("shows request counts for this month's Copilot runs after the agent changed adapter", () => {
    expect(deriveCopilotRequestCard(true, codexAgents, { copilotRequests })).toEqual(copilotRequests);
  });

  it("keeps the spend card for a company that never used GitHub Copilot", () => {
    expect(
      deriveCopilotRequestCard(true, codexAgents, { copilotRequests: { monthPremiumRequests: 0, monthRuns: 0 } }),
    ).toBeNull();
  });
});
