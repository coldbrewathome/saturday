export type PlannerVibe =
  | "balanced"
  | "low-effort"
  | "active"
  | "food-first"
  | "culture";

export type AgeBand = "toddler" | "preschool" | "school-age" | "tween";

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

export function scoreSpotForVibe(
  spot: PlannerSpot,
  vibe: PlannerVibe,
  ageBand?: AgeBand,
) {
  // Base: every spot is being evaluated as a kid/family option.
  let score = spot.friendScore ?? 60;

  if (spot.openNow) score += 5;
  if (spot.website) score += 3;
  if (spot.transitMinutes > 45) score -= 8;
  if (spot.planning.toLowerCase().includes("book")) score -= 2;

  // Universal kid bias (applies to every vibe in the family-only build).
  if (spot.kidsFriendly === true) score += 12;
  if (spot.kidsFriendly === false) score -= 25;
  if (spot.cost === "Free") score += 4;
  if (spot.cost === "$") score += 2;

  if (vibe === "low-effort") {
    score -= spot.transitMinutes * 0.65;
    if (spot.planning === "Walk-in" || spot.planning === "Flexible") score += 10;
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
    if (spot.category === "Shopping") score += 4;
  }

  // Age-band bias on top of vibe.
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
  }
  if (ageBand === "tween") {
    if (spot.category === "Wellness") score += 6;
    if (spot.category === "Food") score += 4;
    if (spot.category === "Shopping") score += 4;
  }

  return Math.round(score);
}

export function rankForVibe(
  spots: PlannerSpot[],
  vibe: PlannerVibe,
  ageBand?: AgeBand,
) {
  return [...spots].sort((left, right) => {
    const scoreDelta =
      scoreSpotForVibe(right, vibe, ageBand) - scoreSpotForVibe(left, vibe, ageBand);
    if (scoreDelta !== 0) return scoreDelta;
    return left.transitMinutes - right.transitMinutes;
  });
}

export function buildPlannerBrief(
  filteredSpots: PlannerSpot[],
  savedSpots: PlannerSpot[],
  vibe: PlannerVibe,
): PlannerBrief {
  const candidates = savedSpots.length > 0 ? savedSpots : filteredSpots.slice(0, 80);
  const ranked = rankForVibe(candidates, vibe);
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
