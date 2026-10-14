---
name: region-scoring-rubric
description: Scoring rubric, hard gates, lane, and output format the RoamSpoke Dispatch Region Strategist uses to produce an auditable ranked shortlist of 3 regions and a 4-week region plan.
---

# Region Scoring Rubric

Use this rubric every time you rank regions, so that choices stay consistent and
auditable. Show your inputs. A score without its evidence is not acceptable.

## Lane (hard boundary)

Allowed: **Canada and the USA** (contiguous states, Alaska, Hawaii).
A "region" is a rideable area a reader would recognize and could plan one trip in,
for example "Kootenay Rockies, BC", "Arizona Sky Islands", "Driftless Area, WI/MN/IA",
or "Eastern Townships, QC". It is smaller than a province or state and larger than
a single trail.

Do not score regions outside the lane. Changing the lane requires board approval.

## Hard gates (fail any one and the region is excluded)

1. **Lane:** the region is outside Canada/USA.
2. **Rotation:** the region appears in the last **8** rows of `region-log`. Six is
   allowed only with explicit board approval recorded in the Ledger.
3. **Seasonality:** the riding window does not cover the target send dates plus 4 to 8
   weeks. Also excluded: expected snow at route elevations, peak fire season, monsoon,
   or extreme heat during that window.
4. **Safety and access red flag:** an active large fire or evacuation order, a
   corridor-wide closure, or a permit lottery that readers cannot realistically get
   in time.
5. **Minimum data threshold:** the Route Researcher's feasibility check found fewer
   than **3** multi-day routes with public stage-level data. The Strategist cannot
   waive this gate.

## Weighted criteria (score each 1 to 5, multiply by weight, max 100)

| Criterion | Weight | 5 looks like | 1 looks like |
|---|---|---|---|
| Seasonality | 5 | Prime season across the whole window | Shoulder season at best |
| Route supply | 4 | 5+ quality multi-day routes with full public data | Exactly 3, thin data |
| Audience demand | 3 | Rising search interest, active forum/subreddit threads, events in window | Little discussion |
| Competition gap | 3 | Big sites cover it thinly or out of date | Already a top feature on major sites this season |
| Growth fit | 2 | Existing or target RoamSpoke users nearby (once data exists) | No signal |
| Safety and access | 3 | No permits, good bailouts, low seasonal risk | Permits, remote, or elevated seasonal risk |

Total = Σ(score × weight). The weights sum to 20, so the maximum is 100.

Until RoamSpoke usage data exists, score **Growth fit** as 3 for every region and say so.

## Evidence required per criterion

- **Seasonality:** climate normals or agency season guidance, with a link.
- **Route supply:** the feasibility check result: route names and links from the Researcher.
- **Audience demand:** at least 2 signals, such as search trend direction, number of
  recent forum threads, or events in the window. Link to them.
- **Competition gap:** what the major sites have published on this region in the
  last 12 months, with links.
- **Safety and access:** current fire/closure status and permit requirements, from tier 1 sources.

## Output format (the `region-shortlist` document)

1. **Context:** target send dates and the current month's seasonal picture.
2. **Excluded regions:** a table of region and the gate it failed.
3. **Ranked shortlist of exactly 3:** for each region:
   - a score table (criterion, raw score, weight, weighted, evidence links)
   - total score
   - a one-paragraph rationale
   - safety and access flags
   - 3 to 5 candidate routes from the feasibility check
4. **4-week region plan:** which region feeds which upcoming send date, with fallbacks.
5. **Performance learnings:** what `region-log` open and click rates suggest. Write
   "insufficient data" until there are at least 4 sent issues.
