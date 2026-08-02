#!/usr/bin/env node
// Traffic-promotion loop: GSC per-page data → classify every URL against the
// current dataset + promotion files → emit rescue/protect/drift reports.
//
// READ-ONLY REPORT GENERATOR. Merging approved candidates into the promotion
// data files (data/evergreen-events.json, data/seo-pinned-paths.json, the
// *-index-keep.json files) stays a human step — SEO policy: metrics first,
// curated lists, explicit approval (~/Projects/seo-ops/SEO-POLICY.md).
//
// Usage: node scripts/traffic-promotion.mjs [--days=28] [--from-file=out.json]
//   --days=N       GSC window (default 28)
//   --from-file=X  skip GSC, classify a cached GSC pages payload (testing)
//
// Output: output/traffic-promotion/{rescue-candidates,protect-candidates,
// drift-report}.{json,md}  (output/ is gitignored — reports are review aids)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROPERTY = "sc-domain:famhop.com";
const QUOTA_PROJECT = "dulcet-abacus-478503-i7"; // seo-ops sites.json quotaProjectDefault
const GSC_ANALYTICS = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const SITE = "https://famhop.com";
const BAR = { clicks: 1, impressions: 10 }; // matches keep-file rule "click>=1 or impressions>=10"

const METROS = [
  "bay-area", "los-angeles", "new-york-city", "seattle", "chicago",
  "dallas-fort-worth", "houston", "washington-dc", "atlanta", "philadelphia",
  "miami", "phoenix", "boston", "san-diego", "honolulu", "austin",
];

const OUT = path.join(ROOT, "output", "traffic-promotion");

// ── tiny helpers ──────────────────────────────────────────────────────────
function jsonOrNull(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function slugify(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
function stableSuffix(id) {
  if (!id) return "";
  return slugify(id.replace("osm-node-", "n").replace("osm-way-", "w").replace("osm-relation-", "r"));
}
function daysAgo(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}
function mdTable(rows, cols) {
  const head = cols.map((c) => c.label).join(" | ");
  const sep = cols.map(() => "---").join(" | ");
  const body = rows.map((r) => cols.map((c) => String(c.get(r) ?? "")).join(" | ")).join("\n");
  return `| ${head} |\n| ${sep} |\n${body.split("\n").map((l) => `| ${l} |`).join("\n")}`;
}

// ── GSC ───────────────────────────────────────────────────────────────────
function gscToken() {
  try {
    return execFileSync("gcloud", ["auth", "application-default", "print-access-token"], { encoding: "utf8" }).trim();
  } catch (e) {
    try {
      return execFileSync("gcloud", ["auth", "application-default", "print-access-token"],
        { encoding: "utf8", env: { ...process.env, CLOUDSDK_PYTHON: "/opt/homebrew/bin/python3.10" } }).trim();
    } catch (e2) {
      throw new Error(`gcloud ADC token failed: ${e2.message}`);
    }
  }
}

async function gscPages(token, days, fromFile) {
  if (fromFile) return JSON.parse(readFileSync(fromFile, "utf8"));
  const startDate = daysAgo(days);
  const endDate = daysAgo(1);
  const all = [];
  let startRow = 0;
  for (;;) {
    const res = await fetch(`${GSC_ANALYTICS}/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-goog-user-project": QUOTA_PROJECT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate, endDate, dimensions: ["page"],
        rowLimit: 5000, startRow,
      }),
    });
    if (!res.ok) throw new Error(`GSC searchAnalytics ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = (await res.json()).rows ?? [];
    all.push(...rows);
    if (rows.length < 5000) break;
    startRow += 5000;
  }
  return { startDate, endDate, rows: all };
}

// ── dataset state ─────────────────────────────────────────────────────────
function buildState() {
  const liveEvents = new Map();   // metro -> Set(slug)
  const liveSpots = new Map();    // metro -> Set(slug)  (slug replicated from generate-seo-pages)
  const slugHistory = new Map();  // metro -> Set(slug)
  const evergreen = new Set();    // "metro/slug"
  const pinnedSpots = new Map();  // metro -> Set(slug)
  const pinnedCities = new Map(); // metro -> Set(slug)
  const keepPaths = new Set();    // "/metro/kind/slug/" from all keep files

  for (const m of METROS) {
    const ev = jsonOrNull(path.join(ROOT, "public", "data", m, "events.json"));
    liveEvents.set(m, new Set((ev?.events ?? []).map((e) => e.slug).filter(Boolean)));
    const spots = jsonOrNull(path.join(ROOT, "public", "data", m, "spots.json"));
    const map = new Map();
    const used = new Map();
    for (const spot of spots?.spots ?? []) {
      if (!spot || typeof spot.name !== "string") continue;
      const base = slugify(`${spot.name} ${spot.neighborhood ?? ""}`);
      if (!base) continue;
      let s = base;
      if (used.has(s)) {
        const suffix = stableSuffix(spot.id);
        s = suffix ? `${base}-${suffix}` : `${base}-${used.get(base)}`;
        used.set(base, (used.get(base) || 2) + 1);
      } else {
        used.set(base, 2);
      }
      map.set(s, spot);
    }
    liveSpots.set(m, map);
    const hist = jsonOrNull(path.join(ROOT, "data", m, "event-slug-history.json"));
    slugHistory.set(m, new Set(Object.keys(hist?.slugs ?? {})));
  }

  const evg = jsonOrNull(path.join(ROOT, "data", "evergreen-events.json"));
  for (const [m, entries] of Object.entries(evg?.metros ?? {})) {
    for (const e of entries) evergreen.add(`${m}/${e.slug}`);
  }

  const pinned = jsonOrNull(path.join(ROOT, "data", "seo-pinned-paths.json"));
  for (const [m, v] of Object.entries(pinned?.metros ?? {})) {
    pinnedSpots.set(m, new Set(v.spotSlugs ?? []));
    pinnedCities.set(m, new Set(v.citySlugs ?? []));
  }

  for (const f of ["spot-index-keep.json", "city-index-keep.json", "category-index-keep.json"]) {
    const keep = jsonOrNull(path.join(ROOT, "data", f));
    for (const p of keep?.keep ?? []) keepPaths.add(p);
  }

  return { liveEvents, liveSpots, slugHistory, evergreen, pinnedSpots, pinnedCities, keepPaths };
}

// ── classification ────────────────────────────────────────────────────────
function parseUrl(url) {
  const u = new URL(url);
  if (u.hostname !== "famhop.com") return null;
  const m = u.pathname.match(/^\/([a-z0-9-]+)\/(event|spot|city|category)\/([^/]+)\/?$/);
  if (!m) return null;
  if (!METROS.includes(m[1])) return null;
  return { metro: m[1], kind: m[2], slug: m[3] };
}

// Classify a page row. Returns a tagged record or null (skip).
function classify(row, st) {
  const p = parseUrl(row.keys[0]);
  if (!p) return null;
  p.url = row.keys[0];
  const { metro, kind, slug } = p;
  const base = { url: row.keys[0], metro, kind, slug, clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.ctr };

  if (kind === "event") {
    const live = st.liveEvents.get(metro)?.has(slug);
    const seen = st.slugHistory.get(metro)?.has(slug);
    const promoted = st.evergreen.has(`${metro}/${slug}`);
    if (promoted) return { ...base, state: "promoted" };
    if (live) return { ...base, state: "live" };
    if (seen) return { ...base, state: "dead" };
    return { ...base, state: "unknown" };
  }

  if (kind === "spot") {
    const live = st.liveSpots.get(metro)?.has(slug);
    const pinned = Boolean(st.pinnedSpots.get(metro)?.has(slug));
    const kept = st.keepPaths.has(p.url.replace(SITE, ""));
    if (pinned && kept) return { ...base, state: "promoted" };
    if (live) return { ...base, state: "live", pinned, kept };
    return { ...base, state: "unknown", pinned, kept };
  }

  if (kind === "city") {
    const pinned = Boolean(st.pinnedCities.get(metro)?.has(slug));
    const kept = st.keepPaths.has(p.url.replace(SITE, ""));
    if (pinned && kept) return { ...base, state: "promoted" };
    return { ...base, state: pinned || kept ? "promoted" : "unpromoted", pinned, kept };
  }

  if (kind === "category") {
    const kept = st.keepPaths.has(p.url.replace(SITE, ""));
    return { ...base, state: kept ? "promoted" : "unpromoted", kept };
  }
  return null;
}

const hasTraffic = (r) => r.clicks >= BAR.clicks || r.impressions >= BAR.impressions;

// ── drift probes (promoted pages must still resolve) ──────────────────────
async function probe(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", headers: { "User-Agent": "famhop-seo-audit/1.0" } });
    return { status: res.status, noindex: (res.headers.get("x-robots-tag") ?? "").includes("noindex"), redirect: res.headers.get("location") ?? null };
  } catch (e) {
    return { status: 0, noindex: false, redirect: null, error: String(e).slice(0, 100) };
  }
}

async function buildDrift(st) {
  const targets = [];
  const evg = jsonOrNull(path.join(ROOT, "data", "evergreen-events.json"));
  for (const [m, entries] of Object.entries(evg?.metros ?? {})) {
    for (const e of entries) targets.push({ kind: "evergreen", url: `${SITE}/${m}/event/${e.slug}/`, label: `${m}: ${e.title ?? e.slug}` });
  }
  for (const m of METROS) {
    for (const s of st.pinnedSpots.get(m) ?? []) targets.push({ kind: "pinned-spot", url: `${SITE}/${m}/spot/${s}/`, label: `${m} spot ${s}` });
    for (const s of st.pinnedCities.get(m) ?? []) targets.push({ kind: "pinned-city", url: `${SITE}/${m}/city/${s}/`, label: `${m} city ${s}` });
  }
  const drift = [];
  for (const t of targets) {
    const p = await probe(t.url);
    const ok = t.kind === "evergreen" ? p.status === 200 && !p.noindex : p.status === 200;
    if (!ok) drift.push({ ...t, ...p });
  }
  return drift;
}

// ── main ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 28);
const fromFile = args.find((a) => a.startsWith("--from-file="))?.split("=")[1];

const st = buildState();
const token = fromFile ? null : gscToken();
const gsc = await gscPages(token, days, fromFile);
console.log(`GSC ${gsc.startDate}..${gsc.endDate}: ${gsc.rows.length} page-rows with impressions/clicks`);

const rows = gsc.rows.map((r) => classify(r, st)).filter(Boolean);

const rescue = rows
  .filter((r) => r.kind === "event" && r.state === "dead" && hasTraffic(r))
  .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

const protect = rows
  .filter((r) => r.kind !== "event" && (r.state === "live" || r.state === "unpromoted"))
  .filter((r) => hasTraffic(r))
  .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

const drift = await buildDrift(st);

// ── write ─────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const stamp = { generatedAt: new Date().toISOString(), window: `${gsc.startDate}..${gsc.endDate}`, bar: `${BAR.clicks}+ clicks or ${BAR.impressions}+ impressions` };

writeFileSync(path.join(OUT, "rescue-candidates.json"), JSON.stringify({ ...stamp, candidates: rescue }, null, 2));
writeFileSync(path.join(OUT, "protect-candidates.json"), JSON.stringify({ ...stamp, candidates: protect, note: "spot action = add slug to data/seo-pinned-paths.json + data/spot-index-keep.json; city/category action = add path to the *-index-keep.json keep list" }, null, 2));
writeFileSync(path.join(OUT, "drift-report.json"), JSON.stringify({ ...stamp, drift }, null, 2));

const rescueMd = `# Rescue candidates (dead events with traffic)\n\nWindow ${gsc.startDate}..${gsc.endDate} · bar: ${stamp.bar} · proposals only — review, then merge into \`data/evergreen-events.json\` (metrics shown per SEO policy).\n\n${rescue.length ? mdTable(rescue.map((r) => ({ ...r, title: r.slug })), [
  { label: "metro", get: (r) => r.metro },
  { label: "slug", get: (r) => r.slug },
  { label: "clicks", get: (r) => r.clicks },
  { label: "imp", get: (r) => r.impressions },
  { label: "pos", get: (r) => r.position.toFixed(1) },
]) : "_None._"}\n`;
writeFileSync(path.join(OUT, "rescue-candidates.md"), rescueMd);

const protectMd = `# Protect candidates (live pages with traffic, not fully promoted)\n\nWindow ${gsc.startDate}..${gsc.endDate} · bar: ${stamp.bar}\n\n**Spot action:** add slug to \`data/seo-pinned-paths.json\` (metro.spotSlugs — bypasses gate+cap) AND \`data/spot-index-keep.json\` keep list (indexable+sitemap).\n**City/category action:** add path to \`data/city-index-keep.json\` / \`data/category-index-keep.json\` keep list.\n\n${protect.length ? mdTable(protect, [
  { label: "metro", get: (r) => r.metro },
  { label: "kind", get: (r) => r.kind },
  { label: "slug", get: (r) => r.slug },
  { label: "clicks", get: (r) => r.clicks },
  { label: "imp", get: (r) => r.impressions },
  { label: "pos", get: (r) => r.position.toFixed(1) },
  { label: "state", get: (r) => r.state },
]) : "_None._"}\n`;
writeFileSync(path.join(OUT, "protect-candidates.md"), protectMd);

const driftMd = `# Drift report (promoted pages not resolving)\n\n${drift.length ? mdTable(drift, [
  { label: "kind", get: (r) => r.kind },
  { label: "label", get: (r) => r.label },
  { label: "status", get: (r) => r.status },
  { label: "noindex", get: (r) => r.noindex },
]) : "_All promoted pages resolve._"}\n`;
writeFileSync(path.join(OUT, "drift-report.md"), driftMd);

console.log(`\nrescue: ${rescue.length} · protect: ${protect.length} · drift: ${drift.length}`);
console.log(`reports → ${OUT}/`);
