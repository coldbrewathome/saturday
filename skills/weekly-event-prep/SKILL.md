# Weekly Event Prep (FamHop + Mosey)

Populate the coming week's events across all metros, keep SEO regression-free, and ship. Trigger manually once a week (ideally Sunday/Monday, after the Monday 08:30 `com.seo-trends.weekly` report lands). Target window: the next 7 days, plus multi-week runs that start inside it.

Everything here was validated in production on 2026-07-12. Follow the order — several steps exist because of real failures noted inline.

## 0. Pre-flight (2 min)

```bash
cd ~/Projects/saturday
tail -8 tmp/local-indexing.log        # expect "Successful: 200 / Failed: 0" on the last run
git status --short                    # know what's dirty before you start
```

- If indexing shows 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`: the gcloud ADC was re-minted without the indexing scope. Fix (user-interactive):
  `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/indexing,https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,openid`
- Quota note: the Indexing API allows 200 URLs/day per quota project; the 9:00 cron consumes all of it. Don't burn it manually.

## 1. Pull search-demand priorities (5 min)

Read the two freshest reports in `~/Projects/seo-trends/reports/`:

- `weekly-YYYY-MM-DD.md` — GSC rising queries (≥2x impressions), brand-new queries, striking-distance (pos 5–20), plus Google-Trends rising related queries.
- `seasonal-calendar.md` — the "next 8 weeks: prepare now" table; anything marked ASAP or in-window defines this week's discovery themes (e.g. county fairs in July, pumpkin patches by Aug 31).

Output of this step: 2–4 concrete themes + any metro-specific queries worth targeting.

## 2. Refresh all metro feeds (~10 min, background it)

```bash
node scripts/ingest-events-all.mjs; node scripts/build-coverage-summary.mjs
```

Expect "Ingest succeeded for all 16 metros" and coverage "0 below threshold". Critical `[event-pipeline-alert]` lines are normal background noise (~10/metro chronic backlog) — triage them in step 4, don't panic.

## 3. Grounded discovery (30–60 min, agents)

Two sub-passes, BOTH mandatory. (a) exists because theme-only discovery shipped zero marquee one-offs for 2026-07-18/19 — Teddy Bear Picnic, Hayes Valley Carnival, Japan Day, Sunday Streets etc. were all absent while the routine reported green.

### 3a. One-off sweep — calendar-driven, every week

For each traffic metro (bay-area, los-angeles first): the discovery agent MUST run fresh open web searches for the metro's coming 7 days every time the metro is populated — e.g. `"things to do this weekend" <metro> <month day>`, `family events <city> <weekend dates>`, `festival <metro> <month year>` (full patterns in `skills/grounded-event-discovery/references/search-patterns.md`) — AND read the metro's lead pages from `data/discovery-leads.json`. The leads file is a supplement, never the whole sweep: fixed lists go stale and miss whatever roundup covers this particular weekend. Then verify every candidate on its organizer/venue/government page and propose sources. Leads and search results are never fact sources. Target: ≥5 verified one-offs per traffic metro, or state per event why not (no official page, sold out, ended).

- Prefer durable over one-off: when the organizer's calendar has a structured feed, add THAT (recurring source) instead of a one-off gate. Check before writing `officialTextEvents`: `curl -sL <site>/wp-json/tribe/events/v1/events?per_page=5` (Tribe/The Events Calendar is everywhere — fairyland.org sat unnoticed behind a misconfigured `html` source pointing at /visit until 2026-07-18), plus `.ics` links and the other structured sourceTypes.
- A venue we already ingest missing a known event is a SOURCE BUG, not a discovery gap — fix the source (see fairyland: `html` → `tribeEvents`), don't paper over it with a one-off entry.

### 3b. Theme discovery from search demand

Follow `skills/grounded-event-discovery/SKILL.md` for verification rules. Operational rules learned the hard way:

- **Launch 1–2 background agents max, and forbid them from spawning sub-agents.** A 7-sub-agent fan-out stalled for over an hour and had to be killed. Give each agent: an explicit search budget (~4–6 searches + 2–3 fetches per metro), the schema example to read (`data/event-sources-los-angeles.json`, the officialTextEvents entry), and permission to answer "none verified" per metro.
- **Agents return JSON proposals; they never edit repo files.** You merge centrally into `data/event-sources-<metro>.json` (bay-area lives in `data/event-sources.json`) — this avoids write conflicts and keeps the fail-closed review in one place. Append the source, and add the city to `coverage.cities` if new.
- Before proposing, inventory: the fair/venue may already exist as a broken source under another id (e.g. `oc-fair` existed as a dead `html` scraper while `oc-fair-2026` was being added — harmless thanks to dedupe, but check first).

### Gate-authoring rules (zero-extraction causes, all hit on 2026-07-12)

- `requiredText` matches against **visible page text only** — script/JSON-LD content is stripped before matching. "July 18, 2026" failed because the year exists only in JSON-LD; visible text said "Saturday, July 18". Gate on short visible fragments: event name + "July 18" + "11 AM".
- Avoid dashes, en-dashes, addresses, and times-with-ranges in gates unless you confirmed them in *stripped* text.
- **Eventbrite sources need `requiresBrowserContext: true`** — the pipeline UA (`saturday-with-friends/0.1 event-ingest`) gets blocked payloads. Same fix applies to Cloudflare-challenged sites (famsf).
- After merging, ALWAYS re-ingest each affected metro and confirm the new source extracts:
  ```bash
  node scripts/ingest-events.mjs --metro=<m>   # watch for zero-extracted alerts on your new ids
  grep -c "<new-event-id>" public/data/<m>/events.json
  ```

## 4. Bounded repair pass (30 min, one agent)

Aggregate criticals and fix only kids-facing sources in traffic metros (bay-area, los-angeles first — they earn the clicks):

```bash
python3 - <<'EOF'
import json, glob
for f in glob.glob('public/data/*/event-operator-alerts.json'):
    a = json.load(open(f)); a = a.get('alerts', a) if isinstance(a, dict) else a
    crit = [x for x in a if x.get('severity')=='critical']
    if crit: print(f.split('/')[2], len(crit), [x.get('sourceId') for x in crit][:8])
EOF
```

- One-off `officialTextEvents` sources whose event date passed → **retire** (delete the entry), don't repair.
- `scripts/event-ops-agent.mjs --auto-repair-sources` only applies pre-validated candidate URLs — it will not research fixes. Use a discovery agent (diagnose → propose → you approve → it applies with tests).
- Sites in temporary bot-challenge mode (e.g. Huntington Library, Vercel attack mode): mark unfixable, recheck in a few weeks.

## 5. Regenerate plans + validate — order matters

Featured plans go stale **the same day** (events end in the evening; the validator flags "references ended event"). So regenerate plans for ALL metros immediately before validating, and re-run any metro the validator still names:

```bash
for m in $(ls public/data | grep -v '\.'); do node scripts/generate-featured-plans.mjs --metro=$m; done
node scripts/build-coverage-summary.mjs
npm run test                     # 256+ unit/planner tests
npm run validate:data
npm run validate:events:all      # if it names a metro, regenerate that metro's plans and re-run
```

## 6. SEO no-regression gate

`npm run seo:audit` scans **dist/**, so it is meaningless on a stale build. Always:

```bash
npm run build                    # full FamHop build (~11k pages)
npm run seo:audit                # MUST be 0 errors, 0 warnings
npm run seo:i18n-check
grep -c "seo-shell:start" dist/index.html dist/bay-area/index.html   # hub prerender markers: 1 each
```

The `seo-shell` markers are the crawlable homepage/metro-hub content added 2026-07-12 — if a marker is missing, the hub regressed to an empty SPA shell; stop and fix `scripts/generate-seo-pages.mjs` before deploying. Also honor the SEO invariants section of `CLAUDE.md` (no aggregateRating, one event page per (title, venue), no new page types at scale — crawl budget is the binding constraint).

## 7. Ship + verify

```bash
git add -A && git commit -m "feat(events): weekly prep <window>" && git push origin main
npm run deploy:kids && npm run deploy:adults    # sequential — they share dist/
```

Liveness (raw HTML, not browser): famhop.com/ and one metro hub return 200 with `seo-shell:start`; each newly added event URL returns 200. Deploy pins per `CLAUDE.md` Deploy section.

Indexing: nothing manual needed — the 9:00 cron picks up changed `<lastmod>` values and submits within the 200/day quota.

## 8. Report

State: events added (with verification source), sources repaired/retired, metros refreshed, gate results (tests / validation / seo:audit counts), deploy status + liveness, and remaining backlog (chronic criticals, below-threshold coverage). Numbers, not adjectives.
