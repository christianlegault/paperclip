# RoamSpoke Dispatch

An agent team for [Paperclip](https://github.com/paperclipai/paperclip) that produces a
**biweekly, stage-by-stage bikepacking itinerary newsletter** for RoamSpoke. It is
built on a regional route digest and plugs into the RoamSpoke **Base Camp** page.

Each issue features one multi-day route in one Canada/USA region, broken into daily
stages with distance, elevation, camping, resupply, water, and best season. A
"What's happening" section covers closures, conditions, races, and group rides.
Every issue ends with:

> **Copy this trip into RoamSpoke and invite your crew.**

That link lands readers in RoamSpoke's core use case, planning a trip together. It
does not point at a homepage.

## How it works

```
Region Strategist ──(monthly ranked shortlist of 3)──▶ Editor-in-Chief picks
                                                         │
             Monday ── Route Researcher ── route-data (JSON)
            Tuesday ── Conditions & Events Scout ── conditions-report
            Tuesday ── Writer ── draft
          Wednesday ── Fact-Checker & QA ── fact-check-report (pass/fail)
          Wednesday ── Editor-in-Chief ── request_confirmation (human_only) ──▶ YOU approve
 Thursday 07:00 ET ── Scout pre-send re-check (can call HOLD SEND)
           Thursday ── YOU send (no agent has send permissions)
```

- **Pattern:** a pipeline managed by an editor. Each stage is a child issue with
  first-class blockers, so agents wake when their inputs are ready. No agent polls
  another.
- **Cadence:** biweekly Thursday sends, with the first on **2026-10-29**. Routines
  fire weekly. On off weeks they check the Ledger's `issue-calendar` and close
  quickly.
- **The Dispatch Ledger** is a long-lived issue holding four documents:
  `issue-calendar`, `region-log` (rotation and open/click rates), `performance`
  (cost per issue), and `cta-config` (the live copy-trip link).

## Org chart

Attached under the existing RoamSpoke **CEO**.

| Agent | Title | Reports to | Skills | Budget/mo |
|---|---|---|---|---|
| `editor-in-chief` | Editor-in-Chief | RoamSpoke CEO | dispatch-workflow, dispatch-source-rules, dispatch-style-guide | $15 |
| `region-strategist` | Region Strategist | editor-in-chief | dispatch-workflow, dispatch-source-rules, region-scoring-rubric, route-data-contract | $10 |
| `route-researcher` | Route Researcher | editor-in-chief | dispatch-workflow, dispatch-source-rules, route-data-contract | $40 |
| `conditions-events-scout` | Conditions & Events Scout | editor-in-chief | dispatch-workflow, dispatch-source-rules, route-data-contract | $20 |
| `writer` | Newsletter Writer | editor-in-chief | dispatch-workflow, dispatch-source-rules, dispatch-style-guide, route-data-contract | $40 |
| `fact-checker-qa` | Fact-Checker & QA | editor-in-chief | dispatch-workflow, dispatch-source-rules, dispatch-style-guide, route-data-contract | $25 |

Every agent also uses the Paperclip runtime skill `paperclip`. All agents run on
`copilot_local` with `claude-opus-5.5`, matching the rest of RoamSpoke, and
`canCreateAgents: false`.

## Guardrails

- **Human approval gate.** The Editor submits a `human_only` confirmation. No agent
  sends, schedules, or posts.
- **Lane.** Canada and the USA only, until the board changes the rubric.
- **Rotation.** No region repeats within 8 issues (6 with board approval).
- **Minimum data threshold.** A region needs at least 3 multi-day routes with public
  stage data, confirmed by the Researcher's feasibility check.
- **Safety first.** Safety claims need tier 1 or 2 sources, and a `do_not_feature`
  verdict or `HOLD SEND` stops a route.
- **Source rules.** Summarize and link. Never copy text or redistribute GPX files.
- **Separate fact-checker.** The Writer never grades its own work.

## Contents

- `agents/`: six agent instruction files
- `skills/`:
  - `dispatch-workflow`: the shared operating manual
  - `dispatch-source-rules`
  - `region-scoring-rubric`
  - `route-data-contract`: JSON shapes for every handoff
  - `dispatch-style-guide`: includes two fictional example issues
- `projects/dispatch-newsletter/`: the project and three starter tasks:
  - Ledger setup
  - Base Camp and copy-trip product brief, routed to the CEO
  - the first region shortlist
- `tasks/`: five recurring routines (America/Toronto):
  - 1st of the month 09:00
  - Monday 08:00
  - Tuesday 07:00
  - Wednesday 13:00
  - Thursday 07:00
- `.paperclip.yaml`: adapter, budgets, permissions, the CEO attachment, and routine schedules

## Later additions (not hired)

- **Publisher**, once you trust the output: email platform API scheduling.
- **Growth agent**: social posts and repurposing.
- **Community Curator**: featuring public RoamSpoke trips once there are users.

## Getting started

Import into the existing RoamSpoke company:

```sh
paperclipai company import companies/roamspoke-dispatch \
  --target existing -C <roamspoke-company-id> \
  --include agents,projects,tasks,skills --dry-run
# then re-run without --dry-run
```

After import, check the following:

1. The Editor-in-Chief appears under the CEO in the org chart.
2. The Ledger, Base Camp brief, and first shortlist starter tasks are running.
3. Fill in open and click rates in `region-log` after each send. The Strategist learns from them.

## References

- [Agent Companies specification](https://agentcompanies.io/specification)
- [Paperclip](https://github.com/paperclipai/paperclip)
