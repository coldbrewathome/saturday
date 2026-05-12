export type MetroId = "bay-area" | "los-angeles" | "new-york-city" | "seattle";

export type MetroConfig = {
  id: MetroId;
  label: string;
  seoName: string;
  canonicalPath: string;
  aliases: string[];
  dataDir: string;
  center: { lat: number; lon: number };
  legacyData?: Partial<Record<DataKey, string>>;
};

export type DataKey =
  | "spots"
  | "enrichment"
  | "events"
  | "eventReport"
  | "featuredPlans"
  | "curatedSpots";

export const METROS: MetroConfig[] = [
  {
    id: "bay-area",
    label: "Bay Area",
    seoName: "San Francisco Bay Area",
    canonicalPath: "/bay-area",
    aliases: ["bayarea"],
    dataDir: "bay-area",
    center: { lat: 37.7749, lon: -122.4194 },
    legacyData: {
      spots: "bay-area-spots.json",
      enrichment: "bay-area-enrichment.json",
      events: "events.json",
      eventReport: "event-build-report.json",
      featuredPlans: "featured-plans.json",
      curatedSpots: "curated-spots.json",
    },
  },
  {
    id: "los-angeles",
    label: "Los Angeles",
    seoName: "Los Angeles",
    canonicalPath: "/los-angeles",
    aliases: ["losangeles", "la"],
    dataDir: "los-angeles",
    center: { lat: 34.0522, lon: -118.2437 },
  },
  {
    id: "new-york-city",
    label: "New York City",
    seoName: "New York City",
    canonicalPath: "/new-york-city",
    aliases: ["newyorkcity", "new-york", "newyork", "nyc"],
    dataDir: "new-york-city",
    center: { lat: 40.7128, lon: -74.006 },
  },
  {
    id: "seattle",
    label: "Seattle",
    seoName: "Seattle",
    canonicalPath: "/seattle",
    aliases: [],
    dataDir: "seattle",
    center: { lat: 47.6062, lon: -122.3321 },
  },
];

export const DEFAULT_METRO = METROS[0];

const DATA_FILES: Record<DataKey, string> = {
  spots: "spots.json",
  enrichment: "enrichment.json",
  events: "events.json",
  eventReport: "event-build-report.json",
  featuredPlans: "featured-plans.json",
  curatedSpots: "curated-spots.json",
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
  return `${metro.dataDir}/${DATA_FILES[key]}`;
}

export function legacyMetroDataPath(metro: MetroConfig, key: DataKey): string | null {
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
