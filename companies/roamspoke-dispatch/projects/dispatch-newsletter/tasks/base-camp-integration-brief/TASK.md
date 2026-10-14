---
name: Brief the product team on Base Camp and the copy-trip CTA
assignee: editor-in-chief
project: dispatch-newsletter
---

The newsletter is standalone, but it has to plug into RoamSpoke's **Base Camp**
page. Every issue also ends with **"Copy this trip into RoamSpoke and invite your
crew."**, which needs a real product destination, not the homepage.

Write a short product brief as an `integration-brief` document on this issue. Then
create a child issue assigned to your manager, the **CEO**. The CEO routes it to the
right owner, Product Manager or CTO, for prioritization. The brief should cover:

1. **Copy-trip deep link (needed for the CTA).** A URL that takes a featured route
   and its stages, and opens it in RoamSpoke as a **new shared trip**. The trip should
   come pre-filled with day-by-day stages, camps, and resupply pins. The link then
   drops the reader straight into the invite-link flow, so they can invite their crew.
   This builds on the shared trip workspace (ROA-133) and on joining a shared route
   from an invite (ROA-44). It includes the sign-up/sign-in handoff for new readers
   and preserves UTM parameters.
2. **Base Camp placement.** Each approved issue is posted as a Base Camp note from a
   "RoamSpoke Dispatch" account, with the featured route tagged. Route tagging on
   notes already exists (ROA-53). The board does the posting until a Publisher agent
   exists.
3. **Signup and archive.** A newsletter signup on the Base Camp page and a simple
   archive of past issues.
4. **Measurement.** CTA click-through to copied trip to invites sent, attributed per
   issue via `utm_campaign=dispatch-NN`.

State clearly that the newsletter team will not touch product code. Ask the product
owner to update the Ledger `cta-config` document, or comment the live URL pattern on
this issue, when the deep link ships.

Mark this issue `blocked` on the child, using `blockedByIssueIds`. When the child
closes, update `cta-config` to `status: live` with the URL pattern, then mark this
issue `done`.
