---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Planning your family's weekend shouldn't take 47 tabs"
destination: youtube
aspect: 1920x1080
language: en
length: 40s
angle: problem-collapse
audience: "Parents of young kids in the 16 U.S. metros FamHop covers"
narration: yes
---

## Intent

A sell-it promo for FamHop (famhop.com) — the family weekend planner covering 16
U.S. metros. Not a site tour: this markets the product to parents.

The confirmed concept is **"The 47 Tabs"** (chosen from a five-concept round):

> The actual way parents plan a weekend today: 47 browser tabs, a Facebook group,
> a dead city calendar, a PDF from 2019 — all of it collapsing into one FamHop card.
>
> Visual world: a chaotic wall of tab rectangles that crushes to a single card on a
> shader wipe, then opens into captured screens.
>
> Hook: the wall of tabs, already too many, still multiplying.

It states the pain in one image before a word of narration — which matters because
this plays as a hero video that autoplays muted — and the collapse-to-one-card gives
one strong motion beat instead of a feature montage.

## Customizations

- **Website capture** — crawl famhop.com for real brand tokens, screens, and assets.
  The captured screens are the payoff material after the collapse.
- **Scene transitions** — the tab wall hands off to the single card on a shader wipe.
  This is the video's signature beat; do not downgrade it to a crossfade.
- **Map / coverage proof beat (grafted from concept E)** — resolved after capture:
  FamHop's own product screen *is* a real Leaflet map with clustered pins, and the
  topbar carries a 16-metro selector. Use the captured product screen and that real
  selector as the coverage proof — do **not** bake a synthetic basemap. One shot,
  ~4s; it is proof, not a scene.
- **Narration + BGM, added 2026-07-26 on top of the silent cut** — and the silent
  origin still constrains everything:
  - Shipped first as a silent typographic cut (HeyGen unsigned, Kokoro/MusicGen absent).
    Narration and music were added afterwards **without rebuilding a single frame**.
  - **Voice:** ElevenLabs (`$ELEVENLABS_API_KEY`), voice `Gubgw9l4dtIoQA9YZHgx`
    — "Brian, deep/resonant/comforting", middle-aged American male, conversational.
    Needed `pip install elevenlabs` (the engine drives ElevenLabs through Python).
    ElevenLabs returns no word timestamps; the engine aligned them, so captions
    remain possible.
  - **BGM:** generated via the **ElevenLabs music API** (`POST /v1/music`, 41s), not
    HeyGen. This workflow's audio adapter hardcodes `bgm: {mode: "retrieve"}`, which
    has no local fallback — so with no HeyGen credential the normal BGM path always
    skips. `assets/bgm/famhop-underscore.wav`, mounted at volume **0.20**.
  - **Because the frames were authored for silence they PRINT every beat in large
    type, so the narration deliberately says different words.** Never let the two
    converge — that double-prints. See SCRIPT.md's writing constraints.
  - **Never run `audio.mjs sync-durations` on this project.** It writes measured voice
    duration into `STORYBOARD.md` verbatim; every line is shorter than its frame, so it
    would shrink all 8 frames and truncate their late reveals. Lines were written to fit
    the existing windows instead (4.69s in 5.5s, 3.2s in 5.0s, …).
  - Captions still **off**: the frames are already type-dense and the VO adds a second
    text stream. One `captions.mjs build` away if wanted.
  - Delivery loudness normalized post-render (`loudnorm I=-16:TP=-1.5`), video stream
    copied. Renders at -22.9 LUFS raw because voice is already at the 1.0 ceiling.

## Notes

- Design system deferred to post-capture (as agreed): showcases judged with FamHop's
  real brand in hand. The pick is layout bones; FamHop's colors and fonts get
  remixed onto whichever preset wins.
- Real numbers, from capture — use these, invent nothing else:
  **16 metros · 903 spots · 1,007 events · 554 this week · 1,582 Bay Area spots.**
  No user counts, no testimonials, no fabricated growth figures.
- Real product copy worth reusing verbatim: "This weekend's plan, ready to go" ·
  "Hop now" · "Make it mine" · "Plan · Hop · Repeat." · "Get 5 family things to do
  every Friday". Real plan titles: "Palo Alto rainy-day: animals, art & ice cream",
  "San Jose energy-burner: farm, trampolines & pancakes", "East Bay classics: pizza,
  climbing & a Fenton's sundae", "Toddler Saturday in the Presidio".
- Brand assets located in capture:
  `capture/assets/svgs/logo-f8292a20.svg` — the "famhop" wordmark (uses
  `currentColor` + `var(--accent)`, so define `--accent: #DD6A1A`);
  `capture/assets/svgs/logo-217efa6e.svg` — the rounded app tile mark.
- Anti-pattern to avoid: the stock SaaS promo — smiling stock family, "Introducing
  FamHop", feature bullets flying in, UI floating on a gradient.
