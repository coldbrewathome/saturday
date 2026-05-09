// Per-app configuration driven by build-time env vars. The kids app and the
// adults sibling app share this codebase and the data feed, but each builds
// with its own VITE_APP_* values to surface a distinct brand and filter the
// dataset to its audience.
//
// Set in the deploying environment (Cloudflare Pages env vars or the
// VITE_APP_* values in package scripts). Defaults match the kids app.

import type { Audience } from "./App";

export const APP_AUDIENCE: Audience =
  ((import.meta.env.VITE_APP_AUDIENCE as Audience) || "kids");

export const APP_BRAND: string = import.meta.env.VITE_APP_BRAND || "FamHop";
export const APP_TAGLINE: string =
  import.meta.env.VITE_APP_TAGLINE || "Plan · Hop · Repeat.";
export const APP_HERO_TITLE: string =
  import.meta.env.VITE_APP_HERO_TITLE || "Plan the weekend — together.";
export const APP_HERO_SUB: string =
  import.meta.env.VITE_APP_HERO_SUB ||
  "Pick the kids' age, interests, constraints, then a vibe. Get 3 family stops. Share with co-parents to vote.";
export const APP_PARTNERS_LABEL: string =
  import.meta.env.VITE_APP_PARTNERS_LABEL || "co-parents";
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
