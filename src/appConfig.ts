// Per-app configuration driven by build-time env vars. The kids app and the
// adults sibling app share this codebase and the data feed, but each builds
// with its own VITE_APP_* values to surface a distinct brand and filter the
// dataset to its audience.
//
// Set in the deploying environment (Cloudflare Pages env vars or the
// VITE_APP_* values in package scripts). Defaults match the kids app.

import type { Audience } from "./App";
import type { PlannerVibe } from "./planner";

export const APP_AUDIENCE: Audience =
  ((import.meta.env.VITE_APP_AUDIENCE as Audience) || "kids");

// Per-audience vibe label and blurb overrides. The vibe enum itself stays
// the same across apps so the planner scoring code is untouched — but the
// user-facing copy adapts to the audience. "culture" → "Museums, libraries"
// for kids vs "Music & nightlife" for adults, etc.
const KIDS_VIBE_LABELS: Record<PlannerVibe, string> = {
  balanced: "Balanced",
  "low-effort": "Low-effort day",
  active: "Active day",
  "food-first": "Food day",
  culture: "Museum / library day",
};
const ADULTS_VIBE_LABELS: Record<PlannerVibe, string> = {
  balanced: "Balanced night",
  "low-effort": "Chill night",
  active: "Active night",
  "food-first": "Food crawl",
  culture: "Music & culture",
};
const KIDS_VIBE_BLURBS: Record<PlannerVibe, string> = {
  balanced: "A bit of everything",
  "low-effort": "Walk-in, easy outings",
  active: "Run them around",
  "food-first": "Family-friendly bites",
  culture: "Museums, libraries, story-time",
};
const ADULTS_VIBE_BLURBS: Record<PlannerVibe, string> = {
  balanced: "A bit of everything",
  "low-effort": "Cocktail bars, low key",
  active: "Bowling, axe, escape rooms",
  "food-first": "Restaurants & breweries",
  culture: "Live music, comedy, art walks",
};

export const APP_VIBE_LABELS: Record<PlannerVibe, string> =
  APP_AUDIENCE === "adults" ? ADULTS_VIBE_LABELS : KIDS_VIBE_LABELS;
export const APP_VIBE_BLURBS: Record<PlannerVibe, string> =
  APP_AUDIENCE === "adults" ? ADULTS_VIBE_BLURBS : KIDS_VIBE_BLURBS;

export const APP_BRAND: string = import.meta.env.VITE_APP_BRAND || "FamHop";
export const APP_TAGLINE: string =
  import.meta.env.VITE_APP_TAGLINE || "Plan · Hop · Repeat.";
export const APP_GROUP_LABEL: string =
  import.meta.env.VITE_APP_GROUP_LABEL || "the family";
export const APP_PLAN_NOUN: string =
  import.meta.env.VITE_APP_PLAN_NOUN || "family plan";

export function audienceVisible(
  item: { audiences?: Audience[] } | null | undefined,
): boolean {
  if (!item) return false;
  const tags = Array.isArray(item.audiences) ? item.audiences : null;
  if (!tags || tags.length === 0) return true; // legacy / un-tagged data is allowed
  return tags.includes(APP_AUDIENCE) || tags.includes("all");
}

export const SHOW_AGE_BAND_UI = APP_AUDIENCE === "kids";
