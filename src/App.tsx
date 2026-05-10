import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Copy,
  ExternalLink,
  List,
  Mail,
  MapPin,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  type ComponentProps,
  FormEvent,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MapSelection, PlanMapItem } from "./MapViews";
import {
  API_CONFIGURED,
  createAiBrief,
  createAiSwap,
  createPoll,
  fetchAdminEvents,
  fetchGeo,
  fetchWeather,
  type WeatherForecast,
  getUserState,
  googleSignIn,
  logoutSession,
  putUserState,
  StopSummary,
  type EventSummary,
  type ItemOrderRef,
} from "./api";
import {
  clearSession,
  loadGoogleIdentity,
  readSession,
  SessionState,
  writeSession,
} from "./auth";
import {
  ageBandLabels,
  defaultPlannerProfile,
  describePlannerMatch,
  normalizePlannerProfile,
  plannerBudgetOptions,
  plannerCrowdOptions,
  plannerPlanLengthOptions,
  plannerPreferenceOptions,
  plannerSettingOptions,
  plannerTransportOptions,
  rankForVibe,
  scoreSpotForVibe,
  type AgeBand,
  type PlannerProfile,
  type PlannerPreferenceId,
  type PlannerScoringOptions,
  type PlannerVibe,
} from "./planner";

type Category =
  | "Outdoors"
  | "Food"
  | "Culture"
  | "Wellness"
  | "Shopping";
type Cost = "Free" | "$" | "$$" | "$$$" | "Unknown";

type ScheduleWindow = { open: number; close: number };
type WeekSchedule = {
  mon: ScheduleWindow[];
  tue: ScheduleWindow[];
  wed: ScheduleWindow[];
  thu: ScheduleWindow[];
  fri: ScheduleWindow[];
  sat: ScheduleWindow[];
  sun: ScheduleWindow[];
};
type Schedule = { is247: true; days: null } | { is247: false; days: WeekSchedule };

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
};

type SavedEventDateGroup = {
  key: string;
  label: string;
  sortTime: number;
  events: FamilyEvent[];
};

type BoaMuseum = {
  id: string;
  name: string;
  city: string;
  neighborhood: string;
  lat: number;
  lon: number;
  url: string;
};

type BoaDataset = {
  url?: string;
  note?: string;
  museums?: BoaMuseum[];
};

type EventsDataset = {
  schemaVersion?: number;
  generatedAt?: string;
  note?: string;
  events?: FamilyEvent[];
};

type SpotDataset = {
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

type NewSpotForm = {
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

type EventDateFilter = "all" | "today" | "tomorrow" | "weekend";

const categories: Category[] = [
  "Outdoors",
  "Food",
  "Culture",
  "Wellness",
  "Shopping",
];

const ageBandOptions = Object.entries(ageBandLabels) as Array<[AgeBand, string]>;

const costs: Cost[] = ["Free", "$", "$$", "$$$", "Unknown"];
const eventDateFilters: Array<{ id: EventDateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "weekend", label: "Weekend" },
];
const vibeOptions = Object.entries(APP_VIBE_LABELS) as Array<
  [PlannerVibe, string]
>;

function vibeBlurb(vibe: PlannerVibe): string {
  return APP_VIBE_BLURBS[vibe];
}

function optionLabel<T extends string>(
  options: Array<{ id: T; label: string }>,
  id: T,
): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// True when an event has a definite start time that is in the past. Recurring
// events without a startDateTime are never "expired" — they keep recurring.
function isEventExpired(event: { startDateTime?: string | null }, now = Date.now()): boolean {
  if (!event.startDateTime) return false;
  const t = new Date(event.startDateTime).getTime();
  return Number.isFinite(t) && t < now - 6 * 60 * 60 * 1000;
}

function dayWindowLabel(days: number[]): string {
  if (!days || days.length === 0) return "Weekly";
  if (days.length === 1) return SHORT_DAY[days[0]] ?? "Weekly";
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => SHORT_DAY[d] ?? "?").join(" / ");
}

function validEventDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function eventDateGroupLabel(event: FamilyEvent): string {
  const date = validEventDate(event.startDateTime);
  if (!date) {
    return `${dayWindowLabel(event.daysOfWeek)} events`;
  }
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function eventTimeLabel(event: FamilyEvent): string | null {
  const start = validEventDate(event.startDateTime);
  if (!start) return null;
  const end = validEventDate(event.endDateTime);
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (
    end &&
    sameLocalDate(start, end) &&
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    end.getTime() - start.getTime() >= 23 * 60 * 60 * 1000
  ) {
    return "All day";
  }
  if (end && sameLocalDate(start, end) && end.getTime() > start.getTime()) {
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }
  return formatter.format(start);
}

function groupSavedEventsByDate(events: FamilyEvent[]): SavedEventDateGroup[] {
  const groups = new Map<string, SavedEventDateGroup>();
  for (const event of events) {
    const date = validEventDate(event.startDateTime);
    const key = date ? isoDate(date) : `recurring-${dayWindowLabel(event.daysOfWeek)}`;
    const sortTime = date
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      : Infinity;
    const group = groups.get(key) ?? {
      key,
      label: eventDateGroupLabel(event),
      sortTime,
      events: [],
    };
    group.events.push(event);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort(
    (left, right) => left.sortTime - right.sortTime || left.label.localeCompare(right.label),
  );
}

function weatherTone(label: string): "wet" | "dry" | "mixed" {
  const wet = ["Rainy", "Drizzly", "Stormy", "Showers", "Snowy"];
  const dry = ["Clear", "Mostly sunny"];
  if (wet.includes(label)) return "wet";
  if (dry.includes(label)) return "dry";
  return "mixed";
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function nextDayOfWeek(target: number, from: Date = new Date()): Date {
  const offset = (target - from.getDay() + 7) % 7 || 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
}

function thisOrNextDayOfWeek(target: number, from: Date = new Date()): Date {
  const offset = (target - from.getDay() + 7) % 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function nextBoaWeekend(now: Date = new Date()): { saturday: Date; sunday: Date } {
  let year = now.getFullYear();
  let month = now.getMonth();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const firstOfMonth = new Date(year, month, 1);
    const offset = (6 - firstOfMonth.getDay() + 7) % 7;
    const saturday = new Date(year, month, 1 + offset);
    const sunday = new Date(year, month, 2 + offset);
    if (sunday.getMonth() === month) {
      const sundayEnd = new Date(year, month, 2 + offset, 23, 59, 59);
      if (sundayEnd >= now) {
        return { saturday, sunday };
      }
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  const fallback = new Date(year, month, 1);
  return { saturday: fallback, sunday: fallback };
}

function formatWeekendRange(saturday: Date, sunday: Date): string {
  const monthName = saturday.toLocaleDateString("en-US", { month: "short" });
  if (saturday.getMonth() === sunday.getMonth()) {
    return `${monthName} ${saturday.getDate()}–${sunday.getDate()}`;
  }
  const sundayMonth = sunday.toLocaleDateString("en-US", { month: "short" });
  return `${monthName} ${saturday.getDate()} – ${sundayMonth} ${sunday.getDate()}`;
}

function eventWhenLabel(event: FamilyEvent): string {
  if (!event.startDateTime) {
    return `${dayWindowLabel(event.daysOfWeek)} · ${event.timeWindow}`;
  }
  const date = new Date(event.startDateTime);
  if (Number.isNaN(date.getTime())) {
    return `${dayWindowLabel(event.daysOfWeek)} · ${event.timeWindow}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function eventCategoryToSpotCategory(category: string): Category {
  if (/\b(library|museum|ticketed)\b/i.test(category)) return "Culture";
  if (/\b(park|farm|zoo|garden|nature)\b/i.test(category)) return "Outdoors";
  return "Culture";
}

function eventCostToSpotCost(cost: string): Cost {
  if (cost === "Free" || cost === "$" || cost === "$$" || cost === "$$$") {
    return cost;
  }
  if (/free/i.test(cost)) return "Free";
  if (/\$\$\$/.test(cost)) return "$$$";
  if (/\$\$/.test(cost)) return "$$";
  if (/\$/.test(cost)) return "$";
  return "Unknown";
}

function isActualPlanningEvent(
  event: FamilyEvent,
  now: Date,
  selectedAgeBand: AgeBand | "any",
): boolean {
  if (!event.verified || event.sourceMode === "recurring-template") return false;
  if (!event.startDateTime) return false;
  const start = new Date(event.startDateTime);
  if (Number.isNaN(start.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000);
  if (start < today || start > horizon) return false;
  const day = start.getDay();
  if (day !== 0 && day !== 6) return false;
  if (selectedAgeBand !== "any" && !event.ageBands.includes(selectedAgeBand)) {
    return false;
  }
  return true;
}

function eventToPlanningSpot(event: FamilyEvent, transitMinutes: number): Spot {
  const when = eventWhenLabel(event);
  const category = eventCategoryToSpotCategory(event.category);
  const ageText = event.ageBands.map((band) => ageBandLabels[band]).join(", ");
  return {
    id: `event-${event.id}`,
    name: event.title,
    neighborhood: `${event.venue}, ${event.city}`,
    category,
    imageUrl: pickCategoryImage(category, event.id),
    cost: eventCostToSpotCost(event.cost),
    transitMinutes,
    timeWindow: event.timeWindow,
    mood: `Scheduled family event: ${when}`,
    groupSize: "Family",
    planning: `${when}. Confirm details with ${event.sourceName || "the venue"}.`,
    openNow: false,
    note: `${event.description}${ageText ? ` Ages: ${ageText}.` : ""}`,
    tags: [
      "event",
      "scheduled",
      "family",
      event.category.toLowerCase(),
      ...event.ageBands,
    ],
    lat: event.lat,
    lon: event.lon,
    sourceUrl: event.url,
    website: event.url,
    kidsFriendly: true,
    dataSource: "family-event",
    friendScore: event.verified ? 96 : 82,
  };
}

// Shared cross-app data origin. When VITE_DATA_ORIGIN is set (production),
// fetch from the standalone famhop-data Pages project so the data feed and
// the kids app deploy independently. When unset (local dev), fall back to
// same-origin so `npm run dev` works without an external dependency.
const DATA_ORIGIN = (import.meta.env.VITE_DATA_ORIGIN ?? "").replace(/\/$/, "");
const dataUrl = (file: string) =>
  DATA_ORIGIN
    ? `${DATA_ORIGIN}/data/${file}`
    : `${import.meta.env.BASE_URL}data/${file}`;
const DATA_URL = dataUrl("bay-area-spots.json");
const ENRICHMENT_URL = dataUrl("bay-area-enrichment.json");
const FEATURED_PLANS_URL = dataUrl("featured-plans.json");
const EVENTS_URL = dataUrl("events.json");
const BOA_MUSEUMS_URL = dataUrl("boa-museums.json");
const CURATED_SPOTS_URL = dataUrl("curated-spots.json");

import {
  APP_AUDIENCE,
  APP_BRAND,
  APP_HERO_SUB,
  APP_HERO_TITLE,
  APP_PARTNERS_LABEL,
  APP_TAGLINE,
  APP_VIBE_BLURBS,
  APP_VIBE_LABELS,
  SHOW_AGE_BAND_UI,
  audienceVisible,
} from "./appConfig";

void APP_AUDIENCE; // surface APP_AUDIENCE for downstream debugging if needed
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CONFIGURED = GOOGLE_CLIENT_ID.length > 0;

const unsplash = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

const categoryImagePool: Record<Category, string[]> = {
  Food: [
    "1495474472287-4d71bcdd2085",
    "1555396273-367ea4eb4db5",
    "1517248135467-4c7edcad34c4",
    "1481833761820-0509d3217039",
    "1414235077428-338989a2e8c0",
    "1424847651672-bf20a4b0982b",
    "1610890716171-6b1bb98ffd09",
    "1504674900247-0877df9cc836",
    "1565299624946-b28f40a0ae38",
    "1559339352-11d035aa65de",
  ].map(unsplash),
  Outdoors: [
    "1500530855697-b586d89ba3ee",
    "1469474968028-56623f02e42e",
    "1501785888041-af3ef285b470",
    "1502082553048-f009c37129b9",
    "1464822759023-fed622ff2c3b",
    "1473773508845-188df298d2d1",
    "1441974231531-c6227db76b6e",
    "1506905925346-21bda4d32df4",
    "1418065460487-3e41a6c84dc5",
  ].map(unsplash),
  Culture: [
    "1518998053901-5348d3961a04",
    "1554907984-15263bfd63bd",
    "1564399579883-451a5d44ec08",
    "1583847268964-b28dc8f51f92",
    "1485738422979-f5c462d49f74",
    "1503095396549-807759245b35",
  ].map(unsplash),
  Wellness: [
    "1626224583764-f87db24ac4ea",
    "1518611012118-696072aa579a",
    "1571902943202-507ec2618e8f",
    "1599901860904-17e6ed7083a0",
    "1545205597-3d9d02c29597",
    "1571388208497-71bedc66e932",
    "1506629082955-511b1aa562c8",
    "1518609878373-06d740f60d8b",
  ].map(unsplash),
  Shopping: [
    "1441986300917-64674bd600d8",
    "1481437156560-3205f6a55735",
    "1555529669-e69e7aa0ba9a",
    "1567401893414-76b7b1e5a7a5",
    "1549298916-b41d501d3772",
    "1483985988355-763728e1935b",
    "1472851294608-062f824d29cc",
    "1555529771-7888783a18d3",
  ].map(unsplash),
};

function pickCategoryImage(category: Category, key: string): string {
  const pool = categoryImagePool[category];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

const DAY_KEYS: Array<keyof WeekSchedule> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatRatingCount(count: number): string {
  if (count >= 1000) {
    const k = count / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(count);
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// "9:30 AM" → "9:30am", "9:00 AM" → "9am", "12:00 PM" → "noon"
function normalizeClock(token: string): string {
  const m = token.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return token.trim();
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3].toLowerCase();
  if (hour === 12 && minute === 0) return ampm === "pm" ? "noon" : "midnight";
  const h = hour % 12 === 0 ? 12 : hour;
  return minute === 0 ? `${h}${ampm}` : `${h}:${m[2]}${ampm}`;
}

function normalizeHourSpan(span: string): string {
  // Some venues post split sessions ("11:30 AM – 2:30 PM, 4:30 – 8:00 PM").
  // Normalize each range independently, then rejoin.
  return span
    .split(/\s*,\s*/)
    .map((segment) => {
      const parts = segment.split(/\s*[–-]\s*| to /);
      if (parts.length !== 2) return segment.trim();
      return `${normalizeClock(parts[0])}–${normalizeClock(parts[1])}`;
    })
    .join(", ");
}

// "Monday: 9:30 AM – 6:00 PM; Tuesday: ... ; Sunday: ..." → "Daily 9:30am–6pm"
// or "Mon–Fri 9am–5pm · Sat–Sun 10am–4pm". Returns null if input doesn't look
// like the verbose Google weekdayDescriptions format.
function compactHoursLabel(raw: string): string | null {
  if (!raw || !raw.includes(":") || !raw.includes(";")) return null;
  const segments = raw.split(/\s*;\s*/);
  if (segments.length !== 7) return null;
  const byDay = new Array<string>(7).fill("");
  for (const segment of segments) {
    const sep = segment.indexOf(":");
    if (sep < 0) return null;
    const day = segment.slice(0, sep).trim().toLowerCase();
    const hours = segment.slice(sep + 1).trim();
    const idx = DAY_INDEX[day];
    if (idx === undefined || !hours) return null;
    byDay[idx] = /closed/i.test(hours) ? "Closed" : normalizeHourSpan(hours);
  }
  // Reorder Mon–Sun for natural reading.
  const ordered = [1, 2, 3, 4, 5, 6, 0].map((i) => ({
    day: SHORT_DAYS[i],
    hours: byDay[i],
  }));
  // Group consecutive days with identical hours.
  const groups: Array<{ start: string; end: string; hours: string; span: number }> = [];
  for (const entry of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.hours === entry.hours) {
      last.end = entry.day;
      last.span += 1;
    } else {
      groups.push({ start: entry.day, end: entry.day, hours: entry.hours, span: 1 });
    }
  }
  if (groups.length === 1 && groups[0].span === 7) {
    return `Daily ${groups[0].hours}`;
  }
  return groups
    .map((g) => {
      const range = g.start === g.end ? g.start : `${g.start}–${g.end}`;
      return `${range} ${g.hours}`;
    })
    .join(" · ");
}

function formatMinutes(mins: number): string {
  const total = mins % 1440;
  if (total === 0) return "midnight";
  if (total === 720) return "noon";
  let h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h}${suffix}` : `${h}:${String(m).padStart(2, "0")}${suffix}`;
}

type OpenStatus =
  | { kind: "open"; closesAt: number; nextDayIdx?: number }
  | { kind: "closed"; nextOpenAt?: number; nextOpenDayIdx?: number }
  | { kind: "always" }
  | { kind: "unknown" };

function describeStatus(spot: Spot, now: Date = new Date()): OpenStatus {
  const schedule = spot.schedule;
  if (!schedule) return { kind: "unknown" };
  if (schedule.is247) return { kind: "always" };

  const days = schedule.days;
  const dayIdx = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const todayKey = DAY_KEYS[dayIdx];
  const todaySlots = days[todayKey];

  for (const slot of todaySlots) {
    if (minutes >= slot.open && minutes < slot.close) {
      return { kind: "open", closesAt: slot.close };
    }
  }

  // Find next opening within the next 7 days.
  for (let offset = 0; offset < 7; offset += 1) {
    const lookIdx = (dayIdx + offset) % 7;
    const slots = days[DAY_KEYS[lookIdx]];
    for (const slot of slots) {
      if (offset === 0 && slot.open <= minutes) continue;
      return { kind: "closed", nextOpenAt: slot.open, nextOpenDayIdx: lookIdx };
    }
  }
  return { kind: "closed" };
}

function statusLabel(status: OpenStatus, now: Date = new Date()): string {
  if (status.kind === "always") return "Open 24/7";
  if (status.kind === "open") {
    return `Open · until ${formatMinutes(status.closesAt)}`;
  }
  if (status.kind === "closed") {
    if (status.nextOpenAt === undefined || status.nextOpenDayIdx === undefined) {
      return "Closed";
    }
    const sameDay = status.nextOpenDayIdx === now.getDay();
    const dayLabel = sameDay ? "" : ` ${DAY_NAMES[status.nextOpenDayIdx]}`;
    return `Closed · opens ${formatMinutes(status.nextOpenAt)}${dayLabel}`;
  }
  return "Hours unknown";
}

const starterSpots: Spot[] = [
  {
    id: "market-hall",
    name: "Market Hall Crawl",
    neighborhood: "Downtown",
    category: "Food",
    imageUrl:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
    bestWith: ["friends", "family", "date"],
    cost: "$$",
    transitMinutes: 18,
    timeWindow: "Lunch",
    mood: "Lots of choices",
    groupSize: "3-8 people",
    planning: "Walk-in",
    openNow: true,
    note: "Good when nobody can agree on one restaurant. Grab small plates, split snacks, and keep moving.",
    tags: ["food", "group", "indoor", "shareable"],
  },
  {
    id: "board-game-cafe",
    name: "Board Game Cafe",
    neighborhood: "Northside",
    category: "Food",
    imageUrl:
      "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?auto=format&fit=crop&w=1200&q=80",
    bestWith: ["friends", "date", "family"],
    cost: "$",
    transitMinutes: 11,
    timeWindow: "Afternoon",
    mood: "Easy hangout",
    groupSize: "2-6 people",
    planning: "Reserve",
    openNow: true,
    note: "Low-pressure table time for a mixed group. Works especially well when weather is bad.",
    tags: ["games", "coffee", "indoor", "tables"],
  },
  {
    id: "pickleball-courts",
    name: "Pickleball Courts",
    neighborhood: "Civic Park",
    category: "Wellness",
    imageUrl:
      "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=1200&q=80",
    bestWith: ["friends"],
    cost: "Free",
    transitMinutes: 14,
    timeWindow: "Morning",
    mood: "Light competition",
    groupSize: "4 people",
    planning: "Check courts",
    openNow: true,
    note: "Fast to start, easy to rotate, and active without turning the whole day into a workout.",
    tags: ["active", "outside", "free", "sports"],
  },
  {
    id: "sunset-picnic",
    name: "Sunset Picnic Lawn",
    neighborhood: "Waterfront",
    category: "Outdoors",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    bestWith: ["friends", "date", "family", "dog"],
    cost: "Free",
    transitMinutes: 12,
    timeWindow: "Sunset",
    mood: "Low effort",
    groupSize: "2-12 people",
    planning: "Bring snacks",
    openNow: true,
    note: "Easy default when the group wants outside time without tickets, reservations, or a fixed schedule.",
    tags: ["picnic", "views", "outside", "free"],
  },
  {
    id: "gallery-taco-loop",
    name: "Gallery + Taco Loop",
    neighborhood: "Arts District",
    category: "Culture",
    imageUrl:
      "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=1200&q=80",
    bestWith: ["friends", "date"],
    cost: "$",
    transitMinutes: 21,
    timeWindow: "Afternoon",
    mood: "Wander and snack",
    groupSize: "2-5 people",
    planning: "Flexible",
    openNow: false,
    note: "A compact route with small galleries, murals, and taco stops close enough to split up and regroup.",
    tags: ["art", "food", "walkable", "casual"],
  },
  {
    id: "record-cafe",
    name: "Record Cafe",
    neighborhood: "Northside",
    category: "Food",
    imageUrl:
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80",
    bestWith: ["friends", "solo", "date"],
    cost: "$",
    transitMinutes: 9,
    timeWindow: "Morning",
    mood: "Coffee and browsing",
    groupSize: "2-4 people",
    planning: "Walk-in",
    openNow: true,
    note: "A compact coffee stop with records, pastries, and enough browsing to fill a slow morning.",
    tags: ["coffee", "music", "nearby", "low key"],
  },
  {
    id: "library-storytime",
    name: "Library Storytime",
    neighborhood: "Downtown",
    category: "Culture",
    imageUrl:
      "https://images.unsplash.com/photo-1485738422979-f5c462d49f74?auto=format&fit=crop&w=1200&q=80",
    cost: "Free",
    transitMinutes: 10,
    timeWindow: "Morning",
    mood: "Quiet morning",
    groupSize: "1 adult + kids",
    planning: "Walk-in",
    openNow: true,
    note: "Free story session for toddlers and preschoolers. Pair with a stroller-friendly walk afterward.",
    tags: ["library", "free", "toddler", "indoor"],
    kidsFriendly: true,
  },
];

const emptyNewSpot: NewSpotForm = {
  name: "",
  neighborhood: "",
  category: "Outdoors",
  cost: "$",
  note: "",
};

const costRank: Record<Cost, number> = {
  Free: 0,
  $: 1,
  $$: 2,
  $$$: 3,
  Unknown: 4,
};

const pageSizeOptions = [24, 48, 96];

// Map components are bundled in a separate chunk (Leaflet + leaflet.css) and
// loaded only when the user navigates to a view that renders a map.
const LazySpotMap = lazy(() =>
  import("./MapViews").then((m) => ({ default: m.SpotMap })),
);
const LazyPlanMap = lazy(() =>
  import("./MapViews").then((m) => ({ default: m.PlanMap })),
);

function SpotMap(props: ComponentProps<typeof LazySpotMap>) {
  return (
    <Suspense
      fallback={
        <div
          className="map-canvas map-canvas-fill"
          aria-busy="true"
          aria-label="Loading map"
        />
      }
    >
      <LazySpotMap {...props} />
    </Suspense>
  );
}

function PlanMap(props: ComponentProps<typeof LazyPlanMap>) {
  return (
    <Suspense fallback={null}>
      <LazyPlanMap {...props} />
    </Suspense>
  );
}

type FeaturedPlan = {
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
};

type AppRoute = {
  view: "home" | "browse" | "plans";
  planId: string | null;
};

function readAppRoute(): AppRoute {
  if (typeof window === "undefined") {
    return { view: "browse", planId: null };
  }
  const hash = window.location.hash;
  if (hash.startsWith("#/p/")) {
    // Poll route — main.tsx handles rendering. App still mounts when the user
    // navigates back, so default to browse.
    return { view: "browse", planId: null };
  }
  const planMatch = hash.match(/^#\/plans\/(.+)$/);
  if (planMatch) {
    return { view: "plans", planId: decodeURIComponent(planMatch[1]) };
  }
  if (hash === "#/plans") return { view: "plans", planId: null };
  if (hash === "#/browse" || hash === "" || hash === "#/" || hash === "#") {
    return { view: "browse", planId: null };
  }
  return { view: "browse", planId: null };
}

function buildAppHash(view: AppRoute["view"], planId: string | null): string {
  if (view === "plans") {
    return planId ? `#/plans/${encodeURIComponent(planId)}` : "#/plans";
  }
  if (view === "browse") return "#/browse";
  return "#/";
}

function readStoredArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function formatGeneratedAt(value?: string) {
  if (!value) {
    return "Fallback data";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function interleaveByCategory(spots: Spot[]) {
  const buckets = new Map<Category, Spot[]>();
  for (const item of categories) {
    buckets.set(item, []);
  }

  for (const spot of spots) {
    buckets.get(spot.category)?.push(spot);
  }

  const result: Spot[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const item of categories) {
      const next = buckets.get(item)?.shift();
      if (next) {
        result.push(next);
        added = true;
      }
    }
  }

  return result;
}

function App() {
  const [query, setQuery] = useState("");
  const [ageBand, setAgeBand] = useState<AgeBand | "any">("any");
  const [vibe, setVibe] = useState<PlannerVibe>("balanced");
  const [category, setCategory] = useState<Category | "All">("All");
  const [city, setCity] = useState("All");
  const [cost, setCost] = useState<Cost | "All">("All");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [eventDateFilter, setEventDateFilter] = useState<EventDateFilter>("all");
  const [sortBy, setSortBy] = useState<"best" | "nearest" | "price" | "name">(
    "best",
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [savedIds, setSavedIds] = useState<string[]>(() =>
    readStoredArray("saturday.savedSpots", []),
  );
  const [savedEventIds, setSavedEventIds] = useState<string[]>(() =>
    readStoredArray("saturday.savedEvents", []),
  );
  const [visitedIds, setVisitedIds] = useState<string[]>(() =>
    readStoredArray("saturday.visitedSpots", []),
  );
  const [customSpots, setCustomSpots] = useState<Spot[]>(() =>
    readStoredArray("saturday.customSpots", []),
  );
  const [plans, setPlans] = useState<Plan[]>(() =>
    readStoredArray("saturday.plans", []),
  );
  const initialRoute = readAppRoute();
  const [view, setView] = useState<"home" | "browse" | "plans">(
    initialRoute.view,
  );
  const [inferredGeo, setInferredGeo] = useState<{ city: string | null; lat: number | null; lon: number | null } | null>(null);
  const [homeBusy, setHomeBusy] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(
    initialRoute.planId,
  );
  const [addStopChoice, setAddStopChoice] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(() => {
    try {
      const raw = window.localStorage.getItem("saturday.userLocation");
      return raw ? (JSON.parse(raw) as { lat: number; lon: number }) : null;
    } catch {
      return null;
    }
  });
  const [geoState, setGeoState] = useState<"idle" | "requesting" | "denied">("idle");
  const [geoErrorReason, setGeoErrorReason] = useState<
    "denied" | "unavailable" | "timeout" | "unsupported" | null
  >(null);
  const [shareState, setShareState] = useState<{
    status: "idle" | "sharing" | "shared" | "error";
    url?: string;
    error?: string;
  }>({ status: "idle" });
  const [aiState, setAiState] = useState<{
    status: "idle" | "loading" | "error";
    error?: string;
  }>({ status: "idle" });
  const [session, setSession] = useState<SessionState | null>(() => readSession());
  const [signInError, setSignInError] = useState<string | null>(null);
  const signInButtonRef = useRef<HTMLDivElement | null>(null);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "loading" | "syncing" | "synced" | "error"
  >("idle");
  const [remoteSpots, setRemoteSpots] = useState<Spot[]>(starterSpots);
  const [curatedSpots, setCuratedSpots] = useState<Spot[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);
  // Track the map's current center so the featured-plans rail can re-rank
  // city plans by distance from whatever the user is browsing. Default to
  // null until the map fires its first moveend / fit-to-bounds callback.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(
    null,
  );

  const [featuredPlans, setFeaturedPlans] = useState<FeaturedPlan[]>([]);
  const [boaMuseums, setBoaMuseums] = useState<BoaMuseum[]>([]);
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [preferences, setPreferences] = useState<PlannerPreferenceId[]>(() => {
    try {
      const raw = window.localStorage.getItem("saturday.preferences");
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      const valid = new Set(plannerPreferenceOptions.map((option) => option.id));
      return parsed.filter((id): id is PlannerPreferenceId =>
        valid.has(id as PlannerPreferenceId),
      );
    } catch {
      return [];
    }
  });
  const [plannerProfile, setPlannerProfile] = useState<PlannerProfile>(() => {
    try {
      const raw = window.localStorage.getItem("saturday.plannerProfile");
      return normalizePlannerProfile(raw ? JSON.parse(raw) : null);
    } catch {
      return defaultPlannerProfile;
    }
  });
  const [targetDate, setTargetDate] = useState<string>(() => {
    const d = new Date();
    const offset = (6 - d.getDay() + 7) % 7 || 7;
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  });
  const [dataMeta, setDataMeta] = useState<{
    generatedAt?: string;
    sourceName: string;
    count: number;
    loading: boolean;
    error?: string;
    imageStats?: SpotDataset["imageStats"];
  }>({
    sourceName: "Curated fallback",
    count: starterSpots.length,
    loading: true,
  });
  const [isAdding, setIsAdding] = useState(false);
  const [newSpot, setNewSpot] = useState<NewSpotForm>(emptyNewSpot);

  useEffect(() => {
    let active = true;

    const datasetPromise = fetch(DATA_URL).then((response) => {
      if (!response.ok) {
        throw new Error(`Data request failed: ${response.status}`);
      }
      return response.json() as Promise<SpotDataset>;
    });
    // Sidecar is optional; produced by `npm run match:places:osm`.
    const enrichmentPromise = fetch(ENRICHMENT_URL)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              entries?: Record<string, Partial<Spot>>;
            }>)
          : null,
      )
      .catch(() => null);

    Promise.all([datasetPromise, enrichmentPromise])
      .then(([dataset, enrichment]) => {
        if (!active) {
          return;
        }

        if (!Array.isArray(dataset.spots) || dataset.spots.length === 0) {
          throw new Error("Data file does not contain spots.");
        }

        const enrichmentEntries = enrichment?.entries ?? {};
        const merged = dataset.spots
          .filter(audienceVisible)
          .map((spot) => {
            const extra = enrichmentEntries[spot.id];
            return extra ? { ...spot, ...extra } : spot;
          });
        setRemoteSpots(merged);
        setDataMeta({
          generatedAt: dataset.generatedAt,
          sourceName: dataset.source?.name || "Generated Bay Area data",
          count: dataset.count || dataset.spots.length,
          loading: false,
          imageStats: dataset.imageStats,
        });
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setDataMeta({
          sourceName: "Curated fallback",
          count: starterSpots.length,
          loading: false,
          error: error.message,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const adminPayload = await fetchAdminEvents();
      if (!active) return;
      if (adminPayload && adminPayload.events.length > 0) {
        setEvents(
          (adminPayload.events as FamilyEvent[]).filter(audienceVisible),
        );
        return;
      }
      try {
        const response = await fetch(EVENTS_URL);
        if (!response.ok) return;
        const dataset = (await response.json()) as EventsDataset;
        if (!active) return;
        if (Array.isArray(dataset.events)) {
          setEvents(dataset.events.filter(audienceVisible));
        }
      } catch {
        // Events are optional; failure is non-fatal.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "saturday.preferences",
      JSON.stringify(preferences),
    );
  }, [preferences]);

  useEffect(() => {
    window.localStorage.setItem(
      "saturday.plannerProfile",
      JSON.stringify(plannerProfile),
    );
  }, [plannerProfile]);

  useEffect(() => {
    const lat = userLocation?.lat ?? inferredGeo?.lat;
    const lon = userLocation?.lon ?? inferredGeo?.lon;
    if (!lat || !lon) return;
    let active = true;
    fetchWeather(lat, lon).then((forecast) => {
      if (!active) return;
      if (forecast) setWeather(forecast);
    });
    return () => {
      active = false;
    };
  }, [inferredGeo, userLocation]);

  useEffect(() => {
    let active = true;
    fetch(CURATED_SPOTS_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((dataset: { spots?: Spot[] }) => {
        if (!active) return;
        if (Array.isArray(dataset.spots)) {
          setCuratedSpots(
            dataset.spots.map((s) => ({
              ...s,
              imageUrl:
                s.imageUrl ||
                pickCategoryImage(s.category as Category, s.id),
              friendScore: s.friendScore ?? 80,
              tags: s.tags ?? [],
              note: s.note ?? "",
            })),
          );
        }
      })
      .catch(() => {
        // Curated list is optional.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(FEATURED_PLANS_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((dataset: { plans?: FeaturedPlan[] }) => {
        if (!active) return;
        if (Array.isArray(dataset.plans)) {
          setFeaturedPlans(dataset.plans.filter(audienceVisible));
        }
      })
      .catch(() => {
        // Featured plans are optional.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(BOA_MUSEUMS_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((dataset: BoaDataset) => {
        if (!active) return;
        if (Array.isArray(dataset.museums)) setBoaMuseums(dataset.museums);
      })
      .catch(() => {
        // Optional: failure is non-fatal.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("saturday.savedSpots", JSON.stringify(savedIds));
  }, [savedIds]);

  // URL routing: keep window.location.hash in sync with view + activePlanId.
  // pushState (no hashchange fired) when state changes; popstate listener
  // handles back/forward navigation.
  useEffect(() => {
    if (window.location.hash.startsWith("#/p/")) return; // poll page
    const target = buildAppHash(view, activePlanId);
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
  }, [view, activePlanId]);

  useEffect(() => {
    function onPop() {
      if (window.location.hash.startsWith("#/p/")) return;
      const route = readAppRoute();
      setView(route.view);
      setActivePlanId(route.planId);
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "saturday.savedEvents",
      JSON.stringify(savedEventIds),
    );
  }, [savedEventIds]);

  useEffect(() => {
    window.localStorage.setItem(
      "saturday.visitedSpots",
      JSON.stringify(visitedIds),
    );
  }, [visitedIds]);

  useEffect(() => {
    window.localStorage.setItem(
      "saturday.customSpots",
      JSON.stringify(customSpots),
    );
  }, [customSpots]);

  useEffect(() => {
    window.localStorage.setItem("saturday.plans", JSON.stringify(plans));
  }, [plans]);

  useEffect(() => {
    setShareState({ status: "idle" });
  }, [activePlanId]);

  useEffect(() => {
    let cancelled = false;
    fetchGeo().then((geo) => {
      if (cancelled || !geo) return;
      setInferredGeo({ city: geo.city, lat: geo.lat, lon: geo.lon });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session || !API_CONFIGURED) {
      setSyncReady(false);
      setSyncStatus("idle");
      return;
    }
    let cancelled = false;
    setSyncStatus("loading");
    getUserState(session.token)
      .then((serverState) => {
        if (cancelled) return;
        if (serverState) {
          const incomingSaved: string[] = Array.isArray(serverState.savedIds)
            ? (serverState.savedIds as string[])
            : [];
          const incomingSavedEvents: string[] = Array.isArray(
            serverState.savedEventIds,
          )
            ? (serverState.savedEventIds as string[])
            : [];
          const incomingVisited: string[] = Array.isArray(serverState.visitedIds)
            ? (serverState.visitedIds as string[])
            : [];
          const incomingCustom = (Array.isArray(serverState.customSpots)
            ? serverState.customSpots
            : []) as Spot[];
          const incomingPlans = (Array.isArray(serverState.plans)
            ? serverState.plans
            : []) as Plan[];
          setSavedIds((local) =>
            Array.from(new Set<string>([...incomingSaved, ...local])),
          );
          setSavedEventIds((local) =>
            Array.from(new Set<string>([...incomingSavedEvents, ...local])),
          );
          setVisitedIds((local) =>
            Array.from(new Set<string>([...incomingVisited, ...local])),
          );
          setCustomSpots((local) => {
            const map = new Map<string, Spot>();
            for (const item of local) map.set(item.id, item);
            for (const item of incomingCustom) map.set(item.id, item);
            return Array.from(map.values());
          });
          setPlans((local) => {
            const map = new Map<string, Plan>();
            for (const item of local) map.set(item.id, item);
            for (const item of incomingPlans) map.set(item.id, item);
            return Array.from(map.values());
          });
        }
        setSyncReady(true);
        setSyncStatus("synced");
      })
      .catch(() => {
        if (cancelled) return;
        setSyncReady(true);
        setSyncStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [session?.token]);

  useEffect(() => {
    if (!session || !syncReady) return;
    const handle = window.setTimeout(() => {
      setSyncStatus("syncing");
      putUserState(session.token, {
        savedIds,
        savedEventIds,
        visitedIds,
        customSpots,
        plans,
      })
        .then(() => setSyncStatus("synced"))
        .catch(() => setSyncStatus("error"));
    }, 800);
    return () => window.clearTimeout(handle);
  }, [
    session,
    syncReady,
    savedIds,
    savedEventIds,
    visitedIds,
    customSpots,
    plans,
  ]);

  useEffect(() => {
    if (session || !GOOGLE_CONFIGURED) {
      return;
    }
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: { credential: string }) => {
            try {
              const result = await googleSignIn(response.credential);
              const next: SessionState = {
                token: result.sessionToken,
                user: result.user,
              };
              writeSession(next);
              setSession(next);
              setSignInError(null);
            } catch (error) {
              setSignInError((error as Error).message);
            }
          },
          // Keep the user on the page during sign-in. Without this, GIS can
          // fall back to a full-page redirect on small/mobile screens (iOS
          // Chrome in particular) and the redirect-back is unreliable.
          ux_mode: "popup",
          // Use FedCM where the browser supports it — it's the modern,
          // first-party flow that works without third-party cookies.
          use_fedcm_for_button: true,
          use_fedcm_for_prompt: true,
          // ITP / cross-site tracking protection compatibility for Safari
          // and iOS browsers.
          itp_support: true,
          auto_select: false,
          cancel_on_tap_outside: false,
        });
        if (signInButtonRef.current) {
          signInButtonRef.current.innerHTML = "";
          // Compact icon variant — fits in the top-right corner on mobile and
          // stays subtle on desktop. Tapping the Google "G" still triggers the
          // standard credential flow.
          window.google.accounts.id.renderButton(signInButtonRef.current, {
            theme: "outline",
            size: "medium",
            type: "icon",
            shape: "circle",
          });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setSignInError(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  function signOut() {
    if (session) {
      logoutSession(session.token);
    }
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    clearSession();
    setSession(null);
    // Wipe per-user data so the browser becomes a fresh guest after sign-out.
    // The next sign-in will rehydrate from the server.
    setSavedIds([]);
    setSavedEventIds([]);
    setVisitedIds([]);
    setCustomSpots([]);
    setPlans([]);
    setActivePlanId(null);
    setPreferences([]);
    for (const key of [
      "saturday.savedSpots",
      "saturday.savedEvents",
      "saturday.visitedSpots",
      "saturday.customSpots",
      "saturday.plans",
      "saturday.preferences",
    ]) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore quota / privacy errors
      }
    }
  }

  useEffect(() => {
    setAiState({ status: "idle" });
  }, [
    category,
    city,
    ageBand,
    cost,
    onlyOpen,
    plannerProfile,
    preferences,
    query,
    savedIds,
    targetDate,
    vibe,
  ]);

  useEffect(() => {
    setPage(1);
  }, [category, city, ageBand, cost, onlyOpen, pageSize, query, sortBy, vibe]);

  const allSpots = useMemo(
    () => [...remoteSpots, ...curatedSpots, ...customSpots],
    [customSpots, curatedSpots, remoteSpots],
  );

  const targetDateObj = useMemo(() => parseIsoDate(targetDate), [targetDate]);
  const targetDayOfWeek = targetDateObj.getDay();
  const plannerAnchor = useMemo(() => {
    if (userLocation) return userLocation;
    if (inferredGeo?.lat && inferredGeo?.lon) {
      return { lat: inferredGeo.lat, lon: inferredGeo.lon };
    }
    return null;
  }, [inferredGeo, userLocation]);
  const plannerWeather = useMemo(() => {
    const forecast =
      targetDayOfWeek === 6
        ? weather?.saturday
        : targetDayOfWeek === 0
          ? weather?.sunday
          : null;
    return forecast ? weatherTone(forecast.label) : undefined;
  }, [targetDayOfWeek, weather]);
  const scoringOptions = useMemo<PlannerScoringOptions>(
    () => ({
      ageBand: ageBand === "any" ? undefined : ageBand,
      preferences,
      profile: plannerProfile,
      weather: plannerWeather,
    }),
    [ageBand, plannerProfile, plannerWeather, preferences],
  );
  const plannerProfileSummary = useMemo(
    () =>
      [
        optionLabel(plannerPlanLengthOptions, plannerProfile.planLength),
        optionLabel(plannerBudgetOptions, plannerProfile.budget),
        optionLabel(plannerTransportOptions, plannerProfile.transportMode),
        optionLabel(plannerCrowdOptions, plannerProfile.crowdTolerance),
        optionLabel(plannerSettingOptions, plannerProfile.setting),
      ].join(" · "),
    [plannerProfile],
  );

  const boaWeekend = useMemo(() => nextBoaWeekend(new Date()), []);
  const boaIsThisWeekend = useMemo(() => {
    const now = new Date();
    const sundayEnd = new Date(boaWeekend.sunday);
    sundayEnd.setHours(23, 59, 59, 999);
    const saturdayStart = new Date(boaWeekend.saturday);
    saturdayStart.setHours(0, 0, 0, 0);
    return saturdayStart <= now
      ? now <= sundayEnd
      : (saturdayStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 7;
  }, [boaWeekend]);

  const boaActivitySpots = useMemo<Spot[]>(() => {
    const weekendLabel = formatWeekendRange(boaWeekend.saturday, boaWeekend.sunday);
    return boaMuseums.map((museum) => ({
      id: museum.id,
      name: museum.name,
      neighborhood: `${museum.neighborhood}, ${museum.city}`,
      category: "Culture",
      imageUrl: pickCategoryImage("Culture", museum.id),
      cost: boaIsThisWeekend ? "Free" : "$$",
      transitMinutes: 25,
      timeWindow: "Afternoon",
      mood: boaIsThisWeekend
        ? `BoA Museums on Us option for ${weekendLabel}`
        : "Museum day option for a culture-focused plan",
      groupSize: "Family",
      planning: boaIsThisWeekend
        ? "Bring a BoA or Merrill card plus photo ID; confirm exclusions."
        : "Check admission, hours, and exhibit fit before going.",
      openNow: false,
      note: boaIsThisWeekend
        ? "Cardholders may get free general admission during Museums on Us weekend."
        : "Museums on Us partner; useful as a future free-weekend candidate.",
      tags: ["museum", "culture", "indoor", "family", "boa", "free"],
      lat: museum.lat,
      lon: museum.lon,
      sourceUrl: "https://museums.bankofamerica.com",
      website: museum.url,
      kidsFriendly: true,
      dataSource: "boa-museums-on-us",
      friendScore: boaIsThisWeekend ? 92 : 76,
    }));
  }, [boaIsThisWeekend, boaMuseums, boaWeekend]);

  const eventActivitySpots = useMemo<Spot[]>(() => {
    const now = new Date();
    const anchor = plannerAnchor ?? { lat: 37.7749, lon: -122.4194 };
    return events
      .filter((event) => isActualPlanningEvent(event, now, ageBand))
      .map((event) => {
        const transitMinutes =
          Number.isFinite(event.lat) && Number.isFinite(event.lon)
            ? Math.max(8, Math.round(haversineMiles(anchor, {
                lat: event.lat,
                lon: event.lon,
              }) * 6 + 8))
            : 25;
        return eventToPlanningSpot(event, transitMinutes);
      });
  }, [ageBand, events, plannerAnchor]);

  const planningSpots = useMemo(
    () => [...allSpots, ...eventActivitySpots, ...boaActivitySpots],
    [allSpots, boaActivitySpots, eventActivitySpots],
  );

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const spot of allSpots) {
      counts.set(spot.neighborhood, (counts.get(spot.neighborhood) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => ({ name, count }));
  }, [allSpots]);

  const savedEvents = useMemo(() => {
    if (savedEventIds.length === 0) return [] as FamilyEvent[];
    const lookup = new Map(events.map((e) => [e.id, e]));
    const matched = savedEventIds
      .map((id) => lookup.get(id))
      .filter((e): e is FamilyEvent => Boolean(e));
    // Sort by event start date (earliest first); recurring events without a
    // dated instance fall to the end so the soonest commitments stay on top.
    return matched.sort((a, b) => {
      const aT = a.startDateTime ? new Date(a.startDateTime).getTime() : Infinity;
      const bT = b.startDateTime ? new Date(b.startDateTime).getTime() : Infinity;
      return aT - bT;
    });
  }, [events, savedEventIds]);

  const savedEventGroups = useMemo(
    () => groupSavedEventsByDate(savedEvents),
    [savedEvents],
  );

  const savedSpots = useMemo(
    () => allSpots.filter((spot) => savedIds.includes(spot.id)),
    [allSpots, savedIds],
  );

  const filteredSpots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = allSpots.filter((spot) => {
      const searchable = [
        spot.name,
        spot.neighborhood,
        spot.category,
        spot.mood,
        spot.note,
        ...spot.tags,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (ageBand === "any" ||
          spot.kidsFriendly !== false) &&
        (category === "All" || spot.category === category) &&
        (city === "All" || spot.neighborhood === city) &&
        (cost === "All" || spot.cost === cost) &&
        (!onlyOpen || describeStatus(spot).kind === "open" || describeStatus(spot).kind === "always")
      );
    });

    const byScore = (left: Spot, right: Spot) => {
      const leftScore = scoreSpotForVibe(left, vibe, scoringOptions);
      const rightScore = scoreSpotForVibe(right, vibe, scoringOptions);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return left.transitMinutes - right.transitMinutes;
    };

    if (sortBy === "best") {
      return interleaveByCategory(filtered.sort(byScore));
    }

    return filtered.sort((left, right) => {
      if (sortBy === "price") {
        return costRank[left.cost] - costRank[right.cost];
      }

      if (sortBy === "name") {
        return left.name.localeCompare(right.name);
      }

      if (userLocation) {
        const ld = distanceFromUser(left) ?? Number.POSITIVE_INFINITY;
        const rd = distanceFromUser(right) ?? Number.POSITIVE_INFINITY;
        if (ld !== rd) return ld - rd;
      }

      return left.transitMinutes - right.transitMinutes;
    });
  }, [allSpots, category, city, ageBand, cost, onlyOpen, query, scoringOptions, sortBy, vibe, userLocation]);

  const pageCount = Math.max(1, Math.ceil(filteredSpots.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = filteredSpots.length === 0 ? 0 : (safePage - 1) * pageSize;
  const pageEnd = Math.min(filteredSpots.length, pageStart + pageSize);
  const paginatedSpots = useMemo(
    () => filteredSpots.slice(pageStart, pageStart + pageSize),
    [filteredSpots, pageSize, pageStart],
  );

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const selectedLabel =
    ageBand === "any"
      ? "Family-friendly spots"
      : `For ${ageBandLabels[ageBand].toLowerCase()}`;

  const daysThroughSunday = useMemo(() => {
    // Days-of-week from today through the coming Sunday (inclusive).
    // Sunday → [0]; Wednesday → [3,4,5,6,0]; Saturday → [6,0].
    const start = new Date().getDay();
    const out: number[] = [];
    let dow = start;
    for (let i = 0; i < 7; i += 1) {
      out.push(dow);
      if (dow === 0) break;
      dow = (dow + 1) % 7;
    }
    return out;
  }, []);

  const nearTermEvents = useMemo(() => {
    if (events.length === 0) return [] as FamilyEvent[];
    const inWindow = new Set(daysThroughSunday);
    const matching = events.filter((event) => {
      const hits = event.daysOfWeek.some((d) => inWindow.has(d));
      if (!hits) return false;
      if (ageBand !== "any" && !event.ageBands.includes(ageBand)) return false;
      return true;
    });
    const weekendishFirst = (event: FamilyEvent) =>
      event.daysOfWeek.some((d) => d === 0 || d === 6) ? 0 : 1;
    if (!plannerAnchor) {
      return [...matching]
        .sort((a, b) => weekendishFirst(a) - weekendishFirst(b))
        .slice(0, 8);
    }
    const here = plannerAnchor;
    const distOf = (event: FamilyEvent) => {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 3958.8;
      const dLat = toRad(event.lat - here.lat);
      const dLon = toRad(event.lon - here.lon);
      const lat1 = toRad(here.lat);
      const lat2 = toRad(event.lat);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
      return 2 * R * Math.asin(Math.sqrt(x));
    };
    return [...matching]
      .sort((a, b) => {
        const wd = weekendishFirst(a) - weekendishFirst(b);
        if (wd !== 0) return wd;
        return distOf(a) - distOf(b);
      })
      .slice(0, 8);
  }, [events, ageBand, plannerAnchor, daysThroughSunday]);

  const nearTermLabel = useMemo(() => {
    const todayDow = new Date().getDay();
    if (todayDow === 0) return "today (Sunday)";
    if (todayDow === 6) return "this weekend";
    return "this weekend";
  }, []);

  // Events shown as pins on the map: anything in the next ~14 days that matches
  // the active age band. The event date filter can hard-restrict pins to
  // today, tomorrow, or the upcoming weekend.
  // Editor's-pick rail re-ranks by proximity to whatever the user is browsing
  // on the map: hand-curated plans always lead, then auto-generated city
  // plans sorted by distance to the map center (falling back to user
  // location, then inferred geo, then a Bay Area centroid).
  const nearbyFeaturedPlans = useMemo(() => {
    if (featuredPlans.length === 0) return featuredPlans;
    const anchor =
      mapCenter ||
      userLocation ||
      (inferredGeo?.lat && inferredGeo?.lon
        ? { lat: inferredGeo.lat, lon: inferredGeo.lon }
        : { lat: 37.7749, lon: -122.4194 });
    const handCurated = featuredPlans.filter((p) => !p.generated);
    const generated = featuredPlans.filter((p) => p.generated);
    const scored = generated
      .map((p) => {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
          return { plan: p, distance: Number.POSITIVE_INFINITY };
        }
        return {
          plan: p,
          distance: haversineMiles(
            { lat: anchor.lat, lon: anchor.lon },
            { lat: Number(p.lat), lon: Number(p.lon) },
          ),
        };
      })
      .sort((a, b) => a.distance - b.distance);
    // Cap the rail so it doesn't get unwieldy. Generated plans are
    // re-ranked every map move, so the top of the rail follows the user.
    const generatedCap = 8;
    return [...handCurated, ...scored.slice(0, generatedCap).map((s) => s.plan)];
  }, [featuredPlans, mapCenter, userLocation, inferredGeo]);

  const mapEvents = useMemo(() => {
    if (events.length === 0) return [] as FamilyEvent[];
    const nowDate = new Date();
    const now = nowDate.getTime();
    const today = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
    );
    const tomorrow = addLocalDays(today, 1);
    const horizon = now + 14 * 24 * 60 * 60 * 1000;
    const weekendHorizon = now + 7 * 24 * 60 * 60 * 1000;
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      if (ageBand !== "any" && !event.ageBands.includes(ageBand)) return false;
      if (normalizedQuery) {
        const haystack = [
          event.title,
          event.venue,
          event.city,
          event.neighborhood,
          event.category,
          event.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      if (event.startDateTime) {
        const date = validEventDate(event.startDateTime);
        if (!date) return false;
        const t = date.getTime();
        if (!Number.isFinite(t)) return false;
        if (t < now - 12 * 60 * 60 * 1000 || t > horizon) return false;
        if (eventDateFilter === "today" && !sameLocalDate(date, today)) return false;
        if (eventDateFilter === "tomorrow" && !sameLocalDate(date, tomorrow)) return false;
        if (eventDateFilter === "weekend") {
          const dow = date.getDay();
          if (dow !== 0 && dow !== 6) return false;
          if (t > weekendHorizon) return false;
        }
        return true;
      }

      if (eventDateFilter === "today") {
        return event.daysOfWeek.includes(today.getDay());
      }
      if (eventDateFilter === "tomorrow") {
        return event.daysOfWeek.includes(tomorrow.getDay());
      }
      // Recurring without a specific date — keep weekend recurrences.
      return event.daysOfWeek.some((d) => d === 0 || d === 6);
    });
  }, [events, ageBand, eventDateFilter, query]);

  const highlightedEventIds = useMemo(() => {
    const ids = new Set<string>();
    const now = Date.now();
    const weekendHorizon = now + 7 * 24 * 60 * 60 * 1000;
    for (const event of mapEvents) {
      if (event.startDateTime) {
        const t = new Date(event.startDateTime).getTime();
        if (Number.isFinite(t) && t >= now - 6 * 60 * 60 * 1000 && t <= weekendHorizon) {
          ids.add(event.id);
        }
      } else if (event.daysOfWeek.some((d) => d === 0 || d === 6)) {
        ids.add(event.id);
      }
    }
    return ids;
  }, [mapEvents]);

  const weekendEvents = useMemo(() => {
    if (events.length === 0) return [] as FamilyEvent[];
    const matching = events.filter((event) => {
      if (!event.daysOfWeek.includes(targetDayOfWeek)) return false;
      if (ageBand !== "any" && !event.ageBands.includes(ageBand)) return false;
      return true;
    });
    if (!plannerAnchor) return matching;
    const here = plannerAnchor;
    return matching
      .map((event) => ({
        event,
        dist: ((lat: number, lon: number) => {
          const toRad = (deg: number) => (deg * Math.PI) / 180;
          const R = 3958.8;
          const dLat = toRad(lat - here.lat);
          const dLon = toRad(lon - here.lon);
          const lat1 = toRad(here.lat);
          const lat2 = toRad(lat);
          const x =
            Math.sin(dLat / 2) ** 2 +
            Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
          return 2 * R * Math.asin(Math.sqrt(x));
        })(event.lat, event.lon),
      }))
      .sort((a, b) => a.dist - b.dist)
      .map((entry) => entry.event);
  }, [events, ageBand, plannerAnchor, targetDayOfWeek]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (query) n += 1;
    if (ageBand !== "any") n += 1;
    if (category !== "All") n += 1;
    if (city !== "All") n += 1;
    if (cost !== "All") n += 1;
    if (onlyOpen) n += 1;
    if (eventDateFilter !== "all") n += 1;
    return n;
  }, [query, ageBand, category, city, cost, onlyOpen, eventDateFilter]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [plans, activePlanId],
  );

  const activePlanStops = useMemo(() => {
    if (!activePlan) {
      return [];
    }
    const byId = new Map(planningSpots.map((spot) => [spot.id, spot] as const));
    return activePlan.stopIds
      .map((id) => byId.get(id))
      .filter((spot): spot is Spot => Boolean(spot));
  }, [activePlan, planningSpots]);

  const activePlanEvents = useMemo(() => {
    const ids = activePlan?.eventIds;
    if (!ids || ids.length === 0 || events.length === 0) {
      return [] as FamilyEvent[];
    }
    const lookup = new Map(events.map((e) => [e.id, e]));
    return ids
      .map((id) => lookup.get(id))
      .filter((e): e is FamilyEvent => Boolean(e))
      .sort((a, b) => {
        const aT = a.startDateTime ? new Date(a.startDateTime).getTime() : Infinity;
        const bT = b.startDateTime ? new Date(b.startDateTime).getTime() : Infinity;
        return aT - bT;
      });
  }, [activePlan, events]);

  // Single ordered visit sequence used by the plan detail, the plan map, and
  // the share payload. Honors plan.itemOrder when set, otherwise falls back
  // to "stops in stopIds order, then events sorted by start date".
  type PlanItem =
    | { kind: "spot"; id: string; spot: Spot }
    | { kind: "event"; id: string; event: FamilyEvent };
  const activePlanItems = useMemo<PlanItem[]>(() => {
    if (!activePlan) return [];
    const stopMap = new Map(activePlanStops.map((s) => [s.id, s] as const));
    const eventMap = new Map(activePlanEvents.map((e) => [e.id, e] as const));
    const order =
      activePlan.itemOrder ??
      [
        ...activePlan.stopIds.map((id) => ({ kind: "spot" as const, id })),
        ...activePlanEvents.map((e) => ({ kind: "event" as const, id: e.id })),
      ];
    const out: PlanItem[] = [];
    for (const ref of order) {
      if (ref.kind === "spot") {
        const spot = stopMap.get(ref.id);
        if (spot) out.push({ kind: "spot", id: ref.id, spot });
      } else {
        const event = eventMap.get(ref.id);
        if (event) out.push({ kind: "event", id: ref.id, event });
      }
    }
    // Catch any items present in stopIds/eventIds but missing from the order
    // (e.g. legacy plans with a partial itemOrder, or transient race conditions).
    const seen = new Set(out.map((it) => `${it.kind}:${it.id}`));
    for (const spot of activePlanStops) {
      if (!seen.has(`spot:${spot.id}`)) out.push({ kind: "spot", id: spot.id, spot });
    }
    for (const event of activePlanEvents) {
      if (!seen.has(`event:${event.id}`)) out.push({ kind: "event", id: event.id, event });
    }
    return out;
  }, [activePlan, activePlanStops, activePlanEvents]);

  const planNearbyEvents = useMemo(() => {
    if (!activePlan || activePlanStops.length === 0 || events.length === 0) {
      return [] as FamilyEvent[];
    }
    const stopPoints = activePlanStops
      .filter((s) => typeof s.lat === "number" && typeof s.lon === "number")
      .map((s) => ({ lat: s.lat as number, lon: s.lon as number }));
    if (stopPoints.length === 0) return [];
    const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 3958.8;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
      return 2 * R * Math.asin(Math.sqrt(x));
    };
    const matchAge = activePlan.vibe ? activePlan.vibe : null;
    const useAgeBand = ageBand;
    const NEAR_RADIUS = 4;
    const alreadyInPlan = new Set(activePlan.eventIds ?? []);
    const now = Date.now();
    const sevenDays = now + 7 * 24 * 60 * 60 * 1000;
    const seen = new Set<string>();
    const matches: Array<{ event: FamilyEvent; dist: number }> = [];
    for (const event of events) {
      if (seen.has(event.id)) continue;
      if (alreadyInPlan.has(event.id)) continue;
      // Restrict to events happening within the next 7 days. For events with a
      // specific startDateTime, check the timestamp; for recurring events,
      // require that they hit Sat or Sun (the upcoming weekend).
      if (event.startDateTime) {
        const t = new Date(event.startDateTime).getTime();
        if (!Number.isFinite(t) || t < now - 12 * 60 * 60 * 1000 || t > sevenDays) {
          continue;
        }
      } else if (!event.daysOfWeek.some((d) => d === 0 || d === 6)) {
        continue;
      }
      if (
        useAgeBand !== "any" &&
        !event.ageBands.includes(useAgeBand)
      ) {
        continue;
      }
      let minDist = Infinity;
      for (const point of stopPoints) {
        const d = dist(point, { lat: event.lat, lon: event.lon });
        if (d < minDist) minDist = d;
      }
      if (minDist <= NEAR_RADIUS) {
        seen.add(event.id);
        matches.push({ event, dist: minDist });
      }
    }
    matches.sort((a, b) => a.dist - b.dist);
    void matchAge;
    return matches.slice(0, 16).map((m) => m.event);
  }, [activePlan, activePlanStops, events, ageBand, targetDayOfWeek]);

  const planTotalTransit = useMemo(
    () => activePlanStops.reduce((sum, spot) => sum + spot.transitMinutes, 0),
    [activePlanStops],
  );

  const addableSavedSpots = useMemo(() => {
    if (!activePlan) {
      return [];
    }
    const inPlan = new Set(activePlan.stopIds);
    return savedSpots.filter((spot) => !inPlan.has(spot.id));
  }, [activePlan, savedSpots]);

  const addableSavedEvents = useMemo(() => {
    if (!activePlan) return [] as FamilyEvent[];
    const inPlan = new Set(activePlan.eventIds ?? []);
    return savedEvents.filter((event) => !inPlan.has(event.id));
  }, [activePlan, savedEvents]);

  function createPlan() {
    const id = `plan-${Date.now()}`;
    const next: Plan = {
      id,
      name: "New plan",
      stopIds: [],
      createdAt: new Date().toISOString(),
    };
    setPlans((current) => [...current, next]);
    setActivePlanId(id);
    setView("plans");
  }

  function createPlanFromSaved() {
    if (savedSpots.length === 0 && savedEvents.length === 0) {
      return;
    }
    const id = `plan-${Date.now()}`;
    const totalCount = savedSpots.length + savedEvents.length;
    const stopIds = savedSpots.map((spot) => spot.id);
    const eventIds = savedEvents.map((event) => event.id);
    const next: Plan = {
      id,
      name: `Saved plan (${totalCount})`,
      stopIds,
      eventIds,
      itemOrder: [
        ...stopIds.map((sid) => ({ kind: "spot" as const, id: sid })),
        ...eventIds.map((eid) => ({ kind: "event" as const, id: eid })),
      ],
      createdAt: new Date().toISOString(),
      source: "manual",
    };
    setPlans((current) => [...current, next]);
    setActivePlanId(id);
    setView("plans");
  }

  function forkFeaturedPlan(featured: FeaturedPlan) {
    // Resolve refs against current data; silently skip missing items rather
    // than block the fork — featured-plans.json may reference ids that aren't
    // in this build of the dataset.
    const validStops = new Set(allSpots.map((s) => s.id));
    const validEvents = new Set(events.map((e) => e.id));
    const stopIds = featured.stopIds.filter((id) => validStops.has(id));
    const eventIds = (featured.eventIds ?? []).filter((id) =>
      validEvents.has(id),
    );
    if (stopIds.length === 0 && eventIds.length === 0) {
      // Nothing to fork — let the user know via console; the rail UI also
      // disables the button when this is the case.
      console.warn(
        `Featured plan ${featured.id} references no items present in the current dataset.`,
      );
      return;
    }
    const id = `plan-${Date.now()}`;
    const next: Plan = {
      id,
      name: featured.name,
      stopIds,
      eventIds,
      itemOrder: [
        ...stopIds.map((sid) => ({ kind: "spot" as const, id: sid })),
        ...eventIds.map((eid) => ({ kind: "event" as const, id: eid })),
      ],
      createdAt: new Date().toISOString(),
      source: "manual",
    };
    setPlans((current) => [...current, next]);
    setActivePlanId(id);
    setView("plans");
  }

  function addEventToPlan(planId: string, eventId: string) {
    setPlans((current) =>
      current.map((plan) => {
        if (plan.id !== planId) return plan;
        const existing = plan.eventIds ?? [];
        if (existing.includes(eventId)) return plan;
        const order = plan.itemOrder ?? [
          ...plan.stopIds.map((sid) => ({ kind: "spot" as const, id: sid })),
          ...existing.map((eid) => ({ kind: "event" as const, id: eid })),
        ];
        return {
          ...plan,
          eventIds: [...existing, eventId],
          itemOrder: [...order, { kind: "event" as const, id: eventId }],
        };
      }),
    );
  }

  function removeEventFromPlan(planId: string, eventId: string) {
    setPlans((current) =>
      current.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              eventIds: (plan.eventIds ?? []).filter((id) => id !== eventId),
              itemOrder: (plan.itemOrder ?? []).filter(
                (item) => !(item.kind === "event" && item.id === eventId),
              ),
            }
          : plan,
      ),
    );
  }

  function moveItemInPlan(
    planId: string,
    visibleOrder: PlanItemRef[],
    item: PlanItemRef,
    delta: number,
  ) {
    // Operate on the order the user actually sees on screen, not on plan
    // fields. Legacy plans without itemOrder still render via activePlanItems,
    // which date-sorts events; if we recomputed the order here from plan.eventIds
    // (insertion order), the swap targeted the wrong slot and looked broken.
    setPlans((current) =>
      current.map((plan) => {
        if (plan.id !== planId) return plan;
        const idx = visibleOrder.findIndex(
          (it) => it.kind === item.kind && it.id === item.id,
        );
        const swap = idx + delta;
        if (idx < 0 || swap < 0 || swap >= visibleOrder.length) return plan;
        const next = [...visibleOrder];
        [next[idx], next[swap]] = [next[swap], next[idx]];
        return { ...plan, itemOrder: next };
      }),
    );
  }

  function updatePlan(id: string, patch: Partial<Plan>) {
    setPlans((current) =>
      current.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)),
    );
  }

  function deletePlan(id: string) {
    setPlans((current) => current.filter((plan) => plan.id !== id));
    if (activePlanId === id) {
      setActivePlanId(null);
    }
  }

  function addStopToPlan(planId: string, stopId: string) {
    setPlans((current) =>
      current.map((plan) => {
        if (plan.id !== planId || plan.stopIds.includes(stopId)) return plan;
        const order =
          plan.itemOrder ??
          [
            ...plan.stopIds.map((sid) => ({ kind: "spot" as const, id: sid })),
            ...(plan.eventIds ?? []).map((eid) => ({
              kind: "event" as const,
              id: eid,
            })),
          ];
        return {
          ...plan,
          stopIds: [...plan.stopIds, stopId],
          itemOrder: [...order, { kind: "spot" as const, id: stopId }],
        };
      }),
    );
    setAddStopChoice("");
  }

  function removeStopFromPlan(planId: string, stopId: string) {
    setPlans((current) =>
      current.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              stopIds: plan.stopIds.filter((id) => id !== stopId),
              itemOrder: (plan.itemOrder ?? []).filter(
                (item) => !(item.kind === "spot" && item.id === stopId),
              ),
            }
          : plan,
      ),
    );
  }

  async function sharePlan() {
    if (
      !activePlan ||
      (activePlanStops.length === 0 && activePlanEvents.length === 0)
    ) {
      return;
    }
    setShareState({ status: "sharing" });
    const stopPayload: StopSummary[] = activePlanStops.map((spot) => ({
      id: spot.id,
      name: spot.name,
      neighborhood: spot.neighborhood,
      category: spot.category,
      imageUrl: spot.imageUrl,
      cost: spot.cost,
      transitMinutes: spot.transitMinutes,
    }));
    const eventPayload: EventSummary[] = activePlanEvents.map((event) => ({
      id: event.id,
      title: event.title,
      venue: event.venue,
      city: event.city,
      startDateTime: event.startDateTime ?? undefined,
      timeWindow: event.timeWindow,
      url: event.url,
      category: event.category,
      cost: event.cost,
    }));
    const itemOrderPayload: ItemOrderRef[] = activePlanItems.map((it) => ({
      kind: it.kind,
      id: it.id,
    }));
    const planTitle = activePlan.name || "Untitled plan";
    try {
      const result = await createPoll({
        title: planTitle,
        stops: stopPayload,
        events: eventPayload,
        itemOrder: itemOrderPayload,
      });
      const url = `${window.location.origin}/#/p/${result.pollId}`;
      updatePlan(activePlan.id, {
        pollId: result.pollId,
        ownerToken: result.ownerToken,
      });
      // Share text uses the plan's own name so when texted/messaged it reads
      // "Vote on 'Saturday with kids' — …" instead of a generic URL.
      const shareText = `Vote on "${planTitle}" — ${url}`;
      try {
        await navigator.clipboard.writeText(shareText);
      } catch {
        // ignore clipboard failures
      }
      setShareState({ status: "shared", url });
    } catch (error) {
      setShareState({ status: "error", error: (error as Error).message });
    }
  }

  const [swapBusyStopId, setSwapBusyStopId] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  async function swapStopWithAi(planId: string, stopId: string) {
    if (!session) {
      setSwapError("Sign in to use AI swap.");
      return;
    }
    const plan = plans.find((p) => p.id === planId);
    if (!plan || !plan.vibe) {
      setSwapError("Only AI plans can be swapped.");
      return;
    }
    const stopsById = new Map(planningSpots.map((s) => [s.id, s] as const));
    const currentStops = plan.stopIds
      .map((id) => stopsById.get(id))
      .filter((s): s is Spot => Boolean(s));
    const currentPicks: StopSummary[] = currentStops.map((spot) => ({
      id: spot.id,
      name: spot.name,
      neighborhood: spot.neighborhood,
      category: spot.category,
      cost: spot.cost,
      transitMinutes: spot.transitMinutes,
    }));
    const usedIds = new Set(plan.stopIds);
    const remainingStops = currentStops.filter((s) => s.id !== stopId);
    const swapAnchor =
      planCentroid(remainingStops) ??
      planCentroid(currentStops) ??
      plannerAnchor ??
      { lat: 37.7749, lon: -122.4194 };
    const localPool = clusterAround(
      planningSpots.filter((s) => !usedIds.has(s.id)),
      swapAnchor,
      6,
      18,
    );
    const sortedAll = rankForVibe(
      localPool,
      plan.vibe,
      scoringOptions,
    ) as unknown as Spot[];
    const candidatesPool = sampleCandidates(sortedAll, 12);
    const candidates: StopSummary[] = candidatesPool.map((spot) => ({
      id: spot.id,
      name: spot.name,
      neighborhood: spot.neighborhood,
      category: spot.category,
      cost: spot.cost,
      transitMinutes: spot.transitMinutes,
      friendScore: scoreSpotForVibe(
        spot,
        plan.vibe!,
        scoringOptions,
      ),
    }));
    if (candidates.length === 0) {
      setSwapError("No alternative spots available.");
      return;
    }

    setSwapBusyStopId(stopId);
    setSwapError(null);
    try {
      const swapDate = targetDateObj;
      const result = await createAiSwap(
        {
          vibe: plan.vibe,
          ageBand: ageBand === "any" ? undefined : ageBand,
          date: targetDate,
          dayOfWeek: swapDate.toLocaleDateString("en-US", { weekday: "long" }),
          replaceStopId: stopId,
          currentPicks,
          candidates,
          weather,
          preferences,
          profile: plannerProfile,
        },
        session.token,
      );
      setPlans((current) =>
        current.map((p) => {
          if (p.id !== planId) return p;
          const newStopIds = p.stopIds.map((id) =>
            id === stopId ? result.pick.id : id,
          );
          const existingPicks = p.picks ?? [];
          const newPicks = newStopIds.map((id, idx) => {
            if (id === result.pick.id) {
              return { id, reason: result.pick.reason };
            }
            return existingPicks[idx] ?? { id, reason: "" };
          });
          return { ...p, stopIds: newStopIds, picks: newPicks };
        }),
      );
    } catch (error) {
      setSwapError((error as Error).message);
    } finally {
      setSwapBusyStopId(null);
    }
  }

  function applyLocalBias(
    spots: Spot[],
    forecast: WeatherForecast | null,
    prefs: PlannerPreferenceId[],
  ): Spot[] {
    let working = spots;
    if (prefs.includes("free-only")) {
      working = working.filter((s) => s.cost === "Free" || s.cost === "$");
    }
    if (prefs.includes("near-only")) {
      working = working.filter((s) => s.transitMinutes <= 30);
    }
    if (prefs.includes("loves-animals")) {
      working = [...working].sort((a, b) => {
        const score = (s: Spot) => {
          const t = `${s.name} ${s.category} ${s.tags.join(" ")}`.toLowerCase();
          if (/zoo|aquarium|farm|wildlife|animal/.test(t)) return 1;
          return 0;
        };
        return score(b) - score(a);
      });
    }
    if (prefs.includes("parks-nature")) {
      working = [...working].sort((a, b) => {
        const score = (s: Spot) =>
          s.category === "Outdoors" || /park|garden|trail|beach|nature/i.test(`${s.name} ${s.tags.join(" ")}`)
            ? 1
            : 0;
        return score(b) - score(a);
      });
    }
    if (prefs.includes("libraries-museums")) {
      working = [...working].sort((a, b) => {
        const score = (s: Spot) =>
          s.category === "Culture" || /library|museum|science|story/i.test(`${s.name} ${s.tags.join(" ")}`)
            ? 1
            : 0;
        return score(b) - score(a);
      });
    }
    const wet =
      (forecast?.saturday?.precipChance ?? 0) >= 50 ||
      forecast?.saturday?.label === "Rainy" ||
      forecast?.saturday?.label === "Stormy" ||
      forecast?.saturday?.label === "Showers" ||
      (prefs.includes("indoor-when-rainy") &&
        (forecast?.saturday?.precipChance ?? 0) >= 30);
    if (wet) {
      working = [...working].sort((a, b) => {
        const indoor = (s: Spot) =>
          s.category === "Culture" || s.category === "Wellness" ? 1 : 0;
        return indoor(b) - indoor(a);
      });
    }
    return working;
  }

  function sampleCandidates<T extends { category?: string; id?: string }>(
    sorted: T[],
    size: number,
    poolSize = 36,
  ): T[] {
    const pool = sorted.slice(0, poolSize);
    if (pool.length <= size) return pool;
    const byCategory = interleaveByCategory(pool as unknown as Spot[]) as unknown as T[];
    const seeded = byCategory.slice(0, Math.min(byCategory.length, size * 2));
    const shuffled = [...seeded];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const picked: T[] = [];
    const seen = new Set<string>();
    for (const item of shuffled) {
      const key = item.id || `${item.category || "item"}-${picked.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(item);
      if (picked.length >= size) return picked;
    }
    for (const item of byCategory) {
      const key = item.id || `${item.category || "item"}-${picked.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(item);
      if (picked.length >= size) break;
    }
    return picked;
  }

  async function selectVibeFromHome(nextVibe: PlannerVibe) {
    setVibe(nextVibe);
    setHomeError(null);
    setHomeBusy(true);

    const anchor = plannerAnchor ?? { lat: 37.7749, lon: -122.4194 };
    const candidatePool = clusterAround(planningSpots, anchor, 8, 24);

    if (candidatePool.length === 0) {
      setHomeBusy(false);
      setHomeError("Spots are still loading. Try again in a moment.");
      return;
    }

    if (session && API_CONFIGURED) {
      const rankedCandidates = applyLocalBias(
        rankForVibe(
          candidatePool,
          nextVibe,
          scoringOptions,
        ) as unknown as Spot[],
        weather,
        preferences,
      );
      const stopPayload: StopSummary[] = sampleCandidates(rankedCandidates, 12).map((spot) => ({
        id: spot.id,
        name: spot.name,
        neighborhood: spot.neighborhood,
        category: spot.category,
        imageUrl: spot.imageUrl,
        cost: spot.cost,
        transitMinutes: spot.transitMinutes,
        mood: spot.mood,
        groupSize: spot.groupSize,
        planning: spot.planning,
        openNow: spot.openNow,
        website: spot.website,
        sourceUrl: spot.sourceUrl,
        friendScore: scoreSpotForVibe(
          spot,
          nextVibe,
          scoringOptions,
        ),
      }));
      try {
        const planDate = targetDateObj;
        const result = await createAiBrief(
          {
            vibe: nextVibe,
            spots: stopPayload,
            ageBand: ageBand === "any" ? undefined : ageBand,
            date: targetDate,
            dayOfWeek: planDate.toLocaleDateString("en-US", { weekday: "long" }),
            weather,
            preferences,
            profile: plannerProfile,
          },
          session.token,
        );
        const stopIds =
          result.picks.length > 0
            ? result.picks.map((p) => p.id)
            : stopPayload.slice(0, 3).map((s) => s.id);
        const id = `plan-${Date.now()}`;
        const plan: Plan = {
          id,
          name: result.brief.title || `${APP_VIBE_LABELS[nextVibe]} plan`,
          stopIds,
          createdAt: new Date().toISOString(),
          source: "ai",
          vibe: nextVibe,
          summary: result.brief.summary,
          rationale: result.brief.rationale,
          cautions: result.brief.cautions,
          picks: result.picks,
          aiModel: result.model,
          profile: plannerProfile,
        };
        setPlans((current) => [...current, plan]);
        setActivePlanId(id);
        setView("plans");
        setHomeBusy(false);
        return;
      } catch (error) {
        // fall through to local rank below
        setHomeError(
          `AI is unavailable (${(error as Error).message}). Using a quick local pick instead.`,
        );
      }
    }

    // Local deterministic fallback (no auth required)
    const ranked = applyLocalBias(
      rankForVibe(
        candidatePool,
        nextVibe,
        scoringOptions,
      ) as unknown as Spot[],
      weather,
      preferences,
    ).slice(0, 3);
    if (ranked.length === 0) {
      setHomeBusy(false);
      setHomeError("No matching spots for that vibe.");
      return;
    }
    const id = `plan-${Date.now()}`;
    const plan: Plan = {
      id,
      name: `${APP_VIBE_LABELS[nextVibe]} plan`,
      stopIds: ranked.map((s) => s.id),
      createdAt: new Date().toISOString(),
      source: "manual",
      vibe: nextVibe,
      summary: session
        ? `Picked locally for: ${plannerProfileSummary}.`
        : `Picked locally for: ${plannerProfileSummary}. Sign in with Google to use AI for richer suggestions and to save plans across devices.`,
      picks: ranked.map((spot) => ({
        id: spot.id,
        reason: `Matched because ${describePlannerMatch(spot, scoringOptions).join(", ")}.`,
      })),
      profile: plannerProfile,
    };
    setPlans((current) => [...current, plan]);
    setActivePlanId(id);
    setView("plans");
    setHomeBusy(false);
  }

  async function createAiPlan() {
    if (!session) {
      setAiState({
        status: "error",
        error: "Sign in with Google to use AI suggest.",
      });
      return;
    }
    const baseSource = savedSpots.length > 0
      ? savedSpots
      : [...filteredSpots, ...eventActivitySpots, ...boaActivitySpots];
    if (baseSource.length === 0) {
      setAiState({
        status: "error",
        error: "Save spots or adjust filters so the AI has candidates.",
      });
      return;
    }
    const anchor =
      planCentroid(savedSpots) ??
      plannerAnchor ??
      { lat: 37.7749, lon: -122.4194 };
    const source =
      savedSpots.length > 0 ? baseSource : clusterAround(baseSource, anchor, 8, 24);
    const rankedSource = applyLocalBias(
      rankForVibe(
        source,
        vibe,
        scoringOptions,
      ) as unknown as Spot[],
      weather,
      preferences,
    );
    const spots: StopSummary[] = sampleCandidates(rankedSource, 12).map((spot) => ({
      id: spot.id,
      name: spot.name,
      neighborhood: spot.neighborhood,
      category: spot.category,
      imageUrl: spot.imageUrl,
      cost: spot.cost,
      transitMinutes: spot.transitMinutes,
      mood: spot.mood,
      groupSize: spot.groupSize,
      planning: spot.planning,
      openNow: spot.openNow,
      website: spot.website,
      sourceUrl: spot.sourceUrl,
      friendScore: scoreSpotForVibe(
        spot,
        vibe,
        scoringOptions,
      ),
    }));

    setAiState({ status: "loading" });
    try {
      const planDate = targetDateObj;
      const result = await createAiBrief(
        {
          vibe,
          spots,
          ageBand: ageBand === "any" ? undefined : ageBand,
          date: targetDate,
          dayOfWeek: planDate.toLocaleDateString("en-US", { weekday: "long" }),
          weather,
          preferences,
          profile: plannerProfile,
        },
        session.token,
      );
      const stopIds =
        result.picks.length > 0
          ? result.picks.map((p) => p.id)
          : spots.slice(0, 3).map((s) => s.id);
      const id = `plan-${Date.now()}`;
      const plan: Plan = {
        id,
        name: result.brief.title || `${APP_VIBE_LABELS[vibe]} plan`,
        stopIds,
        createdAt: new Date().toISOString(),
        source: "ai",
        vibe,
        summary: result.brief.summary,
        rationale: result.brief.rationale,
        cautions: result.brief.cautions,
        picks: result.picks,
        aiModel: result.model,
        profile: plannerProfile,
      };
      setPlans((current) => [...current, plan]);
      setActivePlanId(id);
      setView("plans");
      setAiState({ status: "idle" });
    } catch (error) {
      setAiState({ status: "error", error: (error as Error).message });
    }
  }

  function moveStop(planId: string, stopId: string, direction: -1 | 1) {
    setPlans((current) =>
      current.map((plan) => {
        if (plan.id !== planId) {
          return plan;
        }
        const idx = plan.stopIds.indexOf(stopId);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= plan.stopIds.length) {
          return plan;
        }
        const next = [...plan.stopIds];
        [next[idx], next[target]] = [next[target], next[idx]];
        return { ...plan, stopIds: next };
      }),
    );
  }

  function haversineMiles(
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ) {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 3958.8;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function clusterAround(
    spots: Spot[],
    anchor: { lat: number; lon: number },
    initialRadiusMiles: number,
    minPoolSize: number,
  ): Spot[] {
    const withCoords = spots.filter(
      (s) =>
        typeof s.lat === "number" &&
        typeof s.lon === "number" &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lon),
    );
    const ranked = withCoords
      .map((spot) => ({
        spot,
        dist: haversineMiles(anchor, {
          lat: spot.lat as number,
          lon: spot.lon as number,
        }),
      }))
      .sort((a, b) => a.dist - b.dist);
    let radius = initialRadiusMiles;
    while (radius <= 60) {
      const within = ranked.filter((entry) => entry.dist <= radius);
      if (within.length >= minPoolSize) {
        return within.map((entry) => entry.spot);
      }
      radius += 5;
    }
    return ranked.slice(0, Math.max(minPoolSize, 30)).map((entry) => entry.spot);
  }

  function planCentroid(stops: Spot[]): { lat: number; lon: number } | null {
    const withCoords = stops.filter(
      (s) =>
        typeof s.lat === "number" &&
        typeof s.lon === "number" &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lon),
    );
    if (withCoords.length === 0) return null;
    const lat =
      withCoords.reduce((sum, s) => sum + (s.lat as number), 0) /
      withCoords.length;
    const lon =
      withCoords.reduce((sum, s) => sum + (s.lon as number), 0) /
      withCoords.length;
    return { lat, lon };
  }

  function distanceFromUser(spot: Spot): number | null {
    if (!userLocation) return null;
    if (typeof spot.lat !== "number" || typeof spot.lon !== "number") return null;
    return haversineMiles(userLocation, { lat: spot.lat, lon: spot.lon });
  }

  async function requestUserLocation() {
    if (!("geolocation" in navigator)) {
      setGeoState("denied");
      setGeoErrorReason("unsupported");
      return;
    }
    // If the browser already knows permission is denied, skip the doomed
    // getCurrentPosition() and surface our modal immediately. iOS Chrome
    // silently swallows the prompt in this state so without the check the
    // user just sees a frozen-looking button.
    if (
      typeof navigator.permissions?.query === "function"
    ) {
      try {
        const status = await navigator.permissions.query({
          name: "geolocation" as PermissionName,
        });
        if (status.state === "denied") {
          setGeoState("denied");
          setGeoErrorReason("denied");
          return;
        }
      } catch {
        // Permissions API not supported — fall through to the request.
      }
    }
    setGeoState("requesting");
    setGeoErrorReason(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
        };
        setUserLocation(next);
        window.localStorage.setItem("saturday.userLocation", JSON.stringify(next));
        setGeoState("idle");
        setGeoErrorReason(null);
        setSortBy("nearest");
      },
      (err) => {
        setGeoState("denied");
        if (err.code === err.PERMISSION_DENIED) {
          setGeoErrorReason("denied");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoErrorReason("unavailable");
        } else if (err.code === err.TIMEOUT) {
          setGeoErrorReason("timeout");
        } else {
          setGeoErrorReason("denied");
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  function clearUserLocation() {
    setUserLocation(null);
    window.localStorage.removeItem("saturday.userLocation");
    setGeoState("idle");
  }

  function toggleSaved(id: string) {
    setSavedIds((current) =>
      current.includes(id)
        ? current.filter((savedId) => savedId !== id)
        : [...current, id],
    );
  }

  function toggleSavedEvent(id: string) {
    setSavedEventIds((current) =>
      current.includes(id)
        ? current.filter((savedId) => savedId !== id)
        : [...current, id],
    );
  }

  function toggleVisited(id: string) {
    setVisitedIds((current) =>
      current.includes(id)
        ? current.filter((visitedId) => visitedId !== id)
        : [...current, id],
    );
  }

  function resetFilters() {
    setQuery("");
    setAgeBand("any");
    setVibe("balanced");
    setCategory("All");
    setCity("All");
    setCost("All");
    setOnlyOpen(false);
    setEventDateFilter("all");
    setSortBy("best");
    setPreferences([]);
    setPlannerProfile(defaultPlannerProfile);
    setPage(1);
  }

  function updatePlannerProfile<Key extends keyof PlannerProfile>(
    key: Key,
    value: PlannerProfile[Key],
  ) {
    setPlannerProfile((current) => normalizePlannerProfile({ ...current, [key]: value }));
  }

  function addSpot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = newSpot.name.trim();
    const neighborhood = newSpot.neighborhood.trim();
    const note = newSpot.note.trim();

    if (!name || !neighborhood) {
      return;
    }

    const created: Spot = {
      id: `custom-${Date.now()}`,
      name,
      neighborhood,
      category: newSpot.category,
      imageUrl: pickCategoryImage(newSpot.category, `custom-${Date.now()}`),
      bestWith: [],
      cost: newSpot.cost,
      transitMinutes: 20,
      timeWindow: "Anytime",
      mood: "Saved idea",
      groupSize: "2-6 people",
      planning: "Flexible",
      openNow: true,
      note: note || "A saved friend outing idea to fill in later.",
      tags: ["custom", newSpot.category.toLowerCase()],
    };

    setCustomSpots((current) => [...current, created]);
    setSavedIds((current) => [...current, created.id]);
    setNewSpot(emptyNewSpot);
    setIsAdding(false);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">{APP_TAGLINE}</p>
          <h1>{APP_BRAND}</h1>
        </div>
        <div className="topbar-auth">
          {GOOGLE_CONFIGURED ? (
            session ? (
              <div className="user-chip" title={session.user.email}>
                {session.user.picture && (
                  <img src={session.user.picture} alt="" />
                )}
                <span>{session.user.name}</span>
                {syncStatus !== "idle" && (
                  <em
                    className={`sync-pill sync-${syncStatus}`}
                    title={
                      syncStatus === "synced"
                        ? "Saved + plans synced to your account"
                        : syncStatus === "loading"
                          ? "Loading your data…"
                          : syncStatus === "syncing"
                            ? "Syncing…"
                            : "Sync error — local-only for now"
                    }
                  >
                    {syncStatus === "loading" || syncStatus === "syncing"
                      ? "•••"
                      : syncStatus === "synced"
                        ? "✓"
                        : "!"}
                  </em>
                )}
                <button
                  className="text-button"
                  onClick={signOut}
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="signin-wrap">
                <div ref={signInButtonRef} className="signin-slot" />
                {signInError && <span className="signin-error">{signInError}</span>}
              </div>
            )
          ) : null}
        </div>
        <div className="data-banner" title={dataMeta.sourceName}>
          <Database aria-hidden="true" />
          <div>
            <strong>
              {dataMeta.loading ? "Loading Bay Area data" : `${dataMeta.count} Bay Area spots`}
            </strong>
            <span>
              {dataMeta.error
                ? "Using fallback data"
                : `Refreshed ${formatGeneratedAt(dataMeta.generatedAt)}`}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Reset filters" onClick={resetFilters}>
            <RotateCcw aria-hidden="true" />
          </button>
          <button className="primary-button" onClick={() => setIsAdding(true)}>
            <Plus aria-hidden="true" />
            Add spot
          </button>
        </div>
      </header>

      <div className="view-bar">
        <nav className="view-tabs" aria-label="View">
          <button
            className={view === "browse" ? "active" : ""}
            onClick={() => setView("browse")}
          >
            <Search aria-hidden="true" />
            Browse
          </button>
          <button
            className={view === "plans" ? "active" : ""}
            onClick={() => setView("plans")}
          >
            <List aria-hidden="true" />
            Plans ({plans.length})
          </button>
        </nav>
        {view === "browse" && (
          <button
            className="filter-trigger view-bar-filter"
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-expanded={filtersOpen}
            aria-controls="spot-filters"
          >
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <em className="filter-count">{activeFilterCount}</em>
            )}
          </button>
        )}
      </div>

      {view === "home" ? (
      <main className="home-screen" aria-label={APP_HERO_TITLE}>
        <div className="home-hero">
          <p className="eyebrow">{APP_TAGLINE}</p>
          <h1>{APP_HERO_TITLE}</h1>
          <p className="home-sub">
            {APP_HERO_SUB}
            {inferredGeo?.city ? ` Tuned for ${inferredGeo.city}.` : ""}
          </p>
        </div>

        <div className="home-date" role="group" aria-label="Plan date">
          <span className="filter-label">When</span>
          <div className="date-row">
            <input
              type="date"
              value={targetDate}
              min={isoDate(new Date())}
              onChange={(event) => setTargetDate(event.target.value)}
            />
            <div className="date-quick">
              <button
                type="button"
                onClick={() => setTargetDate(isoDate(thisOrNextDayOfWeek(6)))}
              >
                This Sat
              </button>
              <button
                type="button"
                onClick={() => setTargetDate(isoDate(thisOrNextDayOfWeek(0)))}
              >
                This Sun
              </button>
              <button
                type="button"
                onClick={() => setTargetDate(isoDate(nextDayOfWeek(6)))}
              >
                Next Sat
              </button>
            </div>
            <span className="date-label">
              {targetDateObj.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        {SHOW_AGE_BAND_UI && (
          <div className="home-age" role="group" aria-label="Kids' age">
            <span className="filter-label">Kids' age</span>
            <div className="segmented compact">
              <button
                className={ageBand === "any" ? "active" : ""}
                onClick={() => setAgeBand("any")}
              >
                Mixed / any
              </button>
              {ageBandOptions.map(([value, label]) => (
                <button
                  key={value}
                  className={ageBand === value ? "active" : ""}
                  onClick={() => setAgeBand(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="home-base" role="group" aria-label="Home base">
          <span className="filter-label">Home base</span>
          <div className="home-base-row">
            {userLocation ? (
              <button
                className="geo-button active"
                type="button"
                onClick={clearUserLocation}
                title={`Using your location (${userLocation.lat.toFixed(2)}, ${userLocation.lon.toFixed(2)})`}
              >
                <MapPin aria-hidden="true" />
                Using my location
              </button>
            ) : (
              <button
                className="geo-button"
                type="button"
                disabled={geoState === "requesting"}
                onClick={requestUserLocation}
              >
                <MapPin aria-hidden="true" />
                {geoState === "requesting" ? "Locating…" : "Use my location"}
              </button>
            )}
            <span className="home-base-status">
              {userLocation
                ? "Distance sorted from you"
                : inferredGeo?.city
                  ? `Using ${inferredGeo.city}`
                  : "Using SF baseline"}
            </span>
          </div>
          {geoState === "denied" && (
            <p className="geo-status error">
              Location permission denied. Enable it in your browser settings to sort by distance from you.
            </p>
          )}
        </div>

        <div className="home-profile" role="group" aria-label="Plan details">
          <span className="filter-label">Plan details</span>
          <div className="profile-grid">
            <label className="profile-field">
              <span>Time</span>
              <select
                value={plannerProfile.planLength}
                onChange={(event) =>
                  updatePlannerProfile(
                    "planLength",
                    event.target.value as PlannerProfile["planLength"],
                  )
                }
              >
                {plannerPlanLengthOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span>Budget</span>
              <select
                value={plannerProfile.budget}
                onChange={(event) =>
                  updatePlannerProfile(
                    "budget",
                    event.target.value as PlannerProfile["budget"],
                  )
                }
              >
                {plannerBudgetOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span>Travel</span>
              <select
                value={plannerProfile.transportMode}
                onChange={(event) =>
                  updatePlannerProfile(
                    "transportMode",
                    event.target.value as PlannerProfile["transportMode"],
                  )
                }
              >
                {plannerTransportOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span>Crowds</span>
              <select
                value={plannerProfile.crowdTolerance}
                onChange={(event) =>
                  updatePlannerProfile(
                    "crowdTolerance",
                    event.target.value as PlannerProfile["crowdTolerance"],
                  )
                }
              >
                {plannerCrowdOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span>Setting</span>
              <select
                value={plannerProfile.setting}
                onChange={(event) =>
                  updatePlannerProfile(
                    "setting",
                    event.target.value as PlannerProfile["setting"],
                  )
                }
              >
                {plannerSettingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {(weather?.saturday || weather?.sunday) && (
          <div className="home-weather" aria-label="Weekend weather">
            {weather.saturday && (
              <span className={`weather-pill weather-${weatherTone(weather.saturday.label)}`}>
                <strong>Sat</strong> {weather.saturday.label} · {weather.saturday.tempMaxF}°
                {weather.saturday.precipChance >= 30
                  ? ` · ${weather.saturday.precipChance}% rain`
                  : ""}
              </span>
            )}
            {weather.sunday && (
              <span className={`weather-pill weather-${weatherTone(weather.sunday.label)}`}>
                <strong>Sun</strong> {weather.sunday.label} · {weather.sunday.tempMaxF}°
                {weather.sunday.precipChance >= 30
                  ? ` · ${weather.sunday.precipChance}% rain`
                  : ""}
              </span>
            )}
          </div>
        )}

        <div className="home-prefs" role="group" aria-label="Family preferences">
          <span className="filter-label">Interests + constraints</span>
          <div className="pref-chips">
            {plannerPreferenceOptions.map((option) => {
              const active = preferences.includes(option.id);
              return (
                <button
                  key={option.id}
                  className={active ? "pref-chip active" : "pref-chip"}
                  title={option.hint}
                  onClick={() =>
                    setPreferences((current) =>
                      active
                        ? current.filter((p) => p !== option.id)
                        : [...current, option.id],
                    )
                  }
                >
                  {active ? "✓ " : ""}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="home-vibes" role="group" aria-label="Pick a vibe">
          {vibeOptions.map(([value, label]) => (
            <button
              key={value}
              className="home-vibe-card"
              disabled={homeBusy}
              onClick={() => selectVibeFromHome(value)}
            >
              <strong>{label}</strong>
              <span>{vibeBlurb(value)}</span>
            </button>
          ))}
        </div>

        {homeBusy && (
          <p className="home-status">Building your plan…</p>
        )}
        {homeError && (
          <p className="home-status error">{homeError}</p>
        )}

        {weekendEvents.length > 0 && (
          <section className="home-events" aria-label="Weekend events">
            <div className="home-events-head">
              <h2>This weekend</h2>
              <p>
                {weekendEvents.length} family program
                {weekendEvents.length === 1 ? "" : "s"}
                {ageBand !== "any" ? ` for ${ageBandLabels[ageBand].toLowerCase()}` : ""}
                {inferredGeo?.city ? ` near ${inferredGeo.city}` : ""}
                . Times vary by venue — tap through to confirm.
              </p>
            </div>
            <ul className="home-events-list">
              {weekendEvents.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className={`home-event-card cat-${event.category.toLowerCase()}`}
                >
                  <a href={event.url} target="_blank" rel="noreferrer">
                    <span className="event-cat-chip">{event.category}</span>
                    <strong>{event.title}</strong>
                    <span className="home-event-meta">
                      {eventWhenLabel(event)}
                      {" · "}
                      {event.ageBands
                        .map((b) => ageBandLabels[b].split(" ")[0])
                        .join(", ")}
                    </span>
                    <span className="home-event-venue">
                      {event.venue} · {event.city}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="home-escape">
          <button className="text-button" onClick={() => setView("browse")}>
            Browse all spots →
          </button>
        </div>
      </main>
      ) : view === "browse" ? (
      <main className="workspace">
        {filtersOpen && (
          <div
            className="filter-backdrop"
            role="presentation"
            onClick={() => setFiltersOpen(false)}
          />
        )}
        <aside
          id="spot-filters"
          className={`filter-panel${filtersOpen ? " is-open" : ""}`}
          aria-label="Spot filters"
        >
          <div className="panel-heading">
            <SlidersHorizontal aria-hidden="true" />
            <span>Filters</span>
            <button
              className="filter-done"
              type="button"
              onClick={() => setFiltersOpen(false)}
            >
              Done
            </button>
          </div>

          <label className="search-box">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search spots"
            />
          </label>

          {SHOW_AGE_BAND_UI && (
            <div className="filter-group">
              <span className="filter-label">Age band</span>
              <div className="segmented compact">
                <button
                  className={ageBand === "any" ? "active" : ""}
                  onClick={() => setAgeBand("any")}
                >
                  Any
                </button>
                {ageBandOptions.map(([value, label]) => (
                  <button
                    key={value}
                    className={ageBand === value ? "active" : ""}
                    onClick={() => setAgeBand(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="select-field">
            <span>Category</span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as Category | "All")
              }
            >
              <option>All</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="select-field">
            <span>Area</span>
            <select
              value={city}
              onChange={(event) => setCity(event.target.value)}
            >
              <option value="All">All ({allSpots.length})</option>
              {cityOptions.map(({ name, count }) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>

          <label className="select-field">
            <span>Cost</span>
            <select
              value={cost}
              onChange={(event) => setCost(event.target.value as Cost | "All")}
            >
              <option>All</option>
              {costs.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(event) => setOnlyOpen(event.target.checked)}
            />
            <span>Open now</span>
          </label>

          <div className="filter-group">
            <span className="filter-label">Events</span>
            <div className="segmented compact">
              {eventDateFilters.map((item) => (
                <button
                  key={item.id}
                  className={eventDateFilter === item.id ? "active" : ""}
                  type="button"
                  onClick={() => setEventDateFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="select-field">
            <span>Sort</span>
            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as "best" | "nearest" | "price" | "name")
              }
            >
              <option value="best">Best fit</option>
              <option value="nearest">
                {userLocation ? "Nearest to me" : "Nearest to SF"}
              </option>
              <option value="price">Lowest cost</option>
              <option value="name">Name</option>
            </select>
          </label>

          <div className="geo-row">
            {userLocation ? (
              <button
                className="geo-button active"
                type="button"
                onClick={clearUserLocation}
                title={`Using your location (${userLocation.lat.toFixed(2)}, ${userLocation.lon.toFixed(2)})`}
              >
                <MapPin aria-hidden="true" />
                Using my location
              </button>
            ) : (
              <button
                className="geo-button"
                type="button"
                disabled={geoState === "requesting"}
                onClick={requestUserLocation}
              >
                <MapPin aria-hidden="true" />
                {geoState === "requesting" ? "Locating…" : "Use my location"}
              </button>
            )}
          </div>
          {geoState === "denied" && (
            <p className="geo-status error">
              Location permission denied. Enable it in your browser settings to sort by distance from you.
            </p>
          )}
        </aside>

        <section className="spots-area" aria-label="Visit spots">
          {nearbyFeaturedPlans.length > 0 && (
            <section
              className="featured-rail"
              aria-label="Editor's picks — starter plans"
            >
              <div className="featured-rail-head">
                <span className="featured-rail-eyebrow">
                  Editor's picks{mapCenter ? " near this view" : ""}
                </span>
                <span className="featured-rail-sub">
                  Tap a starter plan to fork it into your own.
                </span>
              </div>
              <ul className="featured-rail-list">
                {nearbyFeaturedPlans.map((featured) => {
                  const accent = featured.accent || "park";
                  return (
                    <li
                      key={featured.id}
                      className={`featured-card accent-${accent}`}
                    >
                      <div className="featured-card-body">
                        <strong>{featured.name}</strong>
                        <span className="featured-card-summary">
                          {featured.summary}
                        </span>
                        <span className="featured-card-meta">
                          {featured.stopIds.length} place
                          {featured.stopIds.length === 1 ? "" : "s"}
                          {(featured.eventIds?.length ?? 0) > 0
                            ? ` · ${featured.eventIds!.length} event${featured.eventIds!.length === 1 ? "" : "s"}`
                            : ""}
                        </span>
                      </div>
                      <button
                        className="featured-card-use"
                        onClick={() => forkFeaturedPlan(featured)}
                      >
                        <Plus aria-hidden="true" />
                        Use plan
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <div className="map-shell">
            <SpotMap
              spots={filteredSpots}
              events={mapEvents}
              highlightedEventIds={highlightedEventIds}
              selected={mapSelection}
              onSelect={setMapSelection}
              userLocation={userLocation}
              geoState={geoState}
              onRequestLocation={requestUserLocation}
              onViewChange={setMapCenter}
            />
            <div className="map-overlay" aria-label="Map summary">
              <div>
                <strong>{filteredSpots.length}</strong> spots
              </div>
              <div>
                <strong>{mapEvents.length}</strong> events
                {highlightedEventIds.size > 0 && (
                  <span className="map-overlay-highlight">
                    · {highlightedEventIds.size} this week
                  </span>
                )}
              </div>
            </div>
            <div className="map-legend" aria-label="Map legend">
              <span>
                <span className="legend-dot dot-event-hot" /> Time-sensitive
              </span>
              <span>
                <span className="legend-dot dot-event" /> Event
              </span>
              <span>
                <span className="legend-dot dot-library" /> Library
              </span>
              <span>
                <span className="legend-dot dot-park" /> Park / outdoors
              </span>
              <span>
                <span className="legend-dot dot-spot" /> Other
              </span>
            </div>
          </div>

          {(() => {
            if (!mapSelection) return null;
            if (mapSelection.kind === "spot") {
              const spot = allSpots.find((s) => s.id === mapSelection.id);
              if (!spot) return null;
              const saved = savedIds.includes(spot.id);
              const visited = visitedIds.includes(spot.id);
              return (
                <div className="bottom-sheet" role="dialog" aria-label={spot.name}>
                  <button
                    className="bottom-sheet-close"
                    onClick={() => setMapSelection(null)}
                    aria-label="Close"
                  >
                    <X aria-hidden="true" />
                  </button>
                  <div className="sheet-spot">
                    <img
                      className="sheet-thumb"
                      src={spot.imageUrl}
                      alt={spot.name}
                      loading="lazy"
                    />
                    <div className="sheet-body">
                      <p className="spot-category">{spot.category}</p>
                      <h3>{spot.name}</h3>
                      <p className="sheet-note">{spot.note}</p>
                      <div className="sheet-meta">
                        <span>{spot.neighborhood}</span>
                        {typeof spot.googleRating === "number" && (
                          <span className="rating-chip">
                            ★ {spot.googleRating.toFixed(1)}
                            {spot.googleRatingCount
                              ? ` · ${formatRatingCount(spot.googleRatingCount)}`
                              : ""}
                          </span>
                        )}
                        <span>{spot.cost}</span>
                        {spot.openingHours &&
                          (() => {
                            const compact = compactHoursLabel(spot.openingHours);
                            return compact ? <span>{compact}</span> : null;
                          })()}
                      </div>
                      <div className="sheet-actions">
                        <button
                          className={`sheet-action ${saved ? "is-active" : ""}`}
                          onClick={() => toggleSaved(spot.id)}
                        >
                          <Bookmark aria-hidden="true" />
                          {saved ? "Saved" : "Save"}
                        </button>
                        <button
                          className={`sheet-action ${visited ? "is-active" : ""}`}
                          onClick={() => toggleVisited(spot.id)}
                        >
                          <Check aria-hidden="true" />
                          {visited ? "Visited" : "Mark visited"}
                        </button>
                        {spot.website && (
                          <a
                            className="sheet-action"
                            href={spot.website}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink aria-hidden="true" />
                            Website
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            const renderEventBody = (event: FamilyEvent) => {
              const eventDate = event.startDateTime
                ? new Date(event.startDateTime)
                : null;
              const eventSaved = savedEventIds.includes(event.id);
              return (
                <div className="sheet-event" key={event.id}>
                  <p
                    className={`event-cat-chip cat-${event.category.toLowerCase()}`}
                  >
                    Event · {event.category}
                  </p>
                  <h3>{event.title}</h3>
                  <p className="sheet-note">{event.description}</p>
                  <div className="sheet-meta">
                    <span>
                      {event.venue} · {event.city}
                    </span>
                    <span>
                      {eventDate
                        ? eventDate.toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : dayWindowLabel(event.daysOfWeek)}{" "}
                      · {event.timeWindow}
                    </span>
                    {event.cost && <span>{event.cost}</span>}
                  </div>
                  <div className="sheet-actions">
                    <button
                      className={`sheet-action ${eventSaved ? "is-active" : ""}`}
                      onClick={() => toggleSavedEvent(event.id)}
                    >
                      <Bookmark aria-hidden="true" />
                      {eventSaved ? "Saved" : "Save event"}
                    </button>
                    {activePlan &&
                      (() => {
                        const inPlan = (activePlan.eventIds ?? []).includes(
                          event.id,
                        );
                        return (
                          <button
                            className={`sheet-action ${inPlan ? "is-active" : ""}`}
                            onClick={() =>
                              inPlan
                                ? removeEventFromPlan(activePlan.id, event.id)
                                : addEventToPlan(activePlan.id, event.id)
                            }
                            title={
                              inPlan
                                ? `Remove from "${activePlan.name || "active plan"}"`
                                : `Add to "${activePlan.name || "active plan"}"`
                            }
                          >
                            <List aria-hidden="true" />
                            {inPlan ? "In plan" : "Add to plan"}
                          </button>
                        );
                      })()}
                    <a
                      className="sheet-action"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink aria-hidden="true" />
                      Open event page
                    </a>
                  </div>
                </div>
              );
            };

            if (mapSelection.kind === "event-group") {
              const groupEvents = mapSelection.ids
                .map((id) => events.find((e) => e.id === id))
                .filter((e): e is FamilyEvent => Boolean(e))
                .sort((a, b) => {
                  const aT = a.startDateTime
                    ? new Date(a.startDateTime).getTime()
                    : Infinity;
                  const bT = b.startDateTime
                    ? new Date(b.startDateTime).getTime()
                    : Infinity;
                  return aT - bT;
                });
              if (groupEvents.length === 0) return null;
              const cityLabel =
                groupEvents[0].city || groupEvents[0].venue || "this location";
              return (
                <div
                  className="bottom-sheet bottom-sheet-carousel"
                  role="dialog"
                  aria-label={`${groupEvents.length} events at ${cityLabel}`}
                >
                  <button
                    className="bottom-sheet-close"
                    onClick={() => setMapSelection(null)}
                    aria-label="Close"
                  >
                    <X aria-hidden="true" />
                  </button>
                  <div className="carousel-head">
                    <strong>
                      {groupEvents.length} events at {cityLabel}
                    </strong>
                    <span className="carousel-hint">
                      Swipe to browse · ordered by time
                    </span>
                  </div>
                  <div className="carousel-track" role="list">
                    {groupEvents.map((event) => (
                      <div
                        className="carousel-card"
                        role="listitem"
                        key={event.id}
                      >
                        {renderEventBody(event)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            const event = events.find((e) => e.id === mapSelection.id);
            if (!event) return null;
            return (
              <div
                className="bottom-sheet"
                role="dialog"
                aria-label={event.title}
              >
                <button
                  className="bottom-sheet-close"
                  onClick={() => setMapSelection(null)}
                  aria-label="Close"
                >
                  <X aria-hidden="true" />
                </button>
                {renderEventBody(event)}
              </div>
            );
          })()}

          {filteredSpots.length === 0 && mapEvents.length === 0 && (
            <div className="empty-results">
              <h3>No matches on the map</h3>
              <p>
                Your current filters didn't match any of the {allSpots.length} spots.
                Loosen them or reset.
              </p>
              <button className="primary-button" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" />
                Reset filters
              </button>
            </div>
          )}

          {geoErrorReason && (
            <GeoErrorModal
              reason={geoErrorReason}
              onClose={() => setGeoErrorReason(null)}
              onRetry={() => {
                setGeoErrorReason(null);
                requestUserLocation();
              }}
            />
          )}
          {/* legacy card grid removed — map + bottom sheet replaces it */}
          {false && (
          <div className="spot-grid">
            {paginatedSpots.map((spot) => {
              const saved = savedIds.includes(spot.id);
              const visited = visitedIds.includes(spot.id);

              return (
                <article className="spot-card" key={spot.id}>
                  <div className="spot-image-frame">
                    <img
                      src={spot.imageUrl}
                      alt={spot.name}
                      loading="lazy"
                      title={spot.imageAttribution || spot.imageSource || spot.name}
                    />
                    {spot.imageSource && spot.imageSource !== "Category fallback" && (
                      <span className="image-source-chip">{spot.imageSource}</span>
                    )}
                  </div>
                  <div className="spot-body">
                    <div className="spot-title-row">
                      <div>
                        <p className="spot-category">{spot.category}</p>
                        <h3>{spot.name}</h3>
                      </div>
                      <button
                        className={`icon-button ${saved ? "selected" : ""}`}
                        title={saved ? "Remove from saved" : "Save spot"}
                        onClick={() => toggleSaved(spot.id)}
                      >
                        <Bookmark aria-hidden="true" />
                      </button>
                    </div>

                    <p className="spot-note">{spot.note}</p>

                    {(() => {
                      const status = describeStatus(spot);
                      if (status.kind === "unknown") {
                        if (!spot.openingHours) return null;
                        const compact = compactHoursLabel(spot.openingHours);
                        return (
                          <p
                            className="hours-line muted"
                            title={compact ? spot.openingHours : undefined}
                          >
                            <Clock3 aria-hidden="true" />
                            {compact ?? `Hours: ${spot.openingHours}`}
                          </p>
                        );
                      }
                      const cls =
                        status.kind === "open" || status.kind === "always"
                          ? "open"
                          : "closed";
                      return (
                        <p className={`hours-line ${cls}`}>
                          <Clock3 aria-hidden="true" />
                          {statusLabel(status)}
                        </p>
                      );
                    })()}

                    <div className="metadata-grid">
                      <span>
                        <MapPin aria-hidden="true" />
                        {spot.neighborhood}
                      </span>
                      {(() => {
                        const d = distanceFromUser(spot);
                        return d !== null ? (
                          <span>
                            <MapPin aria-hidden="true" />
                            {d < 1
                              ? `${(d * 5280).toFixed(0)} ft away`
                              : `${d.toFixed(1)} mi away`}
                          </span>
                        ) : (
                          <span>
                            <Clock3 aria-hidden="true" />
                            {spot.transitMinutes} min
                          </span>
                        );
                      })()}
                      {typeof spot.googleRating === "number" && (
                        <span
                          className="rating-chip"
                          title={
                            spot.googleRatingCount
                              ? `Google rating · ${spot.googleRatingCount.toLocaleString()} reviews`
                              : "Google rating"
                          }
                        >
                          ★ {spot.googleRating.toFixed(1)}
                          {spot.googleRatingCount
                            ? ` · ${formatRatingCount(spot.googleRatingCount)}`
                            : ""}
                        </span>
                      )}
                      <span>{spot.cost}</span>
                    </div>

                    {(() => {
                      const visibleTags = spot.tags
                        .filter((item) => {
                          const lower = item.toLowerCase();
                          if (lower === spot.category.toLowerCase()) return false;
                          if (lower === "friends") return false;
                          return true;
                        })
                        .slice(0, 4);
                      const hasFeatures =
                        spot.wheelchair === "yes" ||
                        spot.wheelchair === "limited" ||
                        spot.dogsAllowed === true ||
                        spot.kidsFriendly === true ||
                        spot.parkingNearby === true;
                      if (!hasFeatures && visibleTags.length === 0) return null;
                      return (
                        <div className="tag-row">
                          {spot.kidsFriendly === true && (
                            <span className="chip-feature" title="Kid-friendly">
                              👶 Kids
                            </span>
                          )}
                          {spot.wheelchair === "yes" && (
                            <span className="chip-feature" title="Wheelchair accessible">
                              ♿ Accessible
                            </span>
                          )}
                          {spot.wheelchair === "limited" && (
                            <span className="chip-feature" title="Wheelchair access limited">
                              ♿ Limited
                            </span>
                          )}
                          {spot.dogsAllowed === true && (
                            <span className="chip-feature" title="Dogs allowed">
                              🐕 Dogs OK
                            </span>
                          )}
                          {spot.parkingNearby === true && (
                            <span className="chip-feature" title="Parking on site">
                              🅿 Parking
                            </span>
                          )}
                          {visibleTags.map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                      );
                    })()}

                    <div className="card-footer">
                      {spot.website ? (
                        <a
                          className="text-button"
                          href={spot.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Website
                          <ExternalLink aria-hidden="true" />
                        </a>
                      ) : (
                        <span />
                      )}
                      <button
                        className={`text-button ${visited ? "is-active" : ""}`}
                        onClick={() => toggleVisited(spot.id)}
                      >
                        {visited ? (
                          <>
                            <Check aria-hidden="true" />
                            Visited
                          </>
                        ) : (
                          "Mark visited"
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          )}

          {false && filteredSpots.length > 0 && (
            <div className="pagination-bar" aria-label="Spot pagination">
              <span>
                Showing {pageStart + 1}-{pageEnd} of {filteredSpots.length}
              </span>
              <label>
                <span>Per page</span>
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                >
                  {pageSizeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pagination-controls">
                <button
                  className="icon-button"
                  disabled={safePage === 1}
                  title="Previous page"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <span>
                  Page {safePage} of {pageCount}
                </span>
                <button
                  className="icon-button"
                  disabled={safePage === pageCount}
                  title="Next page"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="plan-panel" aria-label="Saved spots and events">
          <div className="panel-heading">
            <Bookmark aria-hidden="true" />
            <span>Saved</span>
          </div>
          {savedSpots.length === 0 && savedEvents.length === 0 ? (
            <p className="empty-state">
              Save a few places or events from the map to plan your day.
            </p>
          ) : (
            <>
              {savedSpots.length > 0 && (
                <button
                  className="primary-button wide"
                  onClick={() => createPlanFromSaved()}
                  title="Create a plan with all saved places in order"
                >
                  <List aria-hidden="true" />
                  Plan from places ({savedSpots.length})
                </button>
              )}
              {savedSpots.length > 0 && (
                <>
                  <p className="saved-subhead">Places ({savedSpots.length})</p>
                  <div className="saved-list">
                    {savedSpots.map((spot) => (
                      <div className="saved-item" key={spot.id}>
                        <div>
                          <strong>{spot.name}</strong>
                          <span>{spot.neighborhood}</span>
                        </div>
                        <button
                          className="icon-button"
                          title="Remove saved place"
                          onClick={() => toggleSaved(spot.id)}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {savedEvents.length > 0 && (() => {
                const expiredIds = savedEvents
                  .filter((e) => isEventExpired(e))
                  .map((e) => e.id);
                return (
                  <>
                    <div className="saved-subhead-row">
                      <p className="saved-subhead">
                        Events ({savedEvents.length})
                      </p>
                      {expiredIds.length > 0 && (
                        <button
                          className="text-button saved-clear-past"
                          title={`Remove ${expiredIds.length} past event${expiredIds.length === 1 ? "" : "s"}`}
                          onClick={() =>
                            setSavedEventIds((current) =>
                              current.filter((id) => !expiredIds.includes(id)),
                            )
                          }
                        >
                          Clear past ({expiredIds.length})
                        </button>
                      )}
                    </div>
                    <div className="saved-event-groups">
                      {savedEventGroups.map((group) => (
                        <div className="saved-event-group" key={group.key}>
                          <div className="saved-event-date-row">
                            <h3 className="saved-event-date">{group.label}</h3>
                            <span className="saved-event-count">
                              {group.events.length} event{group.events.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="saved-list">
                            {group.events.map((event) => {
                              const expired = isEventExpired(event);
                              const timeLabel = eventTimeLabel(event);
                              const detail = [timeLabel, event.venue]
                                .filter(Boolean)
                                .join(" · ");
                              return (
                                <div
                                  className={`saved-item ${expired ? "is-past" : ""}`}
                                  key={event.id}
                                >
                                  <div>
                                    <strong>
                                      {expired && (
                                        <span className="past-pill">Past</span>
                                      )}
                                      {event.title}
                                    </strong>
                                    {detail && <span>{detail}</span>}
                                  </div>
                                  <button
                                    className="icon-button"
                                    title="Remove saved event"
                                    onClick={() => toggleSavedEvent(event.id)}
                                  >
                                    <Trash2 aria-hidden="true" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </aside>
      </main>
      ) : (
      <main className="plans-workspace" aria-label="Plans">
        <aside className="plan-list-panel" aria-label="Saved plans">
          <div className="panel-heading">
            <List aria-hidden="true" />
            <span>Plans</span>
          </div>
          <button className="primary-button wide" onClick={createPlan}>
            <Plus aria-hidden="true" />
            New plan
          </button>

          {plans.length === 0 ? (
            <p className="empty-state">
              Build a small itinerary from your saved spots.
            </p>
          ) : (
            <div className="plan-list">
              {plans.map((plan) => {
                const isActive = plan.id === activePlanId;
                return (
                  <div
                    key={plan.id}
                    className={`plan-list-item ${isActive ? "active" : ""}`}
                  >
                    <button
                      className="plan-list-item-open"
                      onClick={() => setActivePlanId(plan.id)}
                    >
                      <strong>{plan.name || "Untitled plan"}</strong>
                      <span>
                        {plan.stopIds.length} stop
                        {plan.stopIds.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    <button
                      className="plan-list-item-delete"
                      title="Delete plan"
                      aria-label={`Delete ${plan.name || "untitled plan"}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (
                          window.confirm(
                            `Delete "${plan.name || "Untitled plan"}"? This can't be undone.`,
                          )
                        ) {
                          deletePlan(plan.id);
                        }
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <section className="plan-detail-area" aria-label="Plan detail">
          {!activePlan ? (
            <div className="plan-empty">
              <p>Select a plan or create a new one to start chaining stops.</p>
            </div>
          ) : (
            <div className="plan-detail">
              <input
                className="plan-name-input"
                value={activePlan.name}
                onChange={(event) =>
                  updatePlan(activePlan.id, { name: event.target.value })
                }
                placeholder="Plan name"
              />

              <div className="plan-summary">
                {activePlan.source === "ai" && (
                  <span className="badge-ai">
                    <Sparkles aria-hidden="true" />
                    AI suggested
                    {activePlan.vibe ? ` · ${APP_VIBE_LABELS[activePlan.vibe]}` : ""}
                  </span>
                )}
                <span>
                  {activePlanStops.length} stop
                  {activePlanStops.length === 1 ? "" : "s"}
                </span>
                {activePlanEvents.length > 0 && (
                  <span>
                    {activePlanEvents.length} event
                    {activePlanEvents.length === 1 ? "" : "s"}
                  </span>
                )}
                <span>~{planTotalTransit} min total transit</span>
                {activePlanStops.length > 0 && (
                  <span>
                    {Array.from(
                      new Set(activePlanStops.map((stop) => stop.neighborhood)),
                    ).join(" → ")}
                  </span>
                )}
              </div>

              {activePlan.summary && (
                <p className="plan-ai-summary">{activePlan.summary}</p>
              )}
              {swapBusyStopId && (
                <p className="plan-ai-summary">Swapping with AI…</p>
              )}
              {swapError && !swapBusyStopId && (
                <p className="plan-ai-summary" style={{ borderLeftColor: "var(--coral)" }}>
                  {swapError}
                </p>
              )}
              {activePlan.rationale && activePlan.rationale.length > 0 && (
                <ul className="plan-rationale">
                  {activePlan.rationale.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}

              {activePlanItems.length > 0 && (
                <PlanMap
                  stops={activePlanStops}
                  events={activePlanEvents}
                  items={activePlanItems
                    .map((it) => {
                      if (it.kind === "spot") {
                        if (
                          typeof it.spot.lat !== "number" ||
                          typeof it.spot.lon !== "number"
                        ) {
                          return null;
                        }
                        return {
                          kind: "spot" as const,
                          lat: it.spot.lat,
                          lon: it.spot.lon,
                          label: it.spot.name,
                          sublabel: `${it.spot.neighborhood} · ${it.spot.category}`,
                        };
                      }
                      const date = it.event.startDateTime
                        ? new Date(it.event.startDateTime)
                        : null;
                      const when = date
                        ? date.toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : it.event.timeWindow;
                      return {
                        kind: "event" as const,
                        lat: it.event.lat,
                        lon: it.event.lon,
                        label: it.event.title,
                        sublabel: `${when} · ${it.event.venue}`,
                      };
                    })
                    .filter((x): x is PlanMapItem => x !== null)}
                />
              )}

              {(() => {
                const dates = new Set(
                  activePlanEvents
                    .map((e) =>
                      e.startDateTime
                        ? new Date(e.startDateTime).toDateString()
                        : null,
                    )
                    .filter((d): d is string => Boolean(d)),
                );
                if (dates.size > 1) {
                  return (
                    <p className="plan-warning">
                      ⚠ Events span {dates.size} different days — this plan
                      covers more than one day.
                    </p>
                  );
                }
                return null;
              })()}

              {activePlanItems.length === 0 ? (
                <p className="empty-state">
                  Add places or events from your saved list to build the day.
                </p>
              ) : (
                <ol className="plan-stops">
                  {activePlanItems.map((item, index, arr) => {
                    const isLast = index === arr.length - 1;
                    // Move-up/down buttons swap within the order the user
                    // actually sees, not within plan.stopIds/eventIds — so
                    // legacy plans without itemOrder behave correctly too.
                    const visibleOrder: PlanItemRef[] = arr.map((it) => ({
                      kind: it.kind,
                      id: it.id,
                    }));
                    if (item.kind === "spot") {
                      const spot = item.spot;
                      const aiReason = activePlan.picks?.find(
                        (pick) => pick.id === spot.id,
                      )?.reason;
                      return (
                        <li className="plan-stop" key={`spot:${spot.id}`}>
                          <span className="plan-stop-index">{index + 1}</span>
                          <div className="plan-stop-info">
                            <strong>{spot.name}</strong>
                            <span>
                              {spot.neighborhood} · {spot.category} · {spot.cost} ·{" "}
                              {spot.transitMinutes} min
                              {typeof spot.googleRating === "number" && (
                                <>
                                  {" "}· ★ {spot.googleRating.toFixed(1)}
                                  {spot.googleRatingCount
                                    ? ` (${formatRatingCount(spot.googleRatingCount)})`
                                    : ""}
                                </>
                              )}
                            </span>
                            {aiReason && (
                              <em className="plan-stop-reason">{aiReason}</em>
                            )}
                          </div>
                          <div className="plan-stop-actions">
                            <button
                              title="Move up"
                              disabled={index === 0}
                              onClick={() =>
                                moveItemInPlan(
                                  activePlan.id,
                                  visibleOrder,
                                  { kind: "spot", id: spot.id },
                                  -1,
                                )
                              }
                            >
                              <ArrowUp aria-hidden="true" />
                            </button>
                            <button
                              title="Move down"
                              disabled={isLast}
                              onClick={() =>
                                moveItemInPlan(
                                  activePlan.id,
                                  visibleOrder,
                                  { kind: "spot", id: spot.id },
                                  1,
                                )
                              }
                            >
                              <ArrowDown aria-hidden="true" />
                            </button>
                            <button
                              title="Remove from plan"
                              onClick={() =>
                                removeStopFromPlan(activePlan.id, spot.id)
                              }
                            >
                              <X aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      );
                    }
                    const event = item.event;
                    const date = event.startDateTime
                      ? new Date(event.startDateTime)
                      : null;
                    return (
                      <li
                        className="plan-stop plan-stop-event"
                        key={`event:${event.id}`}
                      >
                        <span className="plan-stop-index plan-stop-index-event">
                          {index + 1}
                        </span>
                        <div className="plan-stop-info">
                          <strong>
                            <span className="plan-event-tag">EVENT</span>{" "}
                            {event.title}
                          </strong>
                          <span>
                            {date
                              ? date.toLocaleDateString(undefined, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                })
                              : dayWindowLabel(event.daysOfWeek)}
                            {date
                              ? ` · ${date.toLocaleTimeString(undefined, {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}`
                              : ` · ${event.timeWindow}`}{" "}
                            · {event.venue}
                            {event.cost ? ` · ${event.cost}` : ""}
                          </span>
                        </div>
                        <div className="plan-stop-actions">
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open event page"
                          >
                            <ExternalLink aria-hidden="true" />
                          </a>
                          <button
                            title="Move up"
                            disabled={index === 0}
                            onClick={() =>
                              moveItemInPlan(
                                activePlan.id,
                                visibleOrder,
                                { kind: "event", id: event.id },
                                -1,
                              )
                            }
                          >
                            <ArrowUp aria-hidden="true" />
                          </button>
                          <button
                            title="Move down"
                            disabled={isLast}
                            onClick={() =>
                              moveItemInPlan(
                                activePlan.id,
                                visibleOrder,
                                { kind: "event", id: event.id },
                                1,
                              )
                            }
                          >
                            <ArrowDown aria-hidden="true" />
                          </button>
                          <button
                            title="Remove event from plan"
                            onClick={() =>
                              removeEventFromPlan(activePlan.id, event.id)
                            }
                          >
                            <X aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="plan-add-row">
                <select
                  value=""
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) return;
                    if (value.startsWith("event:")) {
                      addEventToPlan(activePlan.id, value.slice(6));
                    } else if (value.startsWith("spot:")) {
                      addStopToPlan(activePlan.id, value.slice(5));
                    }
                    setAddStopChoice("");
                    e.target.value = "";
                  }}
                >
                  <option value="">
                    {addableSavedSpots.length === 0 &&
                    addableSavedEvents.length === 0
                      ? "No saved items left to add"
                      : "Pick a saved place or event to add…"}
                  </option>
                  {addableSavedSpots.length > 0 && (
                    <optgroup label="Places">
                      {addableSavedSpots.map((spot) => (
                        <option key={spot.id} value={`spot:${spot.id}`}>
                          {spot.name} — {spot.neighborhood}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {addableSavedEvents.length > 0 && (
                    <optgroup label="Events">
                      {addableSavedEvents.map((event) => {
                        const date = event.startDateTime
                          ? new Date(event.startDateTime).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )
                          : null;
                        return (
                          <option key={event.id} value={`event:${event.id}`}>
                            {event.title}
                            {date ? ` — ${date}` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="plan-actions">
                <button
                  className="primary-button"
                  disabled={
                    !API_CONFIGURED ||
                    (activePlanStops.length === 0 &&
                      activePlanEvents.length === 0) ||
                    shareState.status === "sharing"
                  }
                  title={
                    !API_CONFIGURED
                      ? "Backend not deployed in this preview"
                      : activePlanStops.length === 0 &&
                          activePlanEvents.length === 0
                        ? "Add at least one place or event"
                        : "Share this plan for voting"
                  }
                  onClick={sharePlan}
                >
                  <Share2 aria-hidden="true" />
                  {shareState.status === "sharing"
                    ? "Sharing…"
                    : activePlan.pollId
                      ? "Re-share"
                      : "Share for voting"}
                </button>
                <button
                  className="danger-button"
                  onClick={() => deletePlan(activePlan.id)}
                >
                  <Trash2 aria-hidden="true" />
                  Delete plan
                </button>
              </div>

              {shareState.status === "shared" && shareState.url && (
                <div className="share-banner">
                  <strong>Link copied to clipboard.</strong>
                  <a href={shareState.url}>{shareState.url}</a>
                  <ShareQuickLinks
                    url={shareState.url}
                    title={activePlan.name || "Untitled plan"}
                  />
                </div>
              )}
              {shareState.status === "error" && (
                <div className="share-banner error">
                  <strong>Sharing failed.</strong>
                  <span>{shareState.error}</span>
                </div>
              )}
              {activePlan.pollId && shareState.status === "idle" && (
                <div className="share-banner">
                  <strong>Already shared.</strong>
                  <a href={`${window.location.origin}/#/p/${activePlan.pollId}`}>
                    {`${window.location.origin}/#/p/${activePlan.pollId}`}
                  </a>
                  <ShareQuickLinks
                    url={`${window.location.origin}/#/p/${activePlan.pollId}`}
                    title={activePlan.name || "Untitled plan"}
                  />
                </div>
              )}

              {planNearbyEvents.length > 0 && (
                <section className="plan-nearby" aria-label="Events near this plan">
                  <h3>While you're nearby this weekend</h3>
                  <p className="plan-events-sub">
                    {planNearbyEvents.length} family program
                    {planNearbyEvents.length === 1 ? "" : "s"} within 4 mi of a
                    plan stop, in the next 7 days. Scroll for more →
                  </p>
                  <ul className="plan-nearby-rail">
                    {planNearbyEvents.map((event) => (
                      <li
                        key={event.id}
                        className={`plan-nearby-card cat-${event.category.toLowerCase()}`}
                      >
                        <span className="event-cat-chip">{event.category}</span>
                        <strong>{event.title}</strong>
                        <span className="plan-nearby-when">
                          {eventWhenLabel(event)}
                        </span>
                        <span className="plan-nearby-venue">
                          {event.venue} · {event.city}
                        </span>
                        <div className="plan-nearby-actions">
                          <button
                            className="plan-nearby-add"
                            title={`Add to "${activePlan.name || "active plan"}"`}
                            onClick={() => addEventToPlan(activePlan.id, event.id)}
                          >
                            <Plus aria-hidden="true" />
                            Add to plan
                          </button>
                          <a
                            className="plan-nearby-open"
                            href={event.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open event page"
                            aria-label="Open event page"
                          >
                            <ExternalLink aria-hidden="true" />
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {activePlan.cautions && activePlan.cautions.length > 0 && (
                <div className="plan-cautions">
                  {activePlan.cautions.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {activePlan.aiModel && (
                    <span>Generated by {activePlan.aiModel}.</span>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      )}

      {isAdding && (
        <div className="modal-backdrop" role="presentation">
          <form className="spot-form" onSubmit={addSpot}>
            <div className="form-heading">
              <div>
                <p className="eyebrow">New idea</p>
                <h2>Add a spot</h2>
              </div>
              <button
                className="icon-button"
                title="Close"
                type="button"
                onClick={() => setIsAdding(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <label>
              <span>Name</span>
              <input
                value={newSpot.name}
                onChange={(event) =>
                  setNewSpot((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                autoFocus
              />
            </label>

            <label>
              <span>Neighborhood</span>
              <input
                value={newSpot.neighborhood}
                onChange={(event) =>
                  setNewSpot((current) => ({
                    ...current,
                    neighborhood: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Category</span>
              <select
                value={newSpot.category}
                onChange={(event) =>
                  setNewSpot((current) => ({
                    ...current,
                    category: event.target.value as Category,
                  }))
                }
              >
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Cost</span>
              <select
                value={newSpot.cost}
                onChange={(event) =>
                  setNewSpot((current) => ({
                    ...current,
                    cost: event.target.value as Cost,
                  }))
                }
              >
                {costs.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Note</span>
              <textarea
                value={newSpot.note}
                onChange={(event) =>
                  setNewSpot((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                rows={4}
              />
            </label>

            <button className="primary-button wide" type="submit">
              <Plus aria-hidden="true" />
              Save spot
            </button>
          </form>
        </div>
      )}

      <footer className="app-footer">
        <div className="app-footer-inner">
          <div className="app-footer-brand">
            <strong>{APP_BRAND}</strong>
            <span>{APP_TAGLINE}</span>
          </div>
          <div className="app-footer-meta">
            <span>© {new Date().getFullYear()} {APP_BRAND}</span>
            <span aria-hidden="true">·</span>
            <span>
              Map &amp; place data ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenStreetMap
              </a>{" "}
              contributors, licensed under{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/"
                target="_blank"
                rel="noopener noreferrer"
              >
                ODbL
              </a>
              .
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function GeoErrorModal({
  reason,
  onRetry,
  onClose,
}: {
  reason: "denied" | "unavailable" | "timeout" | "unsupported";
  onRetry: () => void;
  onClose: () => void;
}) {
  const ua =
    typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isIosChrome = isIos && /CriOS/.test(ua);
  const isIosSafari = isIos && !isIosChrome && /Safari/.test(ua);
  const isAndroid = /Android/.test(ua);
  const browserName = isIosChrome
    ? "Chrome"
    : isIosSafari
      ? "Safari"
      : "your browser";

  let title = "Allow location to find spots near you";
  let lead =
    "We need your permission to read your device location.";
  if (reason === "unavailable") {
    title = "Couldn't get a location fix";
    lead =
      "Location Services may be off, or your device can't get a fix right now.";
  } else if (reason === "timeout") {
    title = "Location request timed out";
    lead = "We didn't hear back in time. Try again with a stronger signal.";
  } else if (reason === "unsupported") {
    title = "This browser doesn't support location";
    lead = "Try Safari or Chrome, or pick a city manually in the filters.";
  }

  return (
    <div
      className="geo-error-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="geo-error-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="geo-error-close"
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          <X aria-hidden="true" />
        </button>
        <h3>{title}</h3>
        <p className="geo-error-lead">{lead}</p>

        {reason === "denied" && (
          <div className="geo-error-steps">
            {isIosChrome && (
              <>
                <p className="geo-error-platform">On iOS Chrome</p>
                <ol>
                  <li>
                    Open the iOS <strong>Settings</strong> app (the grey gears
                    icon, not Chrome's menu).
                  </li>
                  <li>
                    Scroll down and tap <strong>Chrome</strong>.
                  </li>
                  <li>
                    Tap <strong>Location</strong> and choose{" "}
                    <strong>While Using the App</strong>.
                  </li>
                  <li>
                    Come back to this tab and tap{" "}
                    <strong>Try again</strong> below.
                  </li>
                </ol>
              </>
            )}
            {isIosSafari && (
              <>
                <p className="geo-error-platform">On iOS Safari</p>
                <ol>
                  <li>
                    Open the iOS <strong>Settings</strong> app.
                  </li>
                  <li>
                    Scroll to <strong>Safari</strong> → <strong>Location</strong>.
                  </li>
                  <li>
                    Choose <strong>Ask</strong> or{" "}
                    <strong>Allow</strong>.
                  </li>
                  <li>
                    Reload famhop.com — Safari will prompt again on the next tap.
                  </li>
                </ol>
              </>
            )}
            {isAndroid && (
              <>
                <p className="geo-error-platform">On Android</p>
                <ol>
                  <li>
                    Tap the <strong>lock icon</strong> in {browserName}'s
                    address bar.
                  </li>
                  <li>
                    Tap <strong>Permissions</strong> → <strong>Location</strong>.
                  </li>
                  <li>
                    Switch <strong>Location</strong> on, then tap{" "}
                    <strong>Try again</strong>.
                  </li>
                </ol>
              </>
            )}
            {!isIos && !isAndroid && (
              <>
                <p className="geo-error-platform">On desktop</p>
                <ol>
                  <li>
                    Click the <strong>lock icon</strong> in the address bar at{" "}
                    <code>famhop.com</code>.
                  </li>
                  <li>
                    Find <strong>Location</strong> and switch it to{" "}
                    <strong>Allow</strong>.
                  </li>
                  <li>
                    Tap <strong>Try again</strong> below.
                  </li>
                </ol>
              </>
            )}
          </div>
        )}

        <div className="geo-error-actions">
          <button
            type="button"
            className="primary-button"
            onClick={onRetry}
          >
            Try again
          </button>
          <button
            type="button"
            className="text-button geo-error-dismiss"
            onClick={onClose}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareQuickLinks({ url, title }: { url: string; title: string }) {
  const text = `Vote on "${title}" — ${url}`;
  const enc = encodeURIComponent(text);
  const subject = encodeURIComponent(`Vote on "${title}"`);
  const body = encodeURIComponent(`${text}`);
  const isApple =
    typeof navigator !== "undefined" &&
    /(iPhone|iPad|iPod|Macintosh)/i.test(navigator.userAgent);
  const smsHref = isApple ? `sms:&body=${enc}` : `sms:?body=${enc}`;

  async function nativeShare() {
    if (typeof navigator !== "undefined" && (navigator as Navigator).share) {
      try {
        await (navigator as Navigator).share({ title, text, url });
      } catch {
        /* user cancelled */
      }
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  const canNativeShare =
    typeof navigator !== "undefined" && !!(navigator as Navigator).share;

  return (
    <div className="share-quick-links" role="group" aria-label="Share via">
      <a
        className="share-quick-link sms"
        href={smsHref}
        aria-label="Share via Messages"
      >
        <MessageCircle aria-hidden="true" /> Messages
      </a>
      <a
        className="share-quick-link whatsapp"
        href={`https://wa.me/?text=${enc}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Share via WhatsApp"
      >
        <MessageCircle aria-hidden="true" /> WhatsApp
      </a>
      <a
        className="share-quick-link email"
        href={`mailto:?subject=${subject}&body=${body}`}
        aria-label="Share via Email"
      >
        <Mail aria-hidden="true" /> Email
      </a>
      {canNativeShare && (
        <button
          type="button"
          className="share-quick-link native"
          onClick={nativeShare}
          aria-label="More share options"
        >
          <Share2 aria-hidden="true" /> More
        </button>
      )}
      <button
        type="button"
        className="share-quick-link copy"
        onClick={copyLink}
        aria-label="Copy link"
      >
        <Copy aria-hidden="true" /> Copy
      </button>
    </div>
  );
}

export default App;
