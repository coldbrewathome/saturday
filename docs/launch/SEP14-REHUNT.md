# Sep 14 Re-hunt Checklist — Halloween wave 3 + seasonal re-checks

_Ready when the date arrives (per seasonal-calendar publish-bys: "halloween
events for kids" Sep 14, "trick or treat events" Sep 21). Run the same
grounded-discovery flow as waves 1-2: verify dates on official pages, gates
on short visible-text strings, one source per verified event, merge →
`node scripts/ingest-events.mjs --metro=<m>` → `npm run validate:events:all`
→ build → audit → push (CI deploys apps + feed automatically).

## A. Zoo Boo / Boo at the Zoo (publish ~early Sep, verified undated 2026-08-30)
- [ ] Bronx Zoo Boo — https://bronxzoo.com/boo-at-the-zoo (page said "on sale 8/29, check back soon")
- [ ] Queens Zoo Boo — https://queenszoo.com/
- [ ] Staten Island Zoo Zoo Boo — staten island zoo (external boomte.ch calendar)
- [ ] SF Zoo Boo at the Zoo — https://sfzoo.org/events/ (30th annual per sfcollege.edu lead)
- [ ] Oakland Zoo Boo — https://www.oaklandzoo.org/programs-and-events/
- [ ] LA Zoo Boo — https://www.lazoo.org/explore-experiences/special-events/
- [ ] Brookfield Zoo Boo! — https://www.brookfieldzoo.org/events
- [ ] Happy Hollow Halloween — https://happyhollow.org/events/

## B. City-parks Halloween (NYC/DC publish early; re-run the rest)
- [ ] Phoenix — https://phoenix.gov/parks/events (calendar already listing fall 2026 entries, e.g. "Crafts with Bats!")
- [ ] Boston Fall-o-Ween — Boston Common (annual; search.boston.gov)
- [ ] San Diego Halloween Carnival / Halloween Hunt — sandiego.gov (currently stuck showing the 2024 date — re-verify)
- [ ] Atlanta (atlantaga.gov Akamai-blocked — retry, or browser-context)
- [ ] Seattle / Austin / Houston / Philly / Miami / Dallas-FW — first-pass sweep found nothing dated; re-check
- [ ] Great America Great Pumpkin Fest — https://www.greatamerica.com/events/great-pumpkin-fest (JS site; usually publishes late Aug/early Sep)

## C. Pumpkin patches that hadn't published (re-check)
- [ ] Arata Pumpkin Farm — https://www.aratapumpkinfarm.com/ (homepage still showed the stale 2025 closing banner on 08-30)
- [ ] Spina Farms — https://www.spinafarms.com/ (bot-blocked on 08-30)
- [ ] Tanaka Farms — already live via ticketSpice extractor (Sep 12 – Nov 1); no action unless the season page changes

## D. Also due soon
- [ ] Decorative/harvest events: Descanso "Carved" (LA) — https://www.descansogardens.org/carved/ (page exists, 2026 dates unverified 08-30)
- [ ] Richardson Adventure Farm (Chicago metro) — Cloudflare-blocked on 08-30; retry (corn maze season)
- [ ] Keep the Village Halloween Parade + Blaze + LPZ Spooky Zoo annual pages in sync when 2027 dates appear (they cross-link automatically)

## Process reminders
- Marquee events (festival/parade/fair) get the 120-day window — non-marquee Oct
  events enter the feed ~mid-Sep on the 45-day window; pages mint when in-window.
- Gates: short visible-text fragments only; nothing past the 1MB pageText slice
  (see the Gilroy fix); no dashes/em-dashes.
- After merging: ingest the metro, grep the new event ids in events.json, then
  the full gate chain — `validate:events:all` (regen plans first if it names
  ended refs), build, `seo:audit` 0 errors, push. CI handles deploys.
- Update docs/launch/REQUEST-INDEX-CANDIDATES.md with the new pages.
