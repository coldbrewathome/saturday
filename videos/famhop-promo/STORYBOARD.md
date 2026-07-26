---
format: 1920x1080
duration: 40s
message: "Planning your family's weekend shouldn't take 47 tabs"
arc: PAS — Pain (tab overwhelm) → Agitation (still no plan) → Solution (one card) → Proof (plan, tuning, coverage) → CTA
audience: Parents of young kids in the 16 U.S. metros FamHop covers
mode: collaborative
music: warm unhurried indie-acoustic underscore, light percussion, one gentle lift into the close
---

<!--
SILENT PIECE. `music: warm unhurried indie-acoustic underscore, light percussion, one gentle lift into the close` + no SCRIPT.md is the canonical fully-silent marker:
no narration, no BGM, no SFX. The hero placement on famhop.com autoplays muted,
so every beat is carried by on-screen type. Each frame's `on_screen:` field is
the copy that must be legible — it is the load-bearing content, not decoration.
All figures and product copy are verbatim from capture/extracted/visible-text.txt.
Every frame has a USER-CONFIRMED WIREFRAME on disk: keep its composition.
-->

## Video direction

**Palette system** (from `frame.md`, never invented). Ground is cream `#FAF5EB` on every frame
except the closer, which is the run's single forest-green plate `#2D5043`. Ink `#1B1916` carries
every border and every line of type. Accent orange `#DD6A1A` is the one voltage color: it marks
exactly the beat's payoff — the count, the selected chip, "ONE PLAN.", "ZERO TABS.", the
wordmark's pin-o — and nothing else. Berry `#B25368` is the marker/stamp color; forest and sun
appear only inside the stat row. Two or three accents per frame, never all four. No pure white,
no gradient, no blurred shadow — depth is hard offset shadow or color-block contrast.

**Motion grammar.** Long-tail decel, `power3` by default — smooth over bouncy. No `back.out` /
`bounce.out` / `elastic.out` anywhere. Entrances are `fromTo`. Internal seams are velocity-matched
cuts (`cut-catalog.md`), never slideshow cuts.

**Reveal model — this piece is SILENT, so beats replace voiceover cues.** There is no narration to
pace against, which makes front-loading the standing danger here: with nothing being said, the
temptation is to dump the whole frame at `t=0` and hold for five seconds. Do not. Each frame runs
an implicit beat grid of roughly **one reveal per 0.9–1.2s**; every piece — a line, a chip, a stat,
a stop — enters on its own beat, with reveals spread across the back ~50%. **Reading time is the
constraint the voiceover would otherwise supply: any line the viewer must read is fully on screen
at least 1.2s before the frame ends.**

**Rhythm / held-frame allocation.** Frames 1–6 develop across their full duration. **Frame 7 is the
deliberate breather** — one move, then a genuine hold; its stillness is what makes the closer land.
Frame 8 resolves and holds to the last frame. Every frame ends on a held read: once content
resolves, it stops. Prefer stillness to bad motion.

**Negative list.** No browser chrome, nav bars, scrollbars, real cursors, or reconstructed
third-party UI. No stock-photo families, no "Introducing FamHop", no feature bullets flying in, no
floating bokeh or purple-blue AI gradients. No rounded corners except the pill chip; no rotation
except the brand angles (−4° badge, −6° stamp). Both motion failure modes are banned: **slideshow**
(everything dumped in the first 25%, then frozen) and **screensaver** (elements drifting or
breathing independently to fake life). The only sanctioned aliveness during a hold is
low-amplitude jitter.

**Caption band.** Captions are off, but the bottom 17% stays clear anyway — nothing below `y=896`.
The mono meta footer sits at `y≈842`, and the confirmed wireframes already place it there.

**No audio.** `sfx: none` on every frame; no worker mounts an `<audio>` element.

## Frame 1 — 47 tabs

- scene: Browser tabs multiply across cream until they swamp the frame; a counter explodes to 47
- voiceover: "Every Saturday starts the same way. Tabs open everywhere, and still nowhere to go."
- duration: 5.5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-47-tabs.html
- type: hook
- persuasion: Pain validation
- beat: overwhelm → frustration
- blueprint: dataviz-countup (Adapt)
- focal: — none (typography-only beat; the chip wall is drawn, not captured)
- roles: — no asset candidates
- sfx: none
- on_screen: kicker "SATURDAY · 9:02 AM" · tab labels (the parent's own searches, not third-party brands): "kid friendly near me" / "toddler activities saturday" / "is it raining sunday" / "museum free days" / "indoor play 3 year old" / "city events calendar" / "birthday party ideas" / "what time does it open" · the count ticks 12 → 47 · payoff line "47 TABS. STILL NO PLAN."
- asset_candidates:
- asset_note: none — typography only; the tabs are drawn as ink-bordered blocks per frame.md

narrativeRole: Open on the viewer's actual Saturday morning, not on the product. The tab wall is recognizable in under a second, which is what a muted autoplay needs. The count is the hook's tension: effort spent, nothing gained.
keyMessage: You already do this every weekend, and it doesn't work.

Adapt: keep the cold-open counter-burst signature — chips puncture in clustered at center, then one
statistic explodes upward in size as the chips fling outward to their marks. Changed: the "icons"
are search tabs, and they resolve into a scattered wall rather than a ring.

Scene 1 (0.0–1.0s): cream ground, mono chrome already seated. A tight cluster of five tab chips punctures in at dead center on a long-tail settle (`spring-pop-entrance`) — centered, ~22% of frame, 2 depth layers.
Scene 2 (1.0–2.6s): the cluster flings outward to the wireframe's scattered wall positions while the remaining chips puncture in behind them, staggered by index (`center-outward-expansion`). Full-width strip filling the upper ~55%; 3 depth layers, rear chips held back in weight.
Scene 3 (2.6–4.1s): the counter enters lower-left and climbs 12 → 47, its type size growing with the value (`counting-dynamic-scale`) in accent-orange; "TABS." lands beside it at the top of the climb. Asymmetric 70/30, hero anchored lower-left.
Scene 4 (4.1–5.5s): "STILL NO PLAN." slams in beneath on one beat (`kinetic-beat-slam`); the chip wall steps back in weight and the frame holds. Held read — no camera drift; at most low-amplitude jitter (`sine-wave-loop`) on two rear chips.

## Frame 2 — One tap. One plan.

- scene: The 47 tabs crush inward and become a single FamHop plan card; the wordmark lands
- voiceover: "FamHop does the looking for you. Your weekend, already planned."
- duration: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/02-one-plan.html
- type: product_intro
- persuasion: Negative contrast
- beat: relief
- blueprint: logo-assemble-lockup (Adapt)
- focal: assets/logo-famhop.svg
- roles: logo-famhop.svg = cutout (the lockup the whole shot resolves onto; inline the SVG so `currentColor` and `var(--accent)` resolve — set `--accent: #DD6A1A`, never an `<img>`)
- sfx: none
- on_screen: "ONE TAP." / "ONE PLAN." → resolves to the product's own line "THIS WEEKEND'S PLAN, READY TO GO" with the famhop wordmark
- asset_candidates: assets/logo-famhop.svg — the famhop wordmark, inlined as SVG

narrativeRole: The value claim, landing on beat 2 exactly as the spine requires. The crush is the video's signature move — it must read as 47 things becoming one thing, in one continuous motion, inside this frame. Frame 1 ends holding the tab wall and this frame opens on the same wall in the same positions, so the hard cut is invisible and the collapse plays here.
keyMessage: The same weekend, without the 47 tabs.

Adapt: keep the signature "the mark comes to exist, built from parts that clear the stage and
assemble." Changed: the parts are frame 1's chip wall (same positions, so the frame boundary is
invisible), and what assembles is the plan card plus the wordmark rather than an abstract mark.
**This is the video's signature beat — do not downgrade the crush to a fade.**

Scene 1 (0.0–1.3s): opens on frame 1's chip wall at its exact final positions. Every chip converges on one center point, shrinking and shedding opacity as it travels (`scale-swap-transition`), the fastest chips carrying directional velocity blur (`motion-blur-streak`). Centered convergence, 3 depth layers.
Scene 2 (1.3–2.2s): the convergence point resolves into the plan card, arriving at the same screen center the chips died on (`card-morph-anchor`) — build the seam as an **inverse zoom-through** (`cut-catalog.md`), which reads as "arriving at". Card centered, ~45% of frame.
Scene 3 (2.2–3.4s): "ONE TAP." lands above the card on one beat, "ONE PLAN." in accent-orange on the next (`kinetic-beat-slam`); the card's inverted ink kicker wipes in along its own width.
Scene 4 (3.4–5.0s): the famhop wordmark draws itself on beneath the card, stroke by stroke (`svg-path-draw`), the pin-o filling accent-orange last. Then held — no drift, no breathing.

## Frame 3 — The plan

- scene: One real FamHop plan card held as hero while its three stops populate in order
- voiceover: "A real day, start to finish. Three stops, a few blocks apart."
- duration: 5.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-the-plan.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: clarity + curiosity
- blueprint: device-surface-showcase (Adapt)
- focal: assets/photo-1554907984-15263bfd63bd.jpg
- roles: photo-1554907984-15263bfd63bd.jpg = supporting (fills the card's left photo panel edge-to-edge, `object-fit: cover`; the stop chain is the type hero)
- sfx: none
- on_screen: plan title "Palo Alto rainy-day: animals, art & ice cream" · the stop chain arriving one at a time — "PALO ALTO JUNIOR MUSEUM & ZOO" → "COLOR ME MINE" → "TIN POT CREAMERY" · footer line "ALL WALKABLE DOWNTOWN. NO TRANSIT BETWEEN STOPS."
- asset_candidates: assets/photo-1554907984-15263bfd63bd.jpg — the museum-interior thumbnail this exact plan card uses on the live site

narrativeRole: Proof that "a plan" means something specific and usable, not a search-results page. The three named stops are the evidence; the no-transit line is the detail that says a person thought about this.
keyMessage: A real, walkable day — not a list of links.

Adapt: keep the held-hero-surface + stepwise-flow signature. Changed: the "device" is the plan card
itself — no window chrome, no browser frame (the negative list forbids it); the card IS the surface.

Scene 1 (0.0–1.1s): the card arrives at hero scale via a zoom-to-target from the previous card's center (`coordinate-target-zoom`); its photo panel and the mono eyebrow "Outdoors · Palo Alto" are present, the body still empty. Asymmetric 30/70 — photo left, body right; 3 depth layers.
Scene 2 (1.1–2.2s): the plan title assembles chunk by chunk (`dynamic-content-sequencing`) on a long-tail settle.
Scene 3 (2.2–4.2s): the three stops arrive one per beat, each accent-orange numeral popping a beat ahead of its stop name (`waterfall-entry`) so the chain reads as a route being built, not a list appearing.
Scene 4 (4.2–5.5s): the footer line sweeps in beneath the card and a marker highlight draws across "No transit" (`css-marker-patterns`). Everything holds still.

## Frame 4 — Make it mine

- scene: Day-type and age chips; one of each is picked and the plan re-forms into a different real plan
- voiceover: "Wrong day for your kid? Change it, and the plan rebuilds."
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-make-it-mine.html
- type: feature_showcase
- persuasion: Friction reduction
- beat: control
- blueprint: panel-edit-live-sync (Reproduce)
- focal: assets/photo-1502082553048-f009c37129b9.jpg
- roles: photo-1502082553048-f009c37129b9.jpg = supporting (the re-formed card's thumbnail panel, `object-fit: cover`)
- sfx: none
- on_screen: chip row "LOW-EFFORT DAY / ACTIVE DAY / FOOD DAY / MUSEUM · LIBRARY DAY" · age row "0–2 / 3–5 / 6–10 / 10+" · "ACTIVE DAY" and "3–5" select · the card re-forms to "San Jose energy-burner: farm, trampolines & pancakes" · button "MAKE IT MINE"
- asset_candidates: assets/photo-1502082553048-f009c37129b9.jpg — open-field/tree thumbnail for the active-day plan the card re-forms into

narrativeRole: Answers the objection the previous frame creates — "that plan isn't for my kid." The pick and the re-form must happen in the same beat, or the coupling isn't proven.
keyMessage: It bends to your kid, your energy, your day.

Reproduce: the chip panel is the inspector, the plan card is the bound surface, and each pick
re-forms the card **in the same beat**. The coupling is the whole point — never let a pick and its
result land in different scenes.

Scene 1 (0.0–1.0s): "MAKE IT MINE." lands upper-left on one beat slam (`kinetic-beat-slam`); the chip panel is seated below it with every chip unselected. Asymmetric 45/55 — panel left, card right; 3 depth layers.
Scene 2 (1.0–2.0s): the "Active day" chip presses — compression, then spring recovery into the accent-orange filled state (`press-release-spring`). No cursor is drawn.
Scene 3 (2.0–3.0s): **in the same beat**, the bound card re-forms — photo and title cross-swap to the San Jose plan (`control-target-sync`, seamed with `theme-crossfade-morph`).
Scene 4 (3.0–4.2s): the "3–5" age chip presses the same way, and the card's stop line re-writes beneath the title (`discrete-text-sequence`).
Scene 5 (4.2–5.0s): the orange "+ Make it mine" button lands under the card and the frame holds still.

## Frame 5 — Everything near you

- scene: The real FamHop map screen; a slow cinematic push across clustered pins
- voiceover: "Every park, museum and library near you, already on the map."
- duration: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-the-map.html
- type: feature_showcase
- persuasion: Statistical proof
- beat: confidence
- blueprint: camera-journey (Adapt — sub-shape B, cursorless flight)
- focal: assets/scroll-000.png
- roles: scroll-000.png = background (full-bleed product screen — **do NOT dim it**; it is the evidence of the beat and must stay fully legible)
- sfx: none
- on_screen: "1,582 SPOTS — IN THE BAY AREA ALONE." (counts up) · small mono label "EDITOR'S PICKS NEAR THIS VIEW"
- asset_candidates: assets/scroll-000.png — the captured full product screen: filter rail, clustered map pins, the editor's-picks carousel

narrativeRole: Scale within one metro. The captured screen does the work — this is the frame where the viewer sees the actual product rather than a designed abstraction of it.
keyMessage: The whole metro is already mapped.

Adapt: keep the cursorless-cinematic-flight signature. Changed: the "world" is a single captured
still, so fly it as a flat plane inside the wireframe's ink-bordered screen block — scale and
translate the image, never fake 3D geometry.

Scene 1 (0.0–1.4s): the product screen fills its block at ~112% scale, framed on the filter rail; a slow lateral flight begins toward the pin cluster (`viewport-change`), the rail softening out of focus as it leaves frame (`depth-of-field-blur`). Full-bleed within the block, 3 depth layers.
Scene 2 (1.4–3.0s): the flight decelerates and locks framed on the clustered pins; the cluster badges pulse once as they come into focus (`svg-icon-enrichment`).
Scene 3 (3.0–4.2s): the berry marker-block slams in over the lower-right of the screen carrying the frame's one hard offset shadow (`spring-pop-entrance`), its figure counting 0 → 1,582 (`counting-dynamic-scale`).
Scene 4 (4.2–5.0s): the flight stops dead and the frame holds — no back-half re-push, no drift.

## Frame 6 — 16 metros

- scene: Three ink-bordered stat cells land while the metro names populate behind them
- voiceover: "Sixteen metros. And the events are refreshed every week."
- duration: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-16-metros.html
- type: social_proof
- persuasion: Statistical proof
- beat: trust
- blueprint: dataviz-countup (Reproduce)
- focal: — none (typography + stat cells only)
- roles: — no asset candidates
- sfx: none
- on_screen: stat cells "16 METROS" / "1,007 EVENTS" / "554 THIS WEEK" · the 16 real metro names populating behind — Bay Area, Los Angeles, New York City, Seattle, Chicago, Dallas-Fort Worth, Houston, Washington DC, Atlanta, Philadelphia, Miami, Phoenix, Boston, San Diego, Honolulu, Austin
- asset_candidates:
- asset_note: none — typography only; stat cells and the metro list are drawn per frame.md's stat-cell component

narrativeRole: The coverage proof, and the frame that answers "does this work where I live?" Uses the product's real metro selector as its content rather than a synthetic map.
keyMessage: Not just one city — and the events are current.

Reproduce: proof by count-up. This is the run's one **dense-exception** frame (frame.md's stat grid),
so it may fill where other frames stay 45–60% empty. Three accents are permitted here and only here.

Scene 1 (0.0–1.0s): "NOT JUST ONE CITY." assembles word by word, centered (`dynamic-content-sequencing`).
Scene 2 (1.0–2.4s): the three ink-bordered stat cells land left to right on staggered beats (`spring-pop-entrance`) — forest, berry, orange — each figure counting up from zero (`counting-dynamic-scale`). Pace the counts so **1,007 is the last figure to finish**: the biggest number lands last.
Scene 3 (2.4–4.2s): the 16 metro pills populate beneath in reading order, staggered by index (`waterfall-entry`), Bay Area first.
Scene 4 (4.2–5.0s): a single marker underline draws under "554 THIS WEEK" (`css-marker-patterns`) — the freshness claim — then the frame holds still.

## Frame 7 — Every Friday

- scene: One calm value card, a single restrained move, then held still
- voiceover: "Or let us send five ideas, every Friday."
- duration: 4.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-every-friday.html
- type: benefit_highlight
- persuasion: Friction reduction
- beat: ease
- blueprint: titlecard-reveal (Reproduce)
- focal: — none (typography only)
- roles: — no asset candidates
- sfx: none
- on_screen: "GET 5 FAMILY THINGS TO DO EVERY FRIDAY." · under it, small: "ZERO TABS."
- asset_candidates:
- asset_note: none — typography only

narrativeRole: The lowest-commitment version of the promise, and the piece's one moment of stillness after four dense product frames. Traces to the message: the zero-tab weekend, delivered rather than searched for.
keyMessage: You don't even have to go looking.

Reproduce. **This is the run's allocated breather frame** (see `## Video direction`) — low motion is
the payload, not a deficiency. Resist adding a third move.

Scene 1 (0.0–1.2s): cream field; the two-line title slides up into place and crossfades on one restrained move (`spring-pop-entrance`, long-tail, zero overshoot). Centered, ~55% of frame.
Scene 2 (1.2–2.2s): "ZERO TABS." lands beneath in accent-orange on a single beat (`kinetic-beat-slam`).
Scene 3 (2.2–4.5s): **deliberate hold.** Nothing moves but a low-amplitude jitter on the numeral "5" (`sine-wave-loop`). No camera, no breathing, no third reveal.

## Frame 8 — Plan · Hop · Repeat.

- scene: The single forest-green plate of the run; the wordmark and URL land
- voiceover: "Get your Saturday back. famhop.com"
- duration: 5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/08-closer.html
- type: cta
- persuasion: Rule of three
- beat: motivation
- blueprint: kinetic-type-beats (Reproduce)
- focal: assets/logo-famhop.svg
- roles: logo-famhop.svg = cutout (inline the SVG in cream; set `--accent: #DD6A1A` so the pin-o reads orange against the green)
- sfx: none
- on_screen: "PLAN ·" / "HOP ·" / "REPEAT." snapping in one at a time · then the famhop wordmark · "famhop.com" · a rotated stamp reading "16 METROS"
- asset_candidates: assets/logo-famhop.svg — the famhop wordmark

narrativeRole: The sign-off, on the one green ground frame.md reserves for exactly this beat. The tagline is the product's own; the URL is the ask.
keyMessage: famhop.com — go get your Saturday back.

Reproduce: the closing line snaps in beat by beat and lands on the wordmark and the URL.
**This is the final frame** — the only one permitted an exit, and it does not need one: let the URL
hold to the last rendered frame.

Scene 1 (0.0–0.4s): the forest-green plate is the ground from `t=0` (the run's only green frame); the berry stamp is already seated top-right at the brand −6° angle.
Scene 2 (0.4–2.2s): "PLAN ·", "HOP ·", "REPEAT." snap in one line per beat on hard cuts (`kinetic-beat-slam`), cream on green — the line count is the rhythm.
Scene 3 (2.2–3.6s): the famhop wordmark draws itself on beneath the tagline (`svg-path-draw`), the pin-o filling accent-orange last.
Scene 4 (3.6–5.0s): "famhop.com" lands under the wordmark on one beat and the frame settles into a full hold to the last frame. No exit tween.
