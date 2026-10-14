---
name: route-data-contract
description: JSON shapes for RoamSpoke Dispatch structured documents - feasibility check, route-data, conditions-report, presend-recheck, and fact-check-report - so the Writer and Fact-Checker work from facts, not prose.
---

# Route Data Contract

All structured outputs are issue documents whose body is a fenced `json` block,
followed by an optional short "Notes" section in markdown. Units: kilometres and
metres, with miles and feet derived by the Writer. Dates use ISO 8601 and the
America/Toronto timezone unless noted. Every fact carries `sources` (see
`dispatch-source-rules`).

## `feasibility-check` (Route Researcher → Region Strategist)

```json
{
  "requested_regions": ["Region A", "Region B", "Region C", "Region D"],
  "results": [
    {
      "region": "Region A",
      "eligible": true,
      "qualifying_routes": [
        {
          "name": "Route name",
          "url": "https://...",
          "days": 4,
          "distance_km": 260,
          "has_public_stage_data": true,
          "data_access": "public",
          "sources": []
        }
      ],
      "notes": "Why routes were excluded, if any"
    }
  ]
}
```

A route qualifies only if it is multi-day (2 nights or more), has public stage-level or
waypoint data, and has `data_access: "public"`.

## `route-data` (Route Researcher → Writer, Fact-Checker)

```json
{
  "issue": 1,
  "region": "Region",
  "route": {
    "name": "Route name",
    "official_url": "https://...",
    "loop_or_point_to_point": "loop",
    "total_distance_km": 260,
    "total_elevation_gain_m": 4200,
    "surface_mix": { "paved_pct": 20, "gravel_pct": 65, "singletrack_pct": 15 },
    "recommended_days": 4,
    "best_season": { "from": "MM-DD", "to": "MM-DD", "notes": "" },
    "difficulty": "moderate",
    "start_access": { "nearest_town": "", "transit_or_parking": "", "sources": [] },
    "permits_required": false,
    "sources": []
  },
  "stages": [
    {
      "day": 1,
      "from": "Start town",
      "to": "Camp or town",
      "distance_km": 68,
      "elevation_gain_m": 1100,
      "highlights": ["short factual phrases in your own words"],
      "camping": [{ "name": "", "type": "frontcountry|backcountry|dispersed|paid", "reservation": "required|recommended|none", "sources": [] }],
      "resupply": [{ "name": "", "km_from_stage_start": 34, "type": "grocery|store|cafe|water_only", "hours_note": "", "sources": [] }],
      "water": [{ "name": "", "km_from_stage_start": 20, "reliability": "reliable|seasonal|unknown", "sources": [] }],
      "bailout": "",
      "sources": []
    }
  ],
  "alternates": [{ "name": "", "description": "", "sources": [] }],
  "crew_notes": "Facts relevant to group planning: group campsite limits, shuttle options, regroup points",
  "unknowns": [{ "field": "stages[2].resupply", "note": "No source found" }]
}
```

Stage distances must sum to `total_distance_km`. A tolerance of ±3% is allowed and
must be explained in `unknowns`.

## `conditions-report` and `presend-recheck` (Conditions & Events Scout)

```json
{
  "checked_at": "2026-10-27T09:15:00-04:00",
  "region": "Region",
  "route_verdict": "clear|caution|do_not_feature",
  "closures": [{ "segment_or_area": "", "status": "", "effective": "", "sources": [] }],
  "fire_smoke": [{ "item": "", "status": "", "sources": [] }],
  "weather_outlook": { "summary": "", "warnings": [], "sources": [] },
  "access_and_permits": [{ "item": "", "sources": [] }],
  "events": [
    {
      "name": "",
      "type": "race|group_ride|festival|clinic",
      "date": "YYYY-MM-DD",
      "registration_deadline": "YYYY-MM-DD|null",
      "location": "",
      "url": "",
      "group_friendly": true,
      "sources": []
    }
  ],
  "flags_for_editor": []
}
```

`do_not_feature` must explain why in `flags_for_editor`, citing tier 1 sources.
The Writer may include at most 5 events, sorted by registration deadline.

## `fact-check-report` (Fact-Checker → Editor)

```json
{
  "verdict": "pass|pass_with_fixes|fail",
  "checked_at": "",
  "claims_checked": 0,
  "issues": [
    {
      "severity": "blocking|major|minor",
      "location": "Stage 2, paragraph 1",
      "claim": "",
      "finding": "",
      "evidence": [],
      "suggested_fix": ""
    }
  ],
  "links": [{ "url": "", "status": 200, "ok": true }],
  "cta_check": { "present": true, "exact_copy": true, "link_ok": true, "notes": "" },
  "source_rules_check": { "copied_text_found": false, "notes": "" }
}
```

`fail` is required if any of these are true: there is a `blocking` issue, a safety
claim lacks a tier 1 or 2 source, the CTA is missing or altered, or copied text was found.
