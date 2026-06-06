// Pure, server-reusable plan + search logic behind the public /api endpoints.
//
// This module is the shared core that the Cloudflare Pages Functions in
// functions/api/*.ts wrap with HTTP plumbing. Keeping it here (under src/)
// means it is type-checked by `tsc -b` and unit-tested in tests/planApi.test.ts,
// while the Functions stay thin. It must NOT import anything browser-only so it
// can also bundle into a Worker.

import {
  buildPlannerBrief,
  rankForVibe,
  vibeLabels,
  type AgeBand,
  type PlannerSpot,
  type PlannerVibe,
} from "./planner";
import { METROS, type MetroConfig } from "./metros";

export type ApiAudience = "kids" | "adults";

export const VALID_VIBES: PlannerVibe[] = [
  "balanced",
  "low-effort",
  "active",
  "food-first",
  "culture",
];
const VALID_AGE_BANDS: AgeBand[] = [
  "toddler",
  "preschool",
  "school-age",
  "tween",
];

export function isVibe(value: string): value is PlannerVibe {
  return (VALID_VIBES as string[]).includes(value);
}

export function isAgeBand(value: string): value is AgeBand {
  return (VALID_AGE_BANDS as string[]).includes(value);
}

export function resolveMetro(slug: string | null | undefined): MetroConfig | null {
  const key = String(slug || "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!key) return null;
  return (
    METROS.find(
      (metro) =>
        metro.id === key ||
        metro.canonicalPath.replace(/^\//, "") === key ||
        metro.aliases.includes(key),
    ) || null
  );
}

// Loose shape of a raw event record from data/{metro}/events.json. Only the
// fields the API reads are typed; the feed carries more.
export type RawEvent = {
  id: string;
  title: string;
  description?: string;
  venue?: string;
  city?: string;
  neighborhood?: string;
  category?: string;
  timeWindow?: string;
  startDateTime?: string | null;
  daysOfWeek?: number[];
  ageBands?: AgeBand[];
  cost?: string;
  url?: string;
  sourceName?: string;
  verified?: boolean;
};

function eventCategory(category: string): string {
  if (/\b(music|comedy|nightclub|bar|dj|concert)\b/i.test(category)) {
    return "Nightlife";
  }
  if (/\b(library|museum|ticketed)\b/i.test(category)) return "Culture";
  if (/\b(park|farm|zoo|garden|nature)\b/i.test(category)) return "Outdoors";
  return "Culture";
}

function eventCost(cost: string | undefined): string {
  if (!cost) return "Unknown";
  if (cost === "Free" || cost === "$" || cost === "$$" || cost === "$$$") {
    return cost;
  }
  if (/free/i.test(cost)) return "Free";
  if (/\$\$\$/.test(cost)) return "$$$";
  if (/\$\$/.test(cost)) return "$$";
  if (/\$/.test(cost)) return "$";
  return "Unknown";
}

function eventWhen(event: RawEvent): string {
  if (event.startDateTime) {
    const date = new Date(event.startDateTime);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }
  }
  return event.timeWindow || "Scheduled";
}

// Mirror of App.tsx's eventToPlanningSpot, trimmed to the fields the scorer
// reads. Transit time is unknown server-side, so use a neutral default rather
// than the SPA's distance-from-origin estimate.
const EVENT_TRANSIT_MINUTES = 20;

export function eventToPlannerSpot(
  event: RawEvent,
  audience: ApiAudience,
): PlannerSpot {
  const when = eventWhen(event);
  return {
    id: `event-${event.id}`,
    name: event.title,
    neighborhood: [event.venue, event.city].filter(Boolean).join(", ") || "—",
    category: eventCategory(event.category || ""),
    cost: eventCost(event.cost),
    transitMinutes: EVENT_TRANSIT_MINUTES,
    timeWindow: event.timeWindow,
    mood: `Scheduled event: ${when}`,
    groupSize: audience === "adults" ? "2-8 people" : "Family",
    planning: `${when}. Confirm details with ${event.sourceName || "the venue"}.`,
    openNow: false,
    note: event.description || undefined,
    tags: ["event", "scheduled", (event.category || "").toLowerCase()],
    sourceUrl: event.url,
    website: event.url,
    kidsFriendly: audience === "kids" ? true : undefined,
    dataSource: "family-event",
    friendScore: event.verified ? 96 : 82,
  };
}

export type PlanStop = {
  id: string;
  kind: "place" | "event";
  name: string;
  category: string;
  neighborhood: string;
  cost: string;
  mood: string;
  when?: string;
  note?: string;
  url?: string;
};

export type PlanResponse = {
  metro: { id: string; label: string };
  vibe: PlannerVibe;
  vibeLabel: string;
  audience: ApiAudience;
  ageBand?: AgeBand;
  stops: PlanStop[];
  brief: {
    title: string;
    summary: string;
    rationale: string[];
    cautions: string[];
  };
  counts: { places: number; events: number; considered: number };
};

function toStop(spot: PlannerSpot): PlanStop {
  const isEvent = spot.dataSource === "family-event";
  return {
    id: spot.id,
    kind: isEvent ? "event" : "place",
    name: spot.name,
    category: spot.category,
    neighborhood: spot.neighborhood,
    cost: spot.cost,
    mood: spot.mood,
    when: isEvent ? spot.timeWindow || undefined : undefined,
    note: spot.note || undefined,
    url: spot.website || spot.sourceUrl || undefined,
  };
}

// Pick `limit` stops favoring category variety, then backfill with the next
// highest-ranked regardless of category.
function selectStops(ranked: PlannerSpot[], limit: number): PlannerSpot[] {
  const picked: PlannerSpot[] = [];
  const usedCategories = new Set<string>();
  for (const spot of ranked) {
    if (picked.length >= limit) break;
    if (usedCategories.has(spot.category)) continue;
    picked.push(spot);
    usedCategories.add(spot.category);
  }
  if (picked.length < limit) {
    const pickedIds = new Set(picked.map((s) => s.id));
    for (const spot of ranked) {
      if (picked.length >= limit) break;
      if (pickedIds.has(spot.id)) continue;
      picked.push(spot);
    }
  }
  return picked;
}

export type BuildPlanParams = {
  metro: MetroConfig;
  spots: PlannerSpot[];
  events: RawEvent[];
  vibe: PlannerVibe;
  audience: ApiAudience;
  ageBand?: AgeBand;
  includeEvents?: boolean;
  limit?: number;
};

export function buildPlan(params: BuildPlanParams): PlanResponse {
  const {
    metro,
    spots,
    events,
    vibe,
    audience,
    ageBand,
    includeEvents = true,
    limit = 3,
  } = params;

  const eventSpots = includeEvents
    ? events.map((event) => eventToPlannerSpot(event, audience))
    : [];
  const candidates = [...spots, ...eventSpots];

  const options = { ageBand, audience };
  const ranked = rankForVibe(candidates, vibe, options);
  const stops = selectStops(ranked, Math.max(1, Math.min(limit, 5)));
  // Feed the brief the already-ranked list so its top pick matches stops[0].
  // (buildPlannerBrief slices its first 80 entries, so an unranked list would
  // describe a different spot than the one the plan actually leads with.)
  const brief = buildPlannerBrief(ranked, [], vibe, options);

  return {
    metro: { id: metro.id, label: metro.label },
    vibe,
    vibeLabel: vibeLabels[vibe],
    audience,
    ageBand,
    stops: stops.map(toStop),
    brief: {
      title: brief.title,
      summary: brief.summary,
      rationale: brief.rationale,
      cautions: brief.cautions,
    },
    counts: {
      places: spots.length,
      events: eventSpots.length,
      considered: candidates.length,
    },
  };
}

export type SearchKind = "place" | "event";

export type SearchHit = {
  id: string;
  kind: SearchKind;
  name: string;
  category: string;
  neighborhood: string;
  cost: string;
  url?: string;
  when?: string;
};

export type SearchResponse = {
  metro: { id: string; label: string };
  query: string;
  count: number;
  hits: SearchHit[];
};

function matches(haystacks: Array<string | undefined>, needle: string): boolean {
  return haystacks.some((h) => (h || "").toLowerCase().includes(needle));
}

export type SearchParams = {
  metro: MetroConfig;
  spots: PlannerSpot[];
  events: RawEvent[];
  query: string;
  type?: "places" | "events" | "all";
  limit?: number;
};

export function searchRecords(params: SearchParams): SearchResponse {
  const { metro, spots, events, query, type = "all", limit = 20 } = params;
  const needle = query.trim().toLowerCase();
  const cap = Math.max(1, Math.min(limit, 50));
  const hits: SearchHit[] = [];

  if (needle && (type === "places" || type === "all")) {
    for (const spot of spots) {
      if (hits.length >= cap) break;
      if (
        matches(
          [spot.name, spot.neighborhood, spot.category, ...(spot.tags || [])],
          needle,
        )
      ) {
        hits.push({
          id: spot.id,
          kind: "place",
          name: spot.name,
          category: spot.category,
          neighborhood: spot.neighborhood,
          cost: spot.cost,
          url: spot.website || spot.sourceUrl || undefined,
        });
      }
    }
  }

  if (needle && (type === "events" || type === "all")) {
    for (const event of events) {
      if (hits.length >= cap) break;
      if (
        matches(
          [event.title, event.venue, event.city, event.category, event.description],
          needle,
        )
      ) {
        hits.push({
          id: `event-${event.id}`,
          kind: "event",
          name: event.title,
          category: event.category || "Event",
          neighborhood: [event.venue, event.city].filter(Boolean).join(", ") || "—",
          cost: eventCost(event.cost),
          url: event.url,
          when: eventWhen(event),
        });
      }
    }
  }

  return {
    metro: { id: metro.id, label: metro.label },
    query: query.trim(),
    count: hits.length,
    hits,
  };
}
