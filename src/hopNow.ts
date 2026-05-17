// Hop-me-now ranker: picks 3-5 things to go do RIGHT NOW. Different from the
// weekend planner (which is multi-stop, planned ahead). This is one or two
// nearby places that are open, near, and a fit for the next 1-2 hours.

export type HopNowAudience = "kids" | "adults";

export type HopNowWeather = "wet" | "dry" | "mixed";

export type HopNowScheduleWindow = { open: number; close: number };
export type HopNowWeekSchedule = {
  mon: HopNowScheduleWindow[];
  tue: HopNowScheduleWindow[];
  wed: HopNowScheduleWindow[];
  thu: HopNowScheduleWindow[];
  fri: HopNowScheduleWindow[];
  sat: HopNowScheduleWindow[];
  sun: HopNowScheduleWindow[];
};
export type HopNowSchedule =
  | { is247: true; days: null }
  | { is247: false; days: HopNowWeekSchedule };

export type HopNowSpot = {
  id: string;
  name: string;
  neighborhood: string;
  category: string;
  lat?: number;
  lon?: number;
  transitMinutes?: number;
  schedule?: HopNowSchedule | null;
  cost?: string;
  kidsFriendly?: boolean | null;
  friendScore?: number;
  googleRating?: number;
  googleRatingCount?: number;
  tags?: string[];
  mood?: string;
  website?: string | null;
  sourceUrl?: string;
};

export type HopNowEvent = {
  id: string;
  title: string;
  venue: string;
  neighborhood: string;
  category: string;
  lat: number;
  lon: number;
  startDateTime: string;
  endDateTime?: string | null;
  cost?: string;
  url: string;
};

export type HopNowLocation = { lat: number; lon: number };

export type HopNowOptions = {
  now: Date;
  audience: HopNowAudience;
  userLocation?: HopNowLocation | null;
  weather?: HopNowWeather;
  maxDriveMinutes?: number;
  maxDistanceMiles?: number;
  minOpenWindowMinutes?: number;
  eventLookaheadMinutes?: number;
  shuffleSeed?: number;
  limit?: number;
};

export type HopNowSpotPick = {
  kind: "spot";
  id: string;
  name: string;
  neighborhood: string;
  category: string;
  distanceMiles: number | null;
  etaMinutes: number | null;
  closesAtMinutes: number | null;
  alwaysOpen: boolean;
  whyNow: string;
  mapsQuery: string;
  url: string | null;
};

export type HopNowEventPick = {
  kind: "event";
  id: string;
  name: string;
  venue: string;
  neighborhood: string;
  category: string;
  distanceMiles: number | null;
  etaMinutes: number | null;
  startsInMinutes: number;
  whyNow: string;
  mapsQuery: string;
  url: string;
};

export type HopNowPick = HopNowSpotPick | HopNowEventPick;

export type HopNowResult = {
  picks: HopNowPick[];
  sparse: boolean;
  reason: string | null;
};

const DAY_KEYS: (keyof HopNowWeekSchedule)[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const DEFAULT_LIMIT = 9;
const DEFAULT_MAX_DRIVE_MINUTES = 20;
const DEFAULT_MAX_DISTANCE_MILES = 12;
const DEFAULT_MIN_OPEN_WINDOW_MINUTES = 90;
const DEFAULT_EVENT_LOOKAHEAD_MINUTES = 240;

// Target composition for a full result. If a tier comes up short its budget is
// not reallocated to a higher tier — we just under-fill (sparse > misleading).
// "other" is the only tier where overflow tops up from leftover earlier tiers.
const TIER_BUDGET_EVENTS = 5;
const TIER_BUDGET_PARKS = 2;
const TIER_BUDGET_MUSEUMS = 2;
// 25 mph average urban driving — rough but fine for "within ~20 min" gating.
const AVG_DRIVE_MPH = 25;

function haversineMiles(a: HopNowLocation, b: HopNowLocation): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function estimateDriveMinutes(distanceMiles: number): number {
  return Math.round((distanceMiles / AVG_DRIVE_MPH) * 60);
}

type OpenWindow =
  | { kind: "always" }
  | { kind: "open"; closesAtMinutes: number; minutesUntilClose: number };

function evaluateOpenWindow(
  schedule: HopNowSchedule | null | undefined,
  now: Date,
): OpenWindow | null {
  if (!schedule) return null;
  if (schedule.is247) return { kind: "always" };
  const dayIdx = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const slots = schedule.days[DAY_KEYS[dayIdx]] ?? [];
  for (const slot of slots) {
    if (minutes >= slot.open && minutes < slot.close) {
      return {
        kind: "open",
        closesAtMinutes: slot.close,
        minutesUntilClose: slot.close - minutes,
      };
    }
  }
  return null;
}

// Deterministic small jitter in [-jitterRange, +jitterRange] from id+seed.
// Used so repeated "Shuffle" taps produce stable, reproducible reordering.
function seededJitter(id: string, seed: number, jitterRange: number): number {
  let h = seed | 0;
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  const unit = ((h >>> 0) % 1000) / 999; // 0..1
  return (unit * 2 - 1) * jitterRange;
}

function spotAudienceBoost(spot: HopNowSpot, audience: HopNowAudience): number {
  if (audience === "kids") {
    if (spot.kidsFriendly === true) return 12;
    if (spot.kidsFriendly === false) return -25;
    return 0;
  }
  if (spot.kidsFriendly === true) return -2;
  return 0;
}

function googleRatingBoost(spot: HopNowSpot): number {
  if (typeof spot.googleRating !== "number") return 0;
  if ((spot.googleRatingCount ?? 0) < 25) return 0;
  const r = spot.googleRating;
  if (r >= 4.7) return 10;
  if (r >= 4.5) return 6;
  if (r >= 4.2) return 3;
  if (r < 3.5) return -8;
  if (r < 3.8) return -3;
  return 0;
}

function weatherBoost(spot: HopNowSpot, weather: HopNowWeather | undefined): number {
  if (weather !== "wet") return 0;
  const text = `${spot.category} ${spot.mood ?? ""} ${(spot.tags ?? []).join(" ")}`.toLowerCase();
  const looksOutdoor =
    spot.category === "Outdoors" ||
    /\b(park|garden|trail|beach|playground|picnic)\b/.test(text);
  const looksIndoor =
    spot.category === "Culture" ||
    spot.category === "Food" ||
    /\b(indoor|library|museum|cafe|covered)\b/.test(text);
  if (looksOutdoor && !/\b(covered|greenhouse|indoor)\b/.test(text)) return -18;
  if (looksIndoor) return 8;
  return 0;
}

type Scored<T> = { item: T; score: number };

type SpotContext = {
  spot: HopNowSpot;
  open: OpenWindow;
  distanceMiles: number | null;
  etaMinutes: number | null;
};

type EventContext = {
  event: HopNowEvent;
  startsInMinutes: number;
  distanceMiles: number | null;
  etaMinutes: number | null;
};

function gatherSpotCandidates(
  spots: HopNowSpot[],
  opts: Required<
    Pick<
      HopNowOptions,
      "maxDriveMinutes" | "maxDistanceMiles" | "minOpenWindowMinutes"
    >
  > & { now: Date; userLocation: HopNowLocation | null | undefined },
): SpotContext[] {
  const out: SpotContext[] = [];
  for (const spot of spots) {
    const open = evaluateOpenWindow(spot.schedule, opts.now);
    if (!open) continue;
    if (open.kind === "open" && open.minutesUntilClose < opts.minOpenWindowMinutes) {
      continue;
    }
    let distanceMiles: number | null = null;
    let etaMinutes: number | null = null;
    if (
      opts.userLocation &&
      typeof spot.lat === "number" &&
      typeof spot.lon === "number"
    ) {
      distanceMiles = haversineMiles(opts.userLocation, {
        lat: spot.lat,
        lon: spot.lon,
      });
      etaMinutes = estimateDriveMinutes(distanceMiles);
      if (distanceMiles > opts.maxDistanceMiles) continue;
      if (etaMinutes > opts.maxDriveMinutes) continue;
    } else if (typeof spot.transitMinutes === "number") {
      etaMinutes = spot.transitMinutes;
      if (spot.transitMinutes > opts.maxDriveMinutes) continue;
    }
    out.push({ spot, open, distanceMiles, etaMinutes });
  }
  return out;
}

function gatherEventCandidates(
  events: HopNowEvent[],
  opts: Required<
    Pick<HopNowOptions, "maxDriveMinutes" | "maxDistanceMiles" | "eventLookaheadMinutes">
  > & { now: Date; userLocation: HopNowLocation | null | undefined },
): EventContext[] {
  const nowMs = opts.now.getTime();
  const out: EventContext[] = [];
  for (const event of events) {
    const startMs = Date.parse(event.startDateTime);
    if (!Number.isFinite(startMs)) continue;
    const minutesUntilStart = Math.round((startMs - nowMs) / 60000);
    // Allow events that start within lookahead OR started up to 30 min ago
    // if they have an endDateTime that's still in the future (still joinable).
    if (minutesUntilStart > opts.eventLookaheadMinutes) continue;
    if (minutesUntilStart < -30) continue;
    if (minutesUntilStart < 0) {
      const endMs = event.endDateTime ? Date.parse(event.endDateTime) : NaN;
      if (!Number.isFinite(endMs) || endMs < nowMs + 30 * 60_000) continue;
    }
    let distanceMiles: number | null = null;
    let etaMinutes: number | null = null;
    if (opts.userLocation) {
      distanceMiles = haversineMiles(opts.userLocation, {
        lat: event.lat,
        lon: event.lon,
      });
      etaMinutes = estimateDriveMinutes(distanceMiles);
      if (distanceMiles > opts.maxDistanceMiles) continue;
      if (etaMinutes > opts.maxDriveMinutes) continue;
    }
    out.push({ event, startsInMinutes: minutesUntilStart, distanceMiles, etaMinutes });
  }
  return out;
}

function scoreSpot(
  ctx: SpotContext,
  opts: { audience: HopNowAudience; weather?: HopNowWeather; shuffleSeed: number },
): number {
  const { spot, open, etaMinutes } = ctx;
  let score = spot.friendScore ?? 60;
  score += spotAudienceBoost(spot, opts.audience);
  score += googleRatingBoost(spot);
  score += weatherBoost(spot, opts.weather);
  // Closer is better.
  if (etaMinutes != null) {
    if (etaMinutes <= 5) score += 14;
    else if (etaMinutes <= 10) score += 9;
    else if (etaMinutes <= 15) score += 4;
    else score -= 2;
  }
  // Longer remaining open window = more flexible for the user.
  if (open.kind === "open") {
    if (open.minutesUntilClose >= 240) score += 4;
    else if (open.minutesUntilClose >= 150) score += 2;
  } else {
    score += 3; // open 24/7
  }
  // Walk-in friendly categories edge out heavier commitments.
  if (spot.category === "Outdoors" || spot.category === "Culture") score += 2;
  if (spot.category === "Shopping") score -= 6;
  score += seededJitter(spot.id, opts.shuffleSeed, 3);
  return score;
}

function scoreEvent(
  ctx: EventContext,
  opts: { audience: HopNowAudience; shuffleSeed: number },
): number {
  const { event, startsInMinutes, etaMinutes } = ctx;
  let score = 70;
  // Time relevance over the 4-hour lookahead. The "go in the next hour" sweet
  // spot still scores highest, but events 1-3 hours out remain very pickable.
  if (startsInMinutes >= 15 && startsInMinutes <= 60) score += 14;
  else if (startsInMinutes > 60 && startsInMinutes <= 180) score += 8;
  else if (startsInMinutes > 180) score += 3;
  else if (startsInMinutes >= 5 && startsInMinutes < 15) score += 6;
  else if (startsInMinutes < 0) score -= 6;
  if (etaMinutes != null) {
    // Can we actually make it before it starts?
    const slack = startsInMinutes - etaMinutes;
    if (slack < -5) score -= 18;
    else if (slack < 0) score -= 8;
    else if (slack >= 10) score += 4;
  }
  if (event.cost === "Free") score += 4;
  if (opts.audience === "adults") score -= 0; // neutral — caller filters audience
  score += seededJitter(event.id, opts.shuffleSeed, 3);
  return score;
}

function whyNowForSpot(ctx: SpotContext, opts: { weather?: HopNowWeather }): string {
  const { spot, open, etaMinutes, distanceMiles } = ctx;
  // Priority order: most specific time hook first.
  if (open.kind === "open" && open.minutesUntilClose <= 150) {
    const hrs = Math.round(open.minutesUntilClose / 60);
    const closeMin = open.closesAtMinutes;
    return `Open ${hrs}h more — closes ${formatClockMinutes(closeMin)}.`;
  }
  if (etaMinutes != null && etaMinutes <= 8) {
    if (distanceMiles != null) {
      return `${etaMinutes} min away (${distanceMiles.toFixed(1)} mi) — easy hop.`;
    }
    return `${etaMinutes} min away — easy hop.`;
  }
  if (opts.weather === "wet" && (spot.category === "Culture" || spot.category === "Food")) {
    return `Indoor pick for the wet weather.`;
  }
  if (spot.category === "Outdoors") {
    return `Outdoor break in ${spot.neighborhood}.`;
  }
  if (
    typeof spot.googleRating === "number" &&
    spot.googleRating >= 4.6 &&
    (spot.googleRatingCount ?? 0) >= 100
  ) {
    return `Highly rated nearby (${spot.googleRating.toFixed(1)}★).`;
  }
  return `${spot.category} fit in ${spot.neighborhood}.`;
}

function whyNowForEvent(ctx: EventContext): string {
  const { event, startsInMinutes, etaMinutes } = ctx;
  if (startsInMinutes < 0) {
    return `Already started — joinable now.`;
  }
  if (startsInMinutes <= 5) {
    return `Starts in ${Math.max(1, startsInMinutes)} min — go now.`;
  }
  if (etaMinutes != null) {
    return `Starts in ${startsInMinutes} min · ${etaMinutes} min to get there.`;
  }
  return `Starts in ${startsInMinutes} min at ${event.venue}.`;
}

function formatClockMinutes(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = ((h24 + 11) % 12) + 1;
  return mm === 0 ? `${h12}${ampm}` : `${h12}:${mm.toString().padStart(2, "0")}${ampm}`;
}

function diversifyByCategory<T extends { item: { category: string } }>(
  scored: T[],
  limit: number,
  maxPerCategory: number,
): T[] {
  const counts = new Map<string, number>();
  const picked: T[] = [];
  for (const s of scored) {
    if (picked.length >= limit) break;
    const cat = s.item.category;
    const c = counts.get(cat) ?? 0;
    if (c >= maxPerCategory) continue;
    picked.push(s);
    counts.set(cat, c + 1);
  }
  return picked;
}

function isParkLike(spot: HopNowSpot): boolean {
  if (spot.category === "Outdoors") return true;
  const text = `${spot.mood ?? ""} ${(spot.tags ?? []).join(" ")}`.toLowerCase();
  return /\b(park|playground|garden|trail|beach|nature center)\b/.test(text);
}

function isMuseumLike(spot: HopNowSpot): boolean {
  // Culture is the museum/library/exhibit category in the dataset.
  if (spot.category === "Culture") return true;
  const text =
    `${spot.name} ${spot.mood ?? ""} ${(spot.tags ?? []).join(" ")}`.toLowerCase();
  return /\b(museum|library|gallery|exhibit|aquarium|planetarium|observatory|science center)\b/.test(
    text,
  );
}

function mapsQueryFromSpot(spot: HopNowSpot): string {
  return `${spot.name}, ${spot.neighborhood}`;
}

function mapsQueryFromEvent(event: HopNowEvent): string {
  return `${event.venue}, ${event.neighborhood}`;
}

export function hopNowPicks(
  spots: HopNowSpot[],
  events: HopNowEvent[],
  options: HopNowOptions,
): HopNowResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxDriveMinutes = options.maxDriveMinutes ?? DEFAULT_MAX_DRIVE_MINUTES;
  const maxDistanceMiles = options.maxDistanceMiles ?? DEFAULT_MAX_DISTANCE_MILES;
  const minOpenWindowMinutes =
    options.minOpenWindowMinutes ?? DEFAULT_MIN_OPEN_WINDOW_MINUTES;
  const eventLookaheadMinutes =
    options.eventLookaheadMinutes ?? DEFAULT_EVENT_LOOKAHEAD_MINUTES;
  const shuffleSeed = options.shuffleSeed ?? 0;
  const userLocation = options.userLocation ?? null;

  const spotCtx = gatherSpotCandidates(spots, {
    now: options.now,
    userLocation,
    maxDriveMinutes,
    maxDistanceMiles,
    minOpenWindowMinutes,
  });
  const eventCtx = gatherEventCandidates(events, {
    now: options.now,
    userLocation,
    maxDriveMinutes,
    maxDistanceMiles,
    eventLookaheadMinutes,
  });

  const scoredSpots: Scored<SpotContext>[] = spotCtx.map((c) => ({
    item: c,
    score: scoreSpot(c, {
      audience: options.audience,
      weather: options.weather,
      shuffleSeed,
    }),
  }));
  const scoredEvents: Scored<EventContext>[] = eventCtx.map((c) => ({
    item: c,
    score: scoreEvent(c, { audience: options.audience, shuffleSeed }),
  }));

  // Strict tier order: events first, parks next, other spots last. We only
  // dip into the next tier when the current one runs out of qualifying picks.
  const eventPicks: HopNowEventPick[] = [...scoredEvents]
    .sort((a, b) => b.score - a.score)
    .map((s) => {
      const c = s.item;
      return {
        kind: "event",
        id: c.event.id,
        name: c.event.title,
        venue: c.event.venue,
        neighborhood: c.event.neighborhood,
        category: c.event.category,
        distanceMiles: c.distanceMiles,
        etaMinutes: c.etaMinutes,
        startsInMinutes: c.startsInMinutes,
        whyNow: whyNowForEvent(c),
        mapsQuery: mapsQueryFromEvent(c.event),
        url: c.event.url,
      };
    });

  // A spot can match both park-like and museum-like (rare; e.g. a "nature
  // museum" with park tags). Resolve to the more specific tier — museum wins
  // because the museum category signal is rarer and stronger than park tags.
  const parkScored = scoredSpots
    .filter((s) => isParkLike(s.item.spot) && !isMuseumLike(s.item.spot))
    .sort((a, b) => b.score - a.score);
  const museumScored = scoredSpots
    .filter((s) => isMuseumLike(s.item.spot))
    .sort((a, b) => b.score - a.score);
  const otherScored = scoredSpots
    .filter((s) => !isParkLike(s.item.spot) && !isMuseumLike(s.item.spot))
    .sort((a, b) => b.score - a.score);

  function toSpotPick(c: SpotContext): HopNowSpotPick {
    return {
      kind: "spot",
      id: c.spot.id,
      name: c.spot.name,
      neighborhood: c.spot.neighborhood,
      category: c.spot.category,
      distanceMiles: c.distanceMiles,
      etaMinutes: c.etaMinutes,
      closesAtMinutes: c.open.kind === "open" ? c.open.closesAtMinutes : null,
      alwaysOpen: c.open.kind === "always",
      whyNow: whyNowForSpot(c, { weather: options.weather }),
      mapsQuery: mapsQueryFromSpot(c.spot),
      url: c.spot.website ?? c.spot.sourceUrl ?? null,
    };
  }

  const parkPicks: HopNowSpotPick[] = parkScored.map((s) => toSpotPick(s.item));
  const museumPicks: HopNowSpotPick[] = museumScored.map((s) => toSpotPick(s.item));
  // Diversity cap on the catch-all "other" tier so we don't pad with 3 cafes
  // when the user's nearby area is food-heavy.
  const otherPicks: HopNowSpotPick[] = diversifyByCategory(
    otherScored.map((s) => ({
      score: s.score,
      item: { category: s.item.spot.category, ctx: s.item },
    })),
    limit,
    2,
  ).map((s) => toSpotPick(s.item.ctx));

  const picks: HopNowPick[] = [];
  const take = (list: HopNowPick[], budget: number) => {
    for (let i = 0; i < list.length && i < budget; i += 1) {
      if (picks.length >= limit) return;
      picks.push(list[i]);
    }
  };
  take(eventPicks, TIER_BUDGET_EVENTS);
  take(parkPicks, TIER_BUDGET_PARKS);
  take(museumPicks, TIER_BUDGET_MUSEUMS);
  // Top up any remaining slot from the catch-all tier first, then overflow
  // from the higher-priority tiers (in priority order) if there's still room.
  for (const p of otherPicks) {
    if (picks.length >= limit) break;
    picks.push(p);
  }
  for (const p of eventPicks.slice(TIER_BUDGET_EVENTS)) {
    if (picks.length >= limit) break;
    picks.push(p);
  }
  for (const p of parkPicks.slice(TIER_BUDGET_PARKS)) {
    if (picks.length >= limit) break;
    picks.push(p);
  }
  for (const p of museumPicks.slice(TIER_BUDGET_MUSEUMS)) {
    if (picks.length >= limit) break;
    picks.push(p);
  }

  const sparse = picks.length < 3;
  let reason: string | null = null;
  if (picks.length === 0) {
    reason = "Nothing open and nearby right now. Try the weekend guide instead.";
  } else if (sparse) {
    reason = "Slim pickings right now — here are the best couple of options.";
  }

  return { picks, sparse, reason };
}
