import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  List,
  MapPin,
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
import L, { type LayerGroup, type Map as LeafletMap } from "leaflet";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  rankForVibe,
  scoreSpotForVibe,
  vibeLabels,
  type AgeBand,
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

type Spot = {
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
};

type FamilyEvent = {
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
  cost: string;
  url: string;
  sourceName?: string;
  sourceMode?: string;
  verified: boolean;
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

export type Plan = {
  id: string;
  name: string;
  stopIds: string[];
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
};

const categories: Category[] = [
  "Outdoors",
  "Food",
  "Culture",
  "Wellness",
  "Shopping",
];

const ageBandOptions = Object.entries(ageBandLabels) as Array<[AgeBand, string]>;

const PREFERENCE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: "stroller-friendly", label: "Stroller-friendly", hint: "Smooth paths, no stairs-only" },
  { id: "no-crowds", label: "No big crowds", hint: "Avoid busy weekend museums" },
  { id: "loves-animals", label: "Loves animals", hint: "Bias toward zoos / farms / wildlife" },
  { id: "indoor-when-rainy", label: "Indoor if rainy", hint: "Hard rule when forecast is wet" },
  { id: "near-only", label: "Within 30 min", hint: "Skip far stops" },
  { id: "free-only", label: "Free / cheap only", hint: "Avoid $$$ admission" },
];

const costs: Cost[] = ["Free", "$", "$$", "$$$", "Unknown"];
const vibeOptions = Object.entries(vibeLabels) as Array<[PlannerVibe, string]>;

const vibeBlurbs: Record<PlannerVibe, string> = {
  balanced: "A bit of everything",
  "low-effort": "Walk-in, easy outings",
  active: "Run them around",
  "food-first": "Family-friendly bites",
  culture: "Museums, libraries, story-time",
};

function vibeBlurb(vibe: PlannerVibe): string {
  return vibeBlurbs[vibe];
}

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayWindowLabel(days: number[]): string {
  if (!days || days.length === 0) return "Weekly";
  if (days.length === 1) return SHORT_DAY[days[0]] ?? "Weekly";
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => SHORT_DAY[d] ?? "?").join(" / ");
}

function weatherTone(label: string): "wet" | "dry" | "mixed" {
  const wet = ["Rainy", "Drizzly", "Stormy", "Showers", "Snowy"];
  const dry = ["Clear", "Mostly sunny"];
  if (wet.includes(label)) return "wet";
  if (dry.includes(label)) return "dry";
  return "mixed";
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

const DATA_URL = `${import.meta.env.BASE_URL}data/bay-area-spots.json`;
const EVENTS_URL = `${import.meta.env.BASE_URL}data/events.json`;
const BOA_MUSEUMS_URL = `${import.meta.env.BASE_URL}data/boa-museums.json`;
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

const bayAreaMapCenter: [number, number] = [37.7749, -122.4194];

function SpotMap({ spots }: { spots: Spot[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  const plottedSpots = useMemo(
    () =>
      spots.filter(
        (spot) =>
          typeof spot.lat === "number" &&
          typeof spot.lon === "number" &&
          Number.isFinite(spot.lat) &&
          Number.isFinite(spot.lon),
      ),
    [spots],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      center: bayAreaMapCenter,
      zoom: 9,
      scrollWheelZoom: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
      return;
    }

    layer.clearLayers();

    if (plottedSpots.length === 0) {
      map.setView(bayAreaMapCenter, 9);
      return;
    }

    const points: Array<[number, number]> = [];
    for (const spot of plottedSpots) {
      const lat = spot.lat as number;
      const lon = spot.lon as number;
      points.push([lat, lon]);
      L.circleMarker([lat, lon], {
        radius: 5,
        color: "#276749",
        weight: 1,
        fillColor: "#276749",
        fillOpacity: 0.7,
      })
        .bindPopup(
          `<strong>${spot.name}</strong><br/>${spot.neighborhood} · ${spot.category}`,
        )
        .addTo(layer);
    }

    if (points.length === 1) {
      map.setView(points[0], 13);
    } else {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { maxZoom: 13, padding: [28, 28] });
    }
  }, [plottedSpots]);

  return (
    <section className="map-panel" aria-label="Map of filtered Bay Area spots">
      <div className="map-copy">
        <p>Map view</p>
        <h2>Where the current matches are clustered</h2>
      </div>
      <div className="map-meta">
        <span>{plottedSpots.length} mapped</span>
        <span>{spots.length - plottedSpots.length} without coordinates</span>
      </div>
      <div className="map-canvas" ref={containerRef} />
    </section>
  );
}

function PlanMap({ stops }: { stops: Spot[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  const plotted = useMemo(
    () =>
      stops.filter(
        (s) =>
          typeof s.lat === "number" &&
          typeof s.lon === "number" &&
          Number.isFinite(s.lat) &&
          Number.isFinite(s.lon),
      ),
    [stops],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: bayAreaMapCenter,
      zoom: 11,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (plotted.length === 0) {
      map.setView(bayAreaMapCenter, 10);
      return;
    }
    const points: Array<[number, number]> = [];
    plotted.forEach((spot, idx) => {
      const lat = spot.lat as number;
      const lon = spot.lon as number;
      points.push([lat, lon]);
      const icon = L.divIcon({
        className: "plan-pin",
        html: `<span>${idx + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([lat, lon], { icon })
        .bindPopup(
          `<strong>${idx + 1}. ${spot.name}</strong><br/>${spot.neighborhood} · ${spot.category}`,
        )
        .addTo(layer);
    });
    if (points.length > 1) {
      L.polyline(points, {
        color: "#276749",
        weight: 3,
        opacity: 0.65,
        dashArray: "6 8",
      }).addTo(layer);
    }
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(points), {
        maxZoom: 14,
        padding: [40, 40],
      });
    }
  }, [plotted]);

  if (stops.length === 0) return null;

  return (
    <div
      className="plan-map"
      role="img"
      aria-label="Map of plan stops in order"
      ref={containerRef}
    />
  );
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
  const [sortBy, setSortBy] = useState<"best" | "nearest" | "price" | "name">(
    "best",
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [savedIds, setSavedIds] = useState<string[]>(() =>
    readStoredArray("saturday.savedSpots", []),
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
  const [view, setView] = useState<"home" | "browse" | "plans">("home");
  const [inferredGeo, setInferredGeo] = useState<{ city: string | null; lat: number | null; lon: number | null } | null>(null);
  const [homeBusy, setHomeBusy] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
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
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [boaMuseums, setBoaMuseums] = useState<BoaMuseum[]>([]);
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [preferences, setPreferences] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem("saturday.preferences");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
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

    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Data request failed: ${response.status}`);
        }

        return response.json() as Promise<SpotDataset>;
      })
      .then((dataset) => {
        if (!active) {
          return;
        }

        if (!Array.isArray(dataset.spots) || dataset.spots.length === 0) {
          throw new Error("Data file does not contain spots.");
        }

        setRemoteSpots(dataset.spots);
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
        setEvents(adminPayload.events as FamilyEvent[]);
        return;
      }
      try {
        const response = await fetch(EVENTS_URL);
        if (!response.ok) return;
        const dataset = (await response.json()) as EventsDataset;
        if (!active) return;
        if (Array.isArray(dataset.events)) setEvents(dataset.events);
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
    if (!inferredGeo?.lat || !inferredGeo?.lon) return;
    let active = true;
    fetchWeather(inferredGeo.lat, inferredGeo.lon).then((forecast) => {
      if (!active) return;
      if (forecast) setWeather(forecast);
    });
    return () => {
      active = false;
    };
  }, [inferredGeo]);

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
        });
        if (signInButtonRef.current) {
          signInButtonRef.current.innerHTML = "";
          window.google.accounts.id.renderButton(signInButtonRef.current, {
            theme: "outline",
            size: "medium",
            text: "signin_with",
            shape: "pill",
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
  }

  useEffect(() => {
    setAiState({ status: "idle" });
  }, [category, city, ageBand, cost, onlyOpen, query, savedIds, vibe]);

  useEffect(() => {
    setPage(1);
  }, [category, city, ageBand, cost, onlyOpen, pageSize, query, sortBy, vibe]);

  const allSpots = useMemo(() => [...remoteSpots, ...customSpots], [customSpots, remoteSpots]);

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const spot of allSpots) {
      counts.set(spot.neighborhood, (counts.get(spot.neighborhood) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => ({ name, count }));
  }, [allSpots]);

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
      const leftScore = scoreSpotForVibe(left, vibe, ageBand === "any" ? undefined : ageBand);
      const rightScore = scoreSpotForVibe(right, vibe, ageBand === "any" ? undefined : ageBand);
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
  }, [allSpots, category, city, ageBand, cost, onlyOpen, query, sortBy, vibe, userLocation]);

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

  const boaWeekend = useMemo(() => nextBoaWeekend(new Date()), []);
  const boaIsThisWeekend = useMemo(() => {
    const now = new Date();
    const sundayEnd = new Date(boaWeekend.sunday);
    sundayEnd.setHours(23, 59, 59, 999);
    const saturdayStart = new Date(boaWeekend.saturday);
    saturdayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    return saturdayStart <= now
      ? now <= sundayEnd
      : (saturdayStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 7;
  }, [boaWeekend]);

  const weekendEvents = useMemo(() => {
    if (events.length === 0) return [] as FamilyEvent[];
    const matching = events.filter((event) => {
      const isWeekend = event.daysOfWeek.some((d) => d === 0 || d === 6);
      if (!isWeekend) return false;
      if (ageBand !== "any" && !event.ageBands.includes(ageBand)) return false;
      return true;
    });
    if (!inferredGeo?.lat || !inferredGeo?.lon) return matching;
    const here = { lat: inferredGeo.lat, lon: inferredGeo.lon };
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
  }, [events, ageBand, inferredGeo]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (query) n += 1;
    if (ageBand !== "any") n += 1;
    if (category !== "All") n += 1;
    if (city !== "All") n += 1;
    if (cost !== "All") n += 1;
    if (onlyOpen) n += 1;
    return n;
  }, [query, ageBand, category, city, cost, onlyOpen]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [plans, activePlanId],
  );

  const activePlanStops = useMemo(() => {
    if (!activePlan) {
      return [];
    }
    const byId = new Map(allSpots.map((spot) => [spot.id, spot] as const));
    return activePlan.stopIds
      .map((id) => byId.get(id))
      .filter((spot): spot is Spot => Boolean(spot));
  }, [activePlan, allSpots]);

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
    const NEAR_RADIUS = 2.5;
    const seen = new Set<string>();
    const matches: Array<{ event: FamilyEvent; dist: number }> = [];
    for (const event of events) {
      if (seen.has(event.id)) continue;
      if (!event.daysOfWeek.some((d) => d === 0 || d === 6)) continue;
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
    return matches.slice(0, 4).map((m) => m.event);
  }, [activePlan, activePlanStops, events, ageBand]);

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
    if (savedSpots.length === 0) {
      return;
    }
    const id = `plan-${Date.now()}`;
    const next: Plan = {
      id,
      name: `Saved plan (${savedSpots.length})`,
      stopIds: savedSpots.map((spot) => spot.id),
      createdAt: new Date().toISOString(),
      source: "manual",
    };
    setPlans((current) => [...current, next]);
    setActivePlanId(id);
    setView("plans");
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
      current.map((plan) =>
        plan.id === planId && !plan.stopIds.includes(stopId)
          ? { ...plan, stopIds: [...plan.stopIds, stopId] }
          : plan,
      ),
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
            }
          : plan,
      ),
    );
  }

  async function sharePlan() {
    if (!activePlan || activePlanStops.length === 0) {
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
    try {
      const result = await createPoll({
        title: activePlan.name || "Untitled plan",
        stops: stopPayload,
      });
      const url = `${window.location.origin}/#/p/${result.pollId}`;
      updatePlan(activePlan.id, {
        pollId: result.pollId,
        ownerToken: result.ownerToken,
      });
      try {
        await navigator.clipboard.writeText(url);
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
    const stopsById = new Map(allSpots.map((s) => [s.id, s] as const));
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
    const sortedAll = rankForVibe(
      allSpots.filter((s) => !usedIds.has(s.id)),
      plan.vibe,
      ageBand === "any" ? undefined : ageBand,
    );
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
        ageBand === "any" ? undefined : ageBand,
      ),
    }));
    if (candidates.length === 0) {
      setSwapError("No alternative spots available.");
      return;
    }

    setSwapBusyStopId(stopId);
    setSwapError(null);
    try {
      const today = new Date();
      const result = await createAiSwap(
        {
          vibe: plan.vibe,
          ageBand: ageBand === "any" ? undefined : ageBand,
          date: today.toISOString().slice(0, 10),
          dayOfWeek: today.toLocaleDateString("en-US", { weekday: "long" }),
          replaceStopId: stopId,
          currentPicks,
          candidates,
          weather,
          preferences,
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
    prefs: string[],
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

  function sampleCandidates<T>(sorted: T[], size: number, poolSize = 30): T[] {
    const pool = sorted.slice(0, poolSize);
    if (pool.length <= size) return pool;
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, size);
  }

  async function selectVibeFromHome(nextVibe: PlannerVibe) {
    setVibe(nextVibe);
    setHomeError(null);
    setHomeBusy(true);

    const candidatePool: Spot[] = (() => {
      if (!inferredGeo?.lat || !inferredGeo?.lon) return allSpots;
      const here = { lat: inferredGeo.lat, lon: inferredGeo.lon };
      const ranked = allSpots
        .filter(
          (spot) =>
            typeof spot.lat === "number" && typeof spot.lon === "number",
        )
        .map((spot) => ({
          spot,
          dist: haversineMiles(here, {
            lat: spot.lat as number,
            lon: spot.lon as number,
          }),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 60)
        .map((entry) => entry.spot);
      return ranked.length > 0 ? ranked : allSpots;
    })();

    if (candidatePool.length === 0) {
      setHomeBusy(false);
      setHomeError("Spots are still loading. Try again in a moment.");
      return;
    }

    if (session && API_CONFIGURED) {
      const stopPayload: StopSummary[] = sampleCandidates(candidatePool, 12).map((spot) => ({
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
          ageBand === "any" ? undefined : ageBand,
        ),
      }));
      try {
        const today = new Date();
        const result = await createAiBrief(
          {
            vibe: nextVibe,
            spots: stopPayload,
            ageBand: ageBand === "any" ? undefined : ageBand,
            date: today.toISOString().slice(0, 10),
            dayOfWeek: today.toLocaleDateString("en-US", { weekday: "long" }),
            weather,
            preferences,
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
          name: result.brief.title || `${vibeLabels[nextVibe]} plan`,
          stopIds,
          createdAt: new Date().toISOString(),
          source: "ai",
          vibe: nextVibe,
          summary: result.brief.summary,
          rationale: result.brief.rationale,
          cautions: result.brief.cautions,
          picks: result.picks,
          aiModel: result.model,
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
        ageBand === "any" ? undefined : ageBand,
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
      name: `${vibeLabels[nextVibe]} plan`,
      stopIds: ranked.map((s) => s.id),
      createdAt: new Date().toISOString(),
      source: "manual",
      vibe: nextVibe,
      summary: session
        ? undefined
        : "Picked locally. Sign in with Google to use AI for richer suggestions and to save plans across devices.",
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
    const source = savedSpots.length > 0 ? savedSpots : filteredSpots;
    if (source.length === 0) {
      setAiState({
        status: "error",
        error: "Save spots or adjust filters so the AI has candidates.",
      });
      return;
    }
    const spots: StopSummary[] = sampleCandidates(source, 12).map((spot) => ({
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
        ageBand === "any" ? undefined : ageBand,
      ),
    }));

    setAiState({ status: "loading" });
    try {
      const today = new Date();
      const result = await createAiBrief(
        {
          vibe,
          spots,
          ageBand: ageBand === "any" ? undefined : ageBand,
          date: today.toISOString().slice(0, 10),
          dayOfWeek: today.toLocaleDateString("en-US", { weekday: "long" }),
          weather,
          preferences,
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
        name: result.brief.title || `${vibeLabels[vibe]} plan`,
        stopIds,
        createdAt: new Date().toISOString(),
        source: "ai",
        vibe,
        summary: result.brief.summary,
        rationale: result.brief.rationale,
        cautions: result.brief.cautions,
        picks: result.picks,
        aiModel: result.model,
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

  function distanceFromUser(spot: Spot): number | null {
    if (!userLocation) return null;
    if (typeof spot.lat !== "number" || typeof spot.lon !== "number") return null;
    return haversineMiles(userLocation, { lat: spot.lat, lon: spot.lon });
  }

  function requestUserLocation() {
    if (!("geolocation" in navigator)) {
      setGeoState("denied");
      return;
    }
    setGeoState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
        };
        setUserLocation(next);
        window.localStorage.setItem("saturday.userLocation", JSON.stringify(next));
        setGeoState("idle");
        setSortBy("nearest");
      },
      () => {
        setGeoState("denied");
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
    setSortBy("best");
    setPage(1);
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
        <div>
          <p className="eyebrow">Family weekend</p>
          <h1>Weekend With Kids</h1>
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
          <button className="icon-button" title="Reset filters" onClick={resetFilters}>
            <RotateCcw aria-hidden="true" />
          </button>
          <button className="primary-button" onClick={() => setIsAdding(true)}>
            <Plus aria-hidden="true" />
            Add spot
          </button>
        </div>
      </header>

      <nav className="view-tabs" aria-label="View">
        <button
          className={view === "home" ? "active" : ""}
          onClick={() => setView("home")}
        >
          <Sparkles aria-hidden="true" />
          Decide
        </button>
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

      {view === "home" ? (
      <main className="home-screen" aria-label="Plan the weekend with the kids">
        <div className="home-hero">
          <p className="eyebrow">Weekend with the kids</p>
          <h1>Plan the weekend — together.</h1>
          <p className="home-sub">
            Pick the kids' age, then a vibe. Get 3 family stops. Share with
            co-parents to vote.
            {inferredGeo?.city ? ` Tuned for ${inferredGeo.city}.` : ""}
          </p>
        </div>

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
          <span className="filter-label">Your family fit (optional)</span>
          <div className="pref-chips">
            {PREFERENCE_OPTIONS.map((option) => {
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

        {boaMuseums.length > 0 && (
          <section className="boa-banner" aria-label="Bank of America Museums on Us">
            <div className="boa-head">
              <p className="eyebrow">Free museum weekend</p>
              <h2>
                BoA Museums on Us · {formatWeekendRange(
                  boaWeekend.saturday,
                  boaWeekend.sunday,
                )}
                {boaIsThisWeekend ? " (this weekend!)" : ""}
              </h2>
              <p className="boa-sub">
                Bank of America / Merrill Lynch cardholders get free general admission
                Saturday and Sunday. Bring your card + ID. Some special exhibits cost
                extra — confirm with each museum.
              </p>
            </div>
            <ul className="boa-list">
              {boaMuseums.map((m) => (
                <li key={m.id}>
                  <a href={m.url} target="_blank" rel="noreferrer">
                    <strong>{m.name}</strong>
                    <span>{m.city} · {m.neighborhood}</span>
                  </a>
                </li>
              ))}
            </ul>
            <a
              className="boa-source"
              href="https://museums.bankofamerica.com"
              target="_blank"
              rel="noreferrer"
            >
              Full Museums on Us partner list →
            </a>
          </section>
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

          <div className="filter-group">
            <span className="filter-label">Vibe</span>
            <div className="segmented compact">
              {vibeOptions.map(([value, label]) => (
                <button
                  key={value}
                  className={vibe === value ? "active" : ""}
                  onClick={() => setVibe(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

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
          <button
            className="filter-trigger"
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
          <SpotMap spots={filteredSpots} />
          <div className="section-heading">
            <div>
              <p>{filteredSpots.length} matches</p>
              <h2>{selectedLabel}</h2>
            </div>
            <div className="stat-strip" aria-label="Plan stats">
              <span>{dataMeta.loading ? "loading" : `${remoteSpots.length} source spots`}</span>
              <span>
                {filteredSpots.length === 0
                  ? "0 shown"
                  : `${pageStart + 1}-${pageEnd} shown`}
              </span>
              {dataMeta.imageStats && (
                <span>
                  {(dataMeta.imageStats.wikidata ?? 0) + (dataMeta.imageStats.tagged ?? 0)} place
                  images
                </span>
              )}
              <span>{savedSpots.length} saved</span>
              <span>{visitedIds.length} visited</span>
            </div>
          </div>

          {filteredSpots.length === 0 ? (
            <div className="empty-results">
              <h3>No matching spots</h3>
              <p>
                Your current filters didn't match any of the {allSpots.length}
                {" "}spots in the dataset.
              </p>
              <ul>
                {query && <li>Search: "{query}"</li>}
                {ageBand !== "any" && (
                  <li>Age: {ageBandLabels[ageBand]}</li>
                )}
                {category !== "All" && <li>Category: {category}</li>}
                {city !== "All" && <li>Area: {city}</li>}
                {cost !== "All" && <li>Cost: {cost}</li>}
                {onlyOpen && <li>Open now only</li>}
              </ul>
              <button className="primary-button" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" />
                Reset filters
              </button>
            </div>
          ) : (
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
                        return spot.openingHours ? (
                          <p className="hours-line muted">
                            <Clock3 aria-hidden="true" />
                            Hours: {spot.openingHours}
                          </p>
                        ) : null;
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
                      <span>
                        <Users aria-hidden="true" />
                        {spot.groupSize}
                      </span>
                      <span>{spot.cost}</span>
                      <span>{spot.timeWindow}</span>
                      <span>{spot.planning}</span>
                    </div>

                    {(spot.wheelchair === "yes" ||
                      spot.wheelchair === "limited" ||
                      spot.dogsAllowed === true ||
                      spot.kidsFriendly === true ||
                      spot.parkingNearby === true) && (
                      <div className="feature-chips">
                        {spot.wheelchair === "yes" && (
                          <span title="Wheelchair accessible">♿ Accessible</span>
                        )}
                        {spot.wheelchair === "limited" && (
                          <span title="Wheelchair access limited">♿ Limited</span>
                        )}
                        {spot.dogsAllowed === true && (
                          <span title="Dogs allowed">🐕 Dogs OK</span>
                        )}
                        {spot.kidsFriendly === true && (
                          <span title="Kid-friendly">👶 Kids</span>
                        )}
                        {spot.parkingNearby === true && (
                          <span title="Parking on site">🅿 Parking</span>
                        )}
                      </div>
                    )}

                    {(() => {
                      const visibleTags = spot.tags
                        .filter((item) => {
                          const lower = item.toLowerCase();
                          if (lower === spot.category.toLowerCase()) return false;
                          if (lower === "friends") return false;
                          return true;
                        })
                        .slice(0, 4);
                      return visibleTags.length === 0 ? null : (
                        <div className="tag-row">
                          {visibleTags.map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                      );
                    })()}

                    {(spot.website || spot.sourceUrl) && (
                      <div className="source-row">
                        {spot.website && (
                          <a href={spot.website} target="_blank" rel="noreferrer">
                            Website
                            <ExternalLink aria-hidden="true" />
                          </a>
                        )}
                        {spot.sourceUrl && (
                          <a href={spot.sourceUrl} target="_blank" rel="noreferrer">
                            OSM source
                            <ExternalLink aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    )}

                    <div className="card-footer">
                      <button
                        className="text-button"
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

          {filteredSpots.length > 0 && (
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

        <aside className="plan-panel" aria-label="Saved spots">
          <div className="panel-heading">
            <Bookmark aria-hidden="true" />
            <span>Saved</span>
          </div>
          {savedSpots.length === 0 ? (
            <p className="empty-state">Save a few group spots to compare your day.</p>
          ) : (
            <>
              <button
                className="primary-button wide"
                onClick={() => createPlanFromSaved()}
                title="Create a plan with all saved spots in order"
              >
                <List aria-hidden="true" />
                Plan from saved ({savedSpots.length})
              </button>
              <div className="saved-list">
                {savedSpots.map((spot) => (
                  <div className="saved-item" key={spot.id}>
                    <div>
                      <strong>{spot.name}</strong>
                      <span>{spot.neighborhood}</span>
                    </div>
                    <button
                      className="icon-button"
                      title="Remove saved spot"
                      onClick={() => toggleSaved(spot.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
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

          <div className="ai-suggest">
            <label className="select-field">
              <span>Vibe</span>
              <select
                value={vibe}
                onChange={(event) => setVibe(event.target.value as PlannerVibe)}
              >
                {vibeOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button wide"
              disabled={
                !API_CONFIGURED ||
                !session ||
                aiState.status === "loading" ||
                (savedSpots.length === 0 && filteredSpots.length === 0)
              }
              title={
                !API_CONFIGURED
                  ? "Backend not deployed in this preview"
                  : !session
                    ? "Sign in with Google to use AI suggest"
                    : undefined
              }
              onClick={createAiPlan}
            >
              <Sparkles aria-hidden="true" />
              {aiState.status === "loading" ? "Thinking…" : "AI suggest"}
            </button>
            <p className="ai-suggest-hint">
              {savedSpots.length > 0
                ? `Uses your ${savedSpots.length} saved spot${savedSpots.length === 1 ? "" : "s"} as candidates.`
                : "Uses your current Browse filters as candidates."}
            </p>
            {aiState.status === "error" && (
              <p className="ai-suggest-error">{aiState.error}</p>
            )}
          </div>

          {plans.length === 0 ? (
            <p className="empty-state">
              Build a small itinerary from your saved spots.
            </p>
          ) : (
            <div className="plan-list">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  className={
                    plan.id === activePlanId ? "plan-list-item active" : "plan-list-item"
                  }
                  onClick={() => setActivePlanId(plan.id)}
                >
                  <strong>{plan.name || "Untitled plan"}</strong>
                  <span>
                    {plan.stopIds.length} stop{plan.stopIds.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
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
                    {activePlan.vibe ? ` · ${vibeLabels[activePlan.vibe]}` : ""}
                  </span>
                )}
                <span>
                  {activePlanStops.length} stop
                  {activePlanStops.length === 1 ? "" : "s"}
                </span>
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

              {activePlanStops.length > 0 && (
                <PlanMap stops={activePlanStops} />
              )}

              {activePlanStops.length === 0 ? (
                <p className="empty-state">
                  Add stops from your saved spots to build the day.
                </p>
              ) : (
                <ol className="plan-stops">
                  {activePlanStops.map((spot, index) => {
                    const aiReason = activePlan.picks?.find(
                      (pick) => pick.id === spot.id,
                    )?.reason;
                    return (
                    <li className="plan-stop" key={spot.id}>
                      <span className="plan-stop-index">{index + 1}</span>
                      <div className="plan-stop-info">
                        <strong>{spot.name}</strong>
                        <span>
                          {spot.neighborhood} · {spot.category} · {spot.cost} ·{" "}
                          {spot.transitMinutes} min
                        </span>
                        {aiReason && <em className="plan-stop-reason">{aiReason}</em>}
                      </div>
                      <div className="plan-stop-actions">
                        {activePlan.source === "ai" && (
                          <button
                            title="Swap with AI choice"
                            disabled={
                              !session ||
                              !API_CONFIGURED ||
                              swapBusyStopId !== null
                            }
                            onClick={() =>
                              swapStopWithAi(activePlan.id, spot.id)
                            }
                          >
                            <Sparkles aria-hidden="true" />
                          </button>
                        )}
                        <button
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => moveStop(activePlan.id, spot.id, -1)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </button>
                        <button
                          title="Move down"
                          disabled={index === activePlanStops.length - 1}
                          onClick={() => moveStop(activePlan.id, spot.id, 1)}
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
                  })}
                </ol>
              )}

              <div className="plan-add-row">
                <select
                  value={addStopChoice}
                  onChange={(event) => setAddStopChoice(event.target.value)}
                >
                  <option value="">
                    {addableSavedSpots.length === 0
                      ? "No saved spots left to add"
                      : "Add stop from saved…"}
                  </option>
                  {addableSavedSpots.map((spot) => (
                    <option key={spot.id} value={spot.id}>
                      {spot.name} — {spot.neighborhood}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-button"
                  disabled={!addStopChoice}
                  onClick={() =>
                    addStopChoice && addStopToPlan(activePlan.id, addStopChoice)
                  }
                >
                  <Plus aria-hidden="true" />
                  Add
                </button>
              </div>

              <div className="plan-actions">
                <button
                  className="primary-button"
                  disabled={
                    !API_CONFIGURED ||
                    activePlanStops.length === 0 ||
                    shareState.status === "sharing"
                  }
                  title={
                    API_CONFIGURED
                      ? "Share this plan for voting"
                      : "Backend not deployed in this preview"
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
                </div>
              )}

              {planNearbyEvents.length > 0 && (
                <section className="plan-events" aria-label="Events near this plan">
                  <h3>While you're nearby this weekend</h3>
                  <p className="plan-events-sub">
                    {planNearbyEvents.length} family program
                    {planNearbyEvents.length === 1 ? "" : "s"} within 2.5 mi of a
                    plan stop. Times vary — tap through to confirm.
                  </p>
                  <ul className="plan-events-list">
                    {planNearbyEvents.map((event) => (
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
    </div>
  );
}

export default App;
