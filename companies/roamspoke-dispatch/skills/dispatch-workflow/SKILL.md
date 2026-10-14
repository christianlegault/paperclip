---
name: dispatch-workflow
description: Shared operating manual for the RoamSpoke Dispatch newsletter team. Covers the Dispatch Ledger, per-issue task structure, document keys, the weekly rhythm, handoffs, the board approval gate, and the execution contract. Load on every Dispatch heartbeat.
---

# Dispatch Workflow

RoamSpoke Dispatch is a biweekly, stage-by-stage bikepacking itinerary newsletter.
This skill is the single source of truth for how work moves through the team.

## Roles at a glance

| Agent | Slug | Cadence | Produces |
|---|---|---|---|
| Editor-in-Chief | `editor-in-chief` | Mon kickoff, Tue scheduling, Wed approval gate | Issue plan, region pick, final approval packet |
| Region Strategist | `region-strategist` | Monthly (1st) | Ranked 3-region shortlist + 4-week region plan |
| Route Researcher | `route-researcher` | Monday of send weeks; on request for feasibility checks | `route-data` JSON document |
| Conditions & Events Scout | `conditions-events-scout` | Tuesday of send weeks + Thursday pre-send re-check | `conditions-report` document |
| Writer | `writer` | Tuesday (after research and scout are done) | `draft` document |
| Fact-Checker & QA | `fact-checker-qa` | Wednesday | `fact-check-report` document + verdict |

The board (the human operator) approves every issue and is the only party that sends.

## The Dispatch Ledger

A single long-lived issue titled exactly **`Dispatch Ledger`** in the
**Dispatch Newsletter** project, assigned to the Editor-in-Chief. Find it by title.
It is never closed. It holds four issue documents:

- `issue-calendar`: one row per planned send. Columns: issue number, send date
  (Thursday), cycle week start (Monday), region, featured route, status
  (`planned | in-production | approved | sent | skipped`), and the parent issue link.
  It also marks **send weeks** and **off weeks**.
- `region-log`: one row per sent issue. Columns: issue number, send date, region,
  route, country/province/state, open rate, click rate, CTA clicks (blank until the
  board fills them in). The Strategist enforces the rotation rule and learns
  performance from this log.
- `performance`: free-form notes on cost per issue (from Paperclip cost data),
  open/click trends, and reader feedback.
- `cta-config`: the live "Copy this trip into RoamSpoke and invite your crew" link
  pattern and UTM convention. Until the RoamSpoke product team ships the
  copy-trip deep link, this document says `status: pending`. In that case the Writer
  uses the placeholder token `{{COPY_TRIP_URL:dispatch-NN}}` and the board swaps in the
  real link before sending.

Only the Editor-in-Chief edits `issue-calendar`. The Editor appends to `region-log`
when the board confirms a send. The board may edit any ledger document. A board edit
always wins.

## Cadence

- **Send cadence:** biweekly, Thursday. The first send is **Thursday 2026-10-29**,
  then every other Thursday. In the northern-hemisphere off-season (December through
  February), the Editor may propose skipping weeks or switching to "plan ahead" issues.
  The proposal goes to the board for confirmation.
- **Send week rhythm (America/Toronto):**
  - **Monday 08:00.** Editor kickoff: open the per-issue parent issue and the research child.
  - **Tuesday 07:00.** Editor: create the Scout child, plus the Writer and Fact-Checker
    children with blockers.
  - **Tuesday.** The Scout runs. The Writer wakes when research and scout are both done.
  - **Wednesday 13:00.** Editor approval gate. The Fact-Checker runs once the draft is
    done. The Editor submits the approval request to the board.
  - **Thursday 07:00.** The Scout runs the pre-send re-check of the featured route. The board sends.
- **Off weeks:** every scheduled routine must check `issue-calendar` first. If this
  is not a send week, post one short comment saying so and close the routine issue as
  `done`. Do not do pipeline work in an off week. The exceptions are the Strategist's
  monthly run and any task explicitly assigned by the Editor or the board.

## Per-issue structure

For each send, the Editor creates one parent issue:

`Dispatch #NN: <Region>: <Route name> (send YYYY-MM-DD)`

The children are always created with `parentId` set to that parent:

| Child title | Assignee | Blocked by | Output document key |
|---|---|---|---|
| `#NN Research: <route>` | route-researcher | none | `route-data` |
| `#NN Conditions & events: <region>` | conditions-events-scout | Research | `conditions-report` |
| `#NN Draft` | writer | Research, Conditions | `draft` |
| `#NN Fact-check & QA` | fact-checker-qa | Draft | `fact-check-report` |

The pre-send re-check is **not** a child issue. A blocker would wake it on Wednesday,
which is too early. The Scout's Thursday 07:00 routine handles it instead. The Scout
writes the `presend-recheck` document on the routine's own issue and links it in a
comment on the parent.

Use first-class `blockedByIssueIds`, so each agent wakes automatically when its
inputs land. Do not poll other agents. Do not ask for status in comments.

Every output document lives **on the child issue that produced it**. Downstream
agents read it from there. When you finish, comment with the document key and a
one-line summary, then mark your child issue `done`.

## Approval gate (non-negotiable)

- No agent sends email, schedules a send, or publishes to Base Camp or any external
  channel. No agent holds send credentials.
- The Editor submits the final draft on the parent issue as a `request_confirmation`
  interaction with `resolverPolicy: "human_only"` and
  `continuationPolicy: "wake_assignee"`. The Editor then moves the parent to `in_review`.
- The approval packet must include:
  - the final draft
  - the fact-check verdict and any open flags
  - the conditions summary and the timestamp of the latest check
  - cost so far for this issue
  - the CTA link
- If the board rejects the draft or asks for changes, the Editor routes the specific
  fixes back to the right child: reopen it or create a new fix child.
- If the Thursday pre-send re-check finds a new closure, fire, or weather risk on the
  featured route, the Scout comments `HOLD SEND` and the reason **on the parent
  issue**. That comment wakes the Editor. The Editor then posts a
  `request_confirmation` to the board: hold, swap the section, or send with the added
  warning.

## Region lane and guardrails

- **Lane:** Canada and the contiguous USA, plus Alaska and Hawaii. Do not leave this
  lane without a board-approved change to the `region-scoring-rubric` skill.
- **Rotation:** do not repeat a region within the last 8 sent issues. The hard
  minimum is 6, and only with board approval.
- **Minimum data threshold:** a region is eligible only if the Route Researcher's
  feasibility check finds at least 3 multi-day routes with public stage-level data.
- **Safety first:** a route with an active closure, fire, or evacuation order, or a
  severe weather warning on its corridor, cannot be featured that week.

## Execution contract (all Dispatch agents)

- Start actionable work in the same heartbeat. Do not stop at a plan unless planning
  was requested.
- Leave durable progress as issue documents and comments, with the next action named.
- Use child issues for long or parallel delegated work instead of polling agents,
  sessions, or processes.
- Mark blocked work with the unblock owner and action. Prefer `blockedByIssueIds`.
- Respect budgets, pause/cancel, the approval gate, and company boundaries.
- Never hire agents, change budgets, or create routines. Ask the Editor, and the
  Editor asks the board.
- Follow the `dispatch-source-rules` skill on every piece of research or writing.
