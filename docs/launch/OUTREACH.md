# Backlink outreach — top live event sources

> **DRAFTS ONLY.** Nothing here is sent automatically. A human personalizes,
> fills in the real numbers, and sends from a real address. Fill `{reach}`
> from `/ops/analytics` per-metro opens — **do not inflate**; if the honest
> number is small, lead with the page we built them instead of the audience.

## Top live sources (from `public/data/*/event-build-report.json`, 2026-06-10)

Ranked by live extracted events in the latest build reports:

| # | Source | Metro | Live events | URL |
|---|--------|-------|------------:|-----|
| 1 | NYC Parks Events | new-york-city | 1,839 | https://www.nycgovparks.org/events |
| 2 | Broward County Library | miami | 1,362 | https://broward.libnet.info/events |
| 3 | LA County Library | los-angeles | 1,233 | https://visit.lacountylibrary.org/events |
| 4 | San Francisco Public Library | bay-area | 966 | https://sfpl.org/events |
| 5 | Montgomery County Public Libraries | washington-dc | 729 | https://mcpl.libnet.info/events |
| 6 | Prince George's County Memorial Library | washington-dc | 673 | https://pgcmls.libnet.info/events |
| 7 | DeKalb County Public Library | atlanta | 560 | https://dekalb.libnet.info/events |
| 8 | Solano County Library | bay-area | 539 | https://solanolibrary.communico.co/ |
| 9 | Stanford Events | bay-area | 442 | https://events.stanford.edu/ |
| 10 | Please Touch Museum | philadelphia | 401 | https://www.pleasetouchmuseum.org/calendar/month/ |
| 11 | Hawaii State Public Library System | honolulu | 394 | https://www.librarieshawaii.org/events/ |

(11 listed because the Hawaii system was flagged in the audit; treat 1–10 as
the priority pass.)

## Base email (short — under 120 words sent)

Subject: `Your events are on FamHop — want a link back?`

> Hi {name / "events team"},
>
> I'm {your name}, and I make FamHop (famhop.com), a free weekend planner
> that helps families find things to do. We feature {source}'s public events
> — {live_count} of your listings are live on our {metro} weekend guide
> right now, each linking back to your official event page:
>
> {metro guide URL, e.g. https://famhop.com/new-york-city/this-weekend/}
>
> Two small asks, only if useful to you:
> 1. If you keep a "find our events on..." or community-partners page, a link
>    to that guide helps {reach} local families find your programs.
> 2. Anything we're getting wrong (times, ages, cancellations) — tell me and
>    I'll fix it same-day.
>
> No catch — your events stay free to list and we always link to you as the
> source.
>
> {your name} · famhop.com

## Embeddable-widget offer (append only when there's a reply)

> One more thing we can do: a small embeddable widget — "Family events this
> weekend at {source}" — that you drop into any page with one line of HTML.
> It shows your next few family events (pulled from your own calendar, the
> same data we already display), styled to match your site, linking to your
> registration pages. We'd build it to your spec; it's free, and you can
> remove it any time. If that's interesting I'll send a preview.

(Note: the widget doesn't exist yet — it's an offer we build on first
acceptance. Don't promise a timeline shorter than two weeks.)

## Per-source notes for personalization

1. **NYC Parks** — government agency; mention free Kids in Parks-type
   programming reaching families per borough. Guide:
   `https://famhop.com/new-york-city/this-weekend/`.
2. **Broward County Library** — our largest library source; their marketing
   team is active. Guide: `https://famhop.com/miami/this-weekend/`.
3. **LA County Library** — 80+ branches; suggest their "Connect with us"
   page. Guide: `https://famhop.com/los-angeles/this-weekend/`.
4. **San Francisco Public Library** — our home metro; offer to meet in
   person, and mention the named curator (Sam) reviews their listings
   weekly. Guide: `https://famhop.com/bay-area/this-weekend/`.
5. **Montgomery County Public Libraries** / 6. **Prince George's County
   Memorial Library** — same metro (DC); stagger sends so they don't read as
   a blast. Guide: `https://famhop.com/washington-dc/this-weekend/`.
7. **DeKalb County Public Library** — guide:
   `https://famhop.com/atlanta/this-weekend/`.
8. **Solano County Library** — Bay Area; their Communico calendar powers a
   big share of our North Bay coverage — say so specifically.
9. **Stanford Events** — university comms office, not a library; pitch is
   "your free public + family events reach Peninsula families".
10. **Please Touch Museum** — a museum, not a library: their whole calendar
    is our Philadelphia anchor; strongest widget candidate of the list.
11. **Hawaii State Public Library System** — statewide system and effectively
    Honolulu's event backbone on FamHop; be candid that they're our main
    source there. Guide: `https://famhop.com/honolulu/this-weekend/`.

**Before sending each:** open the metro guide URL, confirm the source's
events actually render there that week, and replace `{live_count}` with the
number from that metro's `event-build-report.json`.
