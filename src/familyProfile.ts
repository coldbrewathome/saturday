// Family profile — the personalization inputs for the "habit loop" redesign.
// Collected once at first-run onboarding (OnboardingWizard) and reused by the
// feed ranker, the weekend view, check-in prompts, and the newsletter. Stored
// in localStorage and cloud-synced through SyncedState (api.ts) when signed in.

import type { AgeBand, PlannerBudgetLevel, PlannerSettingPreference } from "./planner";
import { isValidThemeId } from "./eventThemes";
import type { FamilyEvent } from "./App";
import { haversineMiles as distanceMiles } from "./appUtils";

export type FamilyProfile = {
  /** Multi-select, unlike the single ageBand filter chip. */
  ageBands: AgeBand[];
  /** Used for future proximity ranking; ranking falls back to device/IP
   * location until a ZIP geocoder exists. */
  zipCode: string;
  /** Interest theme ids (EVENT_THEMES). */
  interests: string[];
  budget: PlannerBudgetLevel;
  setting: PlannerSettingPreference;
};

export const PROFILE_STORAGE_KEY = "famhop:profile";

const AGE_BANDS: readonly AgeBand[] = ["toddler", "preschool", "school-age", "tween"];
const BUDGETS: readonly PlannerBudgetLevel[] = ["any", "free", "under-25"];
const SETTINGS: readonly PlannerSettingPreference[] = ["any", "indoor", "outdoor"];

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

export function isValidFamilyProfile(value: unknown): value is FamilyProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (!Array.isArray(p.ageBands)) return false;
  if (p.ageBands.some((b) => !oneOf(b, AGE_BANDS))) return false;
  if (typeof p.zipCode !== "string") return false;
  if (!Array.isArray(p.interests)) return false;
  if (p.interests.some((t) => !isValidThemeId(String(t)))) return false;
  if (!oneOf(p.budget, BUDGETS)) return false;
  if (!oneOf(p.setting, SETTINGS)) return false;
  return true;
}

export function readStoredProfile(): FamilyProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidFamilyProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredProfile(profile: FamilyProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage can throw in private mode; the profile just won't persist.
  }
}

// ── Ranking ────────────────────────────────────────────────────────────────
// Companion to the newsletter's server-side scoreEvent(): same interestingness
// signals plus profile match. Used to re-rank the weekend feed and browse
// events so the top of the list is what *this* family would like, not just
// what's popular.

// Category is decisive: a Park event stays outdoor even if its title mentions
// "story", and a Museum event stays indoor even if the blurb mentions a garden.
const HARD_OUTDOOR = new Set(["Park", "Zoo", "Farm", "Festival"]);
const HARD_INDOOR = new Set(["Library", "Museum", "Culture"]);

function eventLooksIndoor(event: FamilyEvent): boolean {
  if (HARD_INDOOR.has(event.category)) return true;
  if (HARD_OUTDOOR.has(event.category)) return false;
  const text = `${event.title} ${event.description} ${event.category}`.toLowerCase();
  return /\b(indoor|inside|library|museum|story|aquarium|theater|theatre|show|movie|book|read|science|craft|art)\b/.test(
    text,
  );
}

function eventLooksOutdoor(event: FamilyEvent): boolean {
  if (HARD_OUTDOOR.has(event.category)) return true;
  if (HARD_INDOOR.has(event.category)) return false;
  const text = `${event.title} ${event.description} ${event.category}`.toLowerCase();
  return /\b(outdoor|outside|park|garden|trail|beach|playground|picnic|farm|zoo|wildlife|nature|field)\b/.test(
    text,
  );
}

export function profileSettingMatches(event: FamilyEvent, setting: PlannerSettingPreference): boolean {
  if (setting === "any") return true;
  if (setting === "indoor") return eventLooksIndoor(event) && !eventLooksOutdoor(event);
  return eventLooksOutdoor(event) && !eventLooksIndoor(event);
}

export type EventRankContext = {
  profile: FamilyProfile | null;
  /** Device/IP-derived home coordinates for proximity ranking (best effort). */
  home?: { lat: number; lon: number } | null;
};

// Higher = better fit for this family. Returns a delta to add to whatever the
// caller's baseline ordering is; the caller owns the sort.
export function scoreEventForFamily(
  event: FamilyEvent,
  context: EventRankContext,
): number {
  const profile = context.profile;
  if (!profile) return 0;

  let score = 0;

  // Age fit: explicit match is a strong boost; unknown-age events stay neutral
  // rather than being excluded (the feed must never look empty).
  if (profile.ageBands.length > 0) {
    if (event.ageBands.some((b) => profile.ageBands.includes(b))) score += 20;
    else if (event.ageBands.length === 0) score += 8;
  }

  // Interest fit: +5 per overlapping theme.
  if (profile.interests.length > 0) {
    const overlap = (event.themes ?? []).filter((t) =>
      profile.interests.includes(t),
    ).length;
    score += overlap * 5;
  }

  // Budget fit: free/under-25 profiles boost cheap events, discount ticketed.
  if (profile.budget !== "any") {
    const cheap = event.cost === "Free" || event.cost === "$";
    if (cheap) score += 10;
    else if (event.cost !== "Unknown") score -= 8;
  }

  // Setting fit.
  if (profile.setting !== "any" && profileSettingMatches(event, profile.setting)) {
    score += 10;
  }

  // Proximity: up to +10 for a home within ~10 miles.
  if (context.home) {
    const miles = distanceMiles(context.home, { lat: event.lat, lon: event.lon });
    if (miles <= 10) score += 10;
    else if (miles <= 20) score += 6;
    else if (miles <= 35) score += 2;
  }

  return score;
}

export function rankEventsForFamily<T extends FamilyEvent>(
  events: T[],
  context: EventRankContext,
): T[] {
  if (!context.profile) return events;
  return [...events].sort(
    (a, b) => scoreEventForFamily(b, context) - scoreEventForFamily(a, context),
  );
}
