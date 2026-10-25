#!/usr/bin/env node
// Daily data-population + health collector for FamHop.
//
// Runs the full 16-metro ingest, then prints a compact digest for the daily
// briefing agent: per-metro volume, this-weekend coverage, source health,
// critical alerts, and a day-over-day diff against data/ops/source-snapshot.json.
//
// Usage: node scripts/daily-ops.mjs [--skip-ingest]
//   --skip-ingest  report on the existing data files (fast; used when the
//                  caller already refreshed feeds)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SKIP_INGEST = process.argv.includes("--skip-ingest");
const OPS_DIR = path.join(ROOT, "data", "ops");
const SNAPSHOT = path.join(OPS_DIR, "source-snapshot.json");

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function listMetros() {
  const dir = path.join(ROOT, "public", "data");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(dir, name, "events.json")))
    .sort();
}

// The weekend that contains today (Sat/Sun) or the upcoming one on weekdays.
function upcomingSaturday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const daysSinceSat = (day + 1) % 7; // Sat 0, Sun 1, Mon 2 ... Fri 6
  if (daysSinceSat <= 1) {
    d.setDate(d.getDate() - daysSinceSat);
  } else {
    d.setDate(d.getDate() + (6 - day));
  }
  return d;
}

function localDateKey(iso, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

const TIMEZONES = {
  "bay-area": "America/Los_Angeles",
  "los-angeles": "America/Los_Angeles",
  "san-diego": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  phoenix: "America/Phoenix",
  chicago: "America/Chicago",
  "dallas-fort-worth": "America/Chicago",
  houston: "America/Chicago",
  austin: "America/Chicago",
  "new-york-city": "America/New_York",
  "washington-dc": "America/New_York",
  atlanta: "America/New_York",
  philadelphia: "America/New_York",
  miami: "America/New_York",
  boston: "America/New_York",
  honolulu: "Pacific/Honolulu",
};

const failures = [];

function run(label, args, timeoutMs = 45 * 60 * 1000) {
  process.stderr.write(`[daily-ops] ${label}...\n`);
  try {
    return execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = `${err.stdout || ""}${err.stderr || ""}`;
    const stderrTail = String(err.stderr || "")
      .trim()
      .split("\n")
      .slice(-3)
      .join(" | ")
      .slice(0, 400);
    failures.push(`${label}: ${err.message.split("\n")[0]}${stderrTail ? ` :: ${stderrTail}` : ""}`);
    process.stderr.write(`[daily-ops] ${label} FAILED: ${err.message}\n${stderrTail}\n`);
    return out;
  }
}

function countEvents(file) {
  const doc = readJson(file, null);
  if (!doc) return null;
  if (Array.isArray(doc.events)) return doc.events.length;
  return typeof doc.count === "number" ? doc.count : null;
}

// Keep a one-slot backup of each metro feed and roll back obvious breakage:
// a >30% single-day drop means sources failed, not that the calendar emptied.
const BACKUP_DIR = path.join(OPS_DIR, "backups");
const ROLLBACK_RATIO = 0.7;
const rollbacks = [];

function backupFeed(metro) {
  const feed = path.join(ROOT, "public", "data", metro, "events.json");
  if (!fs.existsSync(feed)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `${metro}.json`);
  fs.copyFileSync(feed, dest);
  return { dest, count: countEvents(feed) };
}

function maybeRollback(metro, backup) {
  if (!backup || !backup.count) return;
  const feed = path.join(ROOT, "public", "data", metro, "events.json");
  const after = countEvents(feed);
  if (after === null) {
    fs.copyFileSync(backup.dest, feed);
    rollbacks.push(`${metro}: ingest wrote no readable feed — restored ${backup.count}`);
    return;
  }
  if (after < backup.count * ROLLBACK_RATIO) {
    fs.copyFileSync(backup.dest, feed);
    rollbacks.push(
      `${metro}: dropped ${backup.count}→${after} (${Math.round((after / backup.count) * 100)}%) — kept previous feed, sources look broken`
    );
  }
}

if (!SKIP_INGEST) {
  // Daily budget: the four metros that actually earn clicks get refreshed every
  // day; the other twelve rotate three per day, so the whole fleet refreshes
  // every ~4 days without a 45-minute ingest on every tick.
  const TRAFFIC = ["bay-area", "los-angeles", "new-york-city", "washington-dc"];
  const ROTATE_PER_DAY = 3;
  const all = listMetros();
  const rotationStatePath = path.join(OPS_DIR, "ingest-rotation.json");
  const rotationState = readJson(rotationStatePath, { cursor: 0 });
  const rest = all.filter((m) => !TRAFFIC.includes(m));
  const start = rotationState.cursor % Math.max(rest.length, 1);
  const rotated = [];
  for (let i = 0; i < Math.min(ROTATE_PER_DAY, rest.length); i += 1) {
    rotated.push(rest[(start + i) % rest.length]);
  }
  const targets = process.env.DAILY_ONLY_METROS
    ? process.env.DAILY_ONLY_METROS.split(",").map((m) => m.trim()).filter(Boolean)
    : process.argv.includes("--all")
      ? all
      : [...TRAFFIC, ...rotated];

  fs.mkdirSync(OPS_DIR, { recursive: true });
  fs.writeFileSync(
    rotationStatePath,
    JSON.stringify({ cursor: (start + ROTATE_PER_DAY) % Math.max(rest.length, 1), updatedAt: new Date().toISOString() }, null, 2)
  );

  process.stderr.write(`[daily-ops] refreshing ${targets.length}/${all.length} metros: ${targets.join(", ")}\n`);
  for (const metro of targets) {
    const backup = backupFeed(metro);
    run(`ingest ${metro}`, ["scripts/ingest-events.mjs", `--metro=${metro}`], 20 * 60 * 1000);
    maybeRollback(metro, backup);
  }
  run("build-coverage-summary", ["scripts/build-coverage-summary.mjs"], 5 * 60 * 1000);
}

const sat = upcomingSaturday();
const sun = new Date(sat);
sun.setDate(sat.getDate() + 1);
const satKey = localDateKey(sat.toISOString(), "UTC");
const sunKey = localDateKey(sun.toISOString(), "UTC");

const prev = readJson(SNAPSHOT, { sources: {}, metros: {} });
const snapshot = { generatedAt: new Date().toISOString(), sources: {}, metros: {} };

const rows = [];
const criticals = [];
const warnings = [];
let totals = { events: 0, adults: 0, weekend: 0, weekendNew: 0 };
const newSources = [];
const newlyBroken = [];
const newlyFixed = [];

for (const metro of listMetros()) {
  const tz = TIMEZONES[metro] || "America/Los_Angeles";
  const feed = readJson(path.join(ROOT, "public", "data", metro, "events.json"), { events: [] });
  const report = readJson(path.join(ROOT, "public", "data", metro, "event-build-report.json"), {});
  const events = Array.isArray(feed.events) ? feed.events : [];
  const weekend = events.filter((e) => {
    if (!e.startDateTime) return false;
    const k = localDateKey(e.startDateTime, tz);
    return k === satKey || k === sunKey;
  });

  const prevCount = prev.metros?.[metro]?.events;
  const delta = typeof prevCount === "number" ? events.length - prevCount : null;

  rows.push({
    metro,
    events: events.length,
    delta,
    weekend: weekend.length,
    sources: report.sourceCount ?? 0,
    fallback: report.fallbackEventCount ?? 0,
    lkg: report.lastKnownGoodEventCount ?? 0,
    alerts: report.operatorAlertCount ?? 0,
  });

  totals.events += events.length;
  totals.adults += report.adultsEventCount ?? 0;
  totals.weekend += weekend.length;

  for (const s of report.sources || []) {
    const key = `${metro}/${s.id}`;
    snapshot.sources[key] = {
      status: s.status,
      live: s.liveEvents ?? 0,
      fallback: s.fallbackEvents ?? 0,
      count: s.eventCount ?? 0,
    };
    const before = prev.sources?.[key];
    if (!before) {
      if (s.status !== "ok") newSources.push(`${key} (${s.status})`);
    } else if (before.status === "ok" && s.status !== "ok") {
      newlyBroken.push(`${key}: ok -> ${s.status}`);
    } else if (before.status !== "ok" && s.status === "ok") {
      newlyFixed.push(`${key}: ${before.status} -> ok`);
    }
  }

  for (const a of report.operatorAlerts || []) {
    const item = { metro, id: a.sourceId, issue: a.issueType, status: a.status };
    if (a.severity === "critical") criticals.push(item);
    else warnings.push(item);
  }

  snapshot.metros[metro] = { events: events.length, weekend: weekend.length };
}

fs.mkdirSync(OPS_DIR, { recursive: true });
fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
const fmtDelta = (d) => (d === null ? "n/a" : d > 0 ? `+${d}` : String(d));

const lines = [];
lines.push(`## Data population — ${satKey} / ${sunKey} weekend`);
lines.push(`Total events: ${totals.events} (kids feed) · ${totals.adults} adults · ${totals.weekend} dated for this Sat/Sun`);
lines.push(`Sources: ${Object.keys(snapshot.sources).length} tracked · ${criticals.length} critical · ${warnings.length} warnings`);
if (newlyBroken.length) lines.push(`Newly broken sources: ${newlyBroken.slice(0, 12).join("; ")}`);
if (newlyFixed.length) lines.push(`Newly recovered sources: ${newlyFixed.slice(0, 12).join("; ")}`);
if (rollbacks.length) lines.push(`Feed rollbacks (broken sources, previous feed kept): ${rollbacks.join("; ")}`);
if (failures.length) lines.push(`Collector failures: ${failures.join("; ")}`);
lines.push("");
lines.push("| metro | events | d/d | weekend | fallback | alerts |");
lines.push("|---|---|---|---|---|---|");
for (const r of rows.sort((a, b) => b.events - a.events)) {
  lines.push(`| ${r.metro} | ${r.events} | ${fmtDelta(r.delta)} | ${r.weekend} | ${r.fallback} (${pct(r.fallback, r.events)}) | ${r.alerts} |`);
}

if (criticals.length) {
  const byIssue = {};
  for (const c of criticals) byIssue[c.issue] = (byIssue[c.issue] || 0) + 1;
  lines.push("");
  lines.push(
    `Critical alerts by issue: ${Object.entries(byIssue).map(([k, v]) => `${k}=${v}`).join(", ")}`
  );
  const top = criticals.slice(0, 20).map((c) => `${c.metro}/${c.id} (${c.issue})`);
  lines.push(`Critical sources: ${top.join(", ")}`);
}

const coverage = readJson(path.join(ROOT, "public", "data", "event-coverage.json"));
if (coverage) {
  const metros = coverage.metros || coverage;
  const below = Array.isArray(metros)
    ? metros.filter((m) => m.belowThreshold)
    : Object.values(metros).filter((m) => m && m.belowThreshold);
  lines.push("");
  lines.push(`Coverage summary: ${below.length} metro(s) below threshold${below.length ? ` (${below.map((m) => m.id || m.metroId).join(", ")})` : ""}`);
}

console.log(lines.join("\n"));
