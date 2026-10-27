import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, heartbeatRuns, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";
import { executionIssueCondition } from "./issue-visibility.js";
import { retryIdempotentDatabaseOperation } from "../database-retry.js";

const DASHBOARD_RUN_ACTIVITY_DAYS = 14;

export interface DashboardSummaryOptions {
  /** Gated by the `enableCopilotRequestDashboard` experimental flag. */
  includeCopilotRequests?: boolean;
}

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getRecentUtcDateKeys(now: Date, days: number): string[] {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => {
    const dayOffset = index - (days - 1);
    return formatUtcDateKey(new Date(todayUtc + dayOffset * 24 * 60 * 60 * 1000));
  });
}

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string, options: DashboardSummaryOptions = {}) => {
      // This lookup only reads the company row. Rebuild it after a transient
      // disconnect; do not replay the later summary or budget workflows.
      const company = await retryIdempotentDatabaseOperation(() => db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null));

      if (!company) throw notFound("Company not found");

      const agentRows = await retryIdempotentDatabaseOperation(() => db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status));

      const taskRows = await retryIdempotentDatabaseOperation(() => db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), executionIssueCondition()))
        .groupBy(issues.status));

      const pendingApprovals = await retryIdempotentDatabaseOperation(() => db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0)));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = getUtcMonthStart(now);
      const runActivityDays = getRecentUtcDateKeys(now, DASHBOARD_RUN_ACTIVITY_DAYS);
      const runActivityStart = new Date(`${runActivityDays[0]}T00:00:00.000Z`);
      const [{ monthSpend }] = await retryIdempotentDatabaseOperation(() => db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
            lte(costEvents.occurredAt, now),
          ),
        ));

      const monthSpendCents = Number(monthSpend);
      // copilot_local reports premium requests (not dollars) in
      // result_json.copilot; the dollar ledger records those runs at $0.
      // The Copilot CLI reports a cumulative total for the whole session, so a
      // resumed run counts only its increase over the highest earlier total in
      // that session — including runs from before this month. A drop means the
      // counter restarted, so the run's own value is used.
      const copilotRequests = options.includeCopilotRequests
        ? await retryIdempotentDatabaseOperation(() => db.execute(sql`
          WITH copilot_runs AS (
            SELECT
              run.id,
              run.created_at,
              run.session_id_after,
              CASE WHEN jsonb_typeof(run.result_json -> 'copilot' -> 'premiumRequests') = 'number'
                THEN (run.result_json -> 'copilot' ->> 'premiumRequests')::double precision
                ELSE NULL END AS premium_requests
            FROM ${heartbeatRuns} AS run
            WHERE run.company_id = ${companyId}
              AND run.created_at <= ${now.toISOString()}::timestamptz
              AND jsonb_typeof(run.result_json -> 'copilot') = 'object'
          ),
          month_sessions AS (
            SELECT DISTINCT session_id_after
            FROM copilot_runs
            WHERE created_at >= ${monthStart.toISOString()}::timestamptz
              AND session_id_after IS NOT NULL
          ),
          scoped_runs AS (
            SELECT *,
              CASE WHEN session_id_after IS NULL THEN NULL
                ELSE max(premium_requests) OVER (
                  PARTITION BY session_id_after ORDER BY created_at, id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ) END AS previous_requests
            FROM copilot_runs
            WHERE created_at >= ${monthStart.toISOString()}::timestamptz
              OR session_id_after IN (SELECT session_id_after FROM month_sessions)
          )
          SELECT
            coalesce(sum(
              CASE
                WHEN premium_requests IS NULL THEN 0
                WHEN previous_requests IS NULL OR premium_requests < previous_requests THEN premium_requests
                ELSE premium_requests - previous_requests
              END
            ), 0)::double precision AS premium_requests,
            count(*)::double precision AS runs
          FROM scoped_runs
          WHERE created_at >= ${monthStart.toISOString()}::timestamptz
        `)).then((rows) => {
          const [row] = Array.from(rows as unknown as Iterable<{ premium_requests: number | string; runs: number | string }>);
          return {
            monthPremiumRequests: Number(row?.premium_requests ?? 0),
            monthRuns: Number(row?.runs ?? 0),
          };
        })
        : null;
      // Per-day run breakdown. A run is "recovered" when its retry chain later
      // succeeded (recovered_runs = all ancestors of a succeeded retry), so a
      // restart-killed run whose retry succeeded is pulled out of the headline
      // failed count. error_code is carried through so a failure spike can be
      // attributed to an error class (e.g. process_lost, provider_quota).
      // Both recursive arms are bounded to the chart window: a retry is always
      // created after the run it retries, so ancestors of an out-of-window
      // child are themselves out of window and invisible to the membership
      // test below. Unbounded, the seed walks every run the company ever had.
      const runActivityRows = (await retryIdempotentDatabaseOperation(() => db.execute(sql`
        WITH RECURSIVE recovered_runs(id) AS (
          SELECT parent.id
          FROM ${heartbeatRuns} AS child
          JOIN ${heartbeatRuns} AS parent ON parent.id = child.retry_of_run_id
          WHERE child.company_id = ${companyId}
            AND child.status = 'succeeded'
            AND child.created_at >= ${runActivityStart.toISOString()}::timestamptz
          UNION
          SELECT parent.id
          FROM recovered_runs rr
          JOIN ${heartbeatRuns} AS child ON child.id = rr.id
          JOIN ${heartbeatRuns} AS parent ON parent.id = child.retry_of_run_id
          WHERE child.created_at >= ${runActivityStart.toISOString()}::timestamptz
        )
        SELECT
          to_char(run.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          run.status AS status,
          run.error_code AS error_code,
          (run.id IN (SELECT id FROM recovered_runs)) AS recovered,
          count(*)::double precision AS count
        FROM ${heartbeatRuns} AS run
        WHERE run.company_id = ${companyId}
          AND run.created_at >= ${runActivityStart.toISOString()}::timestamptz
        GROUP BY date, run.status, run.error_code, recovered
      `))) as unknown as Iterable<{
        date: string;
        status: string;
        error_code: string | null;
        recovered: boolean | string;
        count: number | string;
      }>;

      const runActivity = new Map(
        runActivityDays.map((date) => [
          date,
          {
            date,
            succeeded: 0,
            failed: 0,
            recovered: 0,
            other: 0,
            total: 0,
            failedByErrorCode: {} as Record<string, number>,
          },
        ]),
      );
      for (const row of runActivityRows) {
        const bucket = runActivity.get(String(row.date));
        if (!bucket) continue;
        const count = Number(row.count);
        const status = String(row.status);
        // Postgres booleans can arrive as JS boolean or "t"/"true" depending on driver.
        const recovered = row.recovered === true || row.recovered === "t" || row.recovered === "true";
        if (status === "succeeded") {
          bucket.succeeded += count;
        } else if (status === "failed" || status === "timed_out") {
          if (recovered) {
            bucket.recovered += count;
          } else {
            bucket.failed += count;
            const code =
              typeof row.error_code === "string" && row.error_code.length > 0
                ? row.error_code
                : "unknown";
            bucket.failedByErrorCode[code] = (bucket.failedByErrorCode[code] ?? 0) + count;
          }
        } else {
          bucket.other += count;
        }
        bucket.total += count;
      }

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        ...(copilotRequests ? { copilotRequests } : {}),
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        runActivity: Array.from(runActivity.values()),
      };
    },
  };
}
