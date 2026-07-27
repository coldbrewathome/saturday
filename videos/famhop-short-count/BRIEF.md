---
workflow: product-launch-video
flow: automation
storyboard: no
message: "5,163 kid-friendly things to do next week — 2,109 of them free"
destination: youtube-shorts
aspect: 1080x1920
language: en
length: 28s
angle: scale-proof
audience: "Parents in any of the 16 U.S. metros FamHop covers"
narration: yes
---

## Intent

The national/top-of-funnel Short. Where the Bay Area cut answers *"what do we do
Saturday?"*, this one answers *"why should I trust this site?"* — by putting the
coverage on screen as a counted, city-by-city ledger instead of a claim.

Beat order: the number → the free share → the 16-metro roll → the provenance line →
famhop.com. No product UI, no feature list.

## Customizations

- **No capture.** Same inherited design system as `videos/famhop-short-bay`
  (cream `#FAF5EB`, ink `#1B1916`, accent `#DD6A1A`, sun `#E8B547`; Bricolage
  Grotesque 800 / JetBrains Mono / Plus Jakarta Sans).
- **Count-up is a real tween**, snapped to integers, driven off the single paused
  timeline so it stays seek-safe.
- **The metro roll is a ledger, not a montage** — one column, 16 rows, name left /
  count right, staggered. It should read like a receipt.

## Data provenance

Window Mon Jul 27 – Sun Aug 2, 2026, counted directly from `public/data/<metro>/events.json`:

**5,163** events · **2,109** free · **1,344** distinct venues · **16** metros ·
**100%** carry a link back to the source page (`url` or `sourceUrl`, all `https:`).

| Metro | Events | Metro | Events |
|---|---|---|---|
| Bay Area | 895 | Chicago | 253 |
| Washington DC | 547 | Phoenix | 215 |
| Los Angeles | 546 | Honolulu | 167 |
| Philadelphia | 536 | Atlanta | 164 |
| New York City | 483 | Seattle | 132 |
| Miami | 391 | Boston | 125 |
| Houston | 328 | San Diego | 88 |
| Dallas–Fort Worth | 266 | Austin | 27 |

Austin's 27 stays on screen. A ledger that hides its worst row is not a ledger.

## Notes

- The provenance beat claims only what is checkable: every listing links back to the
  venue's own page. It deliberately does **not** claim human review.
