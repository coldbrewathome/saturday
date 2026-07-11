// Single source of truth for the video: scene order, narration, and the
// minimum on-screen duration for each scene. The build pipeline stretches a
// scene to fit its generated voiceover clip when the VO runs longer than the
// minimum. Order + count MUST match the .scene sections in youtube-intro.html.
export const SCENES = [
  { id: "welcome", min: 3000, vo: "Hey there, and welcome! So glad you stopped by." },
  { id: "hook",    min: 3800, vo: "Ever wonder what to do with the kids this weekend? You're in the right place." },
  { id: "meet",    min: 3200, vo: "We built FamHop for exactly that — weekend plans, sorted." },
  { id: "guide",   min: 5400, vo: "FamHop puts your whole weekend in one place: parks, libraries, museums, and real family events near you." },
  { id: "hopnow",  min: 4400, vo: "Need something to do right now? Just tap Hop Now for instant picks nearby." },
  { id: "plans",   min: 5400, vo: "Start from a ready-made plan, or build your own, and we'll map it into a route for the day." },
  { id: "filters", min: 4400, vo: "Filter by your kids' ages, interests, and distance, so every stop actually fits." },
  { id: "share",   min: 4200, vo: "Share the plan, let everyone vote, and you're all set." },
  { id: "metros",  min: 6000, vo: "And FamHop is free to use across sixteen cities, from coast to coast." },
  { id: "outro",   min: 5000, vo: "So come find your weekend, at FamHop dot com." },
];

// Timing pads (seconds): silence before a clip starts inside its scene, and
// breathing room added after the clip when sizing the scene.
export const LEAD = 0.35;
export const TAIL = 0.6;
