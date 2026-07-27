---
workflow: product-launch-video
flow: automation
storyboard: no
message: "A whole Saturday in New York City with the kids, for $0"
destination: youtube-shorts
aspect: 1080x1920
language: en
length: 30s
angle: itinerary
audience: "NYC parents, especially the ones who assume a day out costs money"
narration: yes
---

## Intent

The third Short deliberately does **not** repeat the list format. Instead of six
unconnected events it builds one continuous day — 8am to 8pm, six stops, a running
cost total that never leaves `$0`. The running total is the whole gag and the whole
argument: FamHop's job is turning scattered listings into a day you can actually run.

## Customizations

- **No capture.** Same inherited design system as the sibling shorts.
- **Running total is a persistent element**, not per-scene decoration: it holds `$0`
  across all six stops so the viewer watches it *fail to move*.
- **Time is the spine.** Each stop leads with its clock time in mono, so the frames
  read as a schedule rather than a list.

## Data provenance

All six stops are `cost: "Free"`, `verified: true` records for **Sat Aug 1, 2026** in
`public/data/new-york-city/events.json`, times in America/New_York:

| Time | Event | Venue | Borough |
|------|-------|-------|---------|
| 8:00 AM | Greenmarket at Grand Army Plaza | Prospect Park | Brooklyn |
| 10:00 AM | Nature Exploration | Prospect Park | Brooklyn |
| 12:00 PM | Pop-Up Audubon II | Prospect Park | Brooklyn |
| 1:00 PM | Park Open Studio | Washington Square Park | Manhattan |
| 3:00 PM | Summer on the Hudson: Story Hour! | Riverside Park | Manhattan |
| 8:00 PM | Movie Night: Zootopia 2 | Randall's Island Park | Manhattan |

Closing stats from the same file, Mon Jul 27 – Sun Aug 2:
**483 NYC family events next week, 467 of them free.**

## Notes

- `famhop.com/new-york-city/this-weekend` verified 200 before authoring.
- The day is geographically honest: three Prospect Park stops in the morning, then
  Manhattan in the afternoon and evening. Wave Hill (Bronx) was cut for that reason
  even though it fit the price.
