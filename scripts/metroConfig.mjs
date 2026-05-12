import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const METROS_PATH = path.join(ROOT, "data", "metros.json");

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadMetroConfig() {
  const doc = readJson(METROS_PATH);
  const metros = Array.isArray(doc.metros) ? doc.metros : [];
  const byId = new Map(metros.map((metro) => [metro.id, metro]));
  const bySlug = new Map();
  for (const metro of metros) {
    bySlug.set(metro.id, metro);
    for (const alias of metro.aliases || []) {
      bySlug.set(alias, metro);
    }
    const pathSlug = String(metro.canonicalPath || "")
      .replace(/^\/+|\/+$/g, "");
    if (pathSlug) bySlug.set(pathSlug, metro);
  }
  const defaultMetro = byId.get(doc.defaultMetro) || metros[0];
  if (!defaultMetro) {
    throw new Error("data/metros.json must define at least one metro.");
  }
  return { ...doc, metros, byId, bySlug, defaultMetro };
}

export function metroFromSlug(slug, config = loadMetroConfig()) {
  if (!slug) return config.defaultMetro;
  const key = String(slug).replace(/^\/+|\/+$/g, "").toLowerCase();
  return config.bySlug.get(key) || config.byId.get(key) || config.defaultMetro;
}

export function selectedMetroFromArgs(args = process.argv.slice(2), config = loadMetroConfig()) {
  const metroFlag = args.find((arg) => arg === "--all" || arg.startsWith("--metro="));
  if (metroFlag === "--all") return { all: true, metro: null };
  const explicit = metroFlag?.startsWith("--metro=")
    ? metroFlag.slice("--metro=".length)
    : process.env.METRO_SLUG;
  return { all: false, metro: metroFromSlug(explicit, config) };
}

export function metroDataFile(metro, key) {
  const filenames = {
    spots: "spots.json",
    enrichment: "enrichment.json",
    events: "events.json",
    eventReport: "event-build-report.json",
    featuredPlans: "featured-plans.json",
    curatedSpots: "curated-spots.json",
  };
  const filename = filenames[key];
  if (!filename) throw new Error(`Unknown metro data key: ${key}`);
  return path.join("public", "data", metro.dataDir || metro.id, filename);
}

export function legacyMetroDataFile(metro, key) {
  const filename = metro.legacyData?.[key];
  return filename ? path.join("public", "data", filename) : null;
}

export function sourceRegistryPath(metro) {
  return metro.eventSources || path.join("data", `event-sources-${metro.id}.json`);
}

export function adultSourceRegistryPath(metro) {
  return metro.adultEventSources || null;
}
