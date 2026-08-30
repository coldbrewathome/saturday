// Plan/poll selection helpers, extracted from App.tsx (2026-08).
// Exported for App (re-exports for tests) and used by the browse hero rail.
import { isUpcomingEvent } from "./eventFreshness";
import { scoreSpotForVibe, type PlannerScoringOptions, type PlannerVibe } from "./planner";
import type { PollSnapshot } from "./api";
import type { FamilyEvent, FeaturedPlan, HeroPick, Spot } from "./types";

// B4: a themed plan (e.g. Memorial Day weekend) is pinned at the top of the
// Editor's-picks rail regardless of map center. With an explicit themedEnd
// it expires there. Without one, it used to pin forever — derive an
// effective window from the plan's own events instead: eligible only while
// at least one resolves and hasn't ended; ineligible if none resolve or
// none carry a usable date. Exported for tests.
export function isThemedPlanEligible(
  plan: FeaturedPlan,
  eventsById: Map<string, FamilyEvent>,
  now: Date = new Date(),
): boolean {
  if (!plan.themed) return false;
  if (plan.themedEnd) return Date.parse(plan.themedEnd) > now.getTime();
  const ends = (plan.eventIds ?? [])
    .map((id) => eventsById.get(id))
    .filter((e): e is FamilyEvent => Boolean(e))
    .map((e) => Date.parse(e.endDateTime || e.startDateTime || ""))
    .filter((t) => Number.isFinite(t));
  if (ends.length === 0) return false;
  return Math.max(...ends) > now.getTime();
}

// Pick the hero suggestion from the already-loaded featured plans. Plans
// whose referenced items are all missing/ended are skipped (freshness gate:
// only upcoming events count). Without a vibe the editorial rail order wins;
// with a vibe, plans are re-ranked client-side by scoring their resolved
// stops with the shared planner scorer. Exported for tests.
export function pickHeroFeatured(
  plans: FeaturedPlan[],
  spots: Spot[],
  events: FamilyEvent[],
  vibe: PlannerVibe | null,
  scoringOptions?: PlannerScoringOptions,
  now: Date = new Date(),
  timeZone?: string,
): HeroPick | null {
  const spotById = new Map(spots.map((s) => [s.id, s] as const));
  const eventById = new Map(events.map((e) => [e.id, e] as const));
  const candidates: HeroPick[] = [];
  for (const featured of plans) {
    const resolvedStops = featured.stopIds
      .map((id) => spotById.get(id))
      .filter((s): s is Spot => Boolean(s));
    const upcoming = (featured.eventIds ?? [])
      .map((id) => eventById.get(id))
      .filter((e): e is FamilyEvent => Boolean(e && isUpcomingEvent(e, now, { timeZone })));
    if (resolvedStops.length === 0 && upcoming.length === 0) continue;
    candidates.push({ featured, stops: resolvedStops, events: upcoming });
  }
  if (candidates.length === 0) return null;
  if (!vibe || vibe === "balanced") return candidates[0];
  const scored = candidates.map((pick, index) => ({
    pick,
    index,
    score:
      pick.stops.length > 0
        ? pick.stops.reduce(
            (sum, stop) => sum + scoreSpotForVibe(stop, vibe, scoringOptions),
            0,
          ) / pick.stops.length
        : Number.NEGATIVE_INFINITY,
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0].pick;
}

// Aggregate a poll snapshot into the owner-facing tally summary shown in the
// plan detail ("2 friends voted · 5 yes votes" + per-stop yes counts).
// Exported for tests.
export function summarizePollTallies(poll: PollSnapshot): {
  voterCount: number;
  totalYes: number;
  perItem: Array<{ id: string; label: string; yes: number }>;
} {
  const labelById = new Map<string, string>();
  for (const stop of poll.stops) labelById.set(stop.id, stop.name);
  for (const event of poll.events ?? []) labelById.set(event.id, event.title);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const ref of poll.itemOrder ?? []) {
    if (!seen.has(ref.id) && labelById.has(ref.id)) {
      seen.add(ref.id);
      order.push(ref.id);
    }
  }
  for (const id of labelById.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  let totalYes = 0;
  const perItem = order.map((id) => {
    const yes = poll.tallies[id]?.up ?? 0;
    totalYes += yes;
    return { id, label: labelById.get(id) ?? id, yes };
  });
  return { voterCount: poll.voterCount, totalYes, perItem };
}
