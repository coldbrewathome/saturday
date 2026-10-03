# Growth plan → implementation plan (2026-10-03)

Source: external growth memo ("Increase awareness / Critical features"). This doc converts each item
into concrete work against what the codebase already has, with evidence refs. Phases are ordered by
leverage. Status labels: **BUILT** (works today), **PARTIAL** (exists but has a named gap),
**MISSING**.

Audited 2026-10-03 against: `scripts/generate-seo-pages.mjs` (SEO pages), `worker/src/*` (KV +
Resend + weather), `src/*` (SPA), `functions/[[path]].ts` (edge), `skills/*`, `scripts/*`.

---

## 0. Status map — what the memo asks vs. what exists

| Memo item | Status | Evidence / gap |
|---|---|---|
| City-level SEO pages | **BUILT** | 459 city pages, 886 category pages, 153 `this-weekend/{city}` pages, 16 `free-this-weekend` (`generate-seo-pages.mjs` `generateCityPages:4435`, `generateCityWeekendPages:5592`). Titles already query-shaped: `weekendGuideTitle:5494`. |
| Event schema markup | **BUILT** | `buildEventJsonLd:3950` (Event + Place + Geo + offers + audience). Never add `aggregateRating` (policy). |
| Weekend pages indexed fresh weekly | **BUILT** | `this-weekend` pages deliberately bypass the 500/day lastmod budget (`:396-397`, `:5486`); daily-crawled metro hubs link them. Indexing API is a verified no-op — do not re-enable. |
| **Curation / ranking of listings** | **PARTIAL → Phase 1** | The carousel ("Top picks") is `pickWeekendHeadliners` = `headlinerScore` (`:6301`), which is *data-completeness* (`eventQualityScore/25`, up to 4.0) + tiny keyword bonus. Result (verified on live `/miami/this-weekend/`): hero = "I Voted" Sticker Design Contest; 14 library rows tie at 5.76 while the Zoo Miami festival scores 5.36. Editorial picks (`popular-events.json`, fresh for all 16 metros) are **never read** by the SEO generator (`grep popular` = 0 hits) although the SPA uses them (`src/weekendBrief.ts` `POPULAR_LEAD_BOOST=100`). No junk gate in the generator at all (`src/eventQuality.ts isFeedJunkEvent` is app-only) → "Homework Help and Tutoring" ×27 branches ships as 27 timeline cards. |
| Time parsing ("3:00 AM" all-day rows) | **PARTIAL → Phase 1** | Root cause is ingest: `scripts/eventPipeline.mjs:3880 communicoDateTime` hardcodes `-07:00` for every source, so a date-only `00:00:00` row becomes `07:00Z` = 3:00 AM Eastern. 407 Miami rows (528 across metros) render "3:00 AM"; 107 more (`00:00Z`) render "8:00 PM" on weekend pages while city pages say "All day" — the two render helpers disagree on the same datum (`eventIsAllDay:6831` vs `eventTimeStr:4224`). `timeWindow` ("Morning"/"Afternoon") exists in the data but is never read. |
| Weekly email per metro | **PARTIAL — human-ops blocked** | Fully built: per-metro digest, KV `newsletter:{metro}:{email}` subscribers with ageBands/interests/budget/setting/zip, Resend send, unsubscribe + List-Unsubscribe (`worker/src/newsletter.ts:89`, `scripts/newsletter-send.mjs`). Blocked on: Resend account + DNS + secrets + `NEWSLETTER_ENABLED=true` (human). Austin is already in `METROS` (ROADMAP note is stale). |
| Proactive Thursday digest | **PARTIAL** | No scheduler anywhere: worker exports only `fetch` (`worker/src/index.ts:1977`), no `[triggers]` in `wrangler.toml`; sends are operator-run (`scripts/newsletter-send.mjs --send`). |
| Social roundup per metro/week | **PARTIAL — human-ops blocked** | Shorts pipeline built end-to-end (`videos/build-*.mjs`, uploader `videos/upload-shorts.mjs`); needs one-time Google OAuth (`video/youtube-oauth.json` absent). Pinterest: generator works, `pins-queue/2026-08-31…09-02` still `pending`, dispatch is manual Chrome automation per `skills/social-posting`. |
| Partner with sources (backlink/badge) | **PARTIAL** | Embed-snippet backlink block already on pages (`generate-seo-pages.mjs:887`), `docs/launch/BACKLINK-OUTREACH.md` exists. Missing: a public `/partners/` page with copy-paste badge/embed snippets + "add your events" contact — the thing you can actually send a librarian. |
| Local press / bloggers | **BUILT** | `npm run pr:weekly` (`scripts/pr-weekly.mjs`) makes paste-ready listicles ranked by the digest's `scoreEvent`; contacts in `data/pr-contacts.json` (still `placeholder: true` — human step). |
| Personalization (ages + neighborhood) | **BUILT (one gap)** | `FamilyProfile.ageBands` + wizard (`src/familyProfile.ts`, `src/OnboardingWizard.tsx`), `scoreEventForFamily` re-ranks the weekend feed (`src/WeekendView.tsx:289-299`), proximity via device/IP location. Gap: `zipCode` is stored but never geocoded ("until a ZIP geocoder exists", `familyProfile.ts:11-16`) — so "near Sunnyvale" works only when geolocation/IP is available. |
| Add to calendar | **PARTIAL** | Google Calendar template URL exists (`src/eventTrust.ts:45 eventCalendarUrl`, used in `EventDetailView` + `WeekendView` cards, `calendar_save` metric). No ICS/`.ics` download → Apple Calendar/Outlook users get nothing. No add-to-calendar for a whole plan. |
| Weather-aware plans | **PARTIAL** | Live: `GET /weather` (open-meteo, KV-cached, `worker/src/index.ts:873`), rain hints in `weekendBrief.ts:196`, indoor/outdoor profile scoring, planner wet-weather boost. Gaps: (a) the "Indoor backup plan" preset is a static SEO link, never weather-triggered; (b) `hopNow.ts` wet-weather boost is unreachable — `HopNowPanel` never passes `weather` (`src/HopNowPanel.tsx:129`); (c) the digest ignores weather. |
| Parent reviews + photos | **MISSING** | No UGC of any kind (no file inputs, no review/rating code). Closest: check-ins ("Worth it / Skip it") with aggregate trust badges. Worker is KV-only (no D1/R2) — reviews need a storage + moderation design before code. |
| Ticket/deal integration + sponsorship | **MISSING** | Outbound links are raw `event.url` with `rel="noopener noreferrer"` and **no** utm/affiliate params anywhere; no redirect endpoint; no sponsored/promoted mechanism. Copy currently promises "no listing is sponsored" — changing that is a product decision, not just code. |

---

## 1. Phase 1 — Curation & trust on the money pages (implementing now)

Goal: the highest-traffic pages lead with the *best* events and never show a wrong time.
Success criteria (all verifiable locally):

1. `/miami/this-weekend/` (rebuilt) leads with the Zoo Miami festival — the editorial rank-1 pick — not a library sticker contest.
2. No `3:00 AM` (or `8:00 PM`) strings for all-day rows on any weekend/city page; they render "All day" and sort **last** within their day.
3. `isFeedJunkEvent` events (homework help, tutoring, board meetings…) no longer occupy featured slots or the weekend timeline/ItemList.
4. `npm run test`, `npm run build`, `npm run seo:audit`, `npm run seo:i18n-check` all green; ItemList JSON-LD still valid.

### 1a. Editorial picks drive the weekend page (`scripts/generate-seo-pages.mjs`)
- Read `public/data/{metro}/popular-events.json` (`popular-events-adults.json` for the Mosey build — read directly by filename so the kids file can never leak a kids pick onto a Mosey page; no `metroConfig.mjs` change needed).
- Stale gate mirrors the SPA (`src/popularEvents.ts:75`): apply only when `doc.weekendStart === weekend.saturdayKey`; degrade silently otherwise.
- Resolve `picks[].eventId` → event objects from that metro's feed; keep only events that (a) have a generated slug, (b) fall in the Fri–Sun window, (c) pass the junk gate. Cap 6.
- Use them: carousel order = picks first, then `pickWeekendHeadliners` fill (existing 5-card limit); `namePool`/`introPicks` draw from picks-first (same length/format filters); OG-image scrape follows the final carousel set.

### 1b. Fallback curation when picks are missing/stale
- `featuredTier(event)` (0–3): 3 = parade/fireworks/festival keywords or Festival category; 2 = notable venue categories (Museum/Zoo/Aquarium/Theme Park) or show/concert/fair keywords; 1 = ordinary; 0 = routine programming (drop-in / take-and-make / coloring / scavenger hunt / chess club / storytime series) and library-category rows without a marquee keyword.
- `pickWeekendHeadliners` sorts by `(tier desc, headlinerScore desc)` and drops tier 0 → library drop-ins can never win the carousel/title even without a picks file.
- Port `isFeedJunkEvent` from `src/eventQuality.ts` into the generator (exported for tests) and apply where the SPA applies it: weekend timeline, ItemList, carousel, presets, editorial buckets, hub list.

### 1c. All-day rows: one rule, three surfaces
- Generator: `eventIsAllDay` = metro-local midnight **or** span in [22h, 26h] (covers the 23.98h Communico rows; excludes genuine multi-day 31h/341h spans). Export it; make `eventTimeStr` (city pages) delegate to it so the two helpers stop disagreeing.
- Effects: `renderWeekendDaySection` already sorts all-day rows last → drop-in rows stop leading each day; marquee `time` label = "All day".
- JSON-LD: for all-day rows emit local date-only `startDate` and date-only `endDate` (the real ISO values stay in the visible page/feed).
- App: `src/eventDates.ts eventTimeLabel` gets the same span rule (drop the midnight requirement when span ≥ 22h and ≤ 26h).
- Root cause (ingest): fix `communicoDateTime` (`scripts/eventPipeline.mjs:3880`) to use the metro's timezone offset instead of hardcoded `-07:00`, with a unit test. Takes effect on the next ingest run (not needed for the display fixes above).

### 1d. Tests + verification
- `tests/seo-pages.test.mjs`: all-day span detection; picks-drive-carousel (fixture feed + picks doc); junk gate port; tier ordering.
- New vitest case for `eventTimeLabel` all-day span.
- Manual: build, then grep `dist/miami/this-weekend/index.html` for `3:00 AM` (expect 0), check hero href = zoo pick, confirm all-day rows sit last in each day `<ol>`.
- Gates: `npm run test` → `npm run build` → `npm run seo:i18n-check` → `npm run seo:audit`; commit `data/seo-lastmod.json` (mandatory after any build).

---

## 2. Phase 2 — Activation runway (small code, gated on human ops)

| Step | Files | Note |
|---|---|---|
| Thursday scheduler for the digest | `worker/src/index.ts` (+ `wrangler.toml [triggers]`) | Add `scheduled()` that enumerates KV `newsletter:*` and renders per metro at Thu ~15:00 UTC, behind `NEWSLETTER_ENABLED`. Deploy is safe while the flag is off (no-op). |
| Weather-aware digest lead | `worker/src/newsletter-template.ts` | Use the existing `/weather` data (worker-local fetch) to lead with indoor picks when Sat/Sun precip ≥ 40% — same threshold as `src/weekendBrief.ts:171`. |
| Pinterest dispatch | `skills/social-posting` | Recreate the `/tmp/famhop-social` runner; push the 3 stale pending queues (or regenerate for this weekend) — human-approved batches. |
| YouTube OAuth | `video/` | One-time consent; then `videos/upload-shorts.mjs` for this weekend's 16 metro shorts (already rendered pipeline). |
| PR contacts | `data/pr-contacts.json` | Replace `placeholder: true` rows with a real list; `npm run pr:weekly` already produces the copy. |

## 3. Phase 3 — Retention features (code, no human gate)

1. **ICS export** — `src/eventDates.ts`/new `src/calendarIcs.ts`: build a `text/calendar` blob (`BEGIN:VCALENDAR…`) for one event and for a whole plan; keep the existing Google URL as the primary button, add "Apple/Outlook (.ics)". All-day events emit `DTSTART;VALUE=DATE`.
2. **Weather-driven indoor pivot** — pass `weather` into `hopNowPicks` from `HopNowPanel` (fixes the unreachable boost); when Saturday precip ≥ 40%, the weekend brief leads with the indoor picks rail and the SEO `indoor-backup` preset link swaps to the primary CTA on rainy builds.
3. **ZIP → neighborhood** — geocode `FamilyProfile.zipCode` once (offline centroid table for the 16 metros, ~a few hundred ZCTAs) so proximity works without geolocation permission.
4. **Plan-level "save the weekend"** — one ICS with all chosen stops + the plan share URL.

## 4. Phase 4 — Trust layer (UGC) — design first, then code

Reviews/photos need storage + moderation the KV-only worker doesn't have. Proposal: `review:{eventId}:{hash}` KV records + server-side rate limit + moderation queue endpoint + "verified attendee" flag sourced from check-ins. Must NOT emit `aggregateRating` in JSON-LD (Google policy + Maps ToS); display stars only as first-party UI. Photo upload needs R2 → separate decision.

## 5. Phase 5 — Revenue plumbing

1. Outbound click tracking per venue/source (`organizer_click` already fires) → extend with a `?utm_source=famhop` decorator applied **only** when the venue opts in, plus a worker `/out/:id` redirect for affiliate-ready links.
2. Sponsored slots: labeled, capped (1 per weekend page, above the timeline, visually distinct), and reflected in `privacy`/`how-we-verify` copy (which currently promises no sponsorship).
3. Deals feed (BOGO museum days etc.) as a `data/deals.json` curated file rendered as a badge on spot/event cards.

## 6. Explicitly NOT doing

- Re-enabling the Google Indexing API cron (verified no-op for `Event` schema).
- `aggregateRating` in JSON-LD (policy + Maps ToS violation).
- URL restructuring, FAQPage schema, NAP/local-pack work (see CLAUDE.md SEO invariants).
- Removing or noindexing any page without showing 90-day GSC metrics first.

## 7. Sequencing summary

| Phase | Ships | Gate |
|---|---|---|
| 1 | SEO curation + all-day fix (+ingest offset fix) | tests + build + seo:audit green; deploy = CI on push |
| 2 | Thursday cron, weather-led digest, social dispatch, PR contacts | human: Resend/DNS/secrets, OAuth |
| 3 | ICS export, weather pivot, ZIP geocode | none |
| 4 | Reviews/photos | storage + moderation design decision |
| 5 | Affiliate/sponsor/deals | product decision on sponsored copy |
