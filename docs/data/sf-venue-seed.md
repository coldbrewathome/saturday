# SF Venue Seed — Mosey Bay Area adult event supply

Verification log for `data/event-sources-adults.json` (the bay-area adults registry; `metros.json` points `adultEventSources` there — there is no `event-sources-adults-bay-area.json`). All candidates were fetched live on **2026-06-10** with the registry's exact ingest headers (`user-agent: nighthop/0.1 event-ingest`) and run through the real extractors in `scripts/eventPipeline.mjs` (`extractJsonLdEvents` / `extractIcsEvents` / `extractRssEvents` / `extractTribeEvents` / `extractSfmomaEvents` / `extractOfficialTextEvents`). "Verified" below means the unmodified pipeline extracted dated events from the live source.

## Why most venue pages fail today (read before adding more)

1. **Family-signal gate on generic HTML.** `extractHtmlEvents`' block extractor and all line-based extractors (`eventList`, `structured-html`) require `hasFamilySignal` and reject `hasAdultOnlySignal`, so plain-HTML adult venue calendars extract 0 regardless of markup quality. Only the **json-ld, ics, rss, tribeEvents, sfmomaEvents (with `includePattern`), and officialTextEvents** paths work for adults sources.
2. **`walkJsonLd` only matches `@type: "Event"` exactly.** Every Live Nation venue page (Punch Line, Cobb's, The Fillmore `/shows`, SF Masonic `/shows` — 72 `ld+json` blocks each) publishes `@type: "MusicEvent"` and extracts **0**. A one-line change in `scripts/eventPipeline.mjs` (`types.includes("event")` → also match types ending in `"event"`, e.g. `MusicEvent`, `ComedyEvent`, `TheaterEvent`, `DanceEvent`) would unlock ~290 verified, dated, official events across four already-registered SF venues. Not changed here (pipeline file not in this task's ownership).

## Verified and added (6 new sources, 2 URL repairs)

| Source id | URL | Format | Live evidence (2026-06-10) |
|---|---|---|---|
| `dna-lounge` | https://cdn.dnalounge.com/calendar/dnalounge.ics | ICS | 128 events, 121 upcoming. Sample: "miniFEST" 2026-06-10 17:30 PT; "Mortified: Morti-Pride" 2026-06-12; "Sorry For Party Rocking: 2010-2015 Pop and EDM" 2026-06-12. Official feed linked from dnalounge.com/calendar. |
| `verdi-club` | https://www.verdiclub.net/calendar/?ical=1 | ICS (WP Events Calendar export) | 15 upcoming. Sample: "Scuff Queer Line Dancing & Two-Stepping" 2026-06-10 20:00 PT; "Milonga Malevaje" 2026-06-11. Caveat: 2 of 15 are "Private Event" placeholders; ICS path has no exclude filter. |
| `ybg-festival-adults` | https://ybgfestival.org/events/ | JSON-LD on page (`sourceType: html`) | 67 JSON-LD events, all dated/upcoming (83 after html-block extras). Sample: "Dance Outdoors with Rhythm & Motion" 2026-06-10 12:00 PT; "Camellia Boutros" 2026-06-11. Free outdoor May–Oct. Caveat: occasional "(Kids' Show)" titles ride along (no exclude on json-ld path). |
| `sfmoma-late-events-adults` | https://www.sfmoma.org/events/ | `sfmomaEvents` (inline `APP.data` JSON) | 8 upcoming after `excludePattern` strips family programming: "Rooftop Radio: French Electro Pop" 2026-06-18; "Atria: Live" 2026-06-25; "Joie de Vivre!" 2026-06-18. `includePattern: "."` bypasses the family gate (mirrors kids `sfmoma-events` entry, which keeps the family side). |
| `calacademy-nightlife-adults` | https://www.calacademy.org/nightlife | `officialTextEvents` + `officialRecurringEvents` | Page live (200), gates "NightLife" / "21+" / "Thursday" all present in page text. Extractor produced 5 events in the 30-day window (Jun 11, 18, 25, Jul 2, 9 — 6–10pm PT). Weekly Thursday modeled as 4 monthly nth-Thursday configs (no weekly frequency exists; 5th Thursdays skipped). Fail-closed if page text changes. |
| `omca-friday-nights-adults` | https://museumca.org/events/ | `tribeEvents` REST, `categories: "10"` | Tribe category 10 = "Friday Nights at OMCA" (139 historical). Filtered live call returned: "Friday Nights at OMCA with Kim Nalley Band" 2026-06-12 17:00; "...with The Seshen" 2026-06-26 17:00. 5–9pm hours confirmed on museumca.org's own calendar text. Kids registry already uses category 6 (Family) at the same API. |

URL repairs to existing entries:

- `the-uc-theatre`: `https://theuctheatre.org/calendar` returned **404** (build report status `http-error`) → `https://theuctheatre.org/events/` (200). Still 0 extracted (APE-platform page, no Event JSON-LD), but the hard fetch error is gone.
- `the-fillmore`: `/calendar` has **no** JSON-LD → `/shows` has 72 `MusicEvent` JSON-LD blocks. Extracts 0 until the `walkJsonLd` subtype fix lands, then unlocks immediately.

## Rejected candidates (verified live, not added)

### Blocked by `walkJsonLd` subtype gap (official JSON-LD present, extracts 0 today)
| Venue | URL | Evidence |
|---|---|---|
| Punch Line SF (registered) | punchlinecomedyclub.com/shows | 72 ld blocks, `@type: MusicEvent`. Sample: "Cobb's Comedy Showcase"-style listings with ISO `startDate` 2026-06-10T19:30-07:00. |
| Cobb's Comedy Club (registered) | cobbscomedy.com/shows | 72 ld blocks, `MusicEvent`, e.g. "Really Funny Comedians (Who Happen to Be Women) with Kat Bird" 2026-06-11T19:30-07:00. |
| SF Masonic | sfmasonic.com/shows | 72 ld blocks, `MusicEvent`. Add after subtype fix. |
| The Regency Ballroom | theregencyballroom.com/shows | 0 usable ld on first fetch; same Live Nation platform — re-probe after subtype fix. |

### No machine-readable calendar (would need a new extractor; do not add as `html`)
- **Bottom of the Hill** — bottomofthehill.com/calendar.html: hand-rolled HTML tables, 0 ld, no feeds. Mission-named; needs a bespoke extractor or the venue's ticketing feed.
- **Squarespace venues** (collection `?format=ical` returns HTML, only per-event icals exist; list pages carry only `WebSite`/`LocalBusiness` ld): **El Rio** (elriosf.com/calendar), **Zeitgeist** (zeitgeistsf.com/events), **The Knockout**, **Oasis** (sfoasis.com/events), **Ivy Room**, **Stern Grove Festival** (sterngrove.org — lineup is JS-rendered), **The Stud** (studsf.com). A small Squarespace `?format=json` extractor (`items[].title/startDate epoch ms`) would unlock all of these at once.
- **APE Concerts venues** (no Event ld, JS-rendered): Greek Theatre Berkeley, Fox Theater Oakland (events path 404s), The Castro (thecastro.com), UC Theatre, apeconcerts.com aggregate.
- **WP venues without tribe/REST event routes** (probed `/wp-json/tribe/...`, `/wp-json/wp/v2/...`, `/events/?ical=1`): The Chapel, GAMH (gamh.com — 0 ld on /calendar and /shows), Rickshaw Stop, Cafe du Nord, August Hall, The New Parish, Bimbo's 365, Hotel Utah, Boom Boom Room, Gray Area, Roxie (roxie.com — no tribe; /showtimes 404), The Marsh, Brava, The Independent (1 non-Event ld block), Thee Parkside, 924 Gilman, Killing My Lobster, Madrone Art Bar, Yoshi's, YBCA, Manny's, Booksmith, A.C.T., BroadwaySF, SF Symphony, SF Opera, Chase Center, BATS Improv (tribe REST live but 0 published events).
- **19hz.info** — eventlisting_BayArea.php: plain HTML tables, no ld/ICS/gcal feed links in source. Needs a dedicated parser; good future aggregator for electronic listings.
- **Eventbrite organizer pages** — tested The Setup (eventbrite.com/o/the-setup-san-francisco-8238737269): 200 but **0** `ld+json` blocks (data lives in `window.__SERVER_DATA__`). No existing extractor; do not add.

### Bot-blocked at fetch layer
- **SFJAZZ** (sfjazz.org/calendar) and **Freight & Salvage** (thefreight.org/shows): 403 challenge to ingest UA. Candidates for `requiresBrowserContext: true`, unverified here.
- **Exploratorium After Dark**: CloudFront 403 even via headless-browser context (verified with playwright) — hard block, rejected.
- **The Midway** (403 challenge), **Goldenvoice** (403), **Commonwealth Club** (403), **SeeTickets white-label pages** wl.seetickets.us/TheChapel + /GreatAmericanMusicHall (403).

### Unreachable / unusable
- **Make-Out Room** (makeoutroom.com), **Starry Plough**, **Cheaper Than Therapy**: fetch/DNS failures from the ingest environment.
- **The Mint** (karaoke): site fully JS-rendered, no text to gate.
- **Trick Dog, True Laurel, Royal Cuckoo, Martuni's**: no official event-calendar pages to parse or gate (mission-named; these are spot/venue coverage, not event sources).
- **DNA Lounge RSS** (cdn.dnalounge.com/calendar/dnalounge.rss): parses, but `extractRssEvents` mis-dates titles like "Jun 5 (Fri)" into the wrong year — ICS used instead.
- **Ticketmaster Discovery API** (`sourceType: ticketmaster`): supported by pipeline but `TICKETMASTER_API_KEY` is not set in this environment, so liveness could not be verified — nothing added.

## Counts

- Candidates considered: **~70** (≈60 distinct venues/orgs; several probed at multiple URLs/endpoints).
- Verified and added: **6** — by format: ICS 2 (DNA Lounge, Verdi Club), JSON-LD/html 1 (YBG Festival), tribeEvents 1 (OMCA), sfmomaEvents 1, officialTextEvents/recurring 1 (Cal Academy). Plus 2 URL repairs.
- Rejected: **~50** — subtype-blocked JSON-LD 4, no machine-readable calendar ~30, bot-blocked 8, unreachable/no-calendar/other 8.
- New verified upcoming events at add time: **~220** (121 + 15 + 67 + 8 + 5 + 2), heavily weighted to Thu–Sat nights; a Friday "Tonight" view drawing DNA Lounge (3–5/Fri), YBG (2–3/Fri), OMCA (1/Fri), Verdi (1–2/Fri) plus existing feed clears 15+ once the integrator runs `npm run ingest:events -- --metro=bay-area`.

## 2026-06-11 follow-up pass (subtype fix landed; zero-extracted repairs)

The `walkJsonLd` subtype fix from follow-up #1 has landed (`JSONLD_EVENT_TYPES` now matches `MusicEvent`, `ComedyEvent`, etc). Punch Line (34 live) and Cobb's now extract in the build report. All fetches below used the exact ingest headers (`user-agent: nighthop/0.1 event-ingest`, Node fetch) and the unmodified `extractJsonLdEvents`. Note: ticketweb.com serves different payloads to curl vs Node fetch — verify with Node.

### Repairs

- **`the-independent-sf` (was zero-extracted): FIXED via TicketWeb venue page.** theindependentsf.com remains unextractable: `/calendar` is a JS FullCalendar (TicketWeb WP plugin), the homepage list view is server-rendered but uses numeric `6.11`-style date lines (`parseMonthDay`/`parseDateTimeRange` need month names or `M/D/YYYY`), the `tm-event` post type is not exposed in WP REST (`/wp-json/wp/v2/types` lists no event type), `/feed/` is an empty blog feed, and `/tm-event/<slug>/` pages carry only Yoast WebPage ld. The venue's own ticketing page **https://www.ticketweb.com/venue/the-independent-san-francisco-ca/16302** returns 200 to the ingest UA with 2 static `ld+json` blocks → 20 `MusicEvent` extracted (Mr Tout Le Monde 2026-06-11 8pm PT, Rave Jesus 6/12, Elujay 6/13), pipeline blocked-regex clean. Caveat: appending `?pl=independentsf` to the venue URL returned a 404 shell — keep the URL param-free.
- **`the-uc-theatre` (still zero-extracted): NO supported format — left registered as-is.** The site moved from APE to a self-managed Webflow + Opendate stack. `/events` (200) server-renders 26 shows but in Webflow CMS markup (`shows-collection-item`, date split across `<h1>Jun</h1><h1>16</h1>` headings) that no existing extractor parses — `webflowEvents` expects `event-calendar-item`/`h4-name`/`dateType` classes, and the line-based extractors can't join the split date lines. Per-show pages (e.g. `/shows/j-boog-16-jun`) build MusicEvent JSON-LD **at runtime via `document.createElement('script')`** — not present as a static `ld+json` tag. No RSS (`/events/rss.xml`, `/rss.xml`, `/feed.xml` all 404). Ticketing is Opendate (`app.opendate.io/confirms/<id>/web_orders/new` — 12KB JS shell, 0 ld; no public venue listing page found). Would need either a small Webflow-CMS extractor or an Opendate API integration.

### Rejected-candidate re-verification (5 probed)

| Venue | URL | 2026-06-11 result |
|---|---|---|
| SF Masonic | sfmasonic.com/shows | **NOW VERIFIES — added as `sf-masonic`.** 36 ld blocks, 36 MusicEvent extracted (Belle & Sebastian 6/11). Was subtype-blocked. |
| The Regency Ballroom | theregencyballroom.com/shows/ | Still 0 `ld+json` blocks (200, 146KB). Subtype fix doesn't help — there is no Event ld on the page. Not added. |
| Bimbo's 365 Club | bimbos365club.com/shows/ | Venue site still Yoast-only ld, but shows link to TicketWeb → venue page **ticketweb.com/venue/bimbo-s-365-club-san-francisco-ca/10052** extracts 18 MusicEvent (Naomi Scott 6/11). **Added as `bimbos-365-club`.** |
| The Chapel | thechapelsf.com/music/ | Still Yoast-only ld on venue site; ticketing is SeeTickets white-label and wl.seetickets.us/TheChapel still **403**s the ingest UA. Not added. |
| Rickshaw Stop | rickshawstop.com | Still 0 ld; SeeTickets white-label (wl.seetickets.us/RickshawStop) **403**. Not added. |

Pattern worth remembering: for venues whose own sites have no structured data, check the venue's **TicketWeb venue page** (`ticketweb.com/venue/...`) — it serves ~20 static MusicEvent ld entries to the plain ingest UA and passes the pipeline blocked-regex. SeeTickets white-labels remain hard-403.

## Follow-ups for the integrator

1. **Highest-leverage pipeline fix:** extend `walkJsonLd` in `scripts/eventPipeline.mjs` to match schema.org Event subtypes (`MusicEvent`, `ComedyEvent`, …). Instantly unlocks Punch Line, Cobb's, The Fillmore (URL already repointed to `/shows`), and lets SF Masonic / Regency be added.
2. A Squarespace `?format=json` extractor would unlock El Rio, Zeitgeist, The Knockout, Oasis, Stern Grove, Ivy Room, The Stud — most of the mission-named bars.
3. Re-probe SFJAZZ and Freight & Salvage with `requiresBrowserContext: true` once someone can verify the browser path against their bot walls.
4. Verdi Club ships occasional "Private Event" placeholder titles; if that grates, ICS extraction needs `excludePattern` support (currently only specific extractors honor it).
