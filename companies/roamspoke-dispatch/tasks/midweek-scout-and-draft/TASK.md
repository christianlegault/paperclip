---
name: "Tuesday: queue scout, draft and fact-check"
assignee: editor-in-chief
project: dispatch-newsletter
recurring: true
---

Check `issue-calendar` in the Dispatch Ledger. On an off week, comment "Off week"
and mark this issue `done`.

On a send week, under this week's parent Dispatch issue, create:

1. `#NN Conditions & events: <region>` for the Conditions & Events Scout, blocked by
   the Research child.
2. `#NN Draft` for the Writer, blocked by Research and Conditions.
3. `#NN Fact-check & QA` for the Fact-Checker, blocked by Draft.

Use `blockedByIssueIds` so each agent wakes when its inputs are done. If the
Research child is still open, or has flagged a route problem, resolve that first.
Pick the next candidate route, or escalate to the board. Comment the child links on
the parent, then mark this issue `done`.
