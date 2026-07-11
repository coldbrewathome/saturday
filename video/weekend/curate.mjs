#!/usr/bin/env node
// Curate the "this weekend" event lineup for a metro from the live feed.
// Exports curate() for the multi-metro builder; also runs as a CLI.
//
//   node video/weekend/curate.mjs                       # this weekend, bay-area
//   node video/weekend/curate.mjs --weekend next        # the coming weekend
//   node video/weekend/curate.mjs --count 6 --metro miami
//   node video/weekend/curate.mjs --ref 2026-06-26      # pretend "today" (testing)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { METROS, DEFAULT_THEME } from "./metros.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// Category → emoji + appeal weight + display bucket.
const CATS = {
  Festival:        { emoji: "🎉", weight: 10, bucket: "festival" },
  "Amusement Park":{ emoji: "🎢", weight: 9,  bucket: "shows" },
  Zoo:             { emoji: "🦁", weight: 9,  bucket: "outdoors" },
  Farm:            { emoji: "🚜", weight: 8,  bucket: "outdoors" },
  Music:           { emoji: "🎵", weight: 7,  bucket: "shows" },
  Park:            { emoji: "🌳", weight: 7,  bucket: "outdoors" },
  Museum:          { emoji: "🏛️", weight: 7,  bucket: "museum" },
  Theater:         { emoji: "🎭", weight: 6,  bucket: "shows" },
  Sports:          { emoji: "⚽", weight: 6,  bucket: "shows" },
  Culture:         { emoji: "🎨", weight: 6,  bucket: "museum" },
  Community:       { emoji: "🎪", weight: 6,  bucket: "community" },
  Ticketed:        { emoji: "🎟️", weight: 5,  bucket: "community" },
  Library:         { emoji: "📚", weight: 4,  bucket: "library" },
};
const BUCKET_ORDER = ["festival", "outdoors", "museum", "shows", "community", "library"];
const CITY_CAP = 2;

function catMeta(e) {
  const base = CATS[e.category] || { emoji: "📍", weight: 5, bucket: "community" };
  if (/sand ?castle|beach/i.test(e.title)) return { ...base, emoji: "🏖️" };
  return base;
}
const isFree = (cost) => !!cost && /free/i.test(cost) && !/paid|\$|otherwise/i.test(cost);
function costLabel(cost) {
  if (isFree(cost)) return "FREE";
  if (!cost || /^(unknown|see event website|admission ticket required|ticketed)$/i.test(cost.trim())) return "";
  return cost.length > 22 ? cost.slice(0, 21) + "…" : cost;
}

function weekendWindow(ref, which) {
  const day = ref.getDay();
  const offsetToSat = day === 0 ? -1 : 6 - day;
  const sat = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + offsetToSat + (which === "next" ? 7 : 0));
  const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1);
  const mon = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 2);
  return { sat, sun, mon };
}
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const weekendLabel = (sat, sun) => sat.getMonth() === sun.getMonth()
  ? `${MONTHS[sat.getMonth()]} ${sat.getDate()}–${sun.getDate()}`
  : `${MONTHS[sat.getMonth()]} ${sat.getDate()} – ${MONTHS[sun.getMonth()]} ${sun.getDate()}`;

function score(e, m) {
  let s = m.weight;
  if (isFree(e.cost)) s += 3;
  if (e.verified) s += 1;
  const len = e.title.length;
  if (len >= 8 && len <= 56) s += 1;
  if (e.title === e.title.toUpperCase()) s -= 2;
  return s;
}

// Map bbox: fixed for bay-area; else computed from the events with a small pad.
function computeBbox(theme, events) {
  if (theme.bbox) return theme.bbox;
  const lats = events.map((e) => e.lat).filter((v) => Number.isFinite(v));
  const lons = events.map((e) => e.lon).filter((v) => Number.isFinite(v));
  if (lats.length < 2) return { latMax: 1, latMin: 0, lonMin: 0, lonMax: 1 };
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const padLat = Math.max((latMax - latMin) * 0.12, 0.04);
  const padLon = Math.max((lonMax - lonMin) * 0.12, 0.04);
  return { latMax: latMax + padLat, latMin: latMin - padLat, lonMin: lonMin - padLon, lonMax: lonMax + padLon };
}

export async function curate({ metro = "bay-area", count = 7, weekend = "this", ref = new Date() } = {}) {
  const theme = METROS[metro] || DEFAULT_THEME;
  const feed = JSON.parse(await readFile(join(ROOT, "public", "data", metro, "events.json"), "utf8"));
  const { sat, sun, mon } = weekendWindow(ref, weekend);

  const inWindow = feed.events.filter((e) => {
    const t = new Date(e.startDateTime);
    if (!(t >= sat && t < mon)) return false;
    if (e.endDateTime && new Date(e.endDateTime) <= ref) return false;
    return e.title?.trim() && e.venue?.trim();
  });

  const byTitle = new Map();
  for (const e of inWindow) {
    const m = catMeta(e);
    const cand = { e, m, s: score(e, m) };
    const key = e.title.trim().toLowerCase();
    if (!byTitle.has(key) || cand.s > byTitle.get(key).s) byTitle.set(key, cand);
  }
  const candidates = [...byTitle.values()].sort((a, b) => b.s - a.s);

  const buckets = new Map(BUCKET_ORDER.map((b) => [b, []]));
  for (const c of candidates) (buckets.get(c.m.bucket) ?? buckets.get("community")).push(c);

  // Only enforce a per-city cap when the metro actually spans several cities
  // (e.g. Bay Area boroughs); single-city metros (Phoenix, Austin) would
  // otherwise be throttled to ~2 picks.
  const distinctCities = new Set(candidates.map((c) => c.e.city || "—")).size;
  const cityCap = distinctCities >= 4 ? CITY_CAP : Infinity;

  const picked = [];
  const used = new Set();
  const cityCount = new Map();
  let progress = true;
  while (picked.length < count && progress) {
    progress = false;
    for (const b of BUCKET_ORDER) {
      if (picked.length >= count) break;
      const pool = buckets.get(b);
      const idx = pool.findIndex((c) => !used.has(c) && (cityCount.get(c.e.city || "—") ?? 0) < cityCap);
      if (idx < 0) continue;
      const c = pool[idx];
      used.add(c);
      cityCount.set(c.e.city || "—", (cityCount.get(c.e.city || "—") ?? 0) + 1);
      picked.push(c); progress = true;
    }
  }
  // top up by score if buckets/cap left us short of the target
  if (picked.length < count) {
    for (const c of candidates) {
      if (picked.length >= count) break;
      if (!used.has(c)) { used.add(c); picked.push(c); }
    }
  }

  const events = picked.map(({ e, m }) => ({
    title: e.title.trim(), venue: e.venue.trim(), city: e.city, neighborhood: e.neighborhood || null,
    category: e.category, emoji: m.emoji, bucket: m.bucket,
    day: new Date(e.startDateTime) < sun ? "Sat" : "Sun",
    timeWindow: e.timeWindow || "",
    whenLabel: `${new Date(e.startDateTime) < sun ? "Sat" : "Sun"}${e.timeWindow ? " " + e.timeWindow.toLowerCase() : ""}`,
    cost: e.cost || "", free: isFree(e.cost), costLabel: costLabel(e.cost),
    lat: e.lat ?? null, lon: e.lon ?? null, slug: e.slug || null, url: e.url || null,
  }));

  const byCategory = {};
  for (const e of inWindow) byCategory[e.category] = (byCategory[e.category] || 0) + 1;

  return {
    metroId: metro, metroLabel: theme.label,
    weekend: { saturday: sat.toISOString().slice(0, 10), sunday: sun.toISOString().slice(0, 10), label: weekendLabel(sat, sun) },
    generatedAt: ref.toISOString(),
    bbox: computeBbox(theme, inWindow),
    counts: { total: inWindow.length, free: inWindow.filter((e) => isFree(e.cost)).length, byCategory },
    events,
  };
}

// ── CLI ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, def = null) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
  const ref = arg("ref") ? new Date(arg("ref") + "T12:00:00") : new Date();
  const plan = await curate({ metro: arg("metro", "bay-area"), count: Number(arg("count", "7")), weekend: arg("weekend", "this"), ref });
  await writeFile(join(HERE, "weekend-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  console.log(`${plan.metroLabel} · ${plan.weekend.label} — ${plan.counts.total} events (${plan.counts.free} free)`);
  for (const e of plan.events) console.log(`  ${e.emoji} ${e.title} — ${e.venue}, ${e.city} · ${e.whenLabel}${e.free ? " · FREE" : ""}`);
}
