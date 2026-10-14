---
name: "Wednesday: QA and board approval gate"
assignee: editor-in-chief
project: dispatch-newsletter
recurring: true
---

Check `issue-calendar` in the Dispatch Ledger. On an off week, comment "Off week"
and mark this issue `done`.

On a send week:

1. Read the `fact-check-report` on this week's Fact-check child.
   - If the Fact-check child isn't done yet, comment the current state on the parent
     and mark this issue `done`. When the parent's children are all closed, Paperclip
     wakes you on the parent with `issue_children_completed`, and you run the gate then.
   - On `fail`, route specific fixes to the Writer or the Researcher, and re-queue
     fact-check.
   - If the draft cannot pass by 18:00 ET today, submit a `request_confirmation` to
     the board: skip this week, or send a shorter conditions-only issue.
2. On `pass` or `pass_with_fixes` with fixes applied:
   - Write the `final` document on the parent.
   - Submit a `request_confirmation` with `resolverPolicy: "human_only"` and
     `continuationPolicy: "wake_assignee"`. Include the approval packet from your
     AGENTS.md.
   - Move the parent to `in_review`.
3. Mark this routine issue `done`. The parent carries the approval wait.

No agent sends. The board sends on Thursday, after the Scout's pre-send re-check.
