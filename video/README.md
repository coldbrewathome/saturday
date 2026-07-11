# FamHop — YouTube intro video

**Deliverable:** `famhop-intro-youtube-final.mp4` — 1920×1080, H.264 + AAC, ~52.8s.
Video + ElevenLabs voiceover + background music (music auto-ducked under the voice).

Other outputs:
- `famhop-intro-youtube.mp4` — silent master (visuals only).
- `voiceover.wav` — full narration track, time-aligned to the scenes.
- `vo/scene-NN-*.mp3` — per-scene VO clips (cached; delete to regenerate that line).

## Pipeline (re-render end to end)
```bash
node video/build-vo.mjs     # 1) ElevenLabs VO per scene → durations.json + voiceover.wav
node video/record.mjs       # 2) render silent video at those durations → famhop-intro-youtube.mp4
# 3) mux video + music + VO with ducking:
node -e "0"                 # (see the ffmpeg block below)
```
Final mux (music ducks under the voice via sidechaincompress, then loudness-normalized):
```bash
T=52.833; FO=$(echo "$T-2"|bc)
ffmpeg -y -i famhop-intro-youtube.mp4 -i music.mp3 -i voiceover.wav -filter_complex "\
[2:a]volume=1.5,asplit=2[v1][v2];\
[1:a]volume=0.5,afade=t=in:st=0:d=1.2,afade=t=out:st=${FO}:d=2[m];\
[m][v1]sidechaincompress=threshold=0.04:ratio=8:attack=80:release=400[mc];\
[mc][v2]amix=inputs=2:duration=first:normalize=0[mix];\
[mix]loudnorm=I=-15:TP=-1.5:LRA=11[ao]" \
-map 0:v -map "[ao]" -t $T -c:v copy -c:a aac -b:a 192k -movflags +faststart \
famhop-intro-youtube-final.mp4
```

## Source files
- `youtube-intro.html` — the animated source (1080p, FamHop kids theme). Scene durations
  come from `window.__durs` (injected by the recorder) so visuals match narration.
- `scenes.mjs` — **single source of truth**: scene order, narration text, min durations.
  Edit a `vo:` line here, delete that clip in `vo/`, then re-run the pipeline.
- `record.mjs` — Playwright render; trims the page-load lead-in via ffmpeg freezedetect.
- `build-vo.mjs` — ElevenLabs TTS (uses `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID`).
- `music.mp3` — "Happy Upbeat Ukulele" (Pixabay, ID 142304; free, no attribution).

This folder is **not** under `public/`, so it does not deploy. The on-site looping
version (no audio) lives at `public/intro.html` (famhop.com/intro).

## Narration script (final)
1. Welcome — "Hey there, and welcome! So glad you stopped by."
2. Hook — "Ever wonder what to do with the kids this weekend? You're in the right place."
3. Meet FamHop — "We built FamHop for exactly that — weekend plans, sorted."
4. Weekend guide — "FamHop puts your whole weekend in one place: parks, libraries, museums, and real family events near you."
5. Hop Now — "Need something to do right now? Just tap Hop Now for instant picks nearby."
6. Plans + map — "Start from a ready-made plan, or build your own, and we'll map it into a route for the day."
7. Filters — "Filter by your kids' ages, interests, and distance, so every stop actually fits."
8. Share & vote — "Share the plan, let everyone vote, and you're all set."
9. Metros — "And FamHop is free to use across sixteen cities, from coast to coast." (4×4 skyline grid of all 16 metros)
10. Outro — "So come find your weekend, at FamHop dot com."

## Audio balance
Voice ≈ −17.6 dB mean; music ducks to ~−25 dB under the voice and returns to ~−22 dB
between lines (~3 dB duck). For a stronger duck, raise `sidechaincompress` ratio or lower
the music `volume`.

## YouTube metadata
- **Title:** FamHop — Plan Your Weekend With the Kids in 30 Seconds
- **Description:** Stop guessing what to do this weekend. FamHop finds parks, libraries, museums, and real family events near you — then maps them into a ready-made plan you can share and vote on. Free across 16 U.S. metros. Try it at https://famhop.com
- **Tags:** family activities, things to do with kids, weekend plans, family events near me, FamHop
