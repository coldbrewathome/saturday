# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Deploy

When the user says "deploy", it means **deploy to Cloudflare Pages directly via wrangler** — not "git push and let CI deploy". Use:

- `npm run deploy:kids` → FamHop (project `saturday-spots`)
- `npm run deploy:adults` → Mosey (project `nighthop`, serves trymosey.com)
- `npm run deploy:data` → famhop-data

If the user says "deploy" without specifying, default to both kids and adults (the shared `App.tsx` means a change usually ships to both). Run `npm run test` + `npm run validate:data` + `npm run validate:events` first to match what CI would check.

## Google Indexing API & Automation

**DISABLED 2026-08-01 — the Indexing API is a verified no-op for `Event` schema** (see "SEO invariants" below: submissions return fake success, pages are never crawled). The daily 9:00 AM launchd cron that ran `publish-indexing.mjs` was unloaded and its plist removed from `~/Library/LaunchAgents/`. Do not re-enable it. History retained:
- **Core Script**: `npm run publish:indexing` (runs [publish-indexing.mjs](file:///Users/kning/Projects/saturday/scripts/publish-indexing.mjs)) reads `dist/sitemap.xml`, prioritizes hub pages, filters for new/modified events, and submits up to 200 URLs/day (quota limit) to the Google Indexing API. Useless for famhop events; kept only for any future JobPosting/BroadcastEvent content.
- **History**: Submission timestamps are saved in [indexing-history.json](file:///Users/kning/Projects/saturday/data/indexing-history.json) to maintain a rolling queue.
- [local-indexing-cron.sh](file:///Users/kning/Projects/saturday/scripts/local-indexing-cron.sh) + [setup-local-cron.sh](file:///Users/kning/Projects/saturday/scripts/setup-local-cron.sh) remain as the historical reinstall path — don't use them.

## SEO invariants

Audited 2026-07-11 against GSC and the Google URL Inspection API. These are conclusions, not guesses — re-verify before overriding.

**METRICS FIRST — NEVER KILL A HIGH-TRAFFIC PAGE (user directive 2026-07-25; full policy `~/Projects/seo-ops/SEO-POLICY.md`).** Before you remove / delete / noindex / redirect / prune / consolidate / move ANY page, pull its 90-day GSC clicks + impressions and SHOW them to the user first. A page with meaningful traffic STAYS — it is a hard-won ranking asset you cannot cheaply rebuild. Outdated ≠ removable: refresh/evergreen a stale high-traffic page in place (same URL), never let it decay. This overrides the "pruning low-value pages is a traffic lever" note below — pruning is only for pages you have SHOWN the user are low/zero-traffic. (The 2026-07-24 spot prune qualified: 8 clicks across 1,797 pages, verified; but even that class needs metrics shown first going forward.)

**Event pages are the traffic.** They earn ~85% of clicks; a dated local event ranks in ~13 days with no backlinks. The spot directory earns ~nothing (25 clicks/mo across 4,953 pages) — don't invest there.

**Crawl budget is the binding constraint.** The domain is young (registered 2026-05-09) with zero backlinks, so Google crawls very little: pre-fix, 2 of 3 event pages had *never* been fetched. Every published URL competes for that budget, which makes pruning low-value pages a traffic lever rather than hygiene. Before adding a new page type at scale, ask what it displaces.

**The Google Indexing API does NOT index famhop pages — stop relying on it.** Verified 2026-07-26 (Google docs + URL inspection): the Indexing API only processes `JobPosting`/`BroadcastEvent` markup; famhop events are `Event` schema, so submissions return a fake "success" and are never crawled (event pages submitted daily via the 9 AM cron sat "Discovered/unknown — crawled never"). Out-of-spec use also risks access revocation. The valid Google levers here are: fresh sitemap, **internal links from the daily-crawled metro hubs** (that's why the hub seo-shell now links /annual/ pages — the rankable long-lived pages were otherwise undiscoverable), and manual GSC "Request Indexing". IndexNow (on deploy) is valid but Bing/DDG-only. Full policy: `~/Projects/seo-ops/SEO-POLICY.md`.

**Never emit `aggregateRating` (or any third-party rating) in JSON-LD.** It previously republished Google Places' ratings as our own — a Google structured-data policy violation *and* a Maps Platform terms violation, with no rich result to show for it (Google won't render stars for ratings you didn't collect). Removed in `30d71a5` from both brands. Do not restore it, for Mosey or FamHop.

**Event pages are deduped to one per (title, venue)** in `generate-seo-pages.mjs` (`dedupeEventOccurrences`). Ticketed feeds emit one record per timed-entry slot — a single Chicago exhibition once minted 100 near-identical URLs. The surviving page lists every date and its JSON-LD `endDate` spans the full run, so multi-date events don't expire on day one. Keep the dedupe ahead of the per-metro cap so the cap is spent on *distinct* events.

**Kids spot pages are Outdoors/Culture only** (`KIDS_SPOT_CATEGORIES`). A templated stub for a restaurant or gym cannot outrank Yelp and Google Maps. Mosey still publishes Food; featured-plan spots bypass the gate so curated plans keep their stops.

Do **not** restructure URLs, add FAQPage schema (dead in Google Search since 2026-05), chase EXIF geotagging, or do NAP/local-pack work — a directory with no physical address cannot enter the local pack.

## Shared Skills

- For local event discovery, source repair, Bay Area feed repopulation, or missing-event audits, read and follow `skills/grounded-event-discovery/SKILL.md`. It defines the official-source search workflow and verification gates shared with Codex.
- For the weekly "prepare events for the coming week" routine (feed refresh → GSC/Trends-guided discovery → source repair → SEO no-regression gate → deploy), read and follow `skills/weekly-event-prep/SKILL.md`. It encodes the gate order (plans before validate, build before seo:audit, hub `seo-shell` markers) and the Eventbrite/visible-text gate rules.
