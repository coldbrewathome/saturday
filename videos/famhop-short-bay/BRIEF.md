---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Six real, free, kid-friendly things to do in the Bay Area this weekend"
destination: youtube-shorts
aspect: 1080x1920
language: en
length: 30s
angle: utility-list
audience: "Bay Area parents searching for something to do this weekend"
narration: yes
---

## Intent

A YouTube Short that earns the click by being *useful first*: six real, verified,
genuinely free Bay Area family events happening Sat Aug 1 – Sun Aug 2, 2026, each with
venue, city and start time, then one CTA to `famhop.com/bay-area/this-weekend`.

This is a promo for famhop.com, but the product pitch is the *last* five seconds. The
first twenty-five seconds are the answer the viewer came for — that is the whole angle.

## Customizations

- **No capture.** Brand tokens, fonts and design language are inherited verbatim from
  the sibling project `videos/famhop-promo` (cream `#FAF5EB`, ink `#1B1916`, accent
  `#DD6A1A`, sun `#E8B547`; Bricolage Grotesque 800 headlines, JetBrains Mono chrome,
  Plus Jakarta Sans body). Do not re-crawl the site.
- **Alternating ground.** Odd cards on cream, even cards on ink — a flip-flop rhythm
  that reads at thumb-scroll speed.
- **Shorts safe area.** Key content stays inside x 72–1008, y 150–1700. Nothing
  load-bearing below y 1700 (YouTube's title/action overlay).

## Data provenance

Every event below is a verified record in `public/data/bay-area/events.json`
(`cost: "Free"`, `verified: true`), start times rendered in America/Los_Angeles.
Invent nothing; if a fact is not in that file it does not go on screen.

| # | Title | Venue | City | When |
|---|-------|-------|------|------|
| 01 | 52nd Annual Nihonmachi Street Fair | Japantown, Post Street | San Francisco | Sat + Sun · 11:00 AM |
| 02 | Fremont Festival of the Arts | Downtown Fremont | Fremont | Sat + Sun · 10:00 AM |
| 03 | Space Week Festival | Chabot Space & Science Center | Oakland | Sat + Sun · 10:00 AM |
| 04 | Watsonville Strawberry Festival | Historic Downtown Watsonville | Watsonville | Sat + Sun · 11:00 AM |
| 05 | Jerry Day 2026 | Jerry Garcia Amphitheater, McLaren Park | San Francisco | Sat · 11:30 AM |
| 06 | Color Your Mind | Yerba Buena Gardens | San Francisco | Sun · 12:00 PM |

Closing stat, also from that file: **895 Bay Area family events next week, 435 of them free.**

## Notes

- `famhop.com/bay-area/this-weekend` verified 200 before authoring.
- Stern Grove Festival (Violent Femmes, Sun 2 PM, free) was dropped for card 06 in
  favour of Color Your Mind — same weekend, same price, unambiguously a kids' event.
