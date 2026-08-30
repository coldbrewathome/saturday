// Weekend-brief selection logic for the decision-first home (WeekendView).
// The entrance's job is to answer "what are we doing Saturday?" in one glance:
// a single headliner (the one event to plan around), a short ranked best-of,
// and a weather one-liner that makes the weekend concrete. All pure functions
// so the ranking and the copy are unit-testable without rendering.
//
// Ranking philosophy: editorial signals (popular picks, editor's picks) beat
// personalization (family profile, trust, proximity) — "the best of this
// weekend" is a curation statement first, with the family-fit score as the
// tie-breaker inside each tier. Boosts are sized to dominate the family-score
// range (~0–55) so a rank-1 pick always leads, while family fit still decides
// between otherwise-equal events.

import type { FamilyEvent } from "./App";
import type { FamilyProfile } from "./familyProfile";
import { scoreEventForFamily } from "./familyProfile";
import type { EventTrust } from "./checkinApi";
import { trustBoost } from "./checkinApi";
import type { WeatherForecast } from "./api";

export type BriefEntry = {
  event: FamilyEvent;
  /** 1-based rank among the weekend's popular picks, or null. */
  popularRank: number | null;
  /** Referenced by a curated featured plan ("Editor's pick"). */
  editorPicked: boolean;
  /** familyScore + trust, before editorial boosts (for tests/debug). */
  familyScore: number;
  /** Whether the card can show a real photo (event or venue image). */
  hasPhoto: boolean;
};

export type RankWeekendOptions = {
  /** Weekend-scoped, age-scoped, junk-filtered events. */
  events: FamilyEvent[];
  /** Resolved popular picks (already matched to `events`). */
  popularEvents: FamilyEvent[];
  editorEventIds: ReadonlySet<string>;
  profile: FamilyProfile | null;
  home: { lat: number; lon: number } | null;
  trust?: ReadonlyMap<string, EventTrust>;
  /** Venue → photo index; used only to decide photo tie-breaks. */
  hasPhotoFor?: (event: FamilyEvent) => boolean;
  /** Notability score (e.g. newEvents.importanceScore); boosts marquee
   * one-offs above routine library programming inside a tier. */
  notabilityFor?: (event: FamilyEvent) => number;
};

const POPULAR_LEAD_BOOST = 100;
const POPULAR_STEP = 8;
const EDITOR_BOOST = 40;
const NOTABILITY_WEIGHT = 6;

export function rankWeekendEvents(options: RankWeekendOptions): BriefEntry[] {
  const {
    events,
    popularEvents,
    editorEventIds,
    profile,
    home,
    trust,
    hasPhotoFor,
    notabilityFor,
  } = options;
  const popularRankById = new Map<string, number>();
  popularEvents.forEach((event, index) => {
    // resolvePopularEvents returns picks in rank order; index+1 is the rank.
    popularRankById.set(event.id, index + 1);
  });
  return events
    .map((event) => {
      const popularRank = popularRankById.get(event.id) ?? null;
      const editorPicked = editorEventIds.has(event.id);
      const familyScore =
        scoreEventForFamily(event, { profile: profile ?? null, home }) +
        trustBoost(trust?.get(event.id)?.trustScore ?? null);
      let score = familyScore;
      if (popularRank != null) {
        score += POPULAR_LEAD_BOOST - (popularRank - 1) * POPULAR_STEP;
      }
      if (editorPicked) score += EDITOR_BOOST;
      if (notabilityFor) score += notabilityFor(event) * NOTABILITY_WEIGHT;
      return {
        event,
        popularRank,
        editorPicked,
        familyScore,
        hasPhoto: hasPhotoFor ? hasPhotoFor(event) : false,
        // Stable tie-break: editorial score first, then photo, then family
        // fit, then (as a last resort) event id so tests are deterministic.
        _tie: score,
      };
    })
    .sort((a, b) => {
      if (b._tie !== a._tie) return b._tie - a._tie;
      if (b.hasPhoto !== a.hasPhoto) return b.hasPhoto ? 1 : -1;
      if (b.familyScore !== a.familyScore) return b.familyScore - a.familyScore;
      return a.event.id < b.event.id ? -1 : 1;
    })
    .map(({ _tie, ...entry }) => entry);
}

export const BEST_OF_CAP = 6;

export function buildBestOf(
  entries: BriefEntry[],
  cap: number = BEST_OF_CAP,
): BriefEntry[] {
  return entries.slice(0, cap);
}

export function pickHeadliner(entries: BriefEntry[]): BriefEntry | null {
  return entries.length > 0 ? entries[0] : null;
}

// ── Weather brief ────────────────────────────────────────────────────────

export type WeatherIconKind =
  | "sun"
  | "cloud-sun"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

// WMO weather interpretation codes (open-meteo), grouped into the icon set
// the UI ships. Unknown codes fall back to "cloud" — never crash the brief.
export function weatherIconKind(code: number): WeatherIconKind {
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "cloud-sun";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) {
    return "drizzle";
  }
  if (
    (code >= 61 && code <= 67) ||
    code === 80 ||
    code === 81 ||
    code === 82
  ) {
    return "rain";
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 95 || code === 96 || code === 99) return "storm";
  return "cloud";
}

export type BriefDay = {
  label: string;
  tempF: number | null;
  precipChance: number | null;
  icon: WeatherIconKind;
};

export type WeatherBrief = {
  saturday: BriefDay | null;
  sunday: BriefDay | null;
  /** One-line planning hint, or null when there's nothing useful to say. */
  hint: string | null;
};

const DRY_THRESHOLD = 40; // precip chance % below which a day counts dry

function toBriefDay(
  day: WeatherForecast["saturday"],
): BriefDay | null {
  if (!day) return null;
  return {
    label: day.label,
    tempF: Number.isFinite(day.tempMaxF) ? day.tempMaxF : null,
    precipChance: Number.isFinite(day.precipChance) ? day.precipChance : null,
    icon: weatherIconKind(day.weatherCode),
  };
}

export function weatherBrief(
  forecast: WeatherForecast | null | undefined,
): WeatherBrief | null {
  if (!forecast) return null;
  const saturday = toBriefDay(forecast.saturday);
  const sunday = toBriefDay(forecast.sunday);
  if (!saturday && !sunday) return null;
  let hint: string | null = null;
  if (saturday && sunday) {
    const satDry = (saturday.precipChance ?? 0) < DRY_THRESHOLD;
    const sunDry = (sunday.precipChance ?? 0) < DRY_THRESHOLD;
    if (satDry && sunDry) {
      hint = "Clear skies both days — the outdoor picks are safe.";
    } else if (satDry && !sunDry) {
      hint = "Saturday's the dry day — take the outdoor picks then.";
    } else if (!satDry && sunDry) {
      hint = "Sunday looks clearer — the outdoor picks are on Sunday.";
    } else {
      hint =
        "Rain both days — the indoor picks (libraries, museums) are below.";
    }
  }
  return { saturday, sunday, hint };
}
