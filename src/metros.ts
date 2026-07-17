import metrosDoc from "../data/metros.json";
import { APP_AUDIENCE } from "./appConfig";

export type MetroId = string;

export type MetroConfig = {
  id: MetroId;
  label: string;
  seoName: string;
  canonicalPath: string;
  aliases: string[];
  dataDir: string;
  center: { lat: number; lon: number };
  timezone: string;
  spotCoverage?: {
    bbox?: { south: number; west: number; north: number; east: number };
  };
  legacyData?: Partial<Record<DataKey, string>>;
};

export type DataKey =
  | "spots"
  | "enrichment"
  | "events"
  | "eventReport"
  | "featuredPlans"
  | "curatedSpots";

const ALL_METROS: MetroConfig[] = metrosDoc.metros as MetroConfig[];

// Mosey is a Bay Area-only beta: the adults build exposes just bay-area while
// FamHop keeps the full list. metroBySlug's DEFAULT_METRO fallback plus the
// alias redirect in main.tsx make direct loads of other metro paths
// (e.g. /seattle/) land gracefully on /bay-area/. Exported for tests — the
// build-time audience constant can't be stubbed per test file.
export function metrosForAudience(
  audience: "kids" | "adults" | "all",
): MetroConfig[] {
  return audience === "adults"
    ? ALL_METROS.filter((metro) => metro.id === "bay-area")
    : ALL_METROS;
}

export const METROS: MetroConfig[] = metrosForAudience(APP_AUDIENCE);

export const DEFAULT_METRO = METROS[0];

const DATA_FILES: Record<DataKey, string> = {
  spots: "spots.json",
  enrichment: "enrichment.json",
  events: "events.json",
  eventReport: "event-build-report.json",
  featuredPlans: "featured-plans.json",
  curatedSpots: "curated-spots.json",
};

const ADULTS_DATA_FILES: Partial<Record<DataKey, string>> = {
  spots: "spots-adults.json",
  events: "events-adults.json",
  featuredPlans: "featured-plans-adults.json",
  // D2: without this, the adults build fell through to the kids curated
  // file below (curatedSpots has no audience split otherwise) — Mosey was
  // serving Koret Children's Quarter Playground, Yerba Buena Children's
  // Garden, etc. straight from curated-spots.json.
  curatedSpots: "curated-spots-adults.json",
};

export function metroBySlug(slug: string | null | undefined): MetroConfig {
  const key = String(slug || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  return (
    METROS.find(
      (metro) =>
        metro.id === key ||
        metro.canonicalPath.replace(/^\//, "") === key ||
        metro.aliases.includes(key),
    ) || DEFAULT_METRO
  );
}

export function metroFromPath(pathname: string): {
  metro: MetroConfig;
  isAlias: boolean;
  canonicalPath: string;
} {
  const first = pathname.split("/").filter(Boolean)[0] || "";
  const metro = metroBySlug(first);
  const normalized = first.toLowerCase();
  const canonicalSlug = metro.canonicalPath.replace(/^\//, "");
  return {
    metro,
    isAlias: Boolean(first) && normalized !== canonicalSlug,
    canonicalPath: metro.canonicalPath,
  };
}

export function metroDataPath(metro: MetroConfig, key: DataKey): string {
  const audienceFile = APP_AUDIENCE === "adults" ? ADULTS_DATA_FILES[key] : undefined;
  return `${metro.dataDir}/${audienceFile || DATA_FILES[key]}`;
}

export function legacyMetroDataPath(metro: MetroConfig, key: DataKey): string | null {
  // A legacy mirror is a kids/FamHop-era artifact (bay-area's single-metro
  // history) — it must never win over an explicit audience-specific file
  // (ADULTS_DATA_FILES), or the adults build silently falls back to the
  // kids file for that key regardless of what metroDataPath resolves to.
  if (APP_AUDIENCE === "adults" && ADULTS_DATA_FILES[key]) return null;
  return metro.legacyData?.[key] || null;
}

export function metroStorageKey(metro: MetroConfig, suffix: string): string {
  return metro.id === "bay-area"
    ? `saturday.${suffix}`
    : `saturday.${metro.id}.${suffix}`;
}

export function metroShareBase(metro: MetroConfig): string {
  return `${window.location.origin}${metro.canonicalPath}`;
}
