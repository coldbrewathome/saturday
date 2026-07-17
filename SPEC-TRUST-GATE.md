# SPEC-TRUST-GATE — Feed trust-safety gate v2

Status: spec (2026-07-16). Author: Fable. Implementer: subagent (sonnet).
Scope: harden the v1 gate shipped 2026-06-10 (`03f8256`, `a3bf989`, `0994bca`) and close every hole verified live today. No SEO feature work in this spec — only trust-safety.

## 0. Ground truth (verified 2026-07-16, do not re-litigate)

v1 already exists. Build on it, don't rewrite it:

| Concern | v1 location |
|---|---|
| Venue blocklist | `scripts/lib/brandSafety.mjs`, enforced in `scripts/spotPipeline.mjs:907,952` (ingest) + `scripts/validate-data.mjs:31-36` (CI gate) + `scripts/sweep-brand-safety.mjs` (offline sweep) |
| Adults feed filter | `scripts/lib/adultAudience.mjs` (`qualifiesForAdultFeed`) |
| Plan geography | `scripts/lib/planQuality.mjs` (`coherentPicks`, ≤15 mi pairwise radius; `expiredFeaturedPlanRefs`) |
| Render freshness | `src/eventFreshness.ts` (`isUpcomingEvent`), applied at 11 call sites in `src/App.tsx` + `src/hopNow.ts` |
| SEO audience split | `scripts/generate-seo-pages.mjs` (`audienceVisible`, `ADULT_DATA_FILES`, `KIDS_SPOT_CATEGORIES` line ~1815) |

**Confirmed live violations (all reproduce today):**

1. Kids `spots.json` still ships: `TruePrep Guns And Gear` (atlanta, Shopping), `Realco Guns` (washington-dc, Shopping), `Casino Miami` (miami, Wellness), `CAKE Nightclub` (phoenix, Food). `npm run validate:data:all` passes on all of them — these are **pattern/taxonomy holes**, not enforcement-scope holes:
   - Bare/trailing "Guns" never matches `\bgun\s?(range|shop|store|club|show)\b`.
   - Gambling and nightlife/alcohol-primary venues are entirely absent from the v1 kids taxonomy.
2. trymosey.com (adults brand) sitemap ships 13 kids URLs: 3 playgrounds, `children-s-discovery-museum-san-jose`, `walt-disney-family-museum`, and 8 `*-kids-show-*` event pages. Two mechanisms:
   - **Events:** Yerba Buena Gardens Festival is in the *adults* source registry, so its "(Kids’ Show)" events arrive `audiences:["adults"]`, and `qualifiesForAdultFeed` rule 3 (adults-tag → accept) fires **before** the kids-content check. Source tag outranks content evidence — wrong precedence.
   - **Spots:** `spots-adults.json` / the adults SEO build has no kids-primary-venue exclusion (playgrounds, children's museums pass straight through to Mosey pages + sitemap).
3. `npm run validate:data` (no flag) validates **Bay Area only**; nothing in the deploy path runs `--all`.
4. `isUpcomingEvent` returns `true` for any event with no `startDateTime` **even when `endDateTime` is in the past** (`src/eventFreshness.ts:16`).

Current feeds happen to be fresh (daily refresh repaired 06-10) and Bay Area plans pass geography — the remaining work is closing bypasses so trust doesn't depend on every upstream job staying healthy.

---

## A. Kids-brand venue taxonomy v2

### A1. Categories

The kids (FamHop) feed must never surface a venue whose **primary character** is any of:

| Class | Verdict returned | Notes |
|---|---|---|
| `weapons` | block kids **and** adults | gun/firearm retail, ranges, rod & gun clubs, tactical/ammo |
| `cannabis` | block kids; adults keep lounges but not retail dispensaries | includes smoke/vape/head shops, CBD retail |
| `gambling` | block kids | casinos, card rooms, sportsbooks, adult gaming centres |
| `alcohol` | block kids | venues whose primary type is drinking: bar/pub/nightclub/brewery/winery/distillery/taproom/saloon/speakeasy/liquor store |
| `adult` | block kids | strip/gentlemen's clubs, adult retail, burlesque venues, hostess clubs |
| `age_gated` | block kids | hookah/cigar/vape lounges, explicit "21+" venues |

### A2. Signal tiers (evaluation order)

1. **Allowlist** (`data/brand-safety-allowlist.json`, new): array of `{ id?, name, metro?, reason }`. A match short-circuits to *safe*. Seed with the verified false positives: `False Gun Vista` (vista point), `Gunston Park`, `Gunzo's Sports Center` (hockey shop), `The Gundis` (Kurdish restaurant), `Shogun` (+ any `*gun*` substring-only names the new patterns would newly hit), `Movie Tavern*` (family cinema chain), `Fraunces Tavern Museum`, `Golden Ball Tavern Museum`, `Munroe Tavern` (historic house), `George Washington's Distillery & Gristmill` (historic site), `Walt Disney Family Museum` (adults side — see D2).
2. **Denylist** (`data/brand-safety-denylist.json`, new): same shape, forces a class. For offenders that evade all patterns (cute-named dispensaries like "The Apothecarium", "Sunnyside"; venue-specific judgment calls). Both files are loaded by `brandSafety.mjs` and honored by ingest, sweep, and validate.
3. **Tag/type signals** (authoritative, low false-positive): OSM-derived `tags[]` values and `googleType`. Extend v1 sets:
   - weapons: + `hunting`, `gun_shop`
   - cannabis: + `cannabis_store`, `smoke_shop`, `cbd`
   - gambling (new): `casino`, `gambling`, `adult_gaming_centre` (move from `adult`), `betting`, `bookmaker`, `card_room`
   - alcohol (new): `bar`, `pub`, `nightclub`, `biergarten`, `brewery`, `winery`, `distillery`, `wine`, `alcohol` (OSM shop=alcohol = liquor store), `liquor_store`
   - **Correction (pipeline-map verified): there is no `googleType` field in spot data** — spots are OSM/Overpass-sourced; Google Places is enrichment-only (ratings/hours/images). All tier-3 signals are OSM `tags[]` values (see `inferCategory`, `scripts/spotPipeline.mjs:335-384`, which already maps `amenity∈{bar,biergarten,pub,nightclub}→Nightlife`). Verify OSM `shop=*`/`amenity=*` values actually survive into `tags[]` where `brandSafetyViolation` runs; if they're dropped before the gate, fix that propagation — tag signals are the only thing that catches keyword-free names like "MedMen".
4. **Name patterns** (conservative). Additions to v1:
   - weapons: `\bguns?\b` when the spot's category is `Shopping` **or** name also contains `gear|ammo|arms|armory|outfitters|pawn`; `\brod\s?(&|and)\s?gun\b`; `\bgun\s?works\b`; `\bshooters?\b` + `range|supply|world`; keep all v1 patterns.
   - cannabis: + `\bsmoke\s?shop\b`, `\bcbd\b`, `\b420\b`, `\bpot\s?shop\b`, `\bcigars?\b`, `\btobacco\b`. (Never bare `smoke`: "International Smoke", "Hardwood Bar & Smokery" are restaurants.)
   - gambling: `\bcasinos?\b`, `\bcard\s?(room|club)\b`, `\bsportsbook\b`, `\bbingo\s?(hall|palace)\b`, `\boff[- ]track\s?betting\b`.
   - alcohol: `\bnight\s?club\b|\bnightclub\b`, `\bbrewer(y|ies)\b|\bbrewpub\b|\btap\s?(room|house)\b`, `\bwiner(y|ies)\b`, `\bdistiller(y|ies)\b`, `\bsaloon\b`, `\bspeakeasy\b`, `\bwine\s?bar\b`, `\bcocktail\b`, `\bliquor\b`, `\bbeer\s?garden\b|\bbiergarten\b`, `\bdive\s?bar\b`, `\bsports\s?bar\b`, `\bhappy\s?hour\b`.
   - **Deliberately not matched by name**: bare `\bbar\b` (Oyster Bar, juice bar, snack bar), bare `tavern` (overwhelmingly family restaurants; Movie Tavern is a kids-marketed cinema), bare `smokehouse/smokery`, bare `armory` (Park Avenue Armory is a cultural venue), `pub` only via tags. Type signals (tier 3) are the catch for true bars/pubs.
   - adult: + `\bburlesque\b`, `\bhostess\s?club\b`, `\bcabaret\b` **only with** tag confirmation or `21\+` (Cabaret theaters exist).
5. **Age-gate text**: description/name containing `\b21\s?\+|\bmust be 21\b|\bages?\s?21\b` → `age_gated`.

`brandSafetyViolation(spot)` keeps its contract (string class or null) so all v1 call sites keep working; add the new classes to the kids gate. `isBrandSafeForAdults` blocks `weapons` and retail `cannabis` (dispensary/smoke-shop patterns + tags) but keeps `alcohol`/`gambling`/`age_gated`/hookah lounges.

### A3. Kids **events** gate (new)

`events.json` (kids) must apply the same taxonomy to each event's `venue`/`title`/`description`: an event *at* a blocklisted venue class (trivia night at a brewery, tasting at a winery, 21+ anything) never enters the kids feed, whatever its `audiences` tag says. Enforce in the event pipeline where kids feeds are written (`scripts/eventPipeline.mjs`), and in `validate-events`. The existing ingest-side beer/wine rejection (adult-signal filter) stays; this adds venue-class + 21+ coverage.

### A4. Enforcement matrix (every row must hold)

| Point | Requirement |
|---|---|
| Ingest (`spotPipeline.mjs`, event pipeline) | gate applied before write, removals logged `{name, id, metro, class, signal}` into the build report |
| Sweep (`sweep-brand-safety.mjs`) | re-run against **all 16 metros** cleans every existing violation without re-ingest; also sweeps `spots-adults.json` (weapons/cannabis-retail) and kids `events.json` (A3) |
| `validate:data` | **the bare command validates all metros** (make `--all` the default; keep `--metro=` for scoping). CI/deploy docs and `skills/weekly-event-prep` gate references keep working unchanged |
| `validate:events` | fails on any kids event violating A3 |
| Render | no new render-side work for spots (feeds are the gate), but nothing in the app may re-derive categories in a way that bypasses the feed |

---

## B. Render-time freshness invariant

**Invariant:** no surface may present an event whose end is in the past as attendable — app SPA suggestion surfaces, editor's picks/hero, Hop Now, planner candidates, share/`?guidePlan=` handoffs, prerendered SEO event pages, JSON-LD, and featured plans — **regardless of feed staleness**. The feeds being fresh today is not a defense; the daily refresh was silently dead for a month once already.

### B1. Fix the known holes in `isUpcomingEvent` (`src/eventFreshness.ts`)

1. If `endDateTime` parses valid and is past → `false`, **even when `startDateTime` is missing** (today line 16 short-circuits to `true`).
2. **Date-only strings** (`YYYY-MM-DD`, no time): interpret `endDateTime`/`startDateTime` date-only values as *end of that day* / *start of that day* in the event's metro timezone (metro tz available via `src/metros.ts`; thread it through or accept a `timeZone` option with viewer-local fallback). A date-only `endDateTime` of today must remain upcoming until local midnight, not flip at `Date.parse` UTC midnight (which is 4–5 pm the *previous* day in the US).
3. Same-local-day grace for no-end events: compute "same day" in the **event's metro timezone**, not the viewer's (an ET viewer at 1 a.m. must not hide a PT event still running at 10 p.m., and vice versa).
4. `endDateTime < startDateTime` (data error) → treat as ended/invalid, exclude from suggestions.
5. Contract: exported, pure, `now` injectable — keep it that way; all new logic unit-tested with frozen clocks.
6. **Pipeline-side offset bug (verified):** `DEFAULT_TIMEZONE_OFFSET = "-07:00"` (`scripts/eventPipeline.mjs:6`) is applied to every source that doesn't set its own offset, so East/Central-metro events are stored with Pacific instants and DST is ignored. Fix: derive the offset per event date from the metro's IANA `timezone` (already in `data/metros.json`) instead of the fixed constant. This is a feed-correctness prerequisite for the render invariant — a wrong stored instant defeats any correct render check.
7. **Frozen `now` (verified):** the `useMemo`s behind mapEvents / hero pick / weekend stats capture `now` once with no time term in deps — a tab left open past an event's end keeps showing it as upcoming. Fix minimally: a coarse time tick (e.g. 5-minute interval or `visibilitychange` re-render) that re-evaluates the freshness-gated memos. No redesign; just ensure `now` advances.

### B2. Coverage audit

Every suggestion surface must route through `isUpcomingEvent`. Known call sites are in `App.tsx` (9: lines ~557, 1168, 1891, 2876, 2969, 3146, 3291, 4584, 5361) and `hopNow.ts:6326-area`; the implementer must grep for any event-rendering path added since 06-10 (e.g. newsletter digest rendering in `worker/src/newsletter.ts` — the digest must apply the same invariant server-side before send) and cover it. Verified gaps to close:
- **`EventDetailView` never date-checks** (`EventDetailView.tsx:203-216` shows "ended" only when the event has already dropped out of the feed). It must evaluate `isUpcomingEvent` itself and render the ended state for a past event that is still present in the feed — never upcoming/attendable copy.
- **`highlightedEventIds`** (`App.tsx:2926-2941`) uses start-time + 6h grace and ignores `endDateTime`/freshness — route it through the same gate.

### B3. Static pages

Prerendered event pages can't re-evaluate at request time; the existing layered defense must hold and be tested: (a) JSON-LD `endDate` spans the true run, (b) `functions/[[path]].ts` + `event-seo-manifest.json` serve 410 for ended slugs, (c) capped-out or ended events never get "upcoming"-copy pages minted at build (`SEO_MAX_ENDED_STUBS=0` behavior). Add an acceptance test that a build run with a deliberately past event in the feed mints no upcoming-copy page for it.

### B4. Featured plans

`generate-featured-plans.mjs` already requires event start ≥ generation time; `expiredFeaturedPlanRefs` already fails validate. Keep both; add: the **app** must drop a featured plan's ended `eventIds` at render (App.tsx:1166 does — keep under test) and a plan whose stops all resolve but whose *only* event content has ended must not render an "upcoming" event line.

**Themed-plan expiry (verified hole):** themed/holiday plans surface first in Editor's picks and expire **only** via an *optional* `themedEnd` (`App.tsx:2772-2776`) — a themed plan with no `themedEnd` pins forever. Fix: a themed plan with no `themedEnd` derives its window from the max `endDateTime` of its referenced events; with neither, it is not eligible for the themed slot. Also note the picks rail (`nearbyFeaturedPlans`, `App.tsx:2758-2801`) ranks by map proximity and never freshness-checks the plan as a whole — the derived-window check must run there, not only per-card.

---

## C. Preset-plan geography

### C1. Constraints (generation + validation)

1. **Pairwise radius** ≤ 15 mi (v1, keep).
2. **Max single leg** ≤ 12 mi in stop order (new — pairwise radius alone allows a 15-mi hop between consecutive stops).
3. **Total path length** ≤ 25 mi in stop order (new — kills pairwise-close-but-zigzag paths: 4 stops mutually ≤14 mi apart can still make a 42-mi ping-pong route).
4. **Stop ordering**: order stops nearest-neighbor from the first anchor so the path is roughly monotone; never present an order that violates 2–3 when a compliant order of the same stops exists.
5. **Unresolvable stops**: a `stopId` that doesn't resolve to coordinates counts as a *validation failure* for curated/featured plans (silent skip is how a 150-mi plan hides). A plan below 2 resolvable stops is dropped, not padded.
6. Applies to **all** plan sources: generated (`generate-featured-plans.mjs`), hand-curated entries in `featured-plans.json` / per-metro files, and city "Day out in X" plans.

### C2. Enforcement

`planQuality.mjs` grows `maxLegMiles`, `totalPathMiles`, and an `auditPlanGeometry(plan, resolveStop)` helper returning structured errors; `validate:events` fails on any plan violating C1 across all metros (today it only checks expired event refs). Haversine is the metric (document that water/bridge detours are out of scope).

---

## D. FamHop / Mosey audience separation

### D1. Adults **events** feed (`qualifiesForAdultFeed` — reorder precedence)

Content evidence outranks source-level tags. New rule order:

1. virtual/online → out (keep).
2. **Kids-content signal in title** (`KIDS_CONTENT_RE` against title) → **out, even if `audiences:["adults"]`**, unless the text also carries an explicit adult-only override (`21+`, "adults only", "adults night"). This kills "(Kids’ Show)" from adults-registered sources. Known cost, accepted: genuinely adult acts with kid-words in the name ("Kids in the Hall" tribute) get dropped.
3. `audiences` includes kids and not adults → out (keep).
4. `audiences` includes adults → in.
5. Kids-content signal in venue/sourceName (weaker evidence than title — only applies when not explicitly adults-tagged; keep v1 behavior).
6. University noise → out; else require adult-positive signal (keep).

### D2. Adults **spots** feed (new gate)

`spots-adults.json` must exclude kids-primary venues: name `\bplayground\b`, `\btot\s?lot\b`, `\bsplash\s?pad\b`, `(children'?s?|kids?)\b.*\b(museum|discovery|play|gym)`, brand names `The Little Gym|My Gym|KidZania|Kidspace`, OSM tag `playground`. Allowlist honors D-side entries (`Walt Disney Family Museum` is an adult-interest museum — keep it on Mosey). Enforce at ingest (`ingest-bay-area.mjs` adults split + `spotPipeline`), sweep, and validate.

### D3. SEO / sitemap assertions (build-time, both brands)

New post-build assertion (wired into the build scripts or `seo:audit`) that **fails the build** if:
- adults build: any sitemap URL or minted page slug matches `playground|children|kids-show|storytime|toddler|preschool` (allowlist-aware), or any event page it mints fails D1.
- kids build: any sitemap URL/page for a spot failing A1/A2, and no event page failing A3.

### D4. Kids side

Kids feeds must not carry adults-only content: `audiences:["adults"]` events never enter `events.json` (verify existing behavior + test); Nightlife-category spots stay excluded (`spotPipeline.mjs:951`, keep under test); A3 covers 21+/alcohol events.

---

## E. Acceptance tests

Unit tests live under `tests/` (vitest for `src/`, node for `.mjs` — match existing patterns). Every test below must exist and pass; numbers are referenced by the implementer's report.

**Taxonomy (A):**
- E1. Each of these names, as a kids spot, returns the given class with no tags: `Realco Guns`→weapons, `TruePrep Guns And Gear`→weapons, `Rod & Gun Club of Anytown`→weapons, `Casino Miami`→gambling, `CAKE Nightclub`→alcohol, `Coyote Creek Brewery`→alcohol, `City Winery`→alcohol, `Adair's Saloon`→alcohol, `The Apothecarium` **with** tag `cannabis`→cannabis, `Puff N Stuff Smoke Shop`→cannabis, `Lucky Lady Card Room`→gambling.
- E2. Each of these is **safe for kids**: `False Gun Vista`, `Gunston Park`, `Gunzo's Sports Center`, `The Gundis`, `Shogun`, `Gunther-Hirsh Family Center`, `Range Cafe`, `Target`, `The Smoke Shop BBQ` *(name says Smoke Shop, category Food + no tobacco tag — allowlist if pattern can't distinguish)*, `Hardwood Bar & Smokery`, `International Smoke`, `Movie Tavern`, `Fraunces Tavern Museum`, `Golden Ball Tavern Museum`, `Nojo Ramen Tavern`, `Dorlan's Tavern & Oyster Bar`, `Park Avenue Armory`, `Highland Park Adult Senior Citizen Center`.
- E3. Tag-only detection: a spot named `Green Leaf Wellness` with tag `cannabis` → blocked; named `Corner Store` with tag `alcohol` → blocked for kids; `The Local` with tag `bar` → blocked for kids, kept for adults.
- E4. `npm run validate:data` (bare) validates all 16 metros and **fails** on a fixture metro containing `Realco Guns`.
- E5. After the sweep + fixes, `validate:data` passes on real data **and** `grep`-level scan of all 16 `public/data/*/spots.json` finds zero weapons/gambling/nightclub/dispensary venues (the four named live offenders are gone).
- E6. Kids events gate: an event `Trivia Night at Barebottle Brewery` (audiences `all`) is excluded from kids `events.json`; `Kids' Craft Hour at the Library` stays.

**Freshness (B):**
- E7. `isUpcomingEvent({endDateTime: <yesterday>})` (no start) → false.
- E8. Date-only `endDateTime` of *today* → true at 23:00 metro-local; date-only `endDateTime` of *yesterday* → false at 00:30 metro-local.
- E9. Multi-day event (started last week, ends next week) → true.
- E10. No-end event started 21:00 PT yesterday, viewed 01:00 ET today (= 22:00 PT same day) → true with metro tz America/Los_Angeles; the same event viewed 01:00 PT next day → false.
- E11. `endDateTime < startDateTime` → false. Unparseable start (`"TBD"`) → false (keep v1).
- E12. Build-level: a feed fixture containing a clearly past event produces no editor's-pick/hero/featured-plan reference to it (existing heroPlan/featured tests extended), and the newsletter digest render excludes it.

**Geography (C):**
- E13. 4 stops pairwise ≤14 mi arranged so given-order path = 42 mi → fails C1.3; nearest-neighbor reorder ≤25 mi → passes after reordering.
- E14. Plan with one stop 40 mi away (Dixon→Aptos style) → fails; plan Berkeley→Oakland→Alameda → passes.
- E15. Curated plan with an unresolvable `stopId` → validation error, not silent pass.
- E16. `validate:events` runs geometry checks on every metro's featured plans, including hand-curated ones.

**Audience separation (D):**
- E17. Event `Toishan Lions Dance Troupe (Kids’ Show)` with `audiences:["adults"]` → excluded from adults feed. Same event with title `Toishan Lions Dance Troupe 21+ After Dark` → included.
- E18. `Drag Brunch (family friendly!)` — kids signal ("family") in title without 21+ → excluded from adults feed *(conservative, accepted)*; `Comedy Night at Cobb's` (adults-tagged) → included.
- E19. Adults spots: `Raymond Kimbell Playground`, `Children's Discovery Museum of San Jose` → excluded from `spots-adults.json`; `Walt Disney Family Museum` → included via allowlist; `Top of the Mark` → included.
- E20. Adults build assertion: a fixture dist containing `/bay-area/spot/foo-playground-x/` in the sitemap fails the D3 gate; the real `npm run build:adults` output contains **zero** D3-pattern URLs and the gate passes.
- E21. Kids feed: event with `audiences:["adults"]` never appears in `events.json`; `Nightlife` spots never in kids `spots.json`.
- E25. Themed plan with no `themedEnd` whose events all ended → not shown in the themed/Editor's-picks slot; with a future event end → shown.
- E26. `EventDetailView` given a past event still present in the feed → renders ended-state copy, not attendable copy.
- E27. Offset composition: an NYC event ingested from a source with no explicit offset is stored with the America/New_York offset for that date (−04:00 in July), not −07:00.
- E28. Freshness memos re-evaluate as time advances (fake timers: event ends while "tab open" → disappears from suggestions after the next tick).

**Live verification (post-deploy, part of the implementer's definition of done):**
- E22. `https://trymosey.com/sitemap.xml` contains zero playground/children/kids-show/storytime URLs (allowlist excepted).
- E23. famhop-data (or the deployed app data) serves cleaned spots for atlanta/washington-dc/miami/phoenix — the four named venues absent. *(If `deploy:data` is operator-only, stage everything and list it as a human gate in the final report instead of deploying it.)*
- E24. A previously-live Mosey kids-show event URL returns 410/404 or an "ended"-state page — not an upcoming-copy page.

## F. Adversarial test list (Fable runs these in the attack phase — implementer should try to survive them, not wire them as CI)

1. **Ambiguous names**: `Range Cafe`, `Home on the Range Diner`, `Free Range Kitchen`, `Shooting Star Observatory`, `Photo Shooting Studio`, `Gunpowder Thai` (restaurant), `Smokin' Oak BBQ`, `The Mash Tun Museum of Brewing History` (museum about beer — culture category), `Cannabis City Hall Tour`? — none may be blocked for kids except by explicit deny.
2. **Evasive offenders**: `Bullseye Indoor Range LLC` (no "gun"/"shooting" adjacency — "Indoor Range"), `2nd Amendment Sports`, `Ye Olde Pipe & Tobacco Shoppe`, `Cloud 9 Lounge` (vape, tag-only), `MedMen` (tag-only), `Golden Nugget` (casino brand, tag-only), `The Spearmint Rhino` (brand, tag-only) — each must be caught by tags, denylist, or a documented gap in the report.
3. **Timezone edges**: event ending `2026-07-16` (date-only) checked at 2026-07-16T23:59 PT and 2026-07-17T00:01 PT; event `2026-07-16T22:00:00-07:00` (no end) checked from UTC+0 viewer at 06:30Z on the 17th (= 23:30 PT on the 16th); DST boundary event (Nov 1); `endDateTime` with seconds vs without; ISO string with no offset.
4. **Multi-day/timed-entry**: exhibition Jul 1–Aug 30 must show as upcoming all summer on every surface; the same exhibition after Aug 30 must be gone from picks *and* its SEO page must be 410/ended-state.
5. **Plans pairwise-close, path-absurd**: rectangle zigzag (E13 shape) on real Bay Area coords (e.g. SF↔Daly City↔SF↔Brisbane); plan whose stops are all in-metro but the order crosses a bridge 3×.
6. **Audience**: `Kids in the Hall Tribute Night` (adult comedy) — expected: dropped from Mosey (accepted loss, must be *logged*, not silent); `Children's Hospital Charity Gala 21+` — 21+ override → allowed on Mosey; `Storytime for Grown-ups: Erotic Fiction Night` — kids word + adult content: title has "Storytime" → D1 drops it unless "adults only/21+" appears — verify the override list is sufficient; `Family-friendly brewery tour` in *kids* feed → A3 blocks (brewery venue).
7. **Sitemap bypass**: adults build with an event titled `KIDS BOP Live` (caps), `K!ds Night` (leet), `Niños y Familia` (Spanish — KIDS_CONTENT_RE is English-only; check the i18n surface at least for the seeded ES content) — document what's caught vs. not.
8. **Gate wiring**: run `npm run validate:data` with no args and confirm it can no longer silently skip 15 metros; temporarily inject a violation fixture and confirm the deploy-path command actually fails (not just warns).

## G. Deliverables (implementer)

1. Code per A–D building on the v1 modules (no rewrites of working v1 logic; extend).
2. All E-tests green; full suite (`npm run test`, `npm run validate:data`, `npm run validate:events:all`) green.
3. Data files cleaned (sweep run, all metros, kids + adults feeds + featured plans re-validated).
4. `npm run build` (kids) + `npm run build:adults` green including the new D3 gate; deploy kids then adults **sequentially, never parallel**; live checks E22–E24.
5. A report mapping every E-test to its test name/file, every F-item to caught/gap, and every data removal (venue name, metro, class).
6. **No SEO feature work, no URL restructuring, no aggregateRating — ever** (see CLAUDE.md SEO invariants).

## Non-goals

- Routing-quality (bridge/water detours) beyond haversine.
- Non-English kids-content detection beyond documenting the gap (F7).
- Rebuilding the adults supply bar / SF beta scope (separate roadmap item).
- Any change to URL structure, page inventory, or indexing behavior.
