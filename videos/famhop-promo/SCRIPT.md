# SCRIPT — famhop-promo

**Voice:** _(pending — chosen at the audio step once an engine is available)_
**Voice direction:** Warm, unhurried, one parent talking to another. Not an announcer,
not perky. Dry on the problem lines, quietly certain on the payoff. Never sell.

---

## Writing constraints (read before editing any line)

These are not style notes — they are structural, and breaking them breaks the build:

1. **The on-screen type already states every beat.** The frames were authored for a silent
   cut, so each one prints its claim in large type. The voiceover must therefore say
   something the type does NOT — context, stakes, the human aside. **Never read the
   on-screen words aloud**; that double-prints and is the single fastest way to make a
   promo feel cheap. (Frame worker contract: visible text ≠ narration text.)
2. **Every line must finish INSIDE its frame's existing duration**, with room to spare.
   The eight frames are already built and were reviewed at fixed durations, and each ends
   on a deliberate held read. A line that overruns gets cut off at the frame boundary.
3. **Do not run `audio.mjs sync-durations` on this project.** It writes the measured voice
   duration into `STORYBOARD.md` verbatim, which would *shrink* frames whose line is
   shorter than the window — truncating the late reveals in every frame. The durations
   below are the authority; the voice fits them, not the reverse.
4. Word budget assumes ~2.6 words/sec. The `**Fits:**` figure is the estimate against the
   frame's real duration; keep the estimate at or under ~85% of the window.

---

## Line 1 — The problem (Frame 1)

**Time:** 0.0 – 5.5s
**Fits:** ~13 words ≈ 5.0s of 5.5s
**Delivery:** Flat, recognisable, a little tired. This is a shared complaint, not a pitch.

    Every Saturday starts the same way. Tabs open everywhere, and still nowhere to go.

## Line 2 — The answer (Frame 2)

**Time:** 5.5 – 10.5s
**Fits:** ~10 words ≈ 3.9s of 5.0s
**Delivery:** The turn. Drop the tiredness; land it plainly, no flourish.

    FamHop does the looking for you. Your weekend, already planned.

## Line 3 — What a plan looks like (Frame 3)

**Time:** 10.5 – 16.0s
**Fits:** ~12 words ≈ 4.5s of 5.5s
**Delivery:** Concrete and specific. Let the three stops on screen do the proving.

    A real day, start to finish. Three stops, a few blocks apart.

## Line 4 — Tune it (Frame 4)

**Time:** 16.0 – 21.0s
**Fits:** ~11 words ≈ 4.2s of 5.0s
**Delivery:** Answer the objection before the viewer finishes forming it.

    Wrong day for your kid? Change it, and the plan rebuilds.

## Line 5 — Everything near you (Frame 5)

**Time:** 21.0 – 26.0s
**Fits:** ~11 words ≈ 4.2s of 5.0s
**Delivery:** Calm confidence. The figure is on screen; don't compete with it.

    Every park, museum and library near you, already on the map.

## Line 6 — Coverage (Frame 6)

**Time:** 26.0 – 31.0s
**Fits:** ~9 words ≈ 3.6s of 5.0s
**Delivery:** Matter-of-fact. "Refreshed every week" is the load-bearing half.

    Sixteen metros. And the events are refreshed every week.

## Line 7 — Every Friday (Frame 7)

**Time:** 31.0 – 35.5s
**Fits:** ~8 words ≈ 3.2s of 4.5s
**Delivery:** Softest line in the piece. This frame is the breather — let it breathe.

    Or let us send five ideas, every Friday.

## Line 8 — Go (Frame 8)

**Time:** 35.5 – 40.5s
**Fits:** ~6 words ≈ 2.8s of 5.0s
**Delivery:** Warm, final, unhurried. Small pause before the domain.

    Get your Saturday back. famhop.com
