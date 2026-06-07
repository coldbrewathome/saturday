---
name: grounded-event-discovery
description: Discover, verify, and add local events from official or organizer sources for event-feed repopulation. Use when Codex or Claude needs to find missing Bay Area or other metro events, audit event coverage, repair zero-extracted event sources, create officialTextEvents entries, or avoid incomplete Google-style event discovery.
---

# Grounded Event Discovery

Use this skill to turn a sparse or user-supplied event list into verified event-source updates without relying on snippets or guesses.

## Workflow

1. Inventory what already exists.
   - Search generated feeds and source config before browsing: `rg -n "<event name>|<venue>|<organizer>" data public/data`.
   - Check operator alerts for zero-extracted or failing official sources before adding a duplicate.

2. Search like an event operator, not like a consumer.
   - Start with exact quoted event names plus city, year, and date words.
   - Add source-owner terms: `official`, `city`, `parks`, `library`, `foundation`, `calendar`, `festival`, `tickets`.
   - Use source-specific searches for likely owners: `site:<city>.gov`, `site:sfmta.com`, `site:parksconservancy.org`, `site:libnet.info`, `site:activecommunities.com`, `site:eventbrite.com`.
   - For full pattern sets, read `references/search-patterns.md`.

3. Treat third-party pages as leads only.
   - Do not add event facts from roundups, Funcheap, parent blogs, news snippets, or search snippets unless no better source exists and the user accepts that lower confidence.
   - Use those pages to discover likely organizer names, venue names, dates, and URLs, then find the official page.

4. Verify minimum facts from an official page.
   - Required: title or unmistakable event name, date, start time or all-day range, venue/city, and source ownership.
   - Preferred: end time, cost, audience/family fit, registration requirement, full address.
   - If the official source confirms a multi-day festival, model each day separately when daily hours differ.

5. Add with fail-closed extraction.
   - Prefer existing structured source types when available (`communicoEvents`, `biblioevents`, `openCitiesEvent`, `eventList`, `ics`, etc.).
   - For one-off official pages, use `sourceType: "officialTextEvents"` with `requiredText`, `requiredPattern`, or `requiredAnyPattern` that proves the page still contains the date/time/location.
   - Use the event's own URL when available; otherwise use the source URL. Keep `trust: "official"` only for official, organizer, venue, government, or primary sponsor pages.

6. Leave a visible follow-up when verification fails.
   - Do not invent missing hours, addresses, or dates.
   - Report skipped events with the exact missing fact or missing official source.

## Repo Procedure

For this repo, event-source updates usually mean editing `data/event-sources.json`, then regenerating and validating:

```bash
node scripts/ingest-events.mjs --metro=bay-area
node scripts/generate-featured-plans.mjs --metro=bay-area
node scripts/build-coverage-summary.mjs
node scripts/validate-events.mjs --metro=bay-area
node scripts/audit-event-slugs.mjs --metro=bay-area
```

Run unit tests when code changes or when extraction behavior changes:

```bash
npm run test:unit
```

Keep generated-data churn separate from unrelated dirty files. Never revert user changes.

## Quality Bar

- Official source beats roundup, roundup beats memory, memory beats nothing.
- A search result snippet is never enough to create event data.
- A precise source URL with stale or absent event text is not enough; the configured gate must match live page text.
- A missing event can already be present under a variant title, venue, or source ID. Search variants before adding.
- If the event has already ended in the local planning window, it may validate but not appear in generated feeds. Say that explicitly.
