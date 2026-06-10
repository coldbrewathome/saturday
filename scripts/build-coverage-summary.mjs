// Roll up per-metro event-build-report.json into a single coverage snapshot
// the /ops dashboard reads, and append a dated point to a 90-day trend file.
//
// Why: each ingest writes a per-metro report, but there's no cross-metro view
// or history — so a metro sliding below its minEvents threshold (Honolulu) or
// running on 2 healthy sources (Austin) is invisible until a hard-fail. This
// makes coverage health + decline visible. Run after ingest (see package.json).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { isVirtualEvent } from "./lib/adultAudience.mjs";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data");
const TREND_DAYS = 90;
const NOW = Date.now();

// Brand health is about what a visitor can actually attend: future-dated
// (not yet ended), in-person events only. The raw report eventCount includes
// past and virtual events, which is how Washington DC looked "ok" for Mosey
// while serving ~4 real adult events.
function countUpcomingInPerson(filePath) {
  if (!existsSync(filePath)) return 0;
  let doc;
  try {
    doc = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return 0;
  }
  const events = Array.isArray(doc.events) ? doc.events : [];
  return events.filter((event) => {
    const end = Date.parse(event.endDateTime || event.startDateTime || "");
    return Number.isFinite(end) && end >= NOW && !isVirtualEvent(event);
  }).length;
}

const metros = JSON.parse(
  readFileSync(path.join(ROOT, "data", "metros.json"), "utf8"),
).metros;

// Status tracks threshold proximity only (will it fail the minEvents gate?).
// Source concentration (few healthy sources) is a separate signal surfaced as
// its own column, so a high-volume metro on 2 sources isn't mislabeled "fragile".
function classify(eventCount, minEvents) {
  if (eventCount < minEvents) return "below"; // already starved / hard-fail risk
  if (eventCount < minEvents * 2) return "fragile"; // within 2x of failing
  return "ok";
}

const rows = [];
for (const metro of metros) {
  const reportPath = path.join(DATA, metro.dataDir, "event-build-report.json");
  if (!existsSync(reportPath)) continue;
  const r = JSON.parse(readFileSync(reportPath, "utf8"));
  const sources = r.sources || [];
  // A source is "healthy" when it actually contributed live events.
  const healthySources = sources.filter((s) => (s.liveEvents || 0) > 0).length;
  const brokenSources = sources.filter(
    (s) => (s.liveEvents || 0) === 0 && s.name !== "Manual entries",
  ).length;
  const minEvents = metro.minEvents ?? 15;
  // Per-brand counts from the actual feed files (additive fields — the
  // existing eventCount/status columns keep their meaning for the dashboard).
  const metroDir = path.join(DATA, metro.dataDir);
  const kidsEvents = countUpcomingInPerson(path.join(metroDir, "events.json"));
  const adultsEvents = countUpcomingInPerson(path.join(metroDir, "events-adults.json"));
  // Top-source concentration: share of live events carried by the single
  // biggest source (100% = one outage empties the metro).
  const totalLive = sources.reduce((sum, s) => sum + (s.liveEvents || 0), 0);
  const topSource = sources.reduce(
    (top, s) => ((s.liveEvents || 0) > (top?.liveEvents || 0) ? s : top),
    null,
  );
  rows.push({
    id: metro.id,
    label: metro.label,
    eventCount: r.eventCount ?? 0,
    liveEventCount: r.liveEventCount ?? 0,
    minEvents,
    sourceCount: r.sourceCount ?? sources.length,
    healthySources,
    brokenSources,
    operatorAlertCount: r.operatorAlertCount ?? 0,
    generatedAt: r.generatedAt ?? null,
    // Concentration risk: producing real volume but on ≤2 healthy sources.
    concentrated: healthySources <= 2 && (r.eventCount ?? 0) >= minEvents,
    status: classify(r.eventCount ?? 0, minEvents),
    kidsEvents,
    adultsEvents,
    topSourceId: topSource?.id ?? null,
    topSourcePct: totalLive > 0 ? Math.round(((topSource?.liveEvents || 0) / totalLive) * 100) : null,
    kidsStatus: classify(kidsEvents, minEvents),
    adultsStatus: classify(adultsEvents, metro.minAdultEvents ?? minEvents),
  });
}

// Worst-first so the dashboard leads with what needs attention.
const statusRank = { below: 0, fragile: 1, ok: 2 };
rows.sort(
  (a, b) =>
    statusRank[a.status] - statusRank[b.status] ||
    a.eventCount / a.minEvents - b.eventCount / b.minEvents,
);

const generatedAt = new Date().toISOString();
const summary = { schemaVersion: 1, generatedAt, metros: rows };
writeFileSync(
  path.join(DATA, "event-coverage.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

// Append a dated snapshot to the trend file (one point per day; today replaces
// an existing same-day point). Prune to the last TREND_DAYS days.
const trendPath = path.join(DATA, "event-coverage-trend.json");
const today = generatedAt.slice(0, 10);
let trend = { schemaVersion: 1, points: [] };
if (existsSync(trendPath)) {
  try {
    trend = JSON.parse(readFileSync(trendPath, "utf8"));
  } catch {
    // start fresh on a corrupt file
  }
}
const point = {
  date: today,
  metros: rows.map((m) => ({ id: m.id, eventCount: m.eventCount, status: m.status })),
};
trend.points = (trend.points || []).filter((p) => p.date !== today);
trend.points.push(point);
trend.points.sort((a, b) => a.date.localeCompare(b.date));
trend.points = trend.points.slice(-TREND_DAYS);
writeFileSync(trendPath, `${JSON.stringify(trend, null, 2)}\n`);

const below = rows.filter((r) => r.status === "below");
const fragile = rows.filter((r) => r.status === "fragile");
console.log(
  `Coverage summary: ${rows.length} metros — ${below.length} below threshold, ${fragile.length} fragile.`,
);
for (const r of [...below, ...fragile]) {
  console.log(
    `  ${r.status.toUpperCase().padEnd(7)} ${r.label}: ${r.eventCount}/${r.minEvents} events, ${r.healthySources} healthy / ${r.brokenSources} broken sources`,
  );
}
const adultsBelow = rows.filter((r) => r.adultsStatus === "below");
if (adultsBelow.length > 0) {
  console.log(
    `Mosey (adults) below threshold: ${adultsBelow.map((r) => `${r.label} (${r.adultsEvents})`).join(", ")}`,
  );
}
