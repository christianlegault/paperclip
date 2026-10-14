---
name: dispatch-source-rules
description: Sourcing, attribution, and copyright rules for RoamSpoke Dispatch research and writing. Summarize in your own words and link out, never copy, cite every fact, and prefer primary and official sources for safety information.
---

# Dispatch Source Rules

## Summarize and link. Never copy.

- Write every sentence in your own words. Do not paste or lightly reword paragraphs,
  stage descriptions, or trip reports from other sites.
- Short factual data points such as a distance, an elevation, or a campground name
  are fine to use. Cite where each one came from.
- Direct quotes: at most one short quote (under 25 words) per issue, attributed and
  linked. Use quotes only when the exact wording matters, such as an agency's
  closure notice.
- Never redistribute GPX/KML files, maps, photos, or route descriptions from other
  platforms. Link to the original page instead.
- Do not scrape behind logins or paywalls. Respect `robots.txt` and the site's terms.
  If data is only available after signing in, record the route as
  `data_access: "login_required"` and do not use it.

## Source hierarchy

Prefer sources higher on this list. Safety and conditions claims **must** come from
tier 1 or 2.

1. **Official agencies:** national, state, and provincial parks; national forests and
   BLM (USA); Parks Canada; provincial ministries; DOTs; fire agencies (InciWeb, CIFFC,
   provincial wildfire services); NWS/NOAA; Environment and Climate Change Canada;
   AirNow / FireSmoke.ca.
2. **Route owners and organizers:** official pages for a route, race, or event, and
   trail associations.
3. **Route platforms and established bikepacking publications:** use them for route
   discovery and stage data, with a link and attribution.
4. **Community sources** such as forums, subreddits, and trip reports: use them for
   demand signals and color only. Never use them as the sole source for a number or
   a safety claim.

## Citation format

Every fact in a structured document carries a `sources` array of
`{ "url", "title", "publisher", "accessed": "YYYY-MM-DD" }`. In prose drafts, every
paragraph that contains facts ends with its source links, or the facts link inline.

## Unknowns

If you cannot source a number, write `null` with a `note`. Do not estimate. The
Fact-Checker treats any unsourced number as a blocking flag.
