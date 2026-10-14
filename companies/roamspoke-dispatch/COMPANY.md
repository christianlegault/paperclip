---
name: RoamSpoke Dispatch
description: Agent team that produces a biweekly stage-by-stage bikepacking itinerary newsletter for RoamSpoke, built on a regional route digest, with a human approval gate before every send.
slug: roamspoke-dispatch
schema: agentcompanies/v1
version: 0.1.0
license: MIT
authors:
  - name: Christian Legault
goals:
  - Grow an audience of riders who actively plan multi-day and group bikepacking trips
  - Ship one accurate, source-linked stage-by-stage itinerary issue every other Thursday
  - Convert readers into RoamSpoke trip planners via "Copy this trip into RoamSpoke and invite your crew"
  - Never send wrong trail, closure, or safety information
tags:
  - newsletter
  - bikepacking
  - content
---

RoamSpoke Dispatch is a self-contained newsletter team that plugs into the existing
RoamSpoke company and its Base Camp page. It is imported as an org subtree: the
Editor-in-Chief reports to the RoamSpoke CEO, and the board (you) approves every
issue before it is sent.

Each issue features **one multi-day bikepacking route** in one North American region,
broken into daily stages with distance, elevation, camping, resupply, and best season,
plus a short "what's happening" section of conditions, closures, races, and group rides.
Every issue ends with the call to action:

> **Copy this trip into RoamSpoke and invite your crew.**

The link lands readers in RoamSpoke's core use case, planning a trip together. It does
not point at a homepage.

## Pipeline

1. **Region Strategist** (monthly) scores candidate regions and asks the Route Researcher
   for a quick feasibility check. It then produces a ranked shortlist of 3 regions and a
   region plan for the next 4 weeks.
2. **Editor-in-Chief** picks the region for each issue. The board can override that pick.
3. **Route Researcher** (Monday) builds structured stage data for the featured route.
   **Conditions & Events Scout** (Tuesday) checks closures, alerts, and events.
4. **Writer** (Tuesday) drafts the issue from the structured data only.
5. **Fact-Checker & QA** (Wednesday) verifies every number, claim, and link against sources.
6. **Editor-in-Chief** submits the final draft to the board for approval (Wednesday).
7. **Scout** re-checks the featured route right before the send (Thursday morning).
8. **The board sends.** No agent has send permissions.

## Later additions (not hired yet)

- **Publisher**: formats and schedules issues through the email platform's API, once the output is trusted.
- **Growth agent**: drafts social posts and repurposes each issue.
- **Community Curator**: surfaces standout public RoamSpoke trips once there are users.

Hiring any of these requires board approval.
