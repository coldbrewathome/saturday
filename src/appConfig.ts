// Per-app configuration driven by build-time env vars. The kids app and the
// adults sibling app share this codebase and the data feed, but each builds
// with its own VITE_APP_* values to surface a distinct brand and filter the
// dataset to its audience.
//
// Set in the deploying environment (Cloudflare Pages env vars or the
// VITE_APP_* values in package scripts). Defaults match the kids app.

import type { Audience } from "./App";
import type { PlannerVibe } from "./planner";

// `import.meta.env` is injected by Vite at build time. When this module is
// bundled into a non-Vite context (e.g. a Cloudflare Pages Function reusing the
// shared planner/metros logic), `import.meta.env` is undefined — guard so the
// module still loads and falls back to the kids/FamHop defaults.
const ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ??
  {};

export const APP_AUDIENCE: Audience =
  ((ENV.VITE_APP_AUDIENCE as Audience) || "kids");

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
  balanced: "Balanced",
  "low-effort": "Chill",
  active: "Active",
  "food-first": "Food & drink",
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
  "low-effort": "Cafes, bars, low-key spots",
  active: "Bowling, climbing, escape rooms",
  "food-first": "Restaurants, cafes & breweries",
  culture: "Live music, comedy, art",
};

export const APP_VIBE_LABELS: Record<PlannerVibe, string> =
  APP_AUDIENCE === "adults" ? ADULTS_VIBE_LABELS : KIDS_VIBE_LABELS;
export const APP_VIBE_BLURBS: Record<PlannerVibe, string> =
  APP_AUDIENCE === "adults" ? ADULTS_VIBE_BLURBS : KIDS_VIBE_BLURBS;

export const APP_BRAND: string = ENV.VITE_APP_BRAND || "FamHop";
export const APP_TAGLINE: string =
  ENV.VITE_APP_TAGLINE || "Plan · Hop · Repeat.";
export const APP_GROUP_LABEL: string =
  ENV.VITE_APP_GROUP_LABEL || "the family";
export const APP_PLAN_NOUN: string =
  ENV.VITE_APP_PLAN_NOUN || "family plan";

// Pure per-audience derivations (exported for tests — the build-time
// APP_AUDIENCE constant can't be stubbed per test file).
export function domainForAudience(audience: Audience): string {
  return audience === "adults" ? "trymosey.com" : "famhop.com";
}

export function pollCtaForAudience(audience: Audience): string {
  return audience === "adults"
    ? 'Pick a vibe, get a 3-stop hangout in seconds, then share a vote link of your own — no endless "where should we go" group-chat debate.'
    : 'Pick a vibe, get a 3-stop family Saturday in seconds, then share a vote link of your own — no 11am "what are we doing today" debate.';
}

// Browse-hero headline. Day-aware (Thu–Sun sells the imminent weekend,
// Mon–Wed sells planning ahead) and audience-toned. dayOfWeek follows
// Date#getDay (0 = Sunday).
export function heroTitleForAudience(
  audience: Audience,
  dayOfWeek: number,
): string {
  const nearWeekend = dayOfWeek === 0 || dayOfWeek >= 4;
  if (audience === "adults") {
    return nearWeekend
      ? "This weekend's hangout, ready to go"
      : "Get a head start on the weekend hang";
  }
  return nearWeekend
    ? "This weekend's plan, ready to go"
    : "Get a head start on the weekend";
}

// One-line Friday-digest ask (browse hero one-liner, poll-page signup,
// visit-3 digest prompt).
export function digestCtaForAudience(audience: Audience): string {
  return audience === "adults"
    ? "Get 5 things to do every Friday"
    : "Get 5 family things to do every Friday";
}

export const APP_DIGEST_CTA: string = digestCtaForAudience(APP_AUDIENCE);

// Public domain for user-facing copy (geo-permission help, share cards).
export const APP_DOMAIN: string = domainForAudience(APP_AUDIENCE);

// Poll-page CTA body — a viral surface seen by invitees who may have never
// opened the app, so the framing must match the brand's audience.
export const APP_POLL_CTA: string = pollCtaForAudience(APP_AUDIENCE);

export function audienceVisible(
  item: { audiences?: Audience[] } | null | undefined,
): boolean {
  if (!item) return false;
  const tags = Array.isArray(item.audiences) ? item.audiences : null;
  if (!tags || tags.length === 0) return true; // legacy / un-tagged data is allowed
  return tags.includes(APP_AUDIENCE) || tags.includes("all");
}

export const SHOW_AGE_BAND_UI = APP_AUDIENCE === "kids";
