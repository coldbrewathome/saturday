# FamHop metro Shorts — weekend of Sat Aug 1 / Sun Aug 2, 2026

16 vertical (1080×1920) YouTube Shorts, one per metro, generated from the live
event feed. Upload copy for every one is in [`YOUTUBE-METADATA.md`](./YOUTUBE-METADATA.md).
Delivered MP4s are in `videos/delivery-2026-08-01/`.

## Rebuild

```bash
node videos/pick-weekend-events.mjs --weekend 2026-08-08   # choose the events
node videos/build-metro-shorts.mjs                          # write 16 projects (+ narration)
node videos/build-shorts-metadata.mjs                       # write the upload sheet
```

Narration is cached: shared lines live in `videos/vo-shared/`, the per-metro
closing line in each project's `assets/voice/cta.mp3`. Delete a file to
regenerate just that line. `--no-vo` skips ElevenLabs entirely.

## The one thing to understand before publishing

**The feed cannot fill six strong weekend cards in every metro.** The generator
adapts rather than pads, and the adaptation is visible on screen:

| What the data supports | Hook | Cards show |
|---|---|---|
| 6 free weekend events | "6 FREE THINGS TO DO … THIS WEEKEND" | `Free` |
| 6 weekend events, mixed cost | "6 THINGS TO DO … THIS WEEKEND" | real cost, incl. `Check listing` |
| fewer than 6 good weekend events | "… THIS WEEK" | the real weekday |

Austin only reached 4 cards. That is a fact about Austin's listings for this
week, not a bug — 26 events, 4 free.

## Quality tiers (as built, Aug 1–2 weekend)

Ranked by how much genuinely marquee weekend programming the feed carried.

- **Strong — publish first:** Boston, Bay Area, Los Angeles, San Diego, Houston
- **Fine:** Philadelphia, Chicago, New York City, Seattle, Phoenix
- **Thin — read before publishing:** Washington DC, Dallas–Fort Worth, Atlanta,
  Miami, Honolulu, Austin

The thin tier is dominated by library programming because that is what those
feeds actually contain for this weekend. It is honest, it is just not
compelling. Treat that list as the priority queue for weekend-source coverage in
`skills/weekly-event-prep`.

## Data rules the generator enforces

Learned the hard way while building this set — every one of these caught a real
defect that would otherwise have shipped:

- **Never upgrade unknown cost to "free."** A blank `cost` renders as
  `Check listing`, never as `Free`.
- **Geo-fence to 75 miles.** The Hawaii feed is statewide (Hilo, Maui) and one
  Miami record carried a Montana address.
- **Ignore the San Francisco fallback coordinate.** `scripts/eventPipeline.mjs:281`
  returns `[37.7749, -122.4194]` when its city-centroid lookup misses, so 53
  events across 11 metros claim to be in SF — 9 of them in Boston. The picker
  treats that exact pair as "no coordinate" instead of geo-fencing Boston out of
  Boston. **This is a live-site bug too** (map placement, distance sort), not
  just a video problem.
- **A card must name a real place.** Venue strings that are a bare borough or
  repeat the city (`Manhattan, Manhattan`) are dropped.
- **Midnight is an all-day marker,** not a start time — rendered as `All day`.
- **Drop non-outings:** blood drives, vaccination clinics, job fairs, members-only
  previews, adult computer classes, food-assistance programs.
- **Deprioritise standing programs.** A title stem recurring dozens of times in a
  feed is a weekly storytime, not this Saturday's event.
