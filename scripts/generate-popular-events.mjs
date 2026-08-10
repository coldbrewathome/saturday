#!/usr/bin/env node
// Weekly "Popular this weekend" picks for the weekend feed.
//
// Two modes:
//   node scripts/generate-popular-events.mjs --candidates [--metro=X] [--gsc-file=P]
//       Upcoming Sat+Sun events → condensed markdown digests in
//       output/popular-candidates/{metro}-kids.md (+ bay-area-adults.md).
//       The digests feed the LLM editorial step (skill step 5a) that writes
//       output/popular-picks/{metro}-kids.json proposals.
//   node scripts/generate-popular-events.mjs [--gsc-file=P]
//       Read output/popular-picks/*.json proposals, validate them hard
//       (unknown ids, duplicate/contiguous ranks, >8 picks, event outside the
//       named weekend → exit 1), and write public/data/{metro}/
//       popular-events.json (+ popular-events-adults.json for bay-area).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadMetroConfig } from "./metroConfig.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CANDIDATES_DIR = path.join(ROOT, "output", "popular-candidates");
const PICKS_DIR = path.join(ROOT, "output", "popular-picks");
const MAX_CANDIDATES_PER_METRO = 150;

const rawArgs = process.argv.slice(2);
const candidatesMode = rawArgs.includes("--candidates");
const metroFlag = rawArgs.find((a) => a.startsWith("--metro="))?.split("=")[1];
const gscFile = rawArgs.find((a) => a.startsWith("--gsc-file="))?.split("=")[1];
// --weekend=YYYY-MM-DD overrides the default (the feed's current Sat+Sun) with
// an explicit Saturday — used when pre-curating for the weekend that becomes
// current on Monday.
const weekendOverride = rawArgs.find((a) => a.startsWith("--weekend="))?.split("=")[1];

function jsonOrNull(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// Same Sat/Sun math as the app feed (WeekendView.upcomingWeekend): on Sunday
// the weekend is yesterday+today so picks never target a dead Saturday.
function upcomingWeekend(now) {
  const dow = now.getDay();
  const daysToSat = dow === 0 ? -1 : 6 - dow;
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  sat.setDate(now.getDate() + daysToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return { sat, sun };
}

function key(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// Upcoming weekend, or an explicit Saturday override from --weekend=.
function weekendWindow() {
  if (weekendOverride) {
    const sat = new Date(`${weekendOverride}T12:00:00`);
    if (Number.isFinite(sat.getTime()) && key(sat) === weekendOverride) {
      const sun = new Date(sat);
      sun.setDate(sat.getDate() + 1);
      return { sat, sun };
    }
    throw new Error(`--weekend must be a YYYY-MM-DD Saturday (got ${weekendOverride})`);
  }
  return upcomingWeekend(new Date());
}

// Local YYYY-MM-DD of an ISO instant in the metro's timezone — the ground
// truth for "is this event on Saturday".
function zonedKey(iso, tz) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function zonedTimeLabel(iso, tz) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function loadGscClicks() {
  if (!gscFile) return null;
  const payload = jsonOrNull(gscFile);
  if (!payload) return null;
  const bySlug = new Map(); // event slug -> clicks
  for (const row of payload.rows ?? []) {
    const url = row.keys?.[0] ?? "";
    const m = url.match(/\/events\/([^/]+)\/$/);
    if (!m) continue;
    const cur = bySlug.get(m[1]) ?? 0;
    bySlug.set(m[1], cur + (row.clicks ?? 0));
  }
  return bySlug;
}

function eventSlug(event) {
  return event.slug || "";
}

function sortedCandidates(events, satKey, sunKey, tz, clicks) {
  return events
    .filter((e) => {
      if (!e.startDateTime) return false;
      const k = zonedKey(e.startDateTime, tz);
      return k === satKey || k === sunKey;
    })
    .map((e) => ({ ...e, _c: clicks?.get(eventSlug(e)) ?? 0 }))
    .sort(
      (a, b) =>
        b._c - a._c ||
        (a.startDateTime < b.startDateTime ? -1 : 1),
    )
    .slice(0, MAX_CANDIDATES_PER_METRO);
}

function digestFor(metro, audience, eventsDoc) {
  const { sat, sun } = weekendWindow();
  const satKey = key(sat);
  const sunKey = key(sun);
  const tz = metro.timezone;
  const clicks = loadGscClicks();
  const lines = sortedCandidates(eventsDoc.events ?? [], satKey, sunKey, tz, clicks).map((e) => {
    const when = zonedTimeLabel(e.startDateTime, tz);
    const c = clicks?.get(eventSlug(e));
    return [
      "- ",
      e.id,
      "| ",
      when,
      "| ",
      e.title,
      "| ",
      [e.venue, e.city].filter(Boolean).join(", "),
      "| ",
      e.cost || "Unknown",
      "| ",
      e.category,
      "| ",
      e.sourceName || "",
      c ? `| clicks7d:${c}` : "",
    ].join(" ");
  });
  return [
    `# ${metro.label} — popular candidates for weekend ${satKey} → ${sunKey} (${audience})`,
    "",
    `Pick ~6 events for a "Popular this weekend" section. Favor: big-name`,
    "one-off festivals/shows over routine programming; events a general audience",
    "would recognize (county fairs, marquee concerts, cultural festivals, blockbusters);",
    "clicks7d only as a small tiebreak — it's Google-referral data, unreliable,",
    "never the primary signal. Mix days and dayparts. Each pick: an entry in a",
    `proposal file (see output/popular-picks/${metro.id}-${audience}.json) with`,
    '{"eventId","rank" (1..N contiguous),"reason" (one short line)}.',
    "",
    ...lines,
  ].join("\n");
}

function runCandidates() {
  const config = loadMetroConfig();
  const metros = metroFlag
    ? [config.metros.find((m) => m.id === metroFlag)].filter(Boolean)
    : config.metros;
  mkdirSync(CANDIDATES_DIR, { recursive: true });
  for (const metro of metros) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(path.join(ROOT, "public", "data", metro.dataDir || metro.id, "events.json"), "utf8"));
    } catch {
      console.error(`[popular] no events.json for ${metro.id}; skipping`);
      continue;
    }
    const kids = digestFor(metro, "kids", doc);
    writeFileSync(path.join(CANDIDATES_DIR, `${metro.id}-kids.md`), kids);
    if (metro.id === "bay-area") {
      let adultsDoc = doc;
      try {
        adultsDoc = JSON.parse(readFileSync(path.join(ROOT, "public", "data", metro.dataDir || metro.id, "events-adults.json"), "utf8"));
      } catch { /* fall back to kids events */ }
      writeFileSync(
        path.join(CANDIDATES_DIR, "bay-area-adults.md"),
        digestFor(metro, "adults", adultsDoc),
      );
    }
    console.log(`[popular] wrote ${CANDIDATES_DIR}/${metro.id}-kids.md`);
  }
}

// ── merge mode ────────────────────────────────────────────────────────────
function runMerge() {
  const config = loadMetroConfig();
  const clicks = loadGscClicks();
  let wroteAny = false;
  for (const metro of config.metros) {
    for (const audience of ["kids", ...(metro.id === "bay-area" ? ["adults"] : [])]) {
      const proposalPath = path.join(PICKS_DIR, `${metro.id}-${audience}.json`);
      const proposal = jsonOrNull(proposalPath);
      if (!proposal) continue;
      const eventsFile = path.join(ROOT, "public", "data", metro.dataDir || metro.id,
        audience === "adults" ? "events-adults.json" : "events.json");
      const eventsDoc = jsonOrNull(eventsFile);
      const errors = [];
      if (!eventsDoc) {
        errors.push(`missing event feed for ${metro.id} ${audience}`);
        continue;
      }
      const byId = new Map((eventsDoc.events ?? []).map((e) => [e.id, e]));
      const picks = proposal.picks ?? [];
      if (!Array.isArray(picks) || picks.length === 0) {
        errors.push(`picks is empty or not an array`);
        continue;
      }
      if (picks.length > 8) errors.push(`>8 picks (${picks.length})`);
      if (!proposal.weekendStart || !proposal.weekendEnd) {
        errors.push(`missing weekendStart/weekendEnd`);
      }
      const ranks = new Set();
      for (const pick of picks) {
        const event = byId.get(pick.eventId);
        if (!event) errors.push(`unknown eventId ${pick.eventId}`);
        else if (proposal.weekendStart) {
          const k = zonedKey(event.startDateTime, metro.timezone);
          if (!k || k < proposal.weekendStart || k > proposal.weekendEnd) {
            errors.push(`${pick.eventId} (${event.title}) starts ${k}, outside ${proposal.weekendStart}..${proposal.weekendEnd}`);
          }
        }
        if (ranks.has(pick.rank)) errors.push(`duplicate rank ${pick.rank}`);
        ranks.add(pick.rank);
      }
      const sortedRanks = [...ranks].filter((r) => Number.isInteger(r)).sort((a, b) => a - b);
      for (let i = 0; i < sortedRanks.length; i++) {
        if (sortedRanks[i] !== i + 1) {
          errors.push(`ranks must be contiguous from 1 (got ${sortedRanks.join(",")})`);
          break;
        }
      }
      if (errors.length > 0) {
        console.error(`[popular] ${proposalPath}:`);
        for (const err of errors) console.error(`  - ${err}`);
        process.exitCode = 1;
        continue;
      }
      const outPicks = picks
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((pick) => {
          const event = byId.get(pick.eventId);
          const out = { eventId: pick.eventId, rank: pick.rank };
          if (pick.reason) out.reason = pick.reason;
          const c = clicks?.get(eventSlug(event));
          if (c != null) out.clicks7d = c;
          return out;
        });
      const outFile = path.join(ROOT, "public", "data", metro.dataDir || metro.id,
        audience === "adults" ? "popular-events-adults.json" : "popular-events.json");
      const doc = {
        schemaVersion: 1,
        metroId: metro.id,
        audience,
        generatedAt: new Date().toISOString(),
        weekendStart: proposal.weekendStart,
        weekendEnd: proposal.weekendEnd,
        note: proposal.note ?? "LLM editorial picks for the weekend feed",
        picks: outPicks,
      };
      writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
      console.log(`[popular] wrote ${outFile} (${outPicks.length} picks)`);
      wroteAny = true;
    }
  }
  if (!wroteAny) {
    console.error(`[popular] no proposals found in ${PICKS_DIR}/ — run --candidates first, then curate`);
    process.exitCode = 1;
  }
}

if (candidatesMode) runCandidates();
else runMerge();
