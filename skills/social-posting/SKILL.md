# FamHop Social Posting — Pinterest pins + YouTube Shorts

Run the daily Pinterest pin batch and the weekly YouTube Shorts batch. This
skill is the operator's handbook; detail lives in the referenced docs.

**User decisions (2026-08-02):** Pinterest posting goes through **Chrome
browser automation, risk accepted** (the account's ToS-violation concern was
raised, discussed, and overridden). YouTube Shorts go through the **Data API
v3 uploader** (`videos/upload-shorts.mjs`).

---

## 1 · Pinterest — daily pins

Cadence: ~25–33 pins/day, best posted **5–8pm PT** (peak US-parent hours).
Batch = 1 queue file. Content is date-stamped ("this weekend") — never post a
queue older than the weekend it names; regenerate instead.

### Generate
```bash
cd marketing/pinterest/pinterest-automation
python3 generate_pins.py --date YYYY-MM-DD   # today if omitted
```
Writes `pins-queue/YYYY-MM-DD.json` (~33 pins). **Verify every pin's
`image_path` exists before posting** (the old generator wrote broken paths —
that bug is fixed; stale queues with missing images live in `pins-queue/_stale/`
and must never be posted).

### Post (AppleScript JS injection — the ONLY working mechanism on this Mac)
chrome-devtools-mcp CANNOT connect here: macOS TCC blocks reading
`~/Library/Application Support/Google/Chrome/DevToolsActivePort` (the MCP
server fails with "Could not find DevToolsActivePort"), and System Events
clicks/keystrokes need Accessibility permission (not granted). What works:
driving the REAL logged-in Chrome via `osascript execute javascript`
(`AllowJavascriptAppleEvents` is set — verify with
`defaults read com.google.Chrome AllowJavascriptAppleEvents`).

Posting flow (proven 2026-08-02, 33 pins via `post_loop.py` pattern; runner
helpers in `/tmp/famhop-social/` — recreate if gone):
1. Prereq: Chrome open with Pinterest logged in as **hopwithfamhop**.
2. Per pin (proven sequence, see `post_loop.py` pattern — recreate in
   `/tmp/famhop-social/` if gone):
   a. Navigate to `pinterest.com/pin-creation-tool/` → click "Create new"
      (the tool auto-restores the last draft on nav).
   b. Inject the image via base64→File→DataTransfer into
      `#storyboard-upload-input` (fetch is blocked by Pinterest CSP — always
      base64-inject; the page is HTTPS so `http://localhost` fetches fail).
   c. Fill title (`#storyboard-selector-title`) + link (`#WebsiteField`)
      with the native input setter + `input` event; description via
      `execCommand("insertText")` on the Draft.js
      `[contenteditable=true][aria-label="Describe your Pin"]`; open the
      board dropdown, search, click the row
      (`[data-test-id="board-row-<name>"]`); check the AI-disclosure
      checkbox (`input[id^="pin-draft-ai-disclosure"]`) — **required for
      these AI-generated poster images**. All of this auto-saves to a draft.
   d. **Navigate away and back** (fresh load), then click the pin's draft
      card (newest match on `pin-draft-title-description-container` text).
   e. Click the header **Publish** button — it only fires on a form cleanly
      loaded from the draft (JS-filled fields never enter React state, so it
      silently no-ops on the raw form; the bulk sidebar path is a fallback
      but is flaky). Success = drafts count drops and stays dropped
      (double-read; transient mid-reload reads lie).
3. Space pins ~2 min apart. After each pin: set `status: "posted"` in the
   queue file and save.
4. Done: move queue to `pins-posted/`, write a summary (X posted / Y failed).
5. Debugging aids: leftovers accumulate in the drafts sidebar — bulk-select +
   "Delete Pins" to clean. `sessionStorage` instrumentation survives the
   publish-triggered page reload.

### Watch-outs
- Never post pins from `_stale/` — their dates and image paths are dead.
- If the account hits a bot-check or the publish form misbehaves, stop and
  report — don't retry rapidly.

---

## 2 · YouTube Shorts — weekly (16 metro cuts)

Cadence: one batch per weekend, cut from the week's real events. The Aug 8
batch was built 7/31; the pipeline is designed to be re-run weekly.

### Build (weekly, before Thursday)
```bash
node videos/pick-weekend-events.mjs   # pick 5 events per metro → weekend-picks.json
node videos/build-metro-shorts.mjs    # render 16 HyperFrames cuts → delivery-<sat>/
node videos/build-shorts-vo.mjs       # (VO, if used)
node videos/build-shorts-metadata.mjs # YOUTUBE-METADATA.md + upload-manifest.json
```
Cuts expire the Sunday they name — re-cut weekly, never leave stale ones up.

### Upload (API)
One-time setup (≈5 min, user): Google Cloud console → enable YouTube Data API
v3 → OAuth consent screen (External, test user = channel owner) → Desktop
client → save as `video/youtube-oauth.json` (gitignored). First run opens a
browser for consent; token caches in `video/.youtube-token.json`.
```bash
node videos/upload-shorts.mjs --week 2026-08-08 --privacy public \
  --playlist "This Weekend With Kids" --thumb /tmp/short-thumb.jpg
# --metro <id> to upload one; default privacy is private (flip in Studio, don't re-run public)
```
Thumbnail = closing famhop.com card (~last 3s): `ffmpeg -sseof -3 -i famhop-bay-area-aug8.mp4 -frames:v 1 -update 1 /tmp/short-thumb.jpg` (one frame works — same closing card across metros).
Shared settings (all 16): Visibility public · Category Travel & Events ·
Not made for kids (audience is parents) · Language English · Comments on.

### Watch-outs
- Shorts are vertical <60s — YouTube auto-classifies as Shorts.
- Don't re-upload a batch to flip privacy — duplicate videos.

---

## 3 · YouTube Guides — weekly evergreen (1/week, 4–8 min)

Long-form VO slideshow guides (1920×1080) that never expire — the channel's
compounding search library. Four topic types: **city** ("Weekend with kids in
…"), **howto** ("How to find free things…"), **product** ("How to use FamHop"),
**bucket** ("10 free things in …"). One per week on top of the Shorts.

### Author the spec (the content work)
Each guide is a hand-authored `videos/guides/<id>/spec.json` — Claude writes it
weekly, grounded in real data. Cards/stats reference the data by ref so the
video can never drift from the site:
- `annual-events:<metro>:<slug>` / `evergreen-events:<metro>:<slug>` —
  `data/annual-events.json` / `data/evergreen-events.json`
- `free-stats:<metro>[:<ageBand>]` — live count from `public/data/<metro>/events.json`
- `plan:<metro>:<planId>` — `featured-plans.json` (summary → body, stops → slab)
- `event:<metro>:<id|slug>` — an event feed record (override `body` inline when
  the feed description is date-specific — keep the card evergreen)

Scene layouts: `title | section | card | list | stat | cta`. Every scene needs
`duration` (3.5–20s) + `vo` (plain text, no `*`/`()` — TTS reads them literally).

**Card photos:** cards get a photo panel (right side, 548×420, ink-framed) when
an image resolves: `event:` refs use the feed's `imageUrl`, `plan:` refs match
the first spot whose name shares ≥2 significant tokens with the plan text,
annual/evergreen refs have none — supply `inline.image` (e.g. a Wikimedia
Commons `upload.wikimedia.org/.../1280px-...` thumb; that's where the pilots'
images came from). The builder downloads photos into `assets/img/` at build
time (never hot-linked at render), skips if present, retries with backoff on
429/5xx, and **drops the photo (text-only card) if the URL fails** — a rotting
URL can never break a rebuild. With a photo, the card title column narrows to
the photo's left edge.

**Evergreen discipline (review gate before upload):** no years, no "this
weekend", no dated claims in title/description/vo; snapshot numbers phrased
"on the site right now"; annual entries only name typical months ("every july").
Title conventions per type: city `Weekend with kids in <seoName>: <payoff>` ·
howto `How to find free things to do with kids — a 3-step FamHop guide` ·
product `How to use FamHop to plan a kid-friendly <x>` · bucket
`10 free things to do in <city> with kids`. Target 3:30–4:30 (word budget:
~2.6 wps, ≤85% of each scene window).

### Build
```bash
node videos/build-guides.mjs --guide <id> --no-vo   # validate + scaffold, no TTS
node videos/build-guides.mjs --guide <id>           # + TTS (ELEVENLABS_API_KEY); VO-window gate
cd videos/guides/<id> && npm run check              # hyperframes lint/runtime/layout/motion/contrast
node videos/build-guides.mjs --guide <id> --render --quality draft    # smoke render
# read frames at ~10/50/90% (ffmpeg -ss), listen for BGM loop seams
node videos/build-guides.mjs --guide <id> --render --quality standard # final
```
`--no-vo` builds gate on the word-rate estimate; the real gate (measured VO
duration + 0.6s ≤ scene window) runs with TTS and exits 1 on violation —
**shorten the vo or widen the scene, never re-time frames**. VO is cached in
`videos/vo-guides/` (hash-keyed) — a changed word re-records only that line.

### Metadata + upload
```bash
node videos/build-guides-metadata.mjs               # YOUTUBE-METADATA.md + manifest + thumbnail
node videos/upload-shorts.mjs --manifest videos/delivery-guides/upload-manifest.json \
  --id <guide-id> --privacy private                 # review in Studio, flip to public
```
Form settings: Visibility private → **flip to Public in Studio after review**
(never re-run with --privacy public — duplicates) · Category Travel & Events ·
Not made for kids · Language English · Comments on · Thumbnail = title-card
frame (auto-extracted) · Playlist per spec (e.g. "FamHop City Guides" — create
once in Studio, the uploader warns if missing).

### Watch-outs
- Render time: 4–8 min @ 1080p30 is the unknown — the draft render IS the
  timing probe; a slow standard render can run overnight (1 guide/week budget).
- Data drift: refs re-resolve at build, but hand-written VO does not — if a
  referenced description changes materially, re-check that card's VO.
- Same voice/settings as Shorts (ElevenLabs `Gubgw9l4dtIoQA9YZHgx`) — the
  channel sounds like one person.
- Re-render after metadata requires re-running the metadata step (thumbnail is
  extracted from the mp4).

---

## 4 · Reporting

After either run, write a dated summary file (`pins-posted/` for Pinterest,
inline for YouTube) and tell the user: count posted, failures, links.
