---
name: dispatch-style-guide
description: Voice, structure, formatting, and call-to-action rules for writing RoamSpoke Dispatch stage-by-stage itinerary issues, with example issues in references/. Use when drafting or reviewing a Dispatch issue.
---

# Dispatch Style Guide

## Who we're writing for

Riders who plan multi-day trips **with other people**: a crew of friends, a club, a
partner. They want to know whether the trip fits their group and how to split the
days, and they want the plan in one place. They're competent, busy, and allergic to
fluff.

## Voice

- Practical, warm, specific. Write like a friend who has done the research, not like
  a tourism board.
- Short sentences. Active voice. Use "you" and "your crew".
- No hype words: "epic", "insane", "hidden gem", "bucket list", "breathtaking".
  Show it with a specific detail instead.
- Be honest about the hard parts: the hike-a-bike, the dry 40 km, the closed store.
  Readers trust us because we warn them.
- Never invent sensory detail you can't source. Do not write "the scent of pine on
  the climb" unless a source says so. Facts first.

## Issue structure (fixed order)

1. **Subject line** (≤ 55 characters) and **preview text** (≤ 90 characters).
   Region and day count in the subject, for example "4 days in the Kootenay Rockies".
2. **Intro** (60 to 90 words). Who this trip suits, why now (season), and the
   one-line shape of the trip.
3. **At a glance.** A table with distance (km / mi), climbing (m / ft), days, surface
   mix, best season, start/finish, and permits.
4. **Stage by stage.** One block per day:
   - `Day N: From → To · XX km / XX mi · +X,XXX m / +X,XXX ft`
   - 2 to 4 sentences of route character, in your own words
   - **Camp:** name, type, reservation note
   - **Resupply:** where, and at what km
   - **Water:** where, and how reliable
   - **Bail-out:** one line
5. **Planning with a crew.** 2 to 4 bullets from `crew_notes`: group campsite
   limits, regroup points, shuttle options, where a slower rider can shortcut.
6. **What's happening.** Conditions summary with the date checked, then up to 5
   events (races, group rides) with dates and registration deadlines. Lead with
   urgency, for example "Registration closes Nov 3".
7. **Call to action (exact copy).** It must be the last *content* section, followed
   only by Sources and the footer, and must look like this:

   > **Copy this trip into RoamSpoke and invite your crew.**
   > [Copy the trip →]({{CTA_LINK}})

   - The visible sentence is **exactly** "Copy this trip into RoamSpoke and invite
     your crew." Keep that wording, capitalization, and punctuation.
   - `{{CTA_LINK}}` is the live link from the Ledger `cta-config` document. If that
     document is `pending`, use `{{COPY_TRIP_URL:dispatch-NN}}`.
   - Never link the CTA to the RoamSpoke homepage.
   - One optional line above the CTA may say what happens next. For example: "Opens
     a shared trip with all 4 stages, camps and resupply pre-filled. Send the invite
     link to your crew."
8. **Sources.** A list of every source linked in the issue.
9. **Footer.** A safety disclaimer, reproduced verbatim: "Conditions change. Check
   official agency pages before you ride." Then the date conditions were last checked.

## Formatting

- Length: 600 to 1,000 words, excluding tables and sources.
- Use metric first with imperial in parentheses in prose, and both in tables.
- Round distances to whole km and elevation to the nearest 10 m. Do not round any
  number the Fact-Checker can't trace to `route-data`.
- Markdown only, with no HTML. Headings are `##` for sections and `###` for days.
- Every number in the draft must come from `route-data` or `conditions-report`. If a
  value is `null` there, write "unconfirmed" and do not guess.

## Issue types

- **Standard itinerary** (default): one featured route, built as above.
- **Plan ahead** (off-season or seasonal): one featured route for a future season,
  plus 2 short "also consider" routes, each with a one-line pitch. The headline
  carries the season, for example "Spring route ideas".
- **Events and group rides** (future): use only when the Editor schedules it.

## Examples

See `references/example-standard-issue.md` and `references/example-plan-ahead-issue.md`.
Both examples use a **fictional** route to show voice and structure only. Never reuse
their facts.
