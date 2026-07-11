# FamHop — "This Weekend" video (data-driven, weekly, all metros)

Auto-generates a weekend events roundup for any metro from the **live** event feed.
Built to regenerate every week, per metro. Family/FamHop branded, with per-metro
theming (accent color, landmark emojis, nickname).

## All metros at once (preview, no voiceover)
```bash
node video/weekend/build-all.mjs --weekend next            # every metro w/ data, both orientations
node video/weekend/build-all.mjs --weekend next --orient vertical
node video/weekend/build-all.mjs --only miami,seattle --concurrency 2
```
Renders in parallel with a **music bed only** (no ElevenLabs spend) — for fast
preview. Output: `out/<metro>/famhop-<metro>-weekend-<orient>.mp4` + `lineup.txt`.
Metros with fewer than 4 next-weekend events are skipped. Per-metro theming lives
in `metros.mjs` (accent, emojis, nickname, map type). The FamHop wordmark stays
coral everywhere; the accent colors the hook number, pins, and chips.

**Real maps + event images** (on by default): each event card shows a real
OpenStreetMap view centered on the venue (`staticmap.mjs`, softened to match the
UI) and, when available, the event page's og:image promo photo (`enrich.mjs`).
Both degrade gracefully — no map coords → stylized map; bot-blocked/missing
og:image → map-only card. Live screenshots are deliberately not used (event
pages routinely return "Access Denied" to headless browsers). Flags:
`--no-maps` (use the stylized map), `--no-shots` (skip og:image fetch).
Every render also opens with a metro title card and closes with a FamHop outro.

To add voice later, run the single-metro `build.mjs` (below) for the metro you want.

---

## Single metro, with voiceover (final)

**Deliverables (per run):**
- `famhop-bayarea-weekend-vertical.mp4` — 1080×1920, Shorts / Reels / TikTok (primary)
- `famhop-bayarea-weekend-landscape.mp4` — 1920×1080, YouTube

Both are video + ElevenLabs VO + music (auto-ducked under the voice), ~45–50s.

## Produce one
```bash
node video/weekend/build.mjs                 # this weekend, Bay Area
node video/weekend/build.mjs --weekend next  # the coming weekend
node video/weekend/build.mjs --skip-curate   # reuse the current plan/scenes
```
Requires `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` in the environment (same as
the intro). Output is ~45–50s, both orientations.

## Pipeline (what build.mjs runs)
1. **`curate.mjs`** — reads `public/data/<metro>/events.json`, finds the target
   Sat–Sun window, keeps upcoming/verified/non-ended events with a real
   title+venue, dedupes, scores, and **round-robins across category buckets** so
   the lineup is diverse (a festival + something outdoors + a museum + free +
   more), capped per city. → `weekend-plan.json`
2. **`build-scenes.mjs`** — turns the plan into an ordered, narrated scene list:
   number hook → "N free" → one card per hero event → category montage → CTA.
   Writes VO copy per event. → `weekend-scenes.json`
3. **`build-vo.mjs`** — ElevenLabs TTS per scene (cached; cache key includes the
   spoken text, so copy edits regenerate). Expands abbreviations (NWR, SF, &) so
   they're spoken naturally. → `vo/`, `durations.json`, `voiceover.wav`, `vo-manifest.json`
4. **`record.mjs`** — Playwright renders `weekend.html` to a silent MP4 per
   orientation at the VO-driven durations; trims the load lead-in via freezedetect.
   Scene data + durations are **injected** (file:// can't fetch). → `raw/<orient>.mp4`
5. **mux** (in `build.mjs`) — video + music + VO with sidechain ducking, loudness
   normalized, per orientation. → the two final MP4s.

## Source / tuning
- **`weekend.html`** — the animated template. `?orient=vertical|landscape` switches
  layout (stacked vs side-by-side). `?scene=N` freezes one scene for screenshots.
  Event cards show category emoji, title, venue·city, day+time, FREE/price, and a
  coral **pin dropped on a stylized Bay Area map by the event's real lat/lon**.
- **Curation knobs:** `--count N` (hero events, default 7), `--metro <id>`,
  `--weekend this|next`, `--ref YYYY-MM-DD` (pretend "today", for testing).
- **Music:** reuses `../music.mp3` (the intro's ukulele bed).

## Cadence
Generate **Thursday/Friday for the upcoming weekend** (`--weekend next` mid-week,
or default on Fri) so the lineup includes both Saturday and Sunday. Running on the
weekend itself drops events that have already ended — by design.

## Not yet (easy next steps)
- Per-metro: `--metro seattle` etc. once those feeds are populated (template and
  pipeline are already metro-agnostic; only the map bbox is Bay-Area-tuned).
- Family age-band filter in curation (the current round-robin can surface a
  teen-only library pick); prefer `ageBands` covering preschool/school-age.
- Real map tiles or a Bay Area silhouette instead of the stylized panel.
