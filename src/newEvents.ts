// "New since your last visit" — the returning-visitor section at the top of
// the weekend feed.
//
// Newness = ingest time: events carry `fetchedAt` (first seen at ingest,
// preserved across re-ingests by scripts/ingest-events.mjs). An event is
// "new" when its `fetchedAt` is strictly later than the visitor's previous
// visit (`saturday.lastVisit`, written once per page load).
//
// Ranking is a composite of the two signals the site already trusts:
// importance (keyword heuristics — a port of scoreEvent in
// worker/src/newsletter-template.ts, keep the regexes in sync) and
// popularity (editorial picks rank from popular-events.json, featured-plan
// editor picks, aggregate check-in trust).
import { isUpcomingEvent } from "./eventFreshness";
import { isFeedJunkEvent } from "./eventQuality";
import {
  dateKey,
  isWeekendWindowEvent,
  type PopularEventsDataset,
} from "./popularEvents";
import { trustBoost, type EventTrust } from "./checkinApi";
import type { FamilyEvent, FeaturedPlan } from "./App";

const LAST_VISIT_KEY = "saturday.lastVisit";
export const NEW_EVENTS_CAP = 6;

export function readLastVisit(): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    if (!raw) return null;
    return Number.isFinite(Date.parse(raw)) ? raw : null;
  } catch {
    return null; // private mode / storage blocked
  }
}

export function writeLastVisit(iso: string): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, iso);
  } catch {
    // private mode / quota — non-fatal; next visit simply has no baseline
  }
}

// Port of scoreEvent in worker/src/newsletter-template.ts (keep in sync).
// The junk-title −10 rule lives in isFeedJunkEvent instead — junk is filtered
// out of the section entirely, same as the day feed.
const MARQUEE_RE =
  /\b(festival|fest|parade|fireworks|carnival|fair|circus|rodeo|air ?show|balloon|drone show|block party|touch[- ]a[- ]truck|grand opening)\b/i;
const BIG_DRAW_RE =
  /\b(concert|live music|symphony|orchestra|movie night|outdoor movie|drive[- ]in|train ride|zoo|aquarium|museum day|splash|water play|pumpkin|holiday lights|ice skating|kite|dinosaur|pirate|princess|superhero|magic show|puppet)\b/i;
const ROUTINE_RE =
  /\b(storytime|story time|story hour|book club|lego club|toddler time|craft(ernoon)?|lap ?sit|read to a dog|homework help|teen advisory|knitting|chess club)\b/i;

/** Notability of a single event title, used for ranking and best-of
 * ordering. Exported so the weekend-brief ranking reuses the newsletter's
 * canonical importance heuristics instead of maintaining a second copy. */
export function importanceScore(event: FamilyEvent): number {
  const title = String(event.title || "");
  let score = 0;
  if (MARQUEE_RE.test(title)) score += 5;
  if (BIG_DRAW_RE.test(title)) score += 3;
  if (event.category && /fest|fair|music|outdoor|seasonal/i.test(event.category)) {
    score += 2;
  }
  if (event.cost && /free/i.test(event.cost)) score += 2;
  if (ROUTINE_RE.test(title)) score -= 3;
  return score;
}

function popularityBoost(
  picks: PopularEventsDataset | null | undefined,
  sat: Date,
  eventId: string,
): number {
  // Same stale-file gate as resolvePopularEvents: ranks only apply to the
  // weekend the file names.
  if (!picks || !Array.isArray(picks.picks) || picks.weekendStart !== dateKey(sat)) {
    return 0;
  }
  const pick = picks.picks.find((p) => p.eventId === eventId);
  if (!pick || !Number.isFinite(pick.rank)) return 0;
  // Top pick ≈ a marquee-keyword boost (+5), decaying to 0 by rank 6.
  return Math.max(0, 6 - pick.rank);
}

export type NewEventsOptions = {
  lastVisit: string | null;
  sat: Date;
  sun: Date;
  timeZone?: string;
  popularPicks?: PopularEventsDataset | null;
  featuredPlans?: FeaturedPlan[];
  trust?: ReadonlyMap<string, EventTrust>;
  /** Test hook, mirrors resolvePopularEvents. */
  now?: Date;
};

export function selectNewEvents(
  events: FamilyEvent[],
  {
    lastVisit,
    sat,
    sun,
    timeZone,
    popularPicks,
    featuredPlans,
    trust,
    now,
  }: NewEventsOptions,
): FamilyEvent[] {
  if (!lastVisit) return []; // first visit → no section
  const since = Date.parse(lastVisit);
  if (!Number.isFinite(since)) return [];
  const upcoming = now ?? new Date();

  const editorIds = new Set<string>();
  for (const plan of featuredPlans ?? []) {
    for (const id of plan.eventIds ?? []) editorIds.add(id);
  }

  const candidates = events.filter((e) => {
    if (!e.fetchedAt) return false; // untracked events never count as "new"
    const fetched = Date.parse(e.fetchedAt);
    if (!Number.isFinite(fetched) || fetched <= since) return false;
    if (isFeedJunkEvent(e)) return false;
    if (!isUpcomingEvent(e, upcoming, timeZone ? { timeZone } : undefined)) {
      return false;
    }
    return isWeekendWindowEvent(e, sat, sun);
  });

  const score = (e: FamilyEvent) =>
    importanceScore(e) +
    popularityBoost(popularPicks, sat, e.id) +
    (editorIds.has(e.id) ? 2 : 0) +
    trustBoost(trust?.get(e.id)?.trustScore ?? null);

  return candidates
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        (a.startDateTime! < b.startDateTime! ? -1 : 1),
    )
    .slice(0, NEW_EVENTS_CAP);
}
