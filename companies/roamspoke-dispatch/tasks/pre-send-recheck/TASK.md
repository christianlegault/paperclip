---
name: "Thursday: pre-send conditions re-check"
assignee: conditions-events-scout
project: dispatch-newsletter
recurring: true
---

Run the pre-send re-check from your AGENTS.md:

1. If `issue-calendar` shows no issue `approved` or `in-production` for today's send,
   comment "Off week. No re-check needed" and mark this issue `done`.
2. Otherwise, re-check closures, fire, smoke, and weather warnings on the featured
   route's corridor only. Write a `presend-recheck` document on this issue.
3. If anything material changed since the Tuesday `conditions-report`, comment
   **`HOLD SEND`** on the parent Dispatch issue with the change and its tier 1
   sources. Otherwise, comment "Pre-send re-check clear as of <time>" on the parent.
4. Mark this issue `done`.
