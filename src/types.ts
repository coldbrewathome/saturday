// Shared domain types, extracted from App.tsx (2026-08) so leaf modules
// (WeekendView, newEvents, eventQuality, …) can import types without pulling
// in the app shell. App.tsx re-exports the public surface unchanged for
// backward compatibility with existing importers.

import type { AgeBand, PlannerProfile, PlannerVibe } from "./planner";

export type Category =
  | "Outdoors"
  | "Food"
  | "Culture"
  | "Wellness"
  | "Shopping"
  | "Nightlife";

export type Cost = "Free" | "$" | "$$" | "$$$" | "Unknown";

export type ScheduleWindow = { open: number; close: number };
export type WeekSchedule = {
  mon: ScheduleWindow[];
  tue: ScheduleWindow[];
  wed: ScheduleWindow[];
  thu: ScheduleWindow[];
  fri: ScheduleWindow[];
  sat: ScheduleWindow[];
  sun: ScheduleWindow[];
};
export type Schedule = { is247: true; days: null } | { is247: false; days: WeekSchedule };

export type Spot = {
  id: string;
  name: string;
  neighborhood: string;
  category: Category;
  imageUrl: string;
  imageSource?: string;
  imageAttribution?: string;
  bestWith?: string[];
  cost: Cost;
  transitMinutes: number;
  timeWindow: string;
  mood: string;
  groupSize: string;
  planning: string;
  openNow: boolean;
  note: string;
  tags: string[];
  lat?: number;
  lon?: number;
  distanceMiles?: number;
  sourceUrl?: string;
  website?: string | null;
  openingHours?: string | null;
  schedule?: Schedule | null;
  wheelchair?: "yes" | "limited" | "no" | null;
  dogsAllowed?: boolean | null;
  kidsFriendly?: boolean | null;
  parkingNearby?: boolean | null;
  dataSource?: string;
  updatedAt?: string;
  friendScore?: number;
  wikidataId?: string | null;
  wikipedia?: string | null;
  googleRating?: number;
  googleRatingCount?: number;
  audiences?: Audience[];
};

export type Audience = "kids" | "adults" | "all";

export type FamilyEvent = {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  neighborhood: string;
  lat: number;
  lon: number;
  category: string;
  daysOfWeek: number[];
  timeWindow: "Morning" | "Afternoon" | "Evening";
  startDateTime?: string | null;
  endDateTime?: string | null;
  ageBands: AgeBand[];
  audiences?: Audience[];
  cost: string;
  url: string;
  sourceName?: string;
  sourceMode?: string;
  verified: boolean;
  // Real event photo extracted at ingest when the source provides one
  // (Ticketmaster/Eventbrite-style feeds). Absent = no photo exists —
  // surfaces render a placeholder, never a stock stand-in.
  imageUrl?: string;
  // Stable slug landed in 261ce3b. Drives the SPA `#/event/<slug>` route
  // and the prerendered `/<metro>/events/<slug>/` URL (ADR-04).
  slug?: string;
  // Interest themes assigned at ingest (scripts/eventThemes.mjs). Drives the
  // "Browse by interest" filter; see EVENT_THEMES in eventThemes.ts.
  themes?: string[];
  // ISO instant this event was first seen at ingest, preserved across
  // re-ingests. Drives the "New since your last visit" weekend section
  // (src/newEvents.ts).
  fetchedAt?: string;
};

export type SavedEventDateGroup = {
  key: string;
  label: string;
  sortTime: number;
  events: FamilyEvent[];
};

export type BoaMuseum = {
  id: string;
  name: string;
  city: string;
  neighborhood: string;
  lat: number;
  lon: number;
  url: string;
};

export type BoaDataset = {
  url?: string;
  note?: string;
  museums?: BoaMuseum[];
};

export type EventsDataset = {
  schemaVersion?: number;
  generatedAt?: string;
  note?: string;
  events?: FamilyEvent[];
};

export type SpotDataset = {
  generatedAt?: string;
  source?: {
    name?: string;
    attribution?: string;
    license?: string;
  };
  imageStats?: {
    wikidata?: number;
    tagged?: number;
    fallback?: number;
  };
  count?: number;
  spots?: Spot[];
};

export type NewSpotForm = {
  name: string;
  neighborhood: string;
  category: Category;
  cost: Cost;
  note: string;
};

export type PlanItemRef = { kind: "spot" | "event"; id: string };

export type Plan = {
  id: string;
  name: string;
  stopIds: string[];
  eventIds?: string[];
  // Mixed visit order (newest field). When present, drives the plan/map/poll
  // rendering; otherwise we fall back to "stops in stopIds order, then events
  // in date order" so existing plans keep working.
  itemOrder?: PlanItemRef[];
  createdAt: string;
  pollId?: string;
  ownerToken?: string;
  source?: "manual" | "ai";
  vibe?: PlannerVibe;
  summary?: string;
  rationale?: string[];
  cautions?: string[];
  picks?: Array<{ id: string; reason: string }>;
  aiModel?: string;
  profile?: PlannerProfile;
};

export type PlanItem =
  | { kind: "spot"; id: string; spot: Spot }
  | { kind: "event"; id: string; event: FamilyEvent };

export type FeaturedPlan = {
  id: string;
  name: string;
  summary: string;
  accent?: string;
  stopIds: string[];
  eventIds?: string[];
  audiences?: Audience[];
  city?: string;
  lat?: number | null;
  lon?: number | null;
  generated?: boolean;
  themed?: string;
  themedEnd?: string;
};

export type HeroPick = {
  featured: FeaturedPlan;
  stops: Spot[];
  events: FamilyEvent[];
};
