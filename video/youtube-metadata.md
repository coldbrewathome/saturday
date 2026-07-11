# FamHop intro — YouTube upload sheet

Copy-paste fields for uploading `famhop-intro-youtube-final.mp4` (1920×1080, 52.8s).
After publishing, put the 11-char video ID into `public/intro.html` (replace
`REPLACE_WITH_VIDEO_ID`) so the on-site "Watch with sound" embed and the
`VideoObject` schema go live.

## Title
```
FamHop — Plan Your Weekend With the Kids in 30 Seconds
```

Alternates:
- `FamHop — Find Your Weekend With the Kids (Free in 16 Cities)`
- `Stop Guessing What to Do This Weekend — Meet FamHop`

## Description
```
Stop guessing what to do this weekend. FamHop finds parks, libraries, museums, and real family events near you — then maps them into a ready-made plan you can share and vote on. Free across 16 U.S. metros.

▶ Try it free: https://famhop.com

What FamHop does:
• Your whole weekend (Fri–Sun) in one place — parks, libraries, museums, real family events
• Hop Now — instant picks for something to do right now
• Start from a ready-made plan or build your own; we map it into a route for the day
• Filter by your kids' ages, interests, and distance so every stop fits
• Share the plan and let everyone vote

Free across 16 U.S. metros: Atlanta, Austin, Bay Area, Boston, Chicago, Dallas–Fort Worth, Honolulu, Houston, Los Angeles, Miami, New York City, Philadelphia, Phoenix, San Diego, Seattle, and Washington, D.C.

#familyactivities #thingstodowithkids #weekendplans
```

## Tags
```
family activities, things to do with kids, weekend plans, family events near me, kids activities, weekend with kids, family outings, FamHop, parenting, family travel
```

## Settings
- **Category:** Howto & Style (or People & Blogs)
- **Audience:** "No, not made for kids" (the audience is parents, not children)
- **Visibility:** Public
- **Language / captions:** English. Upload captions — the narration script is the
  caption text (see `video/scenes.mjs` `vo:` lines, in scene order).
- **Playlists / Shorts:** This is the 53s landscape cut. A 15s vertical Shorts cut is
  storyboarded in `docs/famhop-intro-video-script.md` if you want one later.

## Thumbnail
Use the closing FamHop logo lockup frame (coral) or `public/og-image.png`. Add large
text: "Plan your weekend — free."

## Automated upload
`node video/upload-youtube.mjs` uploads the MP4 with the fields above via the
YouTube Data API (one-time OAuth setup documented at the top of that script).
Defaults to **private**; pass `--privacy public` when ready. The title/description/
tags in the script are kept in sync with this file.

## Post-publish checklist
1. Copy the video ID from the watch URL (`youtube.com/watch?v=XXXXXXXXXXX`).
2. In `public/intro.html`, replace both `REPLACE_WITH_VIDEO_ID` occurrences.
3. `npm run deploy:kids` to ship the on-site embed + VideoObject schema.
4. Validate the rich result: https://search.google.com/test/rich-results?url=https://famhop.com/intro.html
