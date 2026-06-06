import { APP_AUDIENCE } from "./appConfig";

export type PlannerVibe =
  | "balanced"
  | "low-effort"
  | "active"
  | "food-first"
  | "culture";

export type AgeBand = "toddler" | "preschool" | "school-age" | "tween";

export type PlannerPreferenceId =
  | "parks-nature"
  | "libraries-museums"
  | "loves-animals"
  | "stroller-friendly"
  | "no-crowds"
  | "indoor-when-rainy"
  | "near-only"
  | "free-only";

export type PlannerWeatherTone = "wet" | "dry" | "mixed";

const plannerTransportModes = ["any", "drive", "transit", "walk-stroller"] as const;
const plannerBudgetLevels = ["any", "free", "under-25"] as const;
const plannerPlanLengths = ["quick", "half-day", "full-day"] as const;
const plannerCrowdTolerances = ["balanced", "quiet", "busy-ok"] as const;
const plannerSettingPreferences = ["any", "indoor", "outdoor"] as const;

export type PlannerTransportMode = (typeof plannerTransportModes)[number];
export type PlannerBudgetLevel = (typeof plannerBudgetLevels)[number];
export type PlannerPlanLength = (typeof plannerPlanLengths)[number];
export type PlannerCrowdTolerance = (typeof plannerCrowdTolerances)[number];
export type PlannerSettingPreference = (typeof plannerSettingPreferences)[number];

export type PlannerProfile = {
  transportMode: PlannerTransportMode;
  budget: PlannerBudgetLevel;
  planLength: PlannerPlanLength;
  crowdTolerance: PlannerCrowdTolerance;
  setting: PlannerSettingPreference;
};

export type PlannerScoringOptions = {
  ageBand?: AgeBand;
  preferences?: PlannerPreferenceId[];
  weather?: PlannerWeatherTone;
  profile?: Partial<PlannerProfile> | null;
  // Defaults to the build-time APP_AUDIENCE. Server-side callers (the public
  // /api reusing this scorer) pass it explicitly so one bundle can score for
  // either app.
  audience?: "kids" | "adults" | "all";
};

export type PlannerSpot = {
  id: string;
  name: string;
  neighborhood: string;
  category: string;
  cost: string;
  transitMinutes: number;
  mood: string;
  groupSize: string;
  planning: string;
  openNow: boolean;
  website?: string | null;
  sourceUrl?: string;
  openingHours?: string | null;
  friendScore?: number;
  kidsFriendly?: boolean | null;
  dataSource?: string;
  tags?: string[];
  note?: string;
  timeWindow?: string;
  wheelchair?: "yes" | "limited" | "no" | null;
  dogsAllowed?: boolean | null;
  parkingNearby?: boolean | null;
  googleRating?: number;
  googleRatingCount?: number;
};

export type PlannerBrief = {
  title: string;
  summary: string;
  primary?: PlannerSpot;
  backup?: PlannerSpot;
  rationale: string[];
  cautions: string[];
};

export const vibeLabels: Record<PlannerVibe, string> = {
  balanced: "Balanced",
  "low-effort": "Low-effort day",
  active: "Active day",
  "food-first": "Food day",
  culture: "Museum / library day",
};

export const ageBandLabels: Record<AgeBand, string> = {
  toddler: "Toddler (1-3)",
  preschool: "Preschool (3-5)",
  "school-age": "School age (6-10)",
  tween: "Tween (10-13)",
};

export const plannerPreferenceOptions: Array<{
  id: PlannerPreferenceId;
  label: string;
  hint: string;
}> = [
  {
    id: "parks-nature",
    label: "Parks + nature",
    hint: "Bias toward parks, gardens, trails, and outside play",
  },
  {
    id: "libraries-museums",
    label: "Libraries + museums",
    hint: "Prefer story times, museums, and other culture stops",
  },
  {
    id: "loves-animals",
    label: "Animals",
    hint: "Bias toward zoos, farms, wildlife, and nature centers",
  },
  {
    id: "stroller-friendly",
    label: "Stroller-friendly",
    hint: "Prefer smooth, flexible, low-friction outings",
  },
  {
    id: "no-crowds",
    label: "Low crowds",
    hint: "Prefer quieter spaces over busy weekend magnets",
  },
  {
    id: "indoor-when-rainy",
    label: "Indoor if rainy",
    hint: "Prefer indoor ideas when the forecast is wet",
  },
  {
    id: "near-only",
    label: "Within 30 min",
    hint: "Filter planner candidates to short-travel outings",
  },
  {
    id: "free-only",
    label: "Free / cheap",
    hint: "Filter planner candidates to free or low-cost outings",
  },
];

export const defaultPlannerProfile: PlannerProfile = {
  transportMode: "any",
  budget: "any",
  planLength: "half-day",
  crowdTolerance: "balanced",
  setting: "any",
};

export const plannerTransportOptions: Array<{
  id: PlannerTransportMode;
  label: string;
  hint: string;
}> = [
  {
    id: "any",
    label: "Any",
    hint: "Use the best nearby cluster without a transport bias",
  },
  {
    id: "drive",
    label: "Drive",
    hint: "Prefer easier parking and shorter car-style hops",
  },
  {
    id: "transit",
    label: "Transit",
    hint: "Prefer compact plans and places with transit cues",
  },
  {
    id: "walk-stroller",
    label: "Walk / stroller",
    hint: "Prefer short, accessible, low-friction stops",
  },
];

export const plannerBudgetOptions: Array<{
  id: PlannerBudgetLevel;
  label: string;
  hint: string;
}> = [
  { id: "any", label: "Any", hint: "Do not filter by cost" },
  { id: "free", label: "Free", hint: "Only free or very low-cost ideas" },
  { id: "under-25", label: "Under $25", hint: "Prefer low-cost family plans" },
];

export const plannerPlanLengthOptions: Array<{
  id: PlannerPlanLength;
  label: string;
  hint: string;
}> = [
  { id: "quick", label: "Quick", hint: "Short travel and easy exits" },
  { id: "half-day", label: "Half day", hint: "A balanced 2-3 stop outing" },
  { id: "full-day", label: "Bigger day", hint: "Allow stronger destinations" },
];

export const plannerCrowdOptions: Array<{
  id: PlannerCrowdTolerance;
  label: string;
  hint: string;
}> = [
  { id: "balanced", label: "Balanced", hint: "No special crowd preference" },
  { id: "quiet", label: "Quiet", hint: "Prefer calmer places and easy exits" },
  { id: "busy-ok", label: "Busy ok", hint: "Events and weekend magnets are fine" },
];

export const plannerSettingOptions: Array<{
  id: PlannerSettingPreference;
  label: string;
  hint: string;
}> = [
  { id: "any", label: "Any", hint: "Indoor or outdoor can work" },
  { id: "indoor", label: "Indoor", hint: "Prefer weather-protected stops" },
  { id: "outdoor", label: "Outdoor", hint: "Prefer parks, gardens, trails, and play" },
];

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

export function normalizePlannerProfile(
  input?: Partial<PlannerProfile> | null,
): PlannerProfile {
  const transportMode = input?.transportMode;
  const budget = input?.budget;
  const planLength = input?.planLength;
  const crowdTolerance = input?.crowdTolerance;
  const setting = input?.setting;
  return {
    transportMode: oneOf(transportMode, plannerTransportModes)
      ? transportMode
      : defaultPlannerProfile.transportMode,
    budget: oneOf(budget, plannerBudgetLevels)
      ? budget
      : defaultPlannerProfile.budget,
    planLength: oneOf(planLength, plannerPlanLengths)
      ? planLength
      : defaultPlannerProfile.planLength,
    crowdTolerance: oneOf(crowdTolerance, plannerCrowdTolerances)
      ? crowdTolerance
      : defaultPlannerProfile.crowdTolerance,
    setting: oneOf(setting, plannerSettingPreferences)
      ? setting
      : defaultPlannerProfile.setting,
  };
}

function normalizeScoringOptions(
  input?: AgeBand | PlannerScoringOptions,
): PlannerScoringOptions {
  if (!input) return { audience: APP_AUDIENCE };
  if (typeof input === "string") {
    return { ageBand: input, audience: APP_AUDIENCE };
  }
  return { ...input, audience: input.audience ?? APP_AUDIENCE };
}

function textForSpot(spot: PlannerSpot): string {
  return [
    spot.name,
    spot.neighborhood,
    spot.category,
    spot.mood,
    spot.groupSize,
    spot.planning,
    spot.openingHours ?? "",
    spot.note ?? "",
    spot.timeWindow ?? "",
    ...(spot.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function hasPreference(
  preferences: PlannerPreferenceId[] | undefined,
  id: PlannerPreferenceId,
) {
  return preferences?.includes(id) ?? false;
}

function isLowCost(cost: string) {
  return cost === "Free" || cost === "$";
}

function spotLooksIndoor(spot: PlannerSpot, text: string) {
  return (
    spot.category === "Culture" ||
    spot.category === "Food" ||
    spot.category === "Wellness" ||
    spot.category === "Shopping" ||
    spot.category === "Nightlife" ||
    /\b(indoor|inside|covered|library|museum|story|cafe|restaurant|aquarium|gym|greenhouse)\b/.test(
      text,
    )
  );
}

function spotLooksOutdoor(spot: PlannerSpot, text: string) {
  return (
    spot.category === "Outdoors" ||
    /\b(outdoor|outside|park|garden|trail|beach|playground|picnic|farm|zoo|wildlife|nature)\b/.test(
      text,
    )
  );
}

function hasTransitCue(text: string) {
  return /\b(bart|caltrain|muni|ferry|bus|transit|station|downtown|walkable)\b/.test(text);
}

function hasParkingCue(spot: PlannerSpot, text: string) {
  return spot.parkingNearby === true || /\b(parking|lot|garage)\b/.test(text);
}

export function spotPassesPlannerPreferences(
  spot: PlannerSpot,
  input?: PlannerScoringOptions,
): boolean {
  const options = normalizeScoringOptions(input);
  const preferences = options.preferences ?? [];
  const profile = normalizePlannerProfile(options.profile);
  const text = textForSpot(spot);

  if (
    hasPreference(preferences, "free-only") &&
    !isLowCost(spot.cost)
  ) {
    return false;
  }

  if (profile.budget !== "any" && !isLowCost(spot.cost)) {
    return false;
  }

  if (
    hasPreference(preferences, "near-only") &&
    spot.transitMinutes > 30
  ) {
    return false;
  }

  if (profile.planLength === "quick" && spot.transitMinutes > 35) {
    return false;
  }

  if (
    hasPreference(preferences, "indoor-when-rainy") &&
    options.weather === "wet" &&
    spot.category === "Outdoors" &&
    !/\b(indoor|covered|greenhouse)\b/.test(text)
  ) {
    return false;
  }

  if (profile.setting === "indoor" && !spotLooksIndoor(spot, text)) {
    return false;
  }

  if (profile.setting === "outdoor" && !spotLooksOutdoor(spot, text)) {
    return false;
  }

  return true;
}

export function filterSpotsForPlannerPreferences<T extends PlannerSpot>(
  spots: T[],
  options?: PlannerScoringOptions,
): T[] {
  return spots.filter((spot) => spotPassesPlannerPreferences(spot, options));
}

export function scoreSpotForVibe(
  spot: PlannerSpot,
  vibe: PlannerVibe,
  input?: AgeBand | PlannerScoringOptions,
) {
  const options = normalizeScoringOptions(input);
  const ageBand = options.ageBand;
  const preferences = options.preferences ?? [];
  const profile = normalizePlannerProfile(options.profile);
  const text = textForSpot(spot);

  // Base: every spot is being evaluated as a kid/family option.
  let score = spot.friendScore ?? 60;

  if (spot.openNow) score += 5;
  if (spot.website) score += 3;
  if (spot.transitMinutes > 45) score -= 8;
  if (spot.planning.toLowerCase().includes("book")) score -= 2;

  if (options.audience === "kids") {
    if (spot.kidsFriendly === true) score += 12;
    if (spot.kidsFriendly === false) score -= 25;
    if (spot.cost === "Free") score += 4;
    if (spot.cost === "$") score += 2;
    if (
      spot.dataSource === "family-event" ||
      spot.tags?.some((tag) => tag.toLowerCase() === "event")
    ) {
      score += 8;
    }
  }

  // Google rating signal — only trust ratings with enough reviews to be stable.
  // 4.5+ is a meaningful boost, sub-3.5 actively penalizes.
  if (
    typeof spot.googleRating === "number" &&
    (spot.googleRatingCount ?? 0) >= 25
  ) {
    const r = spot.googleRating;
    if (r >= 4.7) score += 12;
    else if (r >= 4.5) score += 8;
    else if (r >= 4.2) score += 4;
    else if (r < 3.5) score -= 10;
    else if (r < 3.8) score -= 4;
  }

  // Passive retail is useful for a specific culture/tween browse, but it should
  // not fill ordinary kid plans ahead of parks, libraries, events, or active stops.
  if (spot.category === "Shopping" && vibe !== "culture") score -= 12;

  if (vibe === "low-effort") {
    score -= spot.transitMinutes * 0.65;
    if (spot.planning === "Walk-in" || spot.planning === "Flexible") score += 10;
    if (spot.category === "Nightlife") score += 12;
  }

  if (vibe === "active") {
    if (spot.category === "Outdoors") score += 22;
    if (spot.category === "Wellness") score += 14;
  }

  if (vibe === "food-first") {
    if (spot.category === "Food") score += 18;
    if (spot.cost === "$$$") score -= 6;
  }

  if (vibe === "culture") {
    if (spot.category === "Culture") score += 22;
    if (spot.category === "Nightlife") score += 20;
    if (spot.category === "Shopping") score += 4;
  }

  if (options.audience === "kids") {
    if (ageBand === "toddler") {
      if (spot.category === "Outdoors") score += 8;
      if (spot.category === "Culture") score += 4;
      if (spot.planning === "Walk-in" || spot.planning === "Flexible") score += 6;
      if (spot.transitMinutes > 30) score -= 5;
    }
    if (ageBand === "preschool") {
      if (spot.category === "Outdoors") score += 6;
      if (spot.category === "Culture") score += 6;
    }
    if (ageBand === "school-age") {
      if (spot.category === "Wellness") score += 5;
      if (spot.category === "Culture") score += 4;
      if (spot.category === "Shopping") score -= 6;
    }
    if (ageBand === "tween") {
      if (spot.category === "Wellness") score += 6;
      if (spot.category === "Food") score += 4;
      if (spot.category === "Shopping") score += 4;
    }
  }

  if (hasPreference(preferences, "parks-nature")) {
    if (spot.category === "Outdoors") score += 18;
    if (/\b(park|garden|nature|trail|beach|playground|picnic)\b/.test(text)) {
      score += 8;
    }
  }

  if (hasPreference(preferences, "libraries-museums")) {
    if (spot.category === "Culture") score += 16;
    if (/\b(library|museum|story|exhibit|art|science)\b/.test(text)) {
      score += 8;
    }
  }

  if (hasPreference(preferences, "loves-animals")) {
    if (/\b(zoo|aquarium|farm|wildlife|animal|bird|nature center)\b/.test(text)) {
      score += 24;
    } else if (spot.category === "Outdoors") {
      score += 5;
    }
  }

  if (hasPreference(preferences, "stroller-friendly")) {
    if (
      spot.wheelchair === "yes" ||
      /\b(stroller|accessible|wheelchair|paved|flat|walk-in|flexible|library|garden)\b/.test(
        text,
      )
    ) {
      score += 12;
    }
    if (spot.transitMinutes > 30) score -= 8;
    if (/\b(stairs|steep|scramble|hike)\b/.test(text)) score -= 10;
  }

  if (hasPreference(preferences, "no-crowds")) {
    if (/\b(quiet|calm|garden|trail|library|picnic|low effort)\b/.test(text)) {
      score += 10;
    }
    if (
      spot.category === "Shopping" ||
      spot.dataSource === "family-event" ||
      /\b(festival|ticketed|market|mall|crowd)\b/.test(text)
    ) {
      score -= 8;
    }
  }

  if (hasPreference(preferences, "indoor-when-rainy")) {
    if (options.weather === "wet") {
      if (
        spot.category === "Culture" ||
        spot.category === "Food" ||
        /\b(indoor|library|museum|cafe|covered|story)\b/.test(text)
      ) {
        score += 18;
      }
      if (spot.category === "Outdoors" && !/\b(indoor|covered|greenhouse)\b/.test(text)) {
        score -= 24;
      }
    } else if (/\b(indoor|library|museum|cafe)\b/.test(text)) {
      score += 2;
    }
  }

  if (hasPreference(preferences, "near-only")) {
    if (spot.transitMinutes <= 15) score += 12;
    else if (spot.transitMinutes <= 30) score += 7;
    else score -= 18;
  }

  if (hasPreference(preferences, "free-only")) {
    if (spot.cost === "Free") score += 14;
    else if (spot.cost === "$") score += 8;
    else if (spot.cost === "$$") score -= 8;
    else if (spot.cost === "$$$") score -= 22;
    else score -= 5;
  }

  if (profile.budget === "free" || profile.budget === "under-25") {
    if (spot.cost === "Free") score += profile.budget === "free" ? 18 : 14;
    else if (spot.cost === "$") score += 9;
    else score -= 18;
  }

  if (profile.planLength === "quick") {
    if (spot.transitMinutes <= 15) score += 14;
    else if (spot.transitMinutes <= 25) score += 8;
    if (spot.planning === "Walk-in" || spot.planning === "Flexible") score += 10;
    if (/\b(short|quick|easy|drop-in|walk-in|flexible)\b/.test(text)) score += 6;
    if (/\b(reservation|book|ticketed|timed entry)\b/.test(text)) score -= 6;
  } else if (profile.planLength === "full-day") {
    if (spot.dataSource === "family-event") score += 6;
    if (spot.category === "Outdoors" || spot.category === "Culture") score += 5;
    if (spot.transitMinutes > 40 && (spot.friendScore ?? 0) < 82) score -= 5;
  }

  if (profile.transportMode === "drive") {
    if (hasParkingCue(spot, text)) score += 7;
    if (spot.parkingNearby === false) score -= 5;
    if (spot.transitMinutes > 45) score -= 6;
  }

  if (profile.transportMode === "transit") {
    if (spot.transitMinutes <= 25) score += 9;
    else if (spot.transitMinutes <= 40) score += 4;
    else score -= 10;
    if (hasTransitCue(text)) score += 8;
  }

  if (profile.transportMode === "walk-stroller") {
    if (spot.transitMinutes <= 15) score += 12;
    else if (spot.transitMinutes <= 25) score += 6;
    else score -= 12;
    if (spot.wheelchair === "yes") score += 8;
    if (/\b(stroller|accessible|paved|flat|walkable|easy exit|library|playground)\b/.test(text)) {
      score += 7;
    }
    if (/\b(stairs|steep|scramble|long hike)\b/.test(text)) score -= 12;
  }

  if (profile.crowdTolerance === "quiet") {
    if (/\b(quiet|calm|small|garden|trail|library|picnic|easy exit|low crowd)\b/.test(text)) {
      score += 11;
    }
    if (
      spot.category === "Shopping" ||
      /\b(festival|market|mall|popular|crowd|busy|ticketed)\b/.test(text)
    ) {
      score -= 10;
    }
  }

  if (profile.crowdTolerance === "busy-ok") {
    if (spot.dataSource === "family-event") score += 4;
    if (/\b(festival|market|program|performance|event|popular)\b/.test(text)) {
      score += 5;
    }
  }

  if (profile.setting === "indoor") {
    if (spotLooksIndoor(spot, text)) score += 14;
    if (spot.category === "Outdoors" && !/\b(covered|greenhouse)\b/.test(text)) score -= 18;
  }

  if (profile.setting === "outdoor") {
    if (spotLooksOutdoor(spot, text)) score += 16;
    if (spot.category === "Shopping") score -= 8;
  }

  return Math.round(score);
}

export function describePlannerMatch(
  spot: PlannerSpot,
  input?: PlannerScoringOptions,
): string[] {
  const options = normalizeScoringOptions(input);
  const preferences = options.preferences ?? [];
  const profile = normalizePlannerProfile(options.profile);
  const text = textForSpot(spot);
  const reasons: string[] = [];

  if (spot.dataSource === "family-event") {
    reasons.push("scheduled family event");
  }
  if (options.ageBand) {
    reasons.push(`fits ${ageBandLabels[options.ageBand].toLowerCase()}`);
  }
  if ((profile.budget !== "any" || hasPreference(preferences, "free-only")) && isLowCost(spot.cost)) {
    reasons.push(spot.cost === "Free" ? "free" : "low cost");
  }
  if (
    (profile.planLength === "quick" || hasPreference(preferences, "near-only")) &&
    spot.transitMinutes <= 30
  ) {
    reasons.push(`${spot.transitMinutes} min away`);
  }
  if (profile.transportMode === "drive" && hasParkingCue(spot, text)) {
    reasons.push("parking looks easier");
  }
  if (profile.transportMode === "transit" && (spot.transitMinutes <= 30 || hasTransitCue(text))) {
    reasons.push("better transit fit");
  }
  if (
    profile.transportMode === "walk-stroller" &&
    (spot.transitMinutes <= 25 || spot.wheelchair === "yes" || /\b(stroller|accessible|paved|flat)\b/.test(text))
  ) {
    reasons.push("stroller-friendly");
  }
  if (
    (profile.setting === "indoor" ||
      (hasPreference(preferences, "indoor-when-rainy") && options.weather === "wet")) &&
    spotLooksIndoor(spot, text)
  ) {
    reasons.push("weather-safe indoor option");
  }
  if (
    (profile.setting === "outdoor" || hasPreference(preferences, "parks-nature")) &&
    spotLooksOutdoor(spot, text)
  ) {
    reasons.push("outdoor play/nature fit");
  }
  if (
    (profile.crowdTolerance === "quiet" || hasPreference(preferences, "no-crowds")) &&
    /\b(quiet|calm|garden|trail|library|picnic|easy exit|low crowd)\b/.test(text)
  ) {
    reasons.push("calmer crowd profile");
  }
  if (
    hasPreference(preferences, "libraries-museums") &&
    (spot.category === "Culture" || /\b(library|museum|story|exhibit|science)\b/.test(text))
  ) {
    reasons.push("library/museum interest match");
  }
  if (
    hasPreference(preferences, "loves-animals") &&
    /\b(zoo|aquarium|farm|wildlife|animal|bird|nature center)\b/.test(text)
  ) {
    reasons.push("animal interest match");
  }

  if (reasons.length === 0) {
    reasons.push(`${spot.category.toLowerCase()} fit in ${spot.neighborhood}`);
  }

  return Array.from(new Set(reasons)).slice(0, 3);
}

export function rankForVibe(
  spots: PlannerSpot[],
  vibe: PlannerVibe,
  input?: AgeBand | PlannerScoringOptions,
) {
  const options = normalizeScoringOptions(input);
  const candidates = filterSpotsForPlannerPreferences(spots, options);
  return [...candidates].sort((left, right) => {
    const scoreDelta =
      scoreSpotForVibe(right, vibe, options) - scoreSpotForVibe(left, vibe, options);
    if (scoreDelta !== 0) return scoreDelta;
    return left.transitMinutes - right.transitMinutes;
  });
}

export function buildPlannerBrief(
  filteredSpots: PlannerSpot[],
  savedSpots: PlannerSpot[],
  vibe: PlannerVibe,
  options?: PlannerScoringOptions,
): PlannerBrief {
  const candidates = savedSpots.length > 0 ? savedSpots : filteredSpots.slice(0, 80);
  const ranked = rankForVibe(candidates, vibe, options);
  const primary = ranked[0];

  if (!primary) {
    return {
      title: "No plan yet",
      summary: "Adjust the filters to bring a few friend-friendly options into view.",
      rationale: ["The planner needs at least one matching spot."],
      cautions: ["No source-backed spot is currently selected."],
    };
  }

  const backup =
    ranked.find((spot) => spot.category !== primary.category) ||
    ranked.find((spot) => spot.id !== primary.id);

  const vibeLabel = vibeLabels[vibe].toLowerCase();
  const rationale = [
    `${primary.name} fits a ${vibeLabel} friend plan with ${primary.groupSize.toLowerCase()} and ${primary.planning.toLowerCase()} planning.`,
    `${primary.neighborhood} is the best starting area in the current result set.`,
    backup
      ? `${backup.name} gives the group a ${backup.category.toLowerCase()} backup instead of overcommitting to one kind of stop.`
      : "No backup is needed yet because the current result set is narrow.",
  ];

  const cautions = [];
  if (!primary.openNow) {
    cautions.push("Current hours are not listed in the source data.");
  }
  if (!primary.website) {
    cautions.push("No venue website is listed, so verify details from the OSM source.");
  }
  if (primary.transitMinutes > 45) {
    cautions.push("Travel time from the San Francisco baseline is high.");
  }
  if (savedSpots.length > 0) {
    cautions.push("The planner is prioritizing your saved shortlist.");
  }

  return {
    title: `Start with ${primary.name}`,
    summary: `${primary.mood} in ${primary.neighborhood}. Best current fit for ${vibeLabel} plans with friends.`,
    primary,
    backup,
    rationale,
    cautions: cautions.length > 0 ? cautions : ["No major data caveats on the top pick."],
  };
}
