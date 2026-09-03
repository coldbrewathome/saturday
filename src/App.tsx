import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  List,
  Image,
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
  Zap,
} from "lucide-react";
import {
  type ComponentProps,
  FormEvent,
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MapSelection, PlanMapItem, SpotMapHandle } from "./MapViews";
import {
  API_CONFIGURED,
  createPoll,
  fetchAdminEvents,
  fetchGeo,
  getPoll,
  PollFetchError,
  subscribeNewsletter,
  trackMetric,
  fetchWeather,
  type WeatherForecast,
  getUserState,
  googleSignIn,
  logoutSession,
  putUserState,
  StopSummary,
  type EventSummary,
  type ItemOrderRef,
  type PollSnapshot,
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
import {
  hopNowPicks,
  type HopNowEvent,
  type HopNowPick,
  type HopNowResult,
  type HopNowSpot,
} from "./hopNow";
import {
  METROS,
  legacyMetroDataPath,
  metroCanonicalOverride,
  metroDataPath,
  metroShareBase,
  metroStorageKey,
  type MetroConfig,
} from "./metros";
import EventDetailView from "./EventDetailView";
import WeekendView from "./WeekendView";
import InstallBanner from "./InstallBanner";
import OnboardingWizard from "./OnboardingWizard";
import { PlanCardArt } from "./planCardArt";
import { createPlanCard, type PlanCardRecord } from "./planCardApi";
import {
  fetchEventTrust,
  submitCheckin,
  trustBoost,
  type EventTrust,
} from "./checkinApi";
import CheckinPrompt from "./CheckinPrompt";
import { computeCheckinCandidates } from "./checkinQueue";
import { EVENT_THEMES, isValidThemeId } from "./eventThemes";
import { isUpcomingEvent, isWeekendWindowDate } from "./eventFreshness";
import type { PopularEventsDataset } from "./popularEvents";
import { readLastVisit, writeLastVisit } from "./newEvents";
import {
  PROFILE_STORAGE_KEY,
  readStoredProfile,
  writeStoredProfile,
  scoreEventForFamily,
  type FamilyProfile,
} from "./familyProfile";
import { buildVenueImageMap } from "./eventImages";
import {
  DEFAULT_VIEW,
  buildAppHash,
  readAppRoute,
  type AppRoute,
} from "./appRoutes";
import {
  addLocalDays,
  dayWindowLabel,
  eventCategoryToSpotCategory,
  eventCostToSpotCost,
  eventDateGroupLabel,
  eventTimeLabel,
  eventWhenLabel,
  formatWeekendRange,
  groupSavedEventsByDate,
  isActualPlanningEvent,
  isEventExpired,
  isoDate,
  nextBoaWeekend,
  nextDayOfWeek,
  optionLabel,
  parseIsoDate,
  sameLocalDate,
  thisOrNextDayOfWeek,
  validEventDate,
  weatherTone,
} from "./eventDates";
import {
  AGE_BAND_STORAGE_KEY,
  AGE_PROMPT_DISMISSED_KEY,
  CHECKINS_STORAGE_KEY,
  GOING_OUT_STORAGE_KEY,
  INTERESTS_STORAGE_KEY,
  readStoredAgeBand,
  readStoredArray,
  readStoredCheckins,
  readStoredGoingOutMode,
  readStoredInterests,
  writeStored,
  writeStoredCheckins,
} from "./appStorage";
import {
  EMAIL_RE,
  formatGeneratedAt,
  haversineMiles,
  interleaveByCategory,
  latestGeneratedAt,
  sourceHostname,
} from "./appUtils";
import {
  DAY_KEYS,
  DAY_NAMES,
  compactHoursLabel,
  describeStatus,
  formatMinutes,
  formatRatingCount,
  normalizeClock,
  normalizeHourSpan,
  pickCategoryImage,
  statusLabel,
  type OpenStatus,
} from "./spotDisplay";

// Shared domain types live in ./types (extracted 2026-08); re-export the
// public surface here so existing importers keep working unchanged.
import type {
  Audience,
  BoaDataset,
  BoaMuseum,
  Category,
  Cost,
  EventsDataset,
  FamilyEvent,
  FeaturedPlan,
  HeroPick,
  NewSpotForm,
  Plan,
  PlanItem,
  PlanItemRef,
  SavedEventDateGroup,
  Schedule,
  ScheduleWindow,
  Spot,
  SpotDataset,
  WeekSchedule,
} from "./types";
export type {
  Audience,
  FamilyEvent,
  FeaturedPlan,
  HeroPick,
  Plan,
  PlanItemRef,
  Spot,
} from "./types";

const PLAN_ID_TOKEN_LENGTH = 12;

function createCompactPlanToken(length = PLAN_ID_TOKEN_LENGTH) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, length);
  }

  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let output = "";
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      output += alphabet[byte % alphabet.length];
    }
    return output;
  }

  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function createPlanId(existingPlans: Plan[]) {
  const existing = new Set(existingPlans.map((plan) => plan.id));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `plan-${createCompactPlanToken()}`;
    if (!existing.has(id)) return id;
  }
  return `plan-${createCompactPlanToken(16)}`;
}

function parseGuideEventIds(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 6) break;
  }
  return ids;
}

function cleanGuidePlanTitle(value: string | null): string {
  const title = (value || "").replace(/\s+/g, " ").trim();
  return title.length > 0 && title.length <= 90
    ? title
    : "Weekend guide plan";
}

type EventDateFilter = "all" | "tonight" | "today" | "tomorrow" | "weekend";

const categories: Category[] =
  APP_AUDIENCE === "adults"
    ? ["Nightlife", "Food", "Culture", "Wellness", "Outdoors"]
    : ["Outdoors", "Food", "Culture", "Wellness", "Shopping"];

const ageBandOptions = Object.entries(ageBandLabels) as Array<[AgeBand, string]>;

const costs: Cost[] = ["Free", "$", "$$", "$$$", "Unknown"];
const eventDateFilters: Array<{ id: EventDateFilter; label: string }> = [
  { id: "all", label: "All" },
  // "Tonight" is an adults (Mosey) affordance — the 20–35 audience plans evenings;
  // families browse by day, so kids keep Today/Tomorrow/Weekend only.
  ...(APP_AUDIENCE === "adults"
    ? [{ id: "tonight" as const, label: "Tonight" }]
    : []),
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "weekend", label: "Weekend (Fri–Sun)" },
];
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
    mood: `Scheduled event: ${when}`,
    groupSize: APP_AUDIENCE === "adults" ? "2-8 people" : "Family",
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
const BOA_MUSEUMS_URL = dataUrl("boa-museums.json");
const rootDataUrl = (file: string) => dataUrl(file);

import {
  APP_AUDIENCE,
  APP_BRAND,
  APP_DIGEST_CTA,
  APP_DOMAIN,
  APP_TAGLINE,
  APP_VIBE_LABELS,
  SHOW_AGE_BAND_UI,
  heroTitleForAudience,
  audienceVisible,
} from "./appConfig";

void APP_AUDIENCE; // surface APP_AUDIENCE for downstream debugging if needed
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CONFIGURED = GOOGLE_CLIENT_ID.length > 0;

// Storage keys + helpers moved to src/appStorage.ts (2026-08).

// Spot display helpers (categoryImagePool, pickCategoryImage, hours/status
// formatting) moved to src/spotDisplay.ts (2026-08).

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
  ...(APP_AUDIENCE === "adults"
    ? [{
        id: "cocktail-lounge",
        name: "Cocktail Lounge",
        neighborhood: "Downtown",
        category: "Nightlife" as Category,
        imageUrl:
          "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80",
        cost: "$$" as Cost,
        transitMinutes: 10,
        timeWindow: "Evening",
        mood: "Cocktails and conversation",
        groupSize: "2-8 people",
        planning: "Walk-in",
        openNow: true,
        note: "Craft cocktails in a low-key lounge. Good for starting the night or a chill catch-up.",
        tags: ["cocktails", "lounge", "evening", "indoor"],
      }]
    : [{
        id: "library-storytime",
        name: "Library Storytime",
        neighborhood: "Downtown",
        category: "Culture" as Category,
        imageUrl:
          "https://images.unsplash.com/photo-1485738422979-f5c462d49f74?auto=format&fit=crop&w=1200&q=80",
        cost: "Free" as Cost,
        transitMinutes: 10,
        timeWindow: "Morning",
        mood: "Quiet morning",
        groupSize: "1 adult + kids",
        planning: "Walk-in",
        openNow: true,
        note: "Free story session for toddlers and preschoolers. Pair with a stroller-friendly walk afterward.",
        tags: ["library", "free", "toddler", "indoor"],
        kidsFriendly: true,
      }]),
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

// Map components are bundled in a separate chunk (Leaflet + leaflet.css) and
// loaded only when the user navigates to a view that renders a map.
const LazySpotMap = lazy(() =>
  import("./MapViews").then((m) => ({ default: m.SpotMap })),
);
const LazyPlanMap = lazy(() =>
  import("./MapViews").then((m) => ({ default: m.PlanMap })),
);

const SpotMap = forwardRef<SpotMapHandle, ComponentProps<typeof LazySpotMap>>(
  function SpotMap(props, ref) {
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
        <LazySpotMap {...props} ref={ref} />
      </Suspense>
    );
  },
);

function PlanMap(props: ComponentProps<typeof LazyPlanMap>) {
  return (
    <Suspense
      fallback={
        <div
          className="plan-map plan-map-loading"
          aria-busy="true"
          aria-label="Loading plan map"
        />
      }
    >
      <LazyPlanMap {...props} />
    </Suspense>
  );
}

// ── Plan-first hero (browse view) ────────────────────────────────────
// The hero card fulfills the advertised "pick a vibe, get a 3-stop plan in
// seconds" promise with the strongest already-loaded editor's pick — no
// backend call. Dismissal persists ~7 days.
const HERO_DISMISS_KEY = "saturday.heroDismissedAt";
const HERO_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HERO_VIBES: PlannerVibe[] = [
  "low-effort",
  "active",
  "food-first",
  "culture",
];

// isThemedPlanEligible/pickHeroFeatured/summarizePollTallies moved to
// src/planUtils.ts (2026-08); re-exported here for tests.
import {
  isThemedPlanEligible,
  pickHeroFeatured,
  summarizePollTallies,
} from "./planUtils";
export {
  isThemedPlanEligible,
  pickHeroFeatured,
  summarizePollTallies,
} from "./planUtils";

// sourceHostname/formatGeneratedAt/latestGeneratedAt/interleaveByCategory
// moved to src/appUtils.ts (2026-08); sourceHostname re-exported below for
// PollView + tests.
export { sourceHostname } from "./appUtils";

// EMAIL_RE lives in src/appUtils.ts (shared with NewsletterCard).

type AppProps = {
  metro: MetroConfig;
};

function App({ metro }: AppProps) {
  // B1.7: freshness-gated useMemos below capture `now`/Date.now() once, at
  // whatever instant they last recomputed for some other reason (a filter
  // change, a map move). A tab left open for hours would keep showing an
  // event that ended in the meantime. clockTick is a cheap dependency that
  // forces those memos to re-evaluate periodically (and when the tab
  // regains focus, since a backgrounded tab's timers get throttled).
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const tick = () => setClockTick((n) => n + 1);
    const interval = setInterval(tick, 5 * 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const dataUrls = useMemo(() => ({
    spots: dataUrl(metroDataPath(metro, "spots")),
    enrichment: dataUrl(
      legacyMetroDataPath(metro, "enrichment") ||
        metroDataPath(metro, "enrichment"),
    ),
    events: dataUrl(metroDataPath(metro, "events")),
    featuredPlans: dataUrl(metroDataPath(metro, "featuredPlans")),
    popularEvents: dataUrl(metroDataPath(metro, "popularEvents")),
    curatedSpots: rootDataUrl(
      legacyMetroDataPath(metro, "curatedSpots") ||
        metroDataPath(metro, "curatedSpots"),
    ),
  }), [metro]);
  const defaultMapCenter = useMemo(
    () => [metro.center.lat, metro.center.lon] as [number, number],
    [metro],
  );
  const weekendGuideHref = useMemo(
    () => `${metro.canonicalPath.replace(/\/+$/, "")}/this-weekend/`,
    [metro],
  );
  const storageKeys = useMemo(() => ({
    savedSpots: metroStorageKey(metro, "savedSpots"),
    savedEvents: metroStorageKey(metro, "savedEvents"),
    visitedSpots: metroStorageKey(metro, "visitedSpots"),
    customSpots: metroStorageKey(metro, "customSpots"),
    plans: metroStorageKey(metro, "plans"),
    deletedPlanIds: metroStorageKey(metro, "deletedPlanIds"),
    userLocation: metroStorageKey(metro, "userLocation"),
    preferences: metroStorageKey(metro, "preferences"),
    plannerProfile: metroStorageKey(metro, "plannerProfile"),
    mapView: metroStorageKey(metro, "mapView"),
    selectedCategories: metroStorageKey(metro, "selectedCategories"),
  }), [metro]);
  const shareBaseUrl = useMemo(() => metroShareBase(metro), [metro]);
  // Weekend briefing share link: lands recipients on the decision-first view.
  const weekendShareUrl = useMemo(
    () => `${shareBaseUrl.replace(/\/+$/, "")}#/weekend`,
    [shareBaseUrl],
  );
  useEffect(() => {
    // Prerendered pages (homepage + metro hubs) ship crafted titles,
    // descriptions, and a correct self-canonical; rewriting them on
    // hydration handed Google conflicting signals (homepage canonical →
    // /bay-area, slashless hub canonicals) that folded hubs out of the
    // index. When the static self-canonical is present, leave the entire
    // head alone — title and description included.
    const canonicalUrl = metroCanonicalOverride(metro);
    if (!canonicalUrl) return;
    const title = APP_AUDIENCE === "adults"
      ? `${APP_BRAND} — Things to do in ${metro.label}`
      : `${APP_BRAND} — ${metro.label} Family Events & Kid-Friendly Spots`;
    const description = APP_AUDIENCE === "adults"
      ? `${APP_BRAND} helps you find good places to hang out in ${metro.label} — cafes, bars, parks, music, and local events. Pick a vibe, get a 3-stop hangout, and share with friends to vote.`
      : `${APP_BRAND} helps families find ${metro.label} kid-friendly spots, family events, parks, libraries, museums, and weekend plans.`;

    document.title = title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", description);
    document
      .querySelector('meta[property="og:title"]')
      ?.setAttribute("content", title);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", description);
    document
      .querySelector('meta[property="og:url"]')
      ?.setAttribute("content", canonicalUrl);
    document
      .querySelector('meta[name="twitter:title"]')
      ?.setAttribute("content", title);
    document
      .querySelector('meta[name="twitter:description"]')
      ?.setAttribute("content", description);
    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute("href", canonicalUrl);
  }, [metro]);

  function switchMetro(nextId: string) {
    const nextMetro = METROS.find((item) => item.id === nextId);
    if (!nextMetro) return;
    if (nextMetro.id === metro.id) {
      mapRef.current?.flyTo(metro.center.lat, metro.center.lon, 10);
      return;
    }
    const hash = window.location.hash || "#/browse";
    window.location.assign(
      `${nextMetro.canonicalPath}${window.location.search}${hash}`,
    );
  }

  const picksCleanupRef = useRef<(() => void) | null>(null);
  const picksRailRef = useCallback((el: HTMLElement | null) => {
    picksCleanupRef.current?.();
    picksCleanupRef.current = null;
    if (!el) return;

    let startY: number | null = null;
    let swiped = false;

    function onTouchStart(e: globalThis.TouchEvent) {
      const target = e.target as HTMLElement | null;
      if (el!.classList.contains("is-expanded") && target?.closest(".featured-rail-list")) {
        startY = null;
        return;
      }
      startY = e.touches[0]?.clientY ?? null;
      swiped = false;
    }

    function onTouchMove(e: globalThis.TouchEvent) {
      if (startY === null) return;
      const currentY = e.touches[0]?.clientY;
      if (currentY === undefined) return;
      e.preventDefault();
      const dy = startY - currentY;
      if (Math.abs(dy) < 18) return;
      setPicksExpanded(dy > 0);
      swiped = true;
      startY = null;
    }

    function onTouchEnd() {
      startY = null;
    }

    function onClick(e: MouseEvent) {
      if (swiped) { swiped = false; return; }
      const head = (e.target as HTMLElement)?.closest(".featured-rail-head");
      if (!head) return;
      setPicksExpanded((v) => !v);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("click", onClick);

    picksCleanupRef.current = () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("click", onClick);
    };
  }, []);

  const [query, setQuery] = useState("");
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  // Transient "Copied!" feedback for the one-tap event share (desktop fallback).
  const [shareCopiedUrl, setShareCopiedUrl] = useState<string | null>(null);
  // Phase 2 personalization: saved interests (cross-metro, so a global key,
  // not metroStorageKey) + a "For you" view that filters to them.
  const [preferredThemes, setPreferredThemes] =
    useState<ReadonlySet<string>>(readStoredInterests);
  // Returning users who've saved interests land in their personalized view
  // automatically; the "All" chip reverts it in one tap. New users start at
  // "All" (no interests → the forYou filter is a no-op anyway).
  const [forYou, setForYou] = useState(() => readStoredInterests().size > 0);
  const [showInterestsPicker, setShowInterestsPicker] = useState(false);
  const [ageBand, setAgeBand] = useState<AgeBand | "any">(readStoredAgeBand);
  // First-visit age prompt (kids): shown until the family picks an age band
  // or explicitly dismisses it. Answered-state needs no extra flag — a stored
  // band ends the prompt via `ageBand !== "any"`.
  const [agePromptDismissed, setAgePromptDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(AGE_PROMPT_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const agePromptVisible =
    SHOW_AGE_BAND_UI && ageBand === "any" && !agePromptDismissed;
  function dismissAgePrompt() {
    setAgePromptDismissed(true);
    try {
      window.localStorage.setItem(AGE_PROMPT_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  }
  // Family profile (kids): first-run wizard collects ages/ZIP/interests/budget/
  // setting once; the weekend feed and browse ranking re-rank for it. Shows on
  // first visit only, until a profile exists; re-openable via "Edit profile".
  const [profile, setProfile] = useState<FamilyProfile | null>(readStoredProfile);
  const [showProfileWizard, setShowProfileWizard] = useState(
    () => SHOW_AGE_BAND_UI && !readStoredProfile(),
  );
  function completeProfile(next: FamilyProfile) {
    setProfile(next);
    writeStoredProfile(next);
    setShowProfileWizard(false);
    trackMetric("profile_completed", metro.id);
  }
  const [vibe, setVibe] = useState<PlannerVibe>("balanced");
  // Adults (Mosey) only: who you're heading out as — nudges planner scoring.
  const [goingOutMode, setGoingOutMode] = useState<"solo" | "friends" | "date">(
    readStoredGoingOutMode,
  );
  const [selectedCategories, setSelectedCategories] = useState<ReadonlySet<Category>>(
    () => {
      try {
        const raw = window.localStorage.getItem(storageKeys.selectedCategories);
        if (raw) {
          const parsed = JSON.parse(raw) as string[];
          const valid = new Set<Category>(categories);
          return new Set<Category>(
            parsed.filter((c): c is Category => valid.has(c as Category)),
          );
        }
      } catch {
        // fall through to default
      }
      // Food is hidden by default on kids — the dataset is dominated by
      // restaurants and most parents aren't browsing for food when planning
      // family time. Adults keep food on since it's core to nightlife.
      const defaults =
        APP_AUDIENCE === "adults"
          ? categories
          : categories.filter((c) => c !== "Food");
      return new Set<Category>(defaults);
    },
  );
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [city, setCity] = useState("All");
  const [cost, setCost] = useState<Cost | "All">("All");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [eventDateFilter, setEventDateFilter] = useState<EventDateFilter>("all");
  const [sortBy, setSortBy] = useState<"best" | "nearest" | "price" | "name">(
    "best",
  );
  const [savedIds, setSavedIds] = useState<string[]>(() =>
    readStoredArray(storageKeys.savedSpots, []),
  );
  const [savedEventIds, setSavedEventIds] = useState<string[]>(() =>
    readStoredArray(storageKeys.savedEvents, []),
  );
  const [visitedIds, setVisitedIds] = useState<string[]>(() =>
    readStoredArray(storageKeys.visitedSpots, []),
  );
  const [customSpots, setCustomSpots] = useState<Spot[]>(() =>
    readStoredArray(storageKeys.customSpots, []),
  );
  const [plans, setPlans] = useState<Plan[]>(() =>
    readStoredArray(storageKeys.plans, []),
  );
  const [deletedPlanIds, setDeletedPlanIds] = useState<string[]>(() =>
    readStoredArray(storageKeys.deletedPlanIds, []),
  );
  const initialRoute = readAppRoute();
  const [view, setView] = useState<AppRoute["view"]>(initialRoute.view);
  const [inferredGeo, setInferredGeo] = useState<{ city: string | null; lat: number | null; lon: number | null } | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(
    initialRoute.planId,
  );
  const [confirmDeletePlanId, setConfirmDeletePlanId] = useState<string | null>(
    null,
  );
  const [activeEventSlug, setActiveEventSlug] = useState<string | null>(
    initialRoute.eventSlug,
  );
  // Spot id from a `#/spot/<id>` deep link, consumed once spots have loaded.
  const [pendingSpotFocusId, setPendingSpotFocusId] = useState<string | null>(
    initialRoute.focusSpotId,
  );
  const [addStopChoice, setAddStopChoice] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [picksExpanded, setPicksExpanded] = useState(false);
  const mapRef = useRef<SpotMapHandle | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(() => {
    try {
      const raw = window.localStorage.getItem(storageKeys.userLocation);
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
    /** True only when the clipboard write actually resolved. */
    copied?: boolean;
  }>({ status: "idle" });
  // Wrapped-style plan card share: the created record shown in a preview modal,
  // exported to a PNG via html-to-image, shared as image + #/card/<id> link.
  const [planCard, setPlanCard] = useState<PlanCardRecord | null>(null);
  const [planCardBusy, setPlanCardBusy] = useState(false);
  const [planCardError, setPlanCardError] = useState<string | null>(null);
  const [planCardCopied, setPlanCardCopied] = useState(false);
  const planCardRef = useRef<HTMLDivElement | null>(null);
  // Post-weekend check-ins: local answers gate the prompt queue; aggregate
  // trust (eventTrust) powers badges + ranking. Set on the weekend view.
  const [checkins, setCheckins] =
    useState<Record<string, { date: string; worthIt: boolean }>>(readStoredCheckins);
  const [checkinPromptIndex, setCheckinPromptIndex] = useState(0);
  const [eventTrust, setEventTrust] = useState<ReadonlyMap<string, EventTrust>>(
    new Map(),
  );
  const [session, setSession] = useState<SessionState | null>(() => readSession());
  const [signInError, setSignInError] = useState<string | null>(null);
  const signInButtonRef = useRef<HTMLDivElement | null>(null);
  // Google Identity initializes lazily on first sign-in intent (see
  // ensureGoogleIdentity) instead of at boot.
  const googleIdentityInit = useRef<Promise<void> | null>(null);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "loading" | "syncing" | "synced" | "error"
  >("idle");
  const [remoteSpots, setRemoteSpots] = useState<Spot[]>(starterSpots);
  const [curatedSpots, setCuratedSpots] = useState<Spot[]>([]);
  // Ready-made day-plan cover photos: first stop with a curated image.
  const stopImages = useMemo(() => {
    const map: Record<string, string> = {};
    for (const spot of curatedSpots) {
      if (spot.imageUrl && !map[spot.id]) map[spot.id] = spot.imageUrl;
    }
    return map;
  }, [curatedSpots]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  // Feed state for WeekendView: "loading" → skeleton, "ready" → feed or the
  // true empty state, "error" → retry UI (a failed events load used to be a
  // silent permanent empty feed). Set by the events effect below.
  const [eventsState, setEventsState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  // Bumping re-runs the events load (retry UI / topbar refresh). Events are
  // kept during a reload so non-weekend views never flash empty.
  const [eventsReload, setEventsReload] = useState(0);
  // Baseline for "New since your last visit" — read once at mount, before
  // the mount effect writes today's timestamp, so the section compares
  // against the *previous* visit. Never updated in-session.
  const [lastVisit] = useState<string | null>(readLastVisit);
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);
  // Track the map's current center so the featured-plans rail can re-rank
  // city plans by distance from whatever the user is browsing. Default to
  // null until the map fires its first moveend / fit-to-bounds callback.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const guidePlanConsumedRef = useRef(false);

  const [featuredPlans, setFeaturedPlans] = useState<FeaturedPlan[]>([]);
  const [popularPicks, setPopularPicks] = useState<PopularEventsDataset | null>(null);
  const [boaMuseums, setBoaMuseums] = useState<BoaMuseum[]>([]);
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [preferences, setPreferences] = useState<PlannerPreferenceId[]>(() => {
    try {
      const raw = window.localStorage.getItem(storageKeys.preferences);
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
      const raw = window.localStorage.getItem(storageKeys.plannerProfile);
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
    eventsCount?: number;
    eventsGeneratedAt?: string;
  }>({
    sourceName: "Curated fallback",
    count: starterSpots.length,
    loading: true,
  });
  const [isAdding, setIsAdding] = useState(false);
  const [isHopNowOpen, setIsHopNowOpen] = useState(false);
  // Visit-3 engaged-visitor ask: the Friday digest (replaced the old Google
  // sign-in modal, which converted ~0 — sign-in stays in the topbar).
  const [showDigestPrompt, setShowDigestPrompt] = useState(false);
  function dismissDigestPrompt() {
    setShowDigestPrompt(false);
    try {
      window.localStorage.setItem("saturday.digestPromptDismissed", "1");
    } catch {
      // ignore
    }
  }
  // Plan-first hero (browse view). "Not now" hides it for ~7 days.
  const [heroDismissed, setHeroDismissed] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(HERO_DISMISS_KEY);
      return raw ? Date.now() - Number(raw) < HERO_DISMISS_TTL_MS : false;
    } catch {
      return false;
    }
  });
  const [heroVibe, setHeroVibe] = useState<PlannerVibe | null>(null);
  // ≤820px the hero collapses to a pill so the map stays usable.
  const [heroExpanded, setHeroExpanded] = useState(false);
  const [heroForkedPlanId, setHeroForkedPlanId] = useState<string | null>(null);
  // Owner-side vote payoff: tally snapshot for the active shared plan, plus a
  // one-shot "votes are in" check across shared plans for the Plans tab dot.
  const [activePollTally, setActivePollTally] = useState<PollSnapshot | null>(
    null,
  );
  const [pollTallyStatus, setPollTallyStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [tallyRefreshNonce, setTallyRefreshNonce] = useState(0);
  const [votesIn, setVotesIn] = useState(false);
  const votesCheckedRef = useRef(false);
  // Optional "email me when friends vote" — passed to createPoll at share time.
  const [notifyEmail, setNotifyEmail] = useState("");
  const [hopNowSeen, setHopNowSeenState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("saturday.hopNowSeen") === "1";
    } catch {
      return false;
    }
  });
  const markHopNowSeen = () => {
    setHopNowSeenState(true);
    try {
      window.localStorage.setItem("saturday.hopNowSeen", "1");
    } catch {
      // ignore
    }
  };
  const openHopNow = () => {
    markHopNowSeen();
    setIsHopNowOpen(true);
    trackMetric("hop_now_opened", metro.id);
  };
  // Static SEO pages link their topbar "Hop now" as #/browse?hopnow=1 (the
  // sheet is modal state, not a route). Open it once on arrival and normalize
  // the hash so a refresh doesn't reopen it.
  useEffect(() => {
    if (!window.location.hash.includes("hopnow")) return;
    openHopNow();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#/browse`,
    );
    // Mount-only by design: reacting to later hash edits would reopen the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [newSpot, setNewSpot] = useState<NewSpotForm>(emptyNewSpot);

  useEffect(() => {
    let active = true;

    const datasetPromise = fetch(dataUrls.spots).then((response) => {
      if (!response.ok) {
        throw new Error(`Data request failed: ${response.status}`);
      }
      return response.json() as Promise<SpotDataset>;
    });
    // Sidecar is optional; produced by `npm run match:places:osm`.
    const enrichmentPromise = fetch(dataUrls.enrichment)
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

        const datasetSpots = dataset.spots;
        const enrichmentEntries = enrichment?.entries ?? {};
        const merged = datasetSpots
          .filter(audienceVisible)
          .map((spot) => {
            const extra = enrichmentEntries[spot.id];
            return extra ? { ...spot, ...extra } : spot;
          });
        setRemoteSpots(merged);
        setDataMeta((prev) => ({
          ...prev,
          generatedAt: dataset.generatedAt,
          sourceName: dataset.source?.name || `Generated ${metro.label} data`,
          count: dataset.count || datasetSpots.length,
          loading: false,
          imageStats: dataset.imageStats,
          error: undefined,
        }));
      })
      .catch((error: Error) => {
        if (!active) {
          return;
        }

        setDataMeta((prev) => ({
          ...prev,
          sourceName: "Curated fallback",
          count: starterSpots.length,
          loading: false,
          error: error.message,
        }));
      });

    return () => {
      active = false;
    };
  }, [dataUrls.enrichment, dataUrls.spots, metro.label]);

  useEffect(() => {
    let active = true;
    (async () => {
      const adminPayload = await fetchAdminEvents(metro.id);
      if (!active) return;
      if (adminPayload && adminPayload.events.length > 0) {
        const visible = (adminPayload.events as FamilyEvent[]).filter(
          audienceVisible,
        );
        setEvents(visible);
        setDataMeta((prev) => ({
          ...prev,
          eventsCount: visible.length,
          eventsGeneratedAt:
            (adminPayload as { generatedAt?: string }).generatedAt ??
            prev.eventsGeneratedAt,
        }));
        setEventsState("ready");
        return;
      }
      try {
        const response = await fetch(dataUrls.events);
        if (!response.ok) {
          if (active) setEventsState("error");
          return;
        }
        const dataset = (await response.json()) as EventsDataset;
        if (!active) return;
        if (Array.isArray(dataset.events)) {
          const visible = dataset.events.filter(audienceVisible);
          setEvents(visible);
          setDataMeta((prev) => ({
            ...prev,
            eventsCount: visible.length,
            eventsGeneratedAt: dataset.generatedAt ?? prev.eventsGeneratedAt,
          }));
          setEventsState("ready");
        } else {
          setEventsState("error");
        }
      } catch {
        if (active) setEventsState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [dataUrls.events, metro.id, eventsReload]);

  function retryEvents() {
    setEventsState("loading");
    setEventsReload((n) => n + 1);
  }

  // Aggregate trust scores for the weekend feed: fetch once per upcoming-
  // event batch (capped), re-fetch when events change.
  useEffect(() => {
    if (view !== "weekend") return;
    let cancelled = false;
    const now = new Date();
    const ids = events
      .filter((e) => isUpcomingEvent(e, now, { timeZone: metro.timezone }))
      .slice(0, 30)
      .map((e) => e.id);
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => fetchEventTrust(id))).then((results) => {
      if (cancelled) return;
      const map = new Map<string, EventTrust>();
      results.forEach((trust, index) => {
        if (trust) map.set(ids[index], trust);
      });
      setEventTrust(map);
    });
    return () => {
      cancelled = true;
    };
  }, [view, events, metro.id]);

  // Post-weekend check-in queue: saved events from the last ~8 days that have
  // ended and haven't been answered yet. Prompt window: Sunday 6pm → Tuesday.
  const checkinCandidates = useMemo(
    () =>
      computeCheckinCandidates(
        events,
        savedEventIds,
        checkins,
        new Date(),
        metro.timezone,
      ),
    [events, savedEventIds, checkins, metro],
  );

  // The prompt shows one event at a time; index advances on any answer.
  const currentCheckin =
    checkinPromptIndex < checkinCandidates.length
      ? checkinCandidates[checkinPromptIndex]
      : null;

  function answerCheckin(event: FamilyEvent, went: boolean | null) {
    const next = { ...checkins, [event.id]: { date: new Date().toISOString(), worthIt: went === true } };
    writeStoredCheckins(next);
    setCheckins(next);
    if (went !== null && session) {
      // "Worth it" / "skip it" are real feedback → server aggregate. "Didn't
      // go" only tombstones locally so it never touches the trust score.
      submitCheckin(event.id, went, session.token).catch(() => {});
    }
    setCheckinPromptIndex((i) => i + 1);
    trackMetric("checkin_answered", metro.id);
  }

  useEffect(() => {
    if (guidePlanConsumedRef.current || events.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const guidePlan = params.get("guidePlan");
    const guideTitle = params.get("guideTitle");
    const eventIds = parseGuideEventIds(params.get("guideEventIds"));
    if (!guidePlan || eventIds.length === 0) return;

    guidePlanConsumedRef.current = true;
    const byId = new Map(events.map((event) => [event.id, event] as const));
    const handoffNow = new Date();
    const selectedEvents = eventIds
      .map((id) => byId.get(id))
      .filter((event): event is FamilyEvent =>
        // Freshness gate: a stale guide link must not seed a plan with
        // events that have already happened.
        Boolean(event && isUpcomingEvent(event, handoffNow, { timeZone: metro.timezone })),
      );

    params.delete("guidePlan");
    params.delete("guideTitle");
    params.delete("guideEventIds");
    const query = params.toString();
    const hash = window.location.hash || "#/plans";
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${hash}`,
    );

    if (selectedEvents.length === 0) return;

    const id = createPlanId(plans);
    const title = cleanGuidePlanTitle(guideTitle);
    const eventPlanIds = selectedEvents.map((event) => event.id);
    const next: Plan = {
      id,
      name: title,
      stopIds: [],
      eventIds: eventPlanIds,
      itemOrder: eventPlanIds.map((eventId) => ({
        kind: "event" as const,
        id: eventId,
      })),
      createdAt: new Date().toISOString(),
      source: "manual",
      summary: `Started from the ${metro.label} weekend guide.`,
      rationale: [
        `Preset: ${guidePlan.replace(/-/g, " ")}.`,
        "Events are ordered by the guide timeline. Confirm timing and tickets on the official listings.",
      ],
    };
    setPlans((current) => [...current, next]);
    trackMetric("plan_created", metro.id);
    setActivePlanId(id);
    setView("plans");
  }, [events, metro.label, plans]);

  useEffect(() => {
    writeStored(storageKeys.preferences, preferences);
  }, [preferences, storageKeys.preferences]);

  useEffect(() => {
    writeStored(
      storageKeys.selectedCategories,
      Array.from(selectedCategories),
    );
  }, [selectedCategories, storageKeys.selectedCategories]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        INTERESTS_STORAGE_KEY,
        JSON.stringify(Array.from(preferredThemes)),
      );
    } catch {
      // best-effort; non-fatal in private mode
    }
  }, [preferredThemes]);

  useEffect(() => {
    if (APP_AUDIENCE !== "adults") return;
    try {
      window.localStorage.setItem(GOING_OUT_STORAGE_KEY, goingOutMode);
    } catch {
      // best-effort; non-fatal in private mode
    }
  }, [goingOutMode]);

  useEffect(() => {
    if (!SHOW_AGE_BAND_UI) return;
    try {
      window.localStorage.setItem(AGE_BAND_STORAGE_KEY, ageBand);
    } catch {
      // best-effort; non-fatal in private mode
    }
  }, [ageBand]);

  useEffect(() => {
    writeStored(storageKeys.plannerProfile, plannerProfile);
  }, [plannerProfile, storageKeys.plannerProfile]);

  useEffect(() => {
    // Weekend-brief weather: prefer the user's coords, fall back to the
    // metro center so the entrance briefing has a forecast for everyone.
    const lat = userLocation?.lat ?? inferredGeo?.lat ?? metro.center.lat;
    const lon = userLocation?.lon ?? inferredGeo?.lon ?? metro.center.lon;
    if (!lat || !lon) return;
    let active = true;
    fetchWeather(lat, lon).then((forecast) => {
      if (!active) return;
      if (forecast) setWeather(forecast);
    });
    return () => {
      active = false;
    };
  }, [inferredGeo, metro, userLocation]);

  useEffect(() => {
    let active = true;
    fetch(dataUrls.curatedSpots)
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
  }, [dataUrls.curatedSpots]);

  useEffect(() => {
    let active = true;
    fetch(dataUrls.featuredPlans)
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
  }, [dataUrls.featuredPlans]);

  useEffect(() => {
    let active = true;
    fetch(dataUrls.popularEvents)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((dataset: PopularEventsDataset) => {
        if (!active) return;
        if (Array.isArray(dataset?.picks)) setPopularPicks(dataset);
      })
      .catch(() => {
        // Popular picks are optional; the feed renders without them.
      });
    return () => {
      active = false;
    };
  }, [dataUrls.popularEvents]);

  useEffect(() => {
    if (metro.id !== "bay-area") {
      setBoaMuseums([]);
      return;
    }
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
  }, [metro.id]);

  useEffect(() => {
    writeStored(storageKeys.savedSpots, savedIds);
  }, [savedIds, storageKeys.savedSpots]);

  // URL routing: keep window.location.hash in sync with view + activePlanId +
  // activeEventSlug. pushState (no hashchange fired) when state changes;
  // popstate listener handles back/forward navigation.
  useEffect(() => {
    if (window.location.hash.startsWith("#/p/")) return; // poll page
    const target = buildAppHash(view, activePlanId, activeEventSlug);
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
  }, [view, activePlanId, activeEventSlug]);

  useEffect(() => {
    function onPop() {
      if (window.location.hash.startsWith("#/p/")) return;
      const route = readAppRoute();
      setView(route.view);
      setActivePlanId(route.planId);
      setActiveEventSlug(route.eventSlug);
      if (route.focusSpotId) setPendingSpotFocusId(route.focusSpotId);
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  useEffect(() => {
    writeStored(storageKeys.savedEvents, savedEventIds);
  }, [savedEventIds, storageKeys.savedEvents]);

  useEffect(() => {
    writeStored(storageKeys.visitedSpots, visitedIds);
  }, [visitedIds, storageKeys.visitedSpots]);

  useEffect(() => {
    writeStored(storageKeys.customSpots, customSpots);
  }, [customSpots, storageKeys.customSpots]);

  useEffect(() => {
    writeStored(storageKeys.plans, plans);
  }, [plans, storageKeys.plans]);

  useEffect(() => {
    writeStored(storageKeys.deletedPlanIds, deletedPlanIds);
  }, [deletedPlanIds, storageKeys.deletedPlanIds]);

  useEffect(() => {
    setShareState({ status: "idle" });
    if (activePlanId && view === "plans") {
      requestAnimationFrame(() => {
        document.getElementById("plan-detail-area")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [activePlanId, view]);

  useEffect(() => {
    trackMetric("app_open", metro.id);
    // Increment per-browser visit counter so we can make the Friday-digest
    // ask to engaged visitors on their third visit (same cadence the old
    // sign-in modal used — no new modal frequency).
    try {
      const prev = Number(window.localStorage.getItem("saturday.visitCount") || "0") || 0;
      const next = prev + 1;
      window.localStorage.setItem("saturday.visitCount", String(next));
      const dismissed =
        window.localStorage.getItem("saturday.digestPromptDismissed") === "1";
      const subscribed =
        window.localStorage.getItem("saturday.newsletterSubscribed") === "1";
      if (next >= 3 && !dismissed && !subscribed && API_CONFIGURED) {
        setShowDigestPrompt(true);
        trackMetric("digest_prompt_shown", metro.id);
      }
    } catch {
      // ignore
    }
    // "New since your last visit" baseline for the *next* visit.
    try {
      writeLastVisit(new Date().toISOString());
    } catch {
      // ignore
    }
    let cancelled = false;
    fetchGeo().then((geo) => {
      if (cancelled || !geo) return;
      setInferredGeo({ city: geo.city, lat: geo.lat, lon: geo.lon });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Owner-side tally: when a shared plan is open, pull its poll once. The
  // Refresh button bumps the nonce to re-pull — no polling loop.
  const activePollId = activePlanId
    ? plans.find((plan) => plan.id === activePlanId)?.pollId ?? null
    : null;
  useEffect(() => {
    setActivePollTally(null);
    setPollTallyStatus("idle");
    if (!activePollId || !API_CONFIGURED || view !== "plans") return;
    let cancelled = false;
    setPollTallyStatus("loading");
    getPoll(activePollId)
      .then((snapshot) => {
        if (cancelled) return;
        setActivePollTally(snapshot);
        setPollTallyStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setPollTallyStatus("error");
        // Poll expired (30-day TTL) or was deleted server-side — drop the
        // dead pollId so this plan stops re-checking it on every load.
        if (err instanceof PollFetchError && err.status === 404) {
          setPlans((current) =>
            current.map((plan) =>
              plan.pollId === activePollId ? { ...plan, pollId: undefined } : plan,
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePollId, view, tallyRefreshNonce]);

  // One-shot on load: do any shared plans already have votes? Drives the
  // subtle "votes are in" dot on the Plans tab. Checked once per session
  // (most recent 5 shared plans), never re-polled.
  useEffect(() => {
    if (votesCheckedRef.current || !API_CONFIGURED) return;
    const shared = plans.filter((plan) => plan.pollId).slice(-5);
    if (shared.length === 0) return;
    votesCheckedRef.current = true;
    let cancelled = false;
    Promise.all(
      shared.map((plan) =>
        getPoll(plan.pollId as string)
          .then((snapshot) => ({ planId: plan.id, snapshot, expired: false }))
          .catch((err) => ({
            planId: plan.id,
            snapshot: null as PollSnapshot | null,
            expired: err instanceof PollFetchError && err.status === 404,
          })),
      ),
    ).then((results) => {
      if (cancelled) return;
      if (results.some((r) => r.snapshot && r.snapshot.voterCount > 0)) {
        setVotesIn(true);
      }
      // Prune plans whose poll expired (30-day TTL) or was deleted
      // server-side so future loads don't keep re-checking a dead pollId.
      const expiredIds = new Set(
        results.filter((r) => r.expired).map((r) => r.planId),
      );
      if (expiredIds.size > 0) {
        setPlans((current) =>
          current.map((plan) =>
            expiredIds.has(plan.id) ? { ...plan, pollId: undefined } : plan,
          ),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [plans]);

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
          const incomingDeletedPlanIds: string[] = Array.isArray(
            (serverState as { deletedPlanIds?: unknown }).deletedPlanIds,
          )
            ? ((serverState as { deletedPlanIds: unknown[] })
                .deletedPlanIds as string[]).filter(
                (v) => typeof v === "string",
              )
            : [];
          const incomingInterests: string[] = Array.isArray(serverState.interests)
            ? (serverState.interests as string[]).filter(isValidThemeId)
            : [];
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
          setDeletedPlanIds((local) =>
            Array.from(new Set<string>([...local, ...incomingDeletedPlanIds])),
          );
          // Interests merge as a union (mirrors savedIds); next load's
          // auto-enable picks up server interests via the persisted localStorage.
          setPreferredThemes(
            (local) => new Set<string>([...incomingInterests, ...local]),
          );
          setPlans((local) => {
            const tombstones = new Set<string>([
              ...deletedPlanIds,
              ...incomingDeletedPlanIds,
            ]);
            const map = new Map<string, Plan>();
            for (const item of local) map.set(item.id, item);
            for (const item of incomingPlans) map.set(item.id, item);
            return Array.from(map.values()).filter(
              (plan) => !tombstones.has(plan.id),
            );
          });
          // Cloud profile wins only when this browser has none yet (the
          // wizard's own answers are the freshest signal for a given browser).
          if (!localStorage.getItem(PROFILE_STORAGE_KEY) && serverState.profile) {
            setProfile(serverState.profile);
            writeStoredProfile(serverState.profile);
            setShowProfileWizard(false);
          }
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
        deletedPlanIds,
        interests: Array.from(preferredThemes),
        profile,
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
    deletedPlanIds,
    preferredThemes,
    profile,
  ]);

  // Lazy Google Identity: the gsi script + sign-in button iframe are a
  // third-party request chain no signed-out visitor needs until they tap
  // sign-in, so load and initialize on first intent. Idempotent — repeat
  // taps (e.g. after sign-out) reuse the same init.
  function ensureGoogleIdentity(): Promise<void> {
    if (!googleIdentityInit.current) {
      googleIdentityInit.current = (async () => {
        if (!GOOGLE_CONFIGURED) return;
        if (!window.google?.accounts?.id) {
          await loadGoogleIdentity();
        }
        if (!window.google?.accounts?.id) return;
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
              trackMetric("signin_success", metro.id);
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
      })().catch((error: Error) => {
        setSignInError(error.message);
        // Allow a retry on the next tap rather than silently succeeding.
        googleIdentityInit.current = null;
      });
    }
    return googleIdentityInit.current;
  }

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
    setDeletedPlanIds([]);
    setActivePlanId(null);
    setPreferences([]);
    for (const key of [
      storageKeys.savedSpots,
      storageKeys.savedEvents,
      storageKeys.visitedSpots,
      storageKeys.customSpots,
      storageKeys.plans,
      storageKeys.deletedPlanIds,
      storageKeys.preferences,
      storageKeys.plannerProfile,
    ]) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore quota / privacy errors
      }
    }
  }

  const allSpots = useMemo(
    () => [...remoteSpots, ...curatedSpots, ...customSpots],
    [customSpots, curatedSpots, remoteSpots],
  );

  // Venue → curated photo index for events without their own photo: the
  // venue's real image shown in place of a blank card (honest — it's the
  // place, not a stock stand-in for the event).
  const venueImages = useMemo(() => buildVenueImageMap(allSpots), [allSpots]);

  // Consume a `#/spot/<id>` deep link once the spot has loaded: open its map
  // sheet. One-shot — clears so later interactions aren't overridden.
  useEffect(() => {
    if (!pendingSpotFocusId) return;
    const spot = allSpots.find((s) => s.id === pendingSpotFocusId);
    if (!spot) return; // spots still loading
    setMapSelection({ kind: "spot", id: spot.id });
    setView("browse");
    setPendingSpotFocusId(null);
  }, [pendingSpotFocusId, allSpots]);

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
      groupMode: APP_AUDIENCE === "adults" ? goingOutMode : undefined,
    }),
    [ageBand, plannerProfile, plannerWeather, preferences, goingOutMode],
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
      groupSize: APP_AUDIENCE === "adults" ? "2-6 people" : "Family",
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
      .filter((event) => isActualPlanningEvent(event, now, ageBand, metro.timezone))
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
  }, [ageBand, events, plannerAnchor, metro, clockTick]);

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
        selectedCategories.has(spot.category) &&
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
      return interleaveByCategory(filtered.sort(byScore), categories);
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
  }, [allSpots, selectedCategories, city, ageBand, cost, onlyOpen, query, scoringOptions, sortBy, vibe, userLocation]);

  const selectedLabel =
    ageBand === "any"
      ? (APP_AUDIENCE === "adults" ? "All spots" : "Family-friendly spots")
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
    // Themed plans (e.g. Memorial Day weekend) are pinned at the top of the
    // rail regardless of map center — they're time-sensitive and metro-wide,
    // not local, so distance ranking would bury them. They auto-expire from
    // the data feed once the holiday window passes; the themedEnd guard is a
    // backstop so a lapsed feed regeneration can't leave a stale holiday card.
    const now = new Date();
    const eventById = new Map(events.map((e) => [e.id, e] as const));
    const themed = featuredPlans.filter((p) => isThemedPlanEligible(p, eventById, now));
    const handCurated = featuredPlans.filter((p) => !p.generated && !p.themed);
    const generated = featuredPlans.filter((p) => p.generated && !p.themed);
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
    return [
      ...themed,
      ...handCurated,
      ...scored.slice(0, generatedCap).map((s) => s.plan),
    ];
  }, [featuredPlans, mapCenter, userLocation, inferredGeo, events, clockTick]);

  // Plan-first hero pick: top of the rail order, or vibe-re-ranked
  // client-side when a hero vibe chip is active. No backend calls.
  const heroPick = useMemo(
    () =>
      pickHeroFeatured(
        nearbyFeaturedPlans,
        allSpots,
        events,
        heroVibe,
        scoringOptions,
        new Date(),
        metro.timezone,
      ),
    [nearbyFeaturedPlans, allSpots, events, heroVibe, scoringOptions, metro],
  );
  const heroLine = useMemo(() => {
    if (!heroPick) return null;
    const names = [
      ...heroPick.stops.map((s) => s.name),
      ...heroPick.events.map((e) => e.title),
    ].slice(0, 3);
    const city =
      heroPick.featured.city || heroPick.stops[0]?.neighborhood || null;
    return { names, city };
  }, [heroPick]);
  // Hide alongside the date strip (same top-center slot as the weekend
  // banner, which yields to the hero while it's visible).
  const heroVisible =
    !heroDismissed && heroPick !== null && eventDateFilter === "all";
  // Day-aware headline: Thu–Sun sells the imminent weekend, Mon–Wed the
  // head start. Recomputed per render — it only changes at midnight.
  const heroTitle = heroTitleForAudience(APP_AUDIENCE, new Date().getDay());
  const heroForkedPlan = heroForkedPlanId
    ? plans.find((plan) => plan.id === heroForkedPlanId) ?? null
    : null;

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
      if (activeTheme && !(event.themes || []).includes(activeTheme)) return false;
      if (forYou && preferredThemes.size > 0) {
        if (!(event.themes || []).some((t) => preferredThemes.has(t))) return false;
      }
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
        // Freshness gate: ended events never render as browsable suggestions.
        if (!isUpcomingEvent(event, nowDate, { timeZone: metro.timezone })) return false;
        if (t > horizon) return false;
        if (eventDateFilter === "tonight") {
          // Tonight = today, starting in the evening (5pm+).
          if (!sameLocalDate(date, today)) return false;
          if (date.getHours() < 17) return false;
        }
        if (eventDateFilter === "today" && !sameLocalDate(date, today)) return false;
        if (eventDateFilter === "tomorrow" && !sameLocalDate(date, tomorrow)) return false;
        if (eventDateFilter === "weekend") {
          // Fri 5pm+ counts as the weekend — see the "Weekend (Fri–Sun)" chip.
          if (!isWeekendWindowDate(date)) return false;
          if (t > weekendHorizon) return false;
        }
        return true;
      }

      if (eventDateFilter === "tonight") {
        // Recurring series with no clock time: keep today's evening windows.
        return (
          event.daysOfWeek.includes(today.getDay()) &&
          /evening|night|sunset/i.test(event.timeWindow || "")
        );
      }
      if (eventDateFilter === "today") {
        return event.daysOfWeek.includes(today.getDay());
      }
      if (eventDateFilter === "tomorrow") {
        return event.daysOfWeek.includes(tomorrow.getDay());
      }
      // Recurring without a specific date — keep weekend recurrences,
      // including Friday-evening series (the chip covers Fri 5pm+).
      return (
        event.daysOfWeek.some((d) => d === 0 || d === 6) ||
        (event.daysOfWeek.includes(5) &&
          /evening|night|sunset/i.test(event.timeWindow || ""))
      );
    });
  }, [events, ageBand, eventDateFilter, query, activeTheme, forYou, preferredThemes, clockTick]);

  // Interest themes present in this metro, in taxonomy order. Drives the
  // "Browse by interest" chip band; themes with no events here are hidden.
  const themeOptions = useMemo(() => {
    const present = new Set<string>();
    for (const event of events) {
      for (const id of event.themes || []) present.add(id);
    }
    return EVENT_THEMES.filter((theme) => present.has(theme.id));
  }, [events]);

  const highlightedEventIds = useMemo(() => {
    const ids = new Set<string>();
    const nowDate = new Date();
    const weekendHorizon = nowDate.getTime() + 7 * 24 * 60 * 60 * 1000;
    for (const event of mapEvents) {
      if (event.startDateTime) {
        const t = new Date(event.startDateTime).getTime();
        // Freshness gate replaces the old "started within 6h" heuristic,
        // which highlighted a short event hours after it ended and missed a
        // still-running one that started more than 6h ago.
        if (
          Number.isFinite(t) &&
          t <= weekendHorizon &&
          isUpcomingEvent(event, nowDate, { timeZone: metro.timezone })
        ) {
          ids.add(event.id);
        }
      } else if (event.daysOfWeek.some((d) => d === 0 || d === 6)) {
        ids.add(event.id);
      }
    }
    return ids;
  }, [mapEvents, metro, clockTick]);

  // Dynamic teaser for the weekend-guide entry point on the browse view: how
  // much is actually happening this weekend, so the link feels promising
  // rather than generic.
  const weekendGuideStats = useMemo(() => {
    if (events.length === 0) return null;
    // Count events actually dated to the upcoming Sat/Sun (matches the guide
    // page), not every recurring series — an inflated "this weekend" number
    // reads as not credible.
    const now = new Date();
    const dow = now.getDay();
    const daysToSat = dow === 0 ? -1 : 6 - dow;
    const sat = new Date(now);
    sat.setHours(0, 0, 0, 0);
    sat.setDate(now.getDate() + daysToSat);
    const keyOf = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
    const satKey = keyOf(sat);
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    const sunKey = keyOf(sun);
    const inWeekend = events.filter((e) => {
      if (!e.startDateTime) return false;
      // Freshness gate: don't count events that already ended (e.g. Saturday
      // events when it's already Sunday) — an inflated number reads as stale.
      if (!isUpcomingEvent(e, now, { timeZone: metro.timezone })) return false;
      const d = new Date(e.startDateTime);
      if (!Number.isFinite(d.getTime())) return false;
      const k = keyOf(d);
      return k === satKey || k === sunKey;
    });
    const scoped =
      ageBand !== "any"
        ? inWeekend.filter((e) => e.ageBands.includes(ageBand))
        : inWeekend;
    if (scoped.length < 3) return null;
    const free = scoped.filter((e) => e.cost === "Free").length;
    return { count: scoped.length, free };
  }, [events, ageBand, clockTick]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (query) n += 1;
    if (ageBand !== "any") n += 1;
    if (selectedCategories.size !== categories.length) n += 1;
    if (city !== "All") n += 1;
    if (cost !== "All") n += 1;
    if (eventDateFilter !== "all") n += 1;
    if (activeTheme) n += 1;
    if (forYou) n += 1;
    return n;
  }, [query, ageBand, selectedCategories, city, cost, eventDateFilter, activeTheme, forYou]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? null,
    [plans, activePlanId],
  );

  const activePollSummary = useMemo(
    () => (activePollTally ? summarizePollTallies(activePollTally) : null),
    [activePollTally],
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

  const activePlanMapItems = useMemo<PlanMapItem[]>(
    () =>
      activePlanItems
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
        .filter((x): x is PlanMapItem => x !== null),
    [activePlanItems],
  );

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
    const nowDate = new Date();
    const now = nowDate.getTime();
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
        // Freshness gate: never suggest an event that already ended.
        if (!isUpcomingEvent(event, nowDate, { timeZone: metro.timezone })) continue;
        const t = new Date(event.startDateTime).getTime();
        if (!Number.isFinite(t) || t > sevenDays) {
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
  }, [activePlan, activePlanStops, events, ageBand, targetDayOfWeek, clockTick]);

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
    const id = createPlanId(plans);
    const next: Plan = {
      id,
      name: "New plan",
      stopIds: [],
      createdAt: new Date().toISOString(),
    };
    setPlans((current) => [...current, next]);
    trackMetric("plan_created", metro.id);
    setActivePlanId(id);
    setView("plans");
  }

  function createPlanFromSaved() {
    if (savedSpots.length === 0 && savedEvents.length === 0) {
      return;
    }
    const id = createPlanId(plans);
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
    trackMetric("plan_created", metro.id);
    setActivePlanId(id);
    setView("plans");
  }

  function addHopNowItemToPlan(item: PlanItemRef) {
    if (activePlanId) {
      setPlans((current) =>
        current.map((plan) => {
          if (plan.id !== activePlanId) return plan;
          const stopSet = new Set(plan.stopIds);
          const eventSet = new Set(plan.eventIds ?? []);
          const orderRefs = plan.itemOrder ?? [
            ...plan.stopIds.map((id) => ({ kind: "spot" as const, id })),
            ...(plan.eventIds ?? []).map((id) => ({
              kind: "event" as const,
              id,
            })),
          ];
          const alreadyOrdered = orderRefs.some(
            (ref) => ref.kind === item.kind && ref.id === item.id,
          );
          if (item.kind === "spot") stopSet.add(item.id);
          else eventSet.add(item.id);
          return {
            ...plan,
            stopIds: Array.from(stopSet),
            eventIds: Array.from(eventSet),
            itemOrder: alreadyOrdered ? orderRefs : [...orderRefs, item],
          };
        }),
      );
      return;
    }
    const id = createPlanId(plans);
    const next: Plan = {
      id,
      name: "Hop now picks",
      stopIds: item.kind === "spot" ? [item.id] : [],
      eventIds: item.kind === "event" ? [item.id] : [],
      itemOrder: [item],
      createdAt: new Date().toISOString(),
      source: "manual",
      summary: "Built from Hop me now suggestions.",
    };
    setPlans((current) => [...current, next]);
    trackMetric("plan_created", metro.id);
    setActivePlanId(id);
  }

  function forkFeaturedPlan(featured: FeaturedPlan): string | null {
    // Resolve refs against current data; silently skip missing items rather
    // than block the fork — featured-plans.json may reference ids that aren't
    // in this build of the dataset.
    const validStops = new Set(allSpots.map((s) => s.id));
    const eventById = new Map(events.map((e) => [e.id, e] as const));
    const forkNow = new Date();
    const stopIds = featured.stopIds.filter((id) => validStops.has(id));
    // Freshness gate: featured plans can reference events that have since
    // happened — never fork a past event into a new plan.
    const eventIds = (featured.eventIds ?? []).filter((id) => {
      const event = eventById.get(id);
      return Boolean(event && isUpcomingEvent(event, forkNow, { timeZone: metro.timezone }));
    });
    if (stopIds.length === 0 && eventIds.length === 0) {
      // Nothing to fork — let the user know via console; the rail UI also
      // disables the button when this is the case.
      console.warn(
        `Featured plan ${featured.id} references no items present in the current dataset.`,
      );
      return null;
    }
    const id = createPlanId(plans);
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
    trackMetric("plan_created", metro.id);
    setActivePlanId(id);
    setView("plans");
    return id;
  }

  // Hero "Make it mine": same fork path as the editor's-picks rail, plus the
  // hero-specific funnel metric (fired alongside the generic plan_created).
  function createHeroPlan(featured: FeaturedPlan) {
    const id = forkFeaturedPlan(featured);
    if (!id) return;
    setHeroForkedPlanId(id);
    trackMetric("hero_plan_created", metro.id);
  }

  function dismissHero() {
    setHeroDismissed(true);
    try {
      window.localStorage.setItem(HERO_DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
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

  // Add an event to the active plan, or seed a fresh plan with it when none is
  // active — so discovery surfaces (event detail, map sheet) always have a path
  // into planning, not only when a plan already exists.
  function addEventToPlanOrCreate(eventId: string) {
    if (activePlan) {
      addEventToPlan(activePlan.id, eventId);
      return;
    }
    // No active plan: if a plan already holds this event, just make it active
    // (avoids spawning duplicate single-event plans on revisits); else seed one.
    const existing = plans.find((plan) =>
      (plan.eventIds ?? []).includes(eventId),
    );
    if (existing) {
      setActivePlanId(existing.id);
      return;
    }
    const id = createPlanId(plans);
    const title = events.find((e) => e.id === eventId)?.title;
    const next: Plan = {
      id,
      name: title ? `Plan: ${title}`.slice(0, 60) : "New plan",
      stopIds: [],
      eventIds: [eventId],
      itemOrder: [{ kind: "event" as const, id: eventId }],
      createdAt: new Date().toISOString(),
    };
    setPlans((current) => [...current, next]);
    trackMetric("plan_created", metro.id);
    setActivePlanId(id);
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
    setDeletedPlanIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
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

  // In-app deep link to an event (always resolves, unlike the prerendered
  // page which the event-page cap may omit). EventDetailView mirrors OG meta.
  const eventShareUrl = (slug: string) => `${shareBaseUrl}/#/event/${slug}`;
  // Spot deep link by stable id — always resolves (opens the map sheet),
  // unlike the prerendered /spot/<slug>/ page which the spot-page cap may omit.
  const spotShareUrl = (id: string) =>
    `${shareBaseUrl}/#/spot/${encodeURIComponent(id)}`;

  // One-tap share: native share sheet on mobile, clipboard copy elsewhere.
  async function shareItem(title: string, url: string) {
    trackMetric("item_shared", metro.id);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: `${title} — ${APP_BRAND}`, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopiedUrl(url);
      window.setTimeout(
        () => setShareCopiedUrl((current) => (current === url ? null : current)),
        2000,
      );
    } catch {
      // clipboard blocked — non-fatal
    }
  }

  async function sharePlan() {
    if (
      !activePlan ||
      (activePlanStops.length === 0 && activePlanEvents.length === 0)
    ) {
      return;
    }
    // Optional vote-updates email: reject obvious typos up front rather than
    // silently dropping the address the user expected updates at.
    const voteEmail = notifyEmail.trim();
    if (voteEmail && !EMAIL_RE.test(voteEmail)) {
      setShareState({
        status: "error",
        error: "That vote-updates email doesn't look right — fix or clear it.",
      });
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
        metroId: metro.id,
        stops: stopPayload,
        events: eventPayload,
        itemOrder: itemOrderPayload,
        notifyEmail: voteEmail || undefined,
      });
      const url = pollShareUrl(result.pollId);
      updatePlan(activePlan.id, {
        pollId: result.pollId,
        ownerToken: result.ownerToken,
      });
      // Prefer the native share sheet (same pattern as shareItem). Clipboard
      // is the fallback — and only claims "copied" when the write actually
      // resolved: iOS Safari routinely rejects clipboard writes after the
      // awaited createPoll, and a false "copied" made users think they had
      // shared when nothing was sent.
      const shareText = buildPlanShareMessage(planTitle, url);
      let copied = false;
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({
            title: buildPlanShareSubject(planTitle),
            text: buildPlanShareMessage(planTitle),
            url,
          });
        } catch (err) {
          // AbortError = user closed the sheet; anything else (e.g. lost
          // user activation) falls back to the clipboard attempt.
          if ((err as Error)?.name !== "AbortError") {
            copied = await copyTextToClipboard(shareText);
          }
        }
      } else {
        copied = await copyTextToClipboard(shareText);
      }
      setShareState({ status: "shared", url, copied });
      trackMetric("plan_shared", metro.id);
    } catch (error) {
      setShareState({ status: "error", error: (error as Error).message });
    }
  }

  // Wrapped-style plan card: create the server snapshot, show the preview
  // modal. The image export happens on demand from the modal (sharePlanCardImage)
  // so the capture runs only when the user actually shares.
  async function sharePlanAsCard() {
    if (
      !activePlan ||
      (activePlanStops.length === 0 && activePlanEvents.length === 0)
    ) {
      return;
    }
    if (!API_CONFIGURED) {
      setPlanCardError("Backend not deployed in this preview.");
      return;
    }
    setPlanCardBusy(true);
    setPlanCardError(null);
    setPlanCardCopied(false);
    const stops: StopSummary[] = [
      ...activePlanStops.map((spot) => ({
        id: spot.id,
        name: spot.name,
        neighborhood: spot.neighborhood,
        category: spot.category,
        imageUrl: spot.imageUrl,
        cost: spot.cost,
      })),
      ...activePlanEvents.map((event) => ({
        id: event.id,
        name: event.title,
        neighborhood: event.neighborhood,
        category: event.category,
        cost: event.cost,
      })),
    ].slice(0, 3);
    try {
      const { cardId } = await createPlanCard({
        title: activePlan.name || "Untitled plan",
        metroId: metro.id,
        stops,
      });
      trackMetric("plan_card_created", metro.id);
      setPlanCard({
        cardId,
        metroId: metro.id,
        title: activePlan.name || "Untitled plan",
        stops,
        createdAt: new Date().toISOString(),
      });
    } catch {
      setPlanCardError("Couldn't create the card — try again.");
    } finally {
      setPlanCardBusy(false);
    }
  }

  // Export the previewed card art to a PNG and share it (image + link) via the
  // native sheet, or download + copy the link where file sharing is unsupported.
  async function sharePlanCardImage() {
    const node = planCardRef.current;
    if (!node || !planCard) return;
    setPlanCardBusy(true);
    try {
      // html-to-image is heavy (~40 KB) and only needed on the share action —
      // load it off the boot chunk.
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, { pixelRatio: 1 });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "weekend-plan.png", { type: "image/png" });
      const url = `${shareBaseUrl}#/card/${planCard.cardId}`;
      const text = `${planCard.title} — plan it with ${APP_BRAND}`;
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: planCard.title, text, url });
          } else {
            const anchor = document.createElement("a");
            anchor.href = dataUrl;
            anchor.download = "weekend-plan.png";
            anchor.click();
            const copied = await copyTextToClipboard(text + " " + url);
            setPlanCardCopied(copied);
          }
        } catch (err) {
          if ((err as Error)?.name !== "AbortError") {
            const copied = await copyTextToClipboard(text + " " + url);
            setPlanCardCopied(copied);
          }
        }
      } else {
        const anchor = document.createElement("a");
        anchor.href = dataUrl;
        anchor.download = "weekend-plan.png";
        anchor.click();
        const copied = await copyTextToClipboard(text + " " + url);
        setPlanCardCopied(copied);
      }
      trackMetric("plan_card_shared", metro.id);
    } catch {
      setPlanCardError("Couldn't export the image — copy the link instead.");
    } finally {
      setPlanCardBusy(false);
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
        window.localStorage.setItem(storageKeys.userLocation, JSON.stringify(next));
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
    window.localStorage.removeItem(storageKeys.userLocation);
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

  function toggleInterest(id: string) {
    setPreferredThemes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleForYouClick() {
    if (preferredThemes.size === 0) {
      setShowInterestsPicker(true);
      return;
    }
    setActiveTheme(null);
    setForYou((v) => !v);
  }

  function resetFilters() {
    setQuery("");
    setActiveTheme(null);
    setForYou(false);
    setAgeBand("any");
    setVibe("balanced");
    setSelectedCategories(
      new Set<Category>(
        APP_AUDIENCE === "adults"
          ? categories
          : categories.filter((c) => c !== "Food"),
      ),
    );
    setCity("All");
    setCost("All");
    setOnlyOpen(false);
    setEventDateFilter("all");
    setSortBy("best");
    setPreferences([]);
    setPlannerProfile(defaultPlannerProfile);
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
      mood: APP_AUDIENCE === "adults" ? "Saved idea" : "Family plan idea",
      groupSize: APP_AUDIENCE === "adults" ? "2-6 people" : "Family",
      planning: "Flexible",
      openNow: true,
      note:
        note ||
        (APP_AUDIENCE === "adults"
          ? "A saved friend outing idea to fill in later."
          : "A saved family outing idea to fill in later."),
      tags: ["custom", newSpot.category.toLowerCase()],
    };

    setCustomSpots((current) => [...current, created]);
    setSavedIds((current) => [...current, created.id]);
    setNewSpot(emptyNewSpot);
    setIsAdding(false);
  }

  return (
    <div className={`app-shell${view === "browse" ? " is-browse" : ""}`}>
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden="true">
            {APP_AUDIENCE === "adults" ? (
              // Mosey: "stroll-to-pin" — matches the new app icon/favicon.
              <svg width="22" height="22" viewBox="0 0 64 64">
                <rect width="64" height="64" rx="14" fill="var(--accent)" />
                <g transform="scale(0.125)" fill="#fff">
                  <circle cx="162" cy="372" r="17" />
                  <circle cx="200" cy="344" r="14.5" />
                  <circle cx="224" cy="306" r="12" />
                  <circle cx="246" cy="272" r="10" />
                  <path d="M300 150 C 256 150 221 185 221 228 C 221 289 300 360 300 360 C 300 360 379 289 379 228 C 379 185 344 150 300 150 Z" />
                </g>
                <circle cx="37.5" cy="28.25" r="3.75" fill="var(--accent)" />
              </svg>
            ) : (
              // FamHop: sun over two hills — matches the app icon/favicon.
              <svg width="22" height="22" viewBox="0 0 64 64">
                <defs>
                  <clipPath id="famhop-topbar-tile">
                    <rect width="64" height="64" rx="14" />
                  </clipPath>
                </defs>
                <rect width="64" height="64" rx="14" fill="#FAEDC9" />
                <g clipPath="url(#famhop-topbar-tile)">
                  <circle cx="30" cy="25" r="10.5" fill="var(--accent)" />
                  <path d="M-8 66 Q22 4 52 66 Z" fill="#2D5043" />
                  <path d="M16 66 Q46 14 76 66 Z" fill="#1F3A2F" />
                </g>
              </svg>
            )}
          </span>
          <h1 className="topbar-wordmark">
            {APP_AUDIENCE === "adults" ? (
              APP_BRAND
            ) : (
              // Gabarito 800 cut to outlines, with the "o" burned out into the sun.
              // Shipped as paths so the logo never waits on (or falls back from) a webfont.
              <>
                <svg className="topbar-logotype" viewBox="0 0 320.4 100" aria-hidden="true">
                  <g transform="translate(0 76) scale(0.1 -0.1)">
                    <g fill="currentColor">
                      <path d="M81 0V515Q81 571 102.5 611.5Q124 652 163.5 674.5Q203 697 256 697Q284 697 305.5 693.5Q327 690 339 688V541Q331 543 320.5 545.5Q310 548 294 548Q268 548 256.0 533.5Q244 519 244 488V0ZM328 320H18V469H328Z" />
                      <path d="M196 -13Q144 -13 104.0 7.5Q64 28 41.5 65.5Q19 103 19 151Q19 203 43.5 239.5Q68 276 108.5 295.5Q149 315 198 315Q271 315 317.0 281.5Q363 248 377 183L311 198V309Q311 334 293.0 352.0Q275 370 237 370Q210 370 175.0 363.0Q140 356 101 337L55 452Q99 474 152.0 488.5Q205 503 262 503Q331 503 378.5 478.0Q426 453 450.0 407.5Q474 362 474 300V0H338L307 97L377 119Q362 58 317.5 22.5Q273 -13 196 -13ZM251 97Q279 97 296.0 112.0Q313 127 313 151Q313 174 296.0 189.0Q279 204 251 204Q221 204 204.5 189.0Q188 174 188 151Q188 127 204.5 112.0Q221 97 251 97Z" transform="translate(317 0)" />
                      <path d="M48 0V490H168L200 389L141 395Q166 423 198.5 447.5Q231 472 270.0 487.5Q309 503 352 503Q400 503 429.5 486.0Q459 469 475.0 440.5Q491 412 497.5 376.0Q504 340 504 301V0H342V282Q342 320 330.0 332.0Q318 344 299 344Q272 344 246.5 329.5Q221 315 195 289L160 370H210V0ZM634 0V282Q634 320 622.5 332.0Q611 344 592 344Q566 344 540.0 329.5Q514 315 488 289L435 395Q460 423 492.5 447.5Q525 472 564.0 487.5Q603 503 645 503Q693 503 723.0 486.0Q753 469 769.0 440.5Q785 412 791.0 376.0Q797 340 797 301V0Z" transform="translate(800 0)" />
                      <path d="M48 0V681H210V0ZM352 0V282Q352 320 340.0 332.0Q328 344 305 344Q288 344 269.0 337.5Q250 331 231.5 318.5Q213 306 195 289L141 395Q166 423 199.5 447.5Q233 472 272.5 487.5Q312 503 356 503Q405 503 436.0 486.0Q467 469 484.0 440.5Q501 412 507.5 376.0Q514 340 514 301V0Z" transform="translate(1607 0)" />
                    </g>
                    <circle cx="2411.5" cy="245" r="269.9" fill="var(--accent)" />
                    <g fill="currentColor" transform="translate(2662 0)">
                      <path d="M326 -13Q262 -13 215.0 16.0Q168 45 142.0 102.0Q116 159 116 245Q116 325 142.5 382.5Q169 440 216.5 471.5Q264 503 327 503Q394 503 444.5 469.5Q495 436 523.5 378.0Q552 320 552 245Q552 170 523.0 111.5Q494 53 442.5 20.0Q391 -13 326 -13ZM48 -190V490H168L210 356H201V144H210V-190ZM295 143Q334 143 360.5 171.5Q387 200 387 245Q387 289 360.5 318.5Q334 348 295 348Q256 348 229.0 318.5Q202 289 202 245Q202 200 229.0 171.5Q256 143 295 143Z" />
                    </g>
                  </g>
                </svg>
                <span className="topbar-wordmark-text">{APP_BRAND}</span>
              </>
            )}
          </h1>
        </div>

        <label className="topbar-metro" title={`Browsing ${metro.label}`}>
          <span className="topbar-metro-prefix">in</span>
          <select
            aria-label="Choose metro area"
            value={metro.id}
            onChange={(event) => switchMetro(event.target.value)}
            style={{ width: `${Math.min(160, metro.label.length * 9 + 16)}px` }}
          >
            {METROS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <nav className="topbar-tabs" aria-label="View">
          {/* Weekend leads: the decision-first feed is the primary surface;
              the map ("Explore") is the inventory behind it. The old Guide
              tab exited the SPA to the static page — that page is now linked
              from inside the Weekend view instead. */}
          <button
            className={view === "weekend" ? "active" : ""}
            onClick={() => setView("weekend")}
          >
            <CalendarDays aria-hidden="true" />
            Weekend
          </button>
          <button
            className={view === "browse" ? "active" : ""}
            onClick={() => setView("browse")}
          >
            <MapPin aria-hidden="true" />
            Explore
          </button>
          <button
            className={view === "plans" ? "active" : ""}
            onClick={() => setView("plans")}
          >
            <List aria-hidden="true" />
            Plans
            <em className="tab-count">{plans.length}</em>
            {votesIn && (
              <span
                className="tab-vote-dot"
                title="Votes are in"
                aria-label="Votes are in on a shared plan"
              />
            )}
          </button>
        </nav>

        <button
          className="hop-now-button topbar-hop"
          type="button"
          onClick={openHopNow}
          title="Things to do right now"
        >
          <Zap aria-hidden="true" />
          <span className="hop-now-label">Hop now</span>
        </button>

        <div className="topbar-spacer" />

        <button
          className="icon-button topbar-refresh"
          type="button"
          title={
            dataMeta.loading
              ? `Loading ${metro.label} data…`
              : eventsState === "error"
                ? "Couldn't load events. Click to retry."
                : dataMeta.error
                  ? "Data error — using fallback. Click to reset filters."
                  : `${
                      dataMeta.eventsCount != null
                        ? `${dataMeta.count} spots · ${dataMeta.eventsCount} events`
                        : `${dataMeta.count} ${metro.label} spots`
                    } · Refreshed ${formatGeneratedAt(
                      latestGeneratedAt(
                        dataMeta.generatedAt,
                        dataMeta.eventsGeneratedAt,
                      ),
                    )} · Click to reset filters`
          }
          onClick={() => {
            if (eventsState === "error") {
              retryEvents();
              return;
            }
            resetFilters();
          }}
          aria-label={
            eventsState === "error"
              ? "Retry loading events"
              : "Refresh and reset filters"
          }
        >
          <RotateCcw aria-hidden="true" />
        </button>

        <button
          className="primary-button topbar-add"
          onClick={() => setIsAdding(true)}
        >
          <Plus aria-hidden="true" />
          Add spot
        </button>

        <div className="topbar-auth">
          {session ? (
            <div className="user-chip" title={session.user.email}>
              <button
                type="button"
                className="user-chip-avatar"
                onClick={signOut}
                title={`Signed in as ${session.user.name} — tap to sign out`}
              >
                {session.user.picture ? (
                  <img src={session.user.picture} alt="" />
                ) : (
                  <span className="user-avatar-fallback">
                    <Users aria-hidden="true" />
                  </span>
                )}
              </button>
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
              {GOOGLE_CONFIGURED && (
                <div ref={signInButtonRef} className="signin-slot" />
              )}
              <button
                type="button"
                className="user-avatar-fallback"
                title="Sign in with Google"
                onClick={() => {
                  void ensureGoogleIdentity().then(() => {
                    const btn = signInButtonRef.current?.querySelector<HTMLElement>('[role="button"], iframe, div[tabindex]');
                    if (btn) { btn.click(); return; }
                    const gid = window.google?.accounts?.id as { prompt?: () => void } | undefined;
                    gid?.prompt?.();
                  });
                }}
              >
                <Users aria-hidden="true" />
              </button>
              {signInError && (
                <span className="signin-error">{signInError}</span>
              )}
            </div>
          )}
        </div>
      </header>

      {view === "browse" && (
        <div className="view-bar">
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
        </div>
      )}

      {view === "browse" ? (
      <main className="browse-viewport">
        {/* ── Full-bleed map (background layer) ─────────────────────── */}
        <div className="map-shell">
          <SpotMap
            ref={mapRef}
            spots={filteredSpots}
            events={mapEvents}
            highlightedEventIds={highlightedEventIds}
            selected={mapSelection}
            onSelect={setMapSelection}
            userLocation={userLocation}
            geoState={geoState}
            onRequestLocation={requestUserLocation}
            onViewChange={setMapCenter}
            defaultCenter={defaultMapCenter}
            mapViewStorageKey={storageKeys.mapView}
          />
        </div>

        {/* ── Map controls (bottom-left zoom + locate) ─────────────── */}
        <div className="map-controls">
          <div className="map-controls-group">
            <button type="button" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
            <div className="map-controls-divider" />
            <button type="button" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
          </div>
          <button
            className={`map-control-locate${userLocation ? " has-location" : ""}`}
            type="button"
            title={userLocation ? "Using your location — tap to clear" : "Use my location"}
            disabled={geoState === "requesting"}
            onClick={userLocation ? clearUserLocation : requestUserLocation}
          >
            <MapPin aria-hidden="true" />
          </button>
        </div>

        {/* ── Summary chip (top-right) ─────────────────────────────── */}
        <div className="summary-chip" aria-label="Map summary">
          <div>
            <strong>{filteredSpots.length}</strong> spots
          </div>
          <div>
            <strong className="summary-events">{mapEvents.length}</strong> events
            {highlightedEventIds.size > 0 && (
              <span> · {highlightedEventIds.size} this week</span>
            )}
          </div>
        </div>

        {/* ── First-visit age prompt (top-center): one tap to personalize
            everything by kids' ages. Owns the slot until answered or
            dismissed — the hero and weekend banner yield so the
            top-center overlays never stack. ── */}
        {agePromptVisible && (
          <div
            className="age-prompt"
            role="group"
            aria-label="Show events for your kids' ages"
          >
            <span className="age-prompt-label">Kids&rsquo; ages?</span>
            <div className="segmented compact">
              {([
                ["toddler", "0–2"],
                ["preschool", "3–5"],
                ["school-age", "6–10"],
                ["tween", "10+"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAgeBand(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-button age-prompt-dismiss"
              title="Hide"
              aria-label="Hide age prompt"
              onClick={dismissAgePrompt}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── Plan-first hero (top-center): the advertised "3-stop plan in
            seconds" promise, fulfilled with the top editor's pick. The
            weekend banner yields this slot while the hero is visible. ── */}
        {!agePromptVisible && heroVisible && heroPick && heroLine && (
          <section
            className={`hero-plan${heroExpanded ? " is-open" : ""}`}
            aria-label="Ready-made plan"
          >
            <button
              type="button"
              className="hero-plan-toggle"
              onClick={() => setHeroExpanded((v) => !v)}
              aria-expanded={heroExpanded}
            >
              <Sparkles aria-hidden="true" />
              <span>{heroTitle}</span>
              <ChevronDown aria-hidden="true" />
            </button>
            <div className="hero-plan-body">
              <div className="hero-plan-head">
                <p className="hero-plan-eyebrow">{heroTitle}</p>
                <button
                  type="button"
                  className="hero-plan-dismiss"
                  onClick={dismissHero}
                >
                  Not now
                </button>
              </div>
              <strong className="hero-plan-name">
                {heroPick.featured.name}
              </strong>
              <span className="hero-plan-stops">
                {heroLine.names.join(" → ")}
                {heroLine.city ? ` · ${heroLine.city}` : ""}
              </span>
              <span className="hero-plan-why">{heroPick.featured.summary}</span>
              <div className="hero-plan-vibes" role="group" aria-label="Pick a vibe">
                {HERO_VIBES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`hero-vibe-chip${heroVibe === v ? " active" : ""}`}
                    aria-pressed={heroVibe === v}
                    onClick={() =>
                      setHeroVibe((current) => (current === v ? null : v))
                    }
                  >
                    {APP_VIBE_LABELS[v]}
                  </button>
                ))}
              </div>
              <div className="hero-plan-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => createHeroPlan(heroPick.featured)}
                >
                  <Plus aria-hidden="true" />
                  Make it mine
                </button>
                {heroForkedPlan && (
                  <button
                    type="button"
                    className="secondary-button"
                    title="Open your plan to share a vote link"
                    onClick={() => {
                      setActivePlanId(heroForkedPlan.id);
                      setView("plans");
                    }}
                  >
                    <Share2 aria-hidden="true" />
                    Share it
                  </button>
                )}
              </div>
              <NewsletterCard
                metroId={metro.id}
                metroLabel={metro.label}
                source="app-browse"
                collapsedLabel={APP_DIGEST_CTA}
              />
            </div>
          </section>
        )}

        {/* ── Weekend-guide hook (top-center) ──────────────────────── */}
        {!agePromptVisible && !heroVisible && weekendGuideStats && eventDateFilter === "all" && (
          <a
            className="weekend-guide-banner"
            href={weekendGuideHref}
            onClick={() => trackMetric("weekend_guide_click", metro.id)}
          >
            <span className="weekend-guide-banner-icon" aria-hidden="true">
              <CalendarDays />
            </span>
            <span className="weekend-guide-banner-text">
              <strong>This weekend in {metro.label}</strong>
              <small>
                {weekendGuideStats.count}{" "}
                {APP_AUDIENCE === "adults" ? "events" : "family events"}
                {weekendGuideStats.free > 0
                  ? ` · ${weekendGuideStats.free} free`
                  : ""}
              </small>
            </span>
            <span className="weekend-guide-banner-cta" aria-hidden="true">
              <ChevronRight />
            </span>
          </a>
        )}

        {/* ── Events date strip (when events filter active) ──────── */}
        {eventDateFilter !== "all" && (
          <div className="date-strip" aria-label="Event date filter">
            <span className="date-strip-label">When</span>
            {eventDateFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`date-strip-chip${eventDateFilter === item.id ? " active" : ""}`}
                onClick={() => setEventDateFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
            <span className="date-strip-count">
              <strong>{mapEvents.length}</strong> events
            </span>
          </div>
        )}

        {/* ── Mobile filter trigger (visible only ≤820px) ──────────── */}
        <button
          className="browse-filter-trigger"
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

        {/* ── Filter drawer (floating, left side) ──────────────────── */}
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
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="filter-reset"
                onClick={resetFilters}
              >
                Reset
              </button>
            )}
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
              placeholder="Search"
            />
          </label>

          {themeOptions.length > 0 && (
            <div className="filter-group">
              <div className="filter-label-row">
                <span className="filter-label">Browse by interest</span>
                {preferredThemes.size > 0 && (
                  <button
                    type="button"
                    className="filter-label-action"
                    onClick={() => setShowInterestsPicker(true)}
                  >
                    Edit interests
                  </button>
                )}
              </div>
              <div className="theme-chips">
                <button
                  type="button"
                  className={`theme-chip theme-chip-foryou${forYou ? " active" : ""}`}
                  title="See events matching your saved interests"
                  aria-pressed={forYou}
                  onClick={handleForYouClick}
                >
                  ✨ For you
                </button>
                <button
                  type="button"
                  className={`theme-chip${!forYou && activeTheme === null ? " active" : ""}`}
                  onClick={() => {
                    setForYou(false);
                    setActiveTheme(null);
                  }}
                >
                  All
                </button>
                {themeOptions.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`theme-chip${!forYou && activeTheme === theme.id ? " active" : ""}`}
                    title={theme.blurb}
                    aria-pressed={!forYou && activeTheme === theme.id}
                    onClick={() => {
                      setForYou(false);
                      setActiveTheme((current) =>
                        current === theme.id ? null : theme.id,
                      );
                    }}
                  >
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {SHOW_AGE_BAND_UI && (
            <div className="filter-group">
              <span className="filter-label">Age group</span>
              <div className="segmented compact">
                <button
                  className={ageBand === "any" ? "active" : ""}
                  onClick={() => setAgeBand("any")}
                >
                  Any
                </button>
                {([
                  ["toddler", "0–2"],
                  ["preschool", "3–5"],
                  ["school-age", "6–10"],
                  ["tween", "10+"],
                ] as const).map(([value, label]) => (
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

          {APP_AUDIENCE === "adults" && (
            <div className="filter-group">
              <span className="filter-label">Going out</span>
              <div className="segmented compact">
                {([
                  ["friends", "With friends"],
                  ["solo", "Solo"],
                  ["date", "Date"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={goingOutMode === value ? "active" : ""}
                    onClick={() => setGoingOutMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="filter-group">
            <span className="filter-label">Spot legend</span>
            <div className="cat-legend">
              <CategoryLegend
                categories={categories}
                allSpots={allSpots}
                selected={selectedCategories}
                expanded={categoriesExpanded}
                onToggleExpand={() => setCategoriesExpanded((v) => !v)}
                onToggleAll={() =>
                  setSelectedCategories((current) =>
                    current.size === categories.length
                      ? new Set<Category>()
                      : new Set<Category>(categories),
                  )
                }
                onToggleCategory={(cat) =>
                  setSelectedCategories((current) => {
                    const next = new Set(current);
                    if (next.has(cat)) next.delete(cat);
                    else next.add(cat);
                    return next;
                  })
                }
              />
            </div>
          </div>

          <label className="select-field">
            <span>Area</span>
            <select
              value={city}
              onChange={(event) => {
                const next = event.target.value;
                setCity(next);
                if (next !== "All") {
                  const inCity = allSpots.filter((s) => s.neighborhood === next);
                  if (inCity.length > 0) {
                    const avgLat = inCity.reduce((s, sp) => s + (sp.lat as number), 0) / inCity.length;
                    const avgLon = inCity.reduce((s, sp) => s + (sp.lon as number), 0) / inCity.length;
                    mapRef.current?.flyTo(avgLat, avgLon, 13);
                  }
                }
              }}
            >
              <option value="All">All ({allSpots.length})</option>
              {cityOptions.map(({ name, count }) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>

          <div className="filter-group">
            <span className="filter-label">Cost</span>
            <div className="cost-segmented">
              <button
                type="button"
                className={cost === "All" ? "active" : ""}
                onClick={() => setCost("All")}
              >
                Any
              </button>
              {(["Free", "$", "$$", "$$$"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cost === c ? "active" : ""}
                  onClick={() => setCost(cost === c ? "All" : c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">When</span>
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

          {/* Geolocation handled by map-controls locate button */}
        </aside>

        {/* ── Editor's picks strip (bottom glass panel) ──────────── */}
        {nearbyFeaturedPlans.length > 0 && (
          <section
            ref={picksRailRef}
            className={`featured-rail${picksExpanded ? " is-expanded" : ""}`}
            aria-label="Editor's picks — starter plans"
          >
            <div
              className="featured-rail-head"
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setPicksExpanded((v) => !v);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="featured-rail-eyebrow">
                Editor's picks{mapCenter ? " near this view" : ""} · {nearbyFeaturedPlans.length}
              </span>
              <span className="featured-rail-sub">
                {picksExpanded ? "Tap to collapse" : "Pull up to browse plans"}
              </span>
            </div>
            <ul className="featured-rail-list">
              {nearbyFeaturedPlans.map((featured) => {
                const accent = featured.accent || "park";
                const heroStop = featured.stopIds
                  .map((sid) => allSpots.find((s) => s.id === sid))
                  .find((s): s is Spot => Boolean(s));
                const stopCount = featured.stopIds.length;
                // Count only events that haven't ended, matching what
                // forkFeaturedPlan will actually put in the plan.
                const eventCount = (featured.eventIds ?? []).filter((id) => {
                  const event = events.find((e) => e.id === id);
                  return Boolean(event && isUpcomingEvent(event, new Date(), { timeZone: metro.timezone }));
                }).length;
                return (
                  <li
                    key={featured.id}
                    className={`featured-card accent-${accent}`}
                  >
                    <button
                      type="button"
                      className="featured-card-surface"
                      onClick={() => forkFeaturedPlan(featured)}
                      aria-label={`Use plan: ${featured.name}`}
                    >
                      {heroStop?.imageUrl ? (
                        <span
                          className="featured-card-thumb"
                          style={{ backgroundImage: `url(${heroStop.imageUrl})` }}
                          aria-hidden="true"
                        />
                      ) : (
                        <span
                          className="featured-card-thumb featured-card-thumb-empty"
                          aria-hidden="true"
                        />
                      )}
                      <span className={`featured-card-tag tag-${accent}`}>
                        {accent === "festival"
                          ? "Events"
                          : accent === "library"
                            ? "Library"
                            : accent === "park"
                              ? "Outdoors"
                              : "Editor's pick"}
                      </span>
                      <span className="featured-card-body">
                        {heroStop?.neighborhood && (
                          <span className="featured-card-eyebrow">
                            {heroStop.neighborhood}
                          </span>
                        )}
                        <strong>{featured.name}</strong>
                        <span className="featured-card-summary">
                          {featured.summary}
                        </span>
                        <span className="featured-card-meta">
                          <em>
                            {stopCount} place{stopCount === 1 ? "" : "s"}
                          </em>
                          {eventCount > 0 && (
                            <em className="featured-card-meta-event">
                              {eventCount} event{eventCount === 1 ? "" : "s"}
                            </em>
                          )}
                          <span className="featured-card-fork" aria-hidden="true">
                            <Plus />
                            Use plan
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

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
                        <button
                          className="sheet-action"
                          onClick={() =>
                            shareItem(spot.name, spotShareUrl(spot.id))
                          }
                        >
                          <Share2 aria-hidden="true" />
                          {shareCopiedUrl === spotShareUrl(spot.id)
                            ? "Copied!"
                            : "Share"}
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
                    {/* Quiet trust line, same framing as the plan stops. */}
                    {event.verified &&
                      event.url &&
                      (() => {
                        const host = sourceHostname(event.url);
                        if (!host) return null;
                        return (
                          <a
                            className="verified-source"
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Verified · {host}
                          </a>
                        );
                      })()}
                  </div>
                  <div className="sheet-actions">
                    <button
                      className={`sheet-action ${eventSaved ? "is-active" : ""}`}
                      onClick={() => toggleSavedEvent(event.id)}
                    >
                      <Bookmark aria-hidden="true" />
                      {eventSaved ? "Saved" : "Save event"}
                    </button>
                    {(() => {
                      const inPlan = activePlan
                        ? (activePlan.eventIds ?? []).includes(event.id)
                        : false;
                      return (
                        <button
                          className={`sheet-action ${inPlan ? "is-active" : ""}`}
                          onClick={() => {
                            if (inPlan && activePlan) {
                              removeEventFromPlan(activePlan.id, event.id);
                            } else {
                              addEventToPlanOrCreate(event.id);
                            }
                          }}
                          title={
                            inPlan && activePlan
                              ? `Remove from "${activePlan.name || "active plan"}"`
                              : activePlan
                                ? `Add to "${activePlan.name || "active plan"}"`
                                : "Start a plan with this event"
                          }
                        >
                          <List aria-hidden="true" />
                          {inPlan ? "In plan" : "Add to plan"}
                        </button>
                      );
                    })()}
                    {event.slug && (
                      <button
                        className="sheet-action"
                        onClick={() =>
                          shareItem(event.title, eventShareUrl(event.slug!))
                        }
                      >
                        <Share2 aria-hidden="true" />
                        {shareCopiedUrl === eventShareUrl(event.slug)
                          ? "Copied!"
                          : "Share"}
                      </button>
                    )}
                    {event.slug && (
                      <a
                        className="sheet-action"
                        href={buildAppHash("event", null, event.slug)}
                      >
                        <ChevronRight aria-hidden="true" />
                        View details
                      </a>
                    )}
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
        {/* ── Saved cart pill (floating, bottom-right) ────────────── */}
        {(() => {
          const totalSaved = savedSpots.length + savedEvents.length;
          if (totalSaved === 0) return null;
          if (!cartExpanded) {
            return (
              <button
                type="button"
                className="saved-cart-collapsed"
                onClick={() => setCartExpanded(true)}
              >
                <Bookmark aria-hidden="true" />
                <strong>{totalSaved} saved</strong>
                <span className="cart-divider" />
                <span className="cart-cta">Plan it &rarr;</span>
              </button>
            );
          }
          return (
            <>
            <div
              className="cart-backdrop"
              role="presentation"
              onClick={() => setCartExpanded(false)}
            />
            <aside className="saved-cart" aria-label="Saved spots and events">
              <div className="panel-heading">
                <Bookmark aria-hidden="true" />
                <span>Saved</span>
                <button
                  type="button"
                  className="icon-button"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setCartExpanded(false)}
                  aria-label="Collapse"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              {totalSaved > 0 && (
                <button
                  className="primary-button wide"
                  onClick={() => { createPlanFromSaved(); setCartExpanded(false); }}
                  title="Create a plan with all saved places and events in order"
                >
                  <Sparkles aria-hidden="true" />
                  Plan from saved ({totalSaved})
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
                  .filter((e) => isEventExpired(e, new Date(), metro.timezone))
                  .map((e) => e.id);
                return (
                  <>
                    <div className="saved-subhead-row">
                      <p className="saved-subhead">
                        Events ({savedEvents.length})
                      </p>
                      {expiredIds.length > 0 && (
                        <button
                          className="saved-clear-past"
                          type="button"
                          title={`Remove ${expiredIds.length} past event${expiredIds.length === 1 ? "" : "s"} from your saved list`}
                          onClick={() =>
                            setSavedEventIds((current) =>
                              current.filter((id) => !expiredIds.includes(id)),
                            )
                          }
                        >
                          <Trash2 aria-hidden="true" />
                          Clear {expiredIds.length} past
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
                              const expired = isEventExpired(event, new Date(), metro.timezone);
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
            </aside>
            </>
          );
        })()}
      </main>
      ) : view === "weekend" ? (
      <WeekendView
        events={events}
        eventsState={eventsState}
        onRetryEvents={retryEvents}
        metro={metro}
        ageBand={ageBand}
        onAgeBand={setAgeBand}
        savedEventIds={savedEventIds}
        onToggleSaved={toggleSavedEvent}
        planEventIds={activePlan?.eventIds ?? []}
        onAddToPlan={addEventToPlanOrCreate}
        onShare={(title, slug) => shareItem(title, eventShareUrl(slug))}
        featuredPlans={nearbyFeaturedPlans}
        onUsePlan={forkFeaturedPlan}
        onOpenMap={() => setView("browse")}
        guideHref={weekendGuideHref}
        profile={profile}
        homeLocation={userLocation}
        onEditProfile={() => setShowProfileWizard(true)}
        trust={eventTrust}
        venueImages={venueImages}
        popularPicks={popularPicks}
        lastVisit={lastVisit}
        weather={weather}
        onShareWeekend={(title, url) => shareItem(title, url)}
        shareUrl={weekendShareUrl}
        stopImages={stopImages}
        newsletterSlot={
          <NewsletterCard
            metroId={metro.id}
            metroLabel={metro.label}
            source="app-weekend"
            profile={profile}
            savedEventIds={savedEventIds}
          />
        }
      />
      ) : view === "event" ? (
      <EventDetailView
        events={events}
        slug={activeEventSlug}
        metro={metro}
        onBack={() => {
          setActiveEventSlug(null);
          setView("browse");
        }}
        activePlanName={activePlan?.name ?? null}
        planEventIds={activePlan?.eventIds ?? []}
        onAddToPlan={(eventId) => {
          addEventToPlanOrCreate(eventId);
          setView("plans");
        }}
        onShare={(title, slug) => shareItem(title, eventShareUrl(slug))}
        shareCopiedUrl={shareCopiedUrl}
        shareUrlFor={eventShareUrl}
        venueImages={venueImages}
      />
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
          <NewsletterCard
            metroId={metro.id}
            metroLabel={metro.label}
            profile={profile}
            savedEventIds={savedEventIds}
          />

          {plans.length === 0 ? (
            <p className="empty-state">
              Build a small itinerary from your saved spots.
            </p>
          ) : (
            <div className="plan-list">
              {plans.map((plan) => {
                const isActive = plan.id === activePlanId;
                const isConfirming = plan.id === confirmDeletePlanId;
                return (
                  <div
                    key={plan.id}
                    className={`plan-list-item ${isActive ? "active" : ""} ${
                      isConfirming ? "confirming" : ""
                    }`}
                  >
                    {isConfirming ? (
                      <div className="plan-list-item-confirm" role="alertdialog" aria-label="Confirm delete plan">
                        <p className="plan-list-item-confirm-text">
                          Delete <strong>{plan.name || "Untitled plan"}</strong>?
                          This can't be undone.
                        </p>
                        <div className="plan-list-item-confirm-actions">
                          <button
                            className="secondary-button"
                            onClick={() => setConfirmDeletePlanId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="danger-button"
                            onClick={() => {
                              deletePlan(plan.id);
                              setConfirmDeletePlanId(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
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
                            setConfirmDeletePlanId(plan.id);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <section className="plan-detail-area" id="plan-detail-area" aria-label="Plan detail">
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
              {activePlan.rationale && activePlan.rationale.length > 0 && (
                <ul className="plan-rationale">
                  {activePlan.rationale.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}

              {activePlanMapItems.length > 0 && (
                <PlanMap
                  stops={activePlanStops}
                  events={activePlanEvents}
                  defaultCenter={defaultMapCenter}
                  items={activePlanMapItems}
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
                    // Saved plans keep their history, but an event that has
                    // ended is marked instead of silently staying actionable.
                    const ended = !isUpcomingEvent(event, new Date(), { timeZone: metro.timezone });
                    return (
                      <li
                        className={`plan-stop plan-stop-event${ended ? " is-ended" : ""}`}
                        key={`event:${event.id}`}
                      >
                        <span className="plan-stop-index plan-stop-index-event">
                          {index + 1}
                        </span>
                        <div className="plan-stop-info">
                          <strong>
                            <span className="plan-event-tag">EVENT</span>{" "}
                            {ended && <span className="past-pill">Ended</span>}
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
                          {/* Quiet trust line: the event's official page.
                              Only for verified events with a parseable URL. */}
                          {event.verified &&
                            event.url &&
                            (() => {
                              const host = sourceHostname(event.url);
                              if (!host) return null;
                              return (
                                <a
                                  className="verified-source"
                                  href={event.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Verified · {host}
                                  {date
                                    ? ` · ${date.toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                      })}`
                                    : ""}
                                </a>
                              );
                            })()}
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

              {/* Optional vote-updates email, sent with the poll at share
                  time. The worker emails the plan owner when friends vote. */}
              {API_CONFIGURED && (
                <div className="share-notify">
                  <label htmlFor="plan-notify-email">
                    Email me when friends vote <em>(optional)</em>
                  </label>
                  <input
                    id="plan-notify-email"
                    type="email"
                    value={notifyEmail}
                    onChange={(event) => setNotifyEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                  <p className="share-notify-note">
                    Only used for vote updates — nothing else.
                  </p>
                </div>
              )}

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
                  type="button"
                  className="secondary-button"
                  disabled={
                    !API_CONFIGURED ||
                    (activePlanStops.length === 0 &&
                      activePlanEvents.length === 0) ||
                    planCardBusy
                  }
                  title="Share this plan as a photo card"
                  onClick={sharePlanAsCard}
                >
                  <Image aria-hidden="true" />
                  {planCardBusy && !planCard ? "Making card…" : "Share as card"}
                </button>
                <button
                  className="danger-button"
                  onClick={() => deletePlan(activePlan.id)}
                >
                  <Trash2 aria-hidden="true" />
                  Delete plan
                </button>
              </div>

              {/* Quick share targets ride directly with the primary share
                  action so Messages/WhatsApp/native are one tap away, not
                  buried below the banner panels. */}
              {(() => {
                const sharedUrl =
                  shareState.status === "shared" && shareState.url
                    ? shareState.url
                    : activePlan.pollId && shareState.status === "idle"
                      ? pollShareUrl(activePlan.pollId)
                      : null;
                if (!sharedUrl) return null;
                return (
                  <ShareQuickLinks
                    url={sharedUrl}
                    title={activePlan.name || "Untitled plan"}
                  />
                );
              })()}

              {/* Vote payoff: live tally for the shared plan. Loaded once
                  when the plan opens; Refresh re-pulls on demand. */}
              {activePlan.pollId && API_CONFIGURED && (
                <div className="poll-tally" aria-label="Votes on this plan">
                  <div className="poll-tally-head">
                    <strong>
                      {pollTallyStatus === "loading"
                        ? "Checking votes…"
                        : pollTallyStatus === "error"
                          ? "Couldn't load votes."
                          : activePollSummary
                            ? activePollSummary.voterCount === 0
                              ? "No votes yet — send the link to get the first one."
                              : `${activePollSummary.voterCount} friend${
                                  activePollSummary.voterCount === 1 ? "" : "s"
                                } voted · ${activePollSummary.totalYes} yes vote${
                                  activePollSummary.totalYes === 1 ? "" : "s"
                                }`
                            : "Votes show up here."}
                    </strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setTallyRefreshNonce((n) => n + 1)}
                      disabled={pollTallyStatus === "loading"}
                    >
                      <RotateCcw aria-hidden="true" />
                      Refresh
                    </button>
                  </div>
                  {activePollSummary && activePollSummary.voterCount > 0 && (
                    <ul className="poll-tally-items">
                      {activePollSummary.perItem.map((item) => (
                        <li key={item.id}>
                          <span>{item.label}</span>
                          <em>{item.yes} yes</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {shareState.status === "shared" && shareState.url && (
                <div className="share-banner">
                  <strong>
                    {shareState.copied
                      ? "Share message copied."
                      : "Share link ready — copy or send it with a button above."}
                  </strong>
                  <a href={shareState.url}>{shareState.url}</a>
                  <ShareEmbedPanel
                    url={shareState.url}
                    title={activePlan.name || "Untitled plan"}
                  />
                  <ShareCardPanel
                    title={activePlan.name || "Untitled plan"}
                    items={activePlanItems}
                    metroLabel={metro.label}
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
                  <a href={pollShareUrl(activePlan.pollId)}>
                    {pollShareUrl(activePlan.pollId)}
                  </a>
                  <ShareEmbedPanel
                    url={pollShareUrl(activePlan.pollId)}
                    title={activePlan.name || "Untitled plan"}
                  />
                  <ShareCardPanel
                    title={activePlan.name || "Untitled plan"}
                    items={activePlanItems}
                    metroLabel={metro.label}
                  />
                </div>
              )}

              {planNearbyEvents.length > 0 && (
                <section className="plan-nearby" aria-label="Events near this plan">
                  <h3>While you're nearby this weekend</h3>
                  <p className="plan-events-sub">
                    {planNearbyEvents.length}{" "}
                    {APP_AUDIENCE === "adults" ? "event" : "family program"}
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
                          {event.slug && (
                            <a
                              className="plan-nearby-details"
                              href={buildAppHash("event", null, event.slug)}
                              title="View event details"
                            >
                              Details
                            </a>
                          )}
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

      <InstallBanner />

      {showProfileWizard && (
        <OnboardingWizard
          onComplete={completeProfile}
          onDismiss={() => setShowProfileWizard(false)}
        />
      )}

      {currentCheckin && !showProfileWizard && (
        <CheckinPrompt
          event={currentCheckin}
          queueLength={checkinCandidates.length}
          answered={checkinPromptIndex}
          onAnswer={(went) => answerCheckin(currentCheckin, went)}
        />
      )}

      {planCard && (
        <div
          className="modal-backdrop plan-card-backdrop"
          role="presentation"
          onClick={() => setPlanCard(null)}
        >
          <div
            className="plan-card-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Plan card preview"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="plan-card-modal-head">
              <strong>Your plan, as a card</strong>
              <button
                type="button"
                className="icon-button"
                title="Close"
                aria-label="Close"
                onClick={() => setPlanCard(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="plan-card-preview" ref={planCardRef}>
              <PlanCardArt card={planCard} />
            </div>
            <div className="plan-card-modal-actions">
              {planCardCopied && (
                <span className="plan-card-copied">Link copied</span>
              )}
              {planCardError && <span className="plan-card-error">{planCardError}</span>}
              <button
                type="button"
                className="primary-button"
                disabled={planCardBusy}
                onClick={sharePlanCardImage}
              >
                {planCardBusy ? "Sharing…" : "Share image + link"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={planCardBusy}
                onClick={async () => {
                  const copied = await copyTextToClipboard(
                    `${shareBaseUrl}#/card/${planCard.cardId}`,
                  );
                  setPlanCardCopied(copied);
                }}
              >
                Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {showInterestsPicker && (
        <div
          className="modal-backdrop interests-backdrop"
          role="presentation"
          onClick={() => setShowInterestsPicker(false)}
        >
          <div
            className="interests-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="interests-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-button interests-close"
              title="Close"
              aria-label="Close"
              onClick={() => setShowInterestsPicker(false)}
            >
              <X aria-hidden="true" />
            </button>
            <p className="eyebrow">Personalize</p>
            <h2 id="interests-title">Pick your interests</h2>
            <p className="interests-sub">
              Choose what {APP_AUDIENCE === "adults" ? "you love" : "your family loves"}.
              "✨ For you" shows weekend events that match — saved on this
              device.
            </p>
            <div className="interests-options">
              {EVENT_THEMES.map((theme) => {
                const checked = preferredThemes.has(theme.id);
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className={`interests-option${checked ? " checked" : ""}`}
                    aria-pressed={checked}
                    onClick={() => toggleInterest(theme.id)}
                  >
                    <span className="interests-option-check" aria-hidden="true">
                      {checked ? <Check /> : null}
                    </span>
                    <span className="interests-option-text">
                      <strong>{theme.label}</strong>
                      <small>{theme.blurb}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="interests-actions">
              <button
                type="button"
                className="interests-done"
                onClick={() => {
                  setShowInterestsPicker(false);
                  setForYou(preferredThemes.size > 0);
                  if (preferredThemes.size > 0) setActiveTheme(null);
                }}
              >
                {preferredThemes.size > 0
                  ? `Show my ${preferredThemes.size} ${preferredThemes.size === 1 ? "interest" : "interests"}`
                  : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        className={`hop-now-fab${hopNowSeen ? " is-seen" : ""}`}
        type="button"
        onClick={openHopNow}
        aria-label="Hop me now — things to do right now"
        title="Hop me now"
      >
        <Zap aria-hidden="true" />
        <span>Hop me now</span>
        {!hopNowSeen && <span className="hop-now-fab-badge">NEW</span>}
      </button>
      {!hopNowSeen && (
        <div className="hop-now-coachmark" role="status" aria-live="polite">
          <div className="hop-now-coachmark-body">
            <span>Stuck on what to do? Tap for instant ideas near you.</span>
            <button
              className="hop-now-coachmark-dismiss"
              type="button"
              onClick={markHopNowSeen}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Visit-3 engaged-visitor ask: the Friday digest. Replaces the old
          Google sign-in modal (same trigger cadence; sign-in stays in the
          topbar). Reuses the prompt-card styles. Suppressed on the Weekend
          view, which carries the same signup inline. */}
      {showDigestPrompt && view !== "weekend" && (
        <div className="modal-backdrop signin-prompt-backdrop" role="presentation">
          <div
            className="signin-prompt-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="digest-prompt-title"
          >
            <button
              type="button"
              className="icon-button signin-prompt-close"
              title="Not now"
              onClick={dismissDigestPrompt}
            >
              <X aria-hidden="true" />
            </button>
            <p className="eyebrow">Free Friday digest</p>
            <h2 id="digest-prompt-title">{APP_DIGEST_CTA}</h2>
            <p className="signin-prompt-sub">
              {APP_AUDIENCE === "adults"
                ? `One short email each Friday with the best ${metro.label} hangs for the weekend. No spam, unsubscribe anytime.`
                : `One short email each Friday with the best ${metro.label} family outings for the weekend. No spam, unsubscribe anytime.`}
            </p>
            <NewsletterCard
              metroId={metro.id}
              metroLabel={metro.label}
              source="visit-prompt"
              bare
            />
            <button
              type="button"
              className="text-button signin-prompt-skip"
              onClick={dismissDigestPrompt}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {isHopNowOpen && (
        <HopNowPanel
          spots={allSpots}
          events={events}
          userLocation={resolveHopNowLocation(userLocation, inferredGeo, metro)}
          audience={APP_AUDIENCE === "adults" ? "adults" : "kids"}
          activePlanName={activePlan?.name ?? null}
          onAddToPlan={addHopNowItemToPlan}
          onClose={() => setIsHopNowOpen(false)}
          metroTimeZone={metro.timezone}
        />
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
            {APP_AUDIENCE === "kids" && (
              <>
                <a href="/intro.html">Watch the intro</a>
                <span aria-hidden="true">·</span>
              </>
            )}
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
            <span aria-hidden="true">·</span>
            <a href="/about/">About {APP_BRAND}</a>
            <span aria-hidden="true">·</span>
            <a href="/how-we-verify/">How we verify listings</a>
            <span aria-hidden="true">·</span>
            <a href="/privacy/">Privacy</a>
            {APP_AUDIENCE === "kids" && (
              <>
                <span aria-hidden="true">·</span>
                <a href="https://trymosey.com/bay-area/">
                  Planning an adults night out? Try Mosey
                </a>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

// NewsletterCard moved to src/NewsletterCard.tsx (2026-08); re-exported for
// PollView + App-internal use.
import { NewsletterCard } from "./NewsletterCard";
export { NewsletterCard } from "./NewsletterCard";

// HopNowPanel (modal + right-now helpers) moved to src/HopNowPanel.tsx
// (2026-08); re-exported for compatibility.
import { HopNowPanel, resolveHopNowLocation } from "./HopNowPanel";
export { HopNowPanel } from "./HopNowPanel";

const CATEGORY_COLORS: Record<Category, string> = {
  Outdoors: "var(--forest)",
  Culture: "var(--blue)",
  Food: "var(--sun)",
  Wellness: "var(--berry)",
  Shopping: "var(--accent)",
  Nightlife: "var(--accent)",
};

function CategoryLegend({
  categories,
  allSpots,
  selected,
  expanded,
  onToggleExpand,
  onToggleAll,
  onToggleCategory,
}: {
  categories: Category[];
  allSpots: Spot[];
  selected: ReadonlySet<Category>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAll: () => void;
  onToggleCategory: (cat: Category) => void;
}) {
  const allState: "all" | "none" | "partial" =
    selected.size === 0
      ? "none"
      : selected.size === categories.length
        ? "all"
        : "partial";
  return (
    <>
      <div className="cat-row-all-wrap">
        <button
          type="button"
          className={`cat-row cat-row-all is-${allState}`}
          onClick={onToggleAll}
        >
          <span className="cat-state-box" aria-hidden="true">
            {allState === "all" && <span className="cat-state-dot" />}
            {allState === "partial" && <span className="cat-state-dash" />}
          </span>
          <span className="cat-row-label">All categories</span>
          <span className="cat-row-count">{allSpots.length}</span>
        </button>
        <button
          type="button"
          className={`cat-expand${expanded ? " is-open" : ""}`}
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide category list" : "Show category list"}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="cat-children">
          {categories.map((cat) => {
            const count = allSpots.filter((s) => s.category === cat).length;
            const isSelected = selected.has(cat);
            const color = CATEGORY_COLORS[cat] ?? "var(--ink-mute)";
            return (
              <button
                key={cat}
                type="button"
                className={`cat-row cat-row-child${isSelected ? " is-selected" : ""}`}
                onClick={() => onToggleCategory(cat)}
              >
                <span
                  className="cat-swatch"
                  style={{
                    background: isSelected ? color : "transparent",
                    borderColor: color,
                  }}
                >
                  {isSelected && <span className="cat-swatch-dot" />}
                </span>
                <span className="cat-row-label">{cat}</span>
                <span className="cat-row-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
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
                    Reload {APP_DOMAIN} — Safari will prompt again on the next tap.
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
                    <code>{APP_DOMAIN}</code>.
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
  const text = buildPlanShareMessage(title, url);
  const nativeText = buildPlanShareMessage(title);
  const enc = encodeURIComponent(text);
  const urlEnc = encodeURIComponent(url);
  const subject = encodeURIComponent(buildPlanShareSubject(title));
  const body = encodeURIComponent(text);
  const isApple =
    typeof navigator !== "undefined" &&
    /(iPhone|iPad|iPod|Macintosh)/i.test(navigator.userAgent);
  const smsHref = isApple ? `sms:&body=${enc}` : `sms:?body=${enc}`;

  async function nativeShare() {
    if (typeof navigator !== "undefined" && (navigator as Navigator).share) {
      try {
        await (navigator as Navigator).share({
          title: buildPlanShareSubject(title),
          text: nativeText,
          url,
        });
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
        className="share-quick-link facebook"
        href={`https://www.facebook.com/sharer/sharer.php?u=${urlEnc}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Share via Facebook"
      >
        <Share2 aria-hidden="true" /> Facebook
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

function ShareEmbedPanel({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const embedUrl = buildPollEmbedUrl(url);
  const embedCode = buildPlanEmbedCode(embedUrl, title);

  async function copyEmbedCode() {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  return (
    <details className="share-embed">
      <summary>Embed this voting card</summary>
      <div className="share-embed-body">
        <label>
          <span>Iframe code</span>
          <textarea readOnly value={embedCode} rows={5} />
        </label>
        <div className="share-embed-actions">
          <button
            type="button"
            className="share-quick-link copy"
            onClick={copyEmbedCode}
          >
            <Copy aria-hidden="true" />
            {copied ? "Copied" : "Copy embed"}
          </button>
          <a
            className="share-quick-link"
            href={embedUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            Preview tab
          </a>
        </div>
        <div className="share-embed-preview" aria-label="Embed preview">
          <iframe title={`${APP_BRAND} embed preview: ${cleanShareTitle(title)}`} src={embedUrl} />
        </div>
      </div>
    </details>
  );
}

function ShareCardPanel({
  title,
  items,
  metroLabel,
}: {
  title: string;
  items: PlanItem[];
  metroLabel: string;
}) {
  const [status, setStatus] = useState<"idle" | "ready" | "shared" | "error">(
    "idle",
  );
  const hasItems = items.length > 0;
  const cardFileName = `${slugifyDownloadName(title || `${APP_BRAND.toLowerCase()}-plan`)}-story.png`;
  // Mobile share sheets accept image files (→ group chats, Stories directly);
  // desktop browsers generally don't, so the button only shows where it works.
  const canShareCardFile =
    typeof navigator !== "undefined" &&
    !!navigator.canShare?.({
      files: [new File([], cardFileName, { type: "image/png" })],
    });

  async function renderStoryCardBlob(): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");

    drawPlanShareCard(ctx, {
      title: cleanShareTitle(title),
      metroLabel,
      items,
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Export failed");
    return blob;
  }

  async function downloadStoryCard() {
    if (!hasItems) return;
    try {
      const blob = await renderStoryCardBlob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = cardFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      setStatus("ready");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
    }
  }

  async function shareStoryCard() {
    if (!hasItems) return;
    try {
      const blob = await renderStoryCardBlob();
      const file = new File([blob], cardFileName, { type: "image/png" });
      await navigator.share({
        files: [file],
        title: cleanShareTitle(title),
      });
      setStatus("shared");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch (e) {
      // Closing the share sheet rejects with AbortError — not an error state.
      if ((e as DOMException)?.name === "AbortError") return;
      setStatus("error");
    }
  }

  return (
    <details className="share-card-panel">
      <summary>Instagram or story card</summary>
      <div className="share-card-body">
        <p>
          Download a vertical PNG for Instagram Stories, group chats, or a
          quick marketing post. Instagram does not provide a reliable web share
          URL, so use this card with the native share sheet or upload it there.
        </p>
        {canShareCardFile && (
          <button
            type="button"
            className="share-quick-link copy"
            disabled={!hasItems}
            onClick={shareStoryCard}
          >
            <Share2 aria-hidden="true" />
            {status === "shared" ? "Shared" : "Share card"}
          </button>
        )}
        <button
          type="button"
          className="share-quick-link copy"
          disabled={!hasItems}
          onClick={downloadStoryCard}
        >
          <Download aria-hidden="true" />
          {status === "ready" ? "Downloaded" : "Download story card"}
        </button>
        {status === "error" && (
          <span className="share-card-error">Could not create the image.</span>
        )}
      </div>
    </details>
  );
}

// Clipboard write that reports whether it actually landed, so callers can
// show honest "copied" feedback instead of assuming success.
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// External share links use the /p/{id} path form (a Pages Function serves rich
// Open Graph previews there). In-app, the canonical poll URL is metro-agnostic.
function pollShareUrl(pollId: string) {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/p/${pollId}`;
}

function buildPollEmbedUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    // Path form (/p/{id}) from a share link → convert to the hash embed route.
    const pathMatch = parsed.pathname.match(/^\/p\/([\w-]+)$/);
    if (pathMatch) {
      return `${parsed.origin}/#/p/${pathMatch[1]}?embed=1`;
    }
    const hash = parsed.hash.replace(/^#/, "");
    if (hash.startsWith("/p/")) {
      parsed.hash = `${hash.split("?")[0]}?embed=1`;
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return `${url}${url.includes("?") ? "&" : "?"}embed=1`;
}

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPlanEmbedCode(url: string, title: string) {
  const escapedUrl = escapeHtmlAttr(url);
  const escapedTitle = escapeHtmlAttr(`${APP_BRAND} plan: ${cleanShareTitle(title)}`);
  return `<iframe title="${escapedTitle}" src="${escapedUrl}" width="420" height="640" style="border:0;border-radius:12px;width:100%;max-width:420px;min-height:640px;" loading="lazy"></iframe>`;
}

function cleanShareTitle(title: string) {
  return title.trim() || `this ${APP_BRAND} plan`;
}

function buildPlanShareSubject(title: string) {
  return `Vote on ${cleanShareTitle(title)}`;
}

function buildPlanShareMessage(title: string, url?: string) {
  const lines = [
    `I put together a ${APP_BRAND} plan: ${cleanShareTitle(title)}.`,
    "Can you take a quick look and vote on the stops that work for you?",
  ];
  if (url) lines.push(url);
  return lines.join("\n");
}

function drawPlanShareCard(
  ctx: CanvasRenderingContext2D,
  {
    title,
    metroLabel,
    items,
  }: {
    title: string;
    metroLabel: string;
    items: PlanItem[];
  },
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.fillStyle = "#faf5eb";
  ctx.fillRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#fff7e8");
  gradient.addColorStop(0.52, "#f7fbff");
  gradient.addColorStop(1, "#fff1ec");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#ffffff";
  drawRoundedRect(ctx, 72, 78, 936, 1194, 36);
  ctx.fill();
  ctx.strokeStyle = "#eadfc9";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#dd6a1a";
  drawRoundedRect(ctx, 112, 118, 88, 88, 24);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 44px Arial, sans-serif";
  ctx.fillText(APP_BRAND.charAt(0) || "F", 141, 177);

  ctx.fillStyle = "#1b1916";
  ctx.font = "800 42px Arial, sans-serif";
  ctx.fillText(APP_BRAND, 224, 153);
  ctx.fillStyle = "#6b7280";
  ctx.font = "700 25px Arial, sans-serif";
  ctx.fillText(
    APP_AUDIENCE === "adults"
      ? `${metroLabel} hangout plan`
      : `${metroLabel} weekend plan`,
    224,
    190,
  );

  let y = 298;
  ctx.fillStyle = "#1b1916";
  ctx.font = "800 64px Arial, sans-serif";
  y = drawWrappedText(ctx, title, 112, y, 856, 72, 3);

  y += 36;
  const visibleItems = items.slice(0, 5);
  visibleItems.forEach((item, index) => {
    ctx.fillStyle = "#fff8ec";
    drawRoundedRect(ctx, 112, y, 856, 132, 24);
    ctx.fill();
    ctx.strokeStyle = "#f1dfbe";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#dd6a1a";
    ctx.font = "800 42px Arial, sans-serif";
    ctx.fillText(String(index + 1), 148, y + 76);

    ctx.fillStyle = "#1b1916";
    ctx.font = "800 31px Arial, sans-serif";
    drawWrappedText(ctx, shareCardItemTitle(item), 214, y + 48, 700, 38, 1);
    ctx.fillStyle = "#5a7896";
    ctx.font = "700 24px Arial, sans-serif";
    drawWrappedText(ctx, shareCardItemMeta(item), 214, y + 88, 700, 30, 1);

    y += 154;
  });

  if (items.length > visibleItems.length) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "700 26px Arial, sans-serif";
    ctx.fillText(`+ ${items.length - visibleItems.length} more stop`, 112, y + 28);
  }

  ctx.fillStyle = "#1b1916";
  ctx.font = "800 30px Arial, sans-serif";
  ctx.fillText(`Vote on the plan at ${APP_DOMAIN}`, 112, 1210);
  ctx.fillStyle = "#6b7280";
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillText(
    APP_AUDIENCE === "adults"
      ? "Good spots and plans, ordered by real timing."
      : "Family-friendly events and plans, ordered by real timing.",
    112,
    1248,
  );
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 3))}...`;
  }
  lines.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function shareCardItemTitle(item: PlanItem) {
  return item.kind === "spot" ? item.spot.name : item.event.title;
}

function shareCardItemMeta(item: PlanItem) {
  if (item.kind === "spot") {
    return [item.spot.neighborhood, item.spot.category, item.spot.cost]
      .filter(Boolean)
      .join(" - ");
  }
  return [eventWhenLabel(item.event), item.event.venue, item.event.city]
    .filter(Boolean)
    .join(" - ");
}

function slugifyDownloadName(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || `${APP_BRAND.toLowerCase()}-plan`;
}

export default App;
