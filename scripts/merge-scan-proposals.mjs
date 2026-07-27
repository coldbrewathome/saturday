#!/usr/bin/env node
// Central fail-closed merge for one-off event proposals from discovery agents
// (weekly-event-prep step 3a). Agents return loosely-shaped JSON; this script
// is the single reviewer: it normalizes each proposal, fetches the official
// page, and accepts an event ONLY if the production extractor
// (extractOfficialTextEvents) would extract it from that page — the exact
// gate the ingest pipeline runs. Failing requiredText fragments are dropped
// (agents often gate on JSON-LD-only text); an event needs >=2 surviving
// fragments to merge. Already-ended events and ids already present in the
// metro's source file are skipped.
//
// Usage: node scripts/merge-scan-proposals.mjs <results-dir> [--apply]
//   results-dir: *.json files shaped {metro, proposals:[...]}
//   without --apply it reports what would merge; with --apply it writes
//   data/event-sources-<metro>.json (bay-area -> data/event-sources.json).

import fs from "node:fs";
import path from "node:path";
import { extractOfficialTextEvents } from "./eventPipeline.mjs";

const TZ = {
  "bay-area": "-07:00", "los-angeles": "-07:00", "san-diego": "-07:00", "seattle": "-07:00",
  phoenix: "-07:00", honolulu: "-10:00",
  chicago: "-05:00", "dallas-fort-worth": "-05:00", houston: "-05:00", austin: "-05:00",
  "new-york-city": "-04:00", "washington-dc": "-04:00", atlanta: "-04:00",
  philadelphia: "-04:00", miami: "-04:00", boston: "-04:00",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function sourceFileForMetro(metro) {
  return metro === "bay-area" ? "data/event-sources.json" : `data/event-sources-${metro}.json`;
}

function parseTimeToken(token) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(token);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] || "00"}:00`;
}

// "10:00 am - 4:00 pm" / "5:30 pm, 7:00 pm" -> {start, end}; null when the
// string has day-prefixed segments or no parseable am/pm tokens (caller must
// supply startTime explicitly rather than us inventing one).
function parseTimes(times) {
  if (!times) return null;
  if (/\b(mon|tue|wed|thu|fri|sat|sun)\b/i.test(times)) return null;
  const tokens = [...String(times).matchAll(/\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi)].map((m) => parseTimeToken(m[0]));
  const valid = tokens.filter(Boolean);
  if (!valid.length) return null;
  return { start: valid[0], end: valid.length > 1 ? valid[valid.length - 1] : null };
}

function normalizeProposal(raw, metro) {
  // Agents return either the flat shape or a nested officialTextEvents array.
  const nested = Array.isArray(raw.officialTextEvents) ? raw.officialTextEvents[0] : null;
  const p = { ...(nested || {}), ...raw };
  if (nested) {
    p.requiredText = nested.requiredText || raw.requiredText;
    p.url = raw.url || nested.url;
    // Agents put the SOURCE id (ending -src) at the top level; raw spreads
    // over nested, so the event config would inherit it and the written
    // source id would become "...-src-src" with "-src" leaking into event
    // page slugs. The nested entry's own id is the event id.
    if (nested.id) p.id = nested.id;
  }
  if (typeof p.id === "string" && p.id.endsWith("-src")) p.id = p.id.slice(0, -4);
  const date = (p.date || String(nested?.startDateTime || "").slice(0, 10) || "").slice(0, 10);
  const endDate = (p.endDate || String(nested?.endDateTime || "").slice(0, 10) || date).slice(0, 10);
  const tz = TZ[metro] || "-07:00";
  let start = nested?.startDateTime || null;
  let end = nested?.endDateTime || null;
  if (!start) {
    const t = p.startTime ? { start: p.startTime, end: p.endTime || null } : parseTimes(p.times);
    if (!t || !date) return { error: `cannot derive startDateTime (times: ${JSON.stringify(p.times)})`, p };
    start = `${date}T${t.start}${tz}`;
    end = t.end ? `${endDate}T${t.end}${tz}` : null;
  }
  return {
    p,
    config: {
      id: p.id,
      title: p.title,
      description: p.description || "",
      venue: p.venue || "",
      neighborhood: p.neighborhood || p.city || "",
      startDateTime: start,
      ...(end ? { endDateTime: end } : {}),
      ageBands: p.ageBands || ["preschool", "school-age", "tween"],
      audiences: p.audiences || ["kids", "family"],
      cost: p.cost || "",
      url: p.url,
      requiredText: (p.requiredText || []).map(String),
    },
    date,
    endDate,
  };
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { html: await res.text() };
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

function gatePasses(html, source, config) {
  return extractOfficialTextEvents(html, { ...source, officialTextEvents: [config] }).length === 1;
}

const resultsDir = process.argv[2];
const apply = process.argv.includes("--apply");
if (!resultsDir) {
  console.error("usage: node scripts/merge-scan-proposals.mjs <results-dir> [--apply]");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
let mergedTotal = 0;

for (const file of fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json"))) {
  const doc = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf8"));
  const metro = doc.metro;
  const srcPath = sourceFileForMetro(metro);
  const srcDoc = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const sources = srcDoc.sources || srcDoc;
  const existingIds = new Set(sources.map((s) => s.id));
  const accepted = [];

  for (const raw of doc.proposals || []) {
    const label = `${metro}/${raw.id || raw.title}`;
    const norm = normalizeProposal(raw, metro);
    if (norm.error) { console.log(`SKIP  ${label}: ${norm.error}`); continue; }
    const { p, config, endDate } = norm;
    if (endDate < today) { console.log(`SKIP  ${label}: already ended (${endDate})`); continue; }
    if (existingIds.has(config.id) || existingIds.has(`${config.id}-src`)) { console.log(`SKIP  ${label}: id already in ${srcPath}`); continue; }
    if (!config.url || !config.requiredText.length) { console.log(`SKIP  ${label}: missing url or requiredText`); continue; }

    const page = await fetchPage(config.url);
    const baseSource = { id: `${config.id}-src`, name: p.title, url: config.url, city: p.city || "", category: p.category || "Festival", sourceType: "officialTextEvents", trust: "official" };
    if (page.error) {
      // Bot-blocked official pages (403) can still merge when flagged for the
      // pipeline's browser-context fetcher: the requiredText gate still fails
      // closed at ingest, so a wrong gate yields zero-extracted, never bad data.
      if (/HTTP 403/.test(page.error) && p.requiresBrowserContext) {
        accepted.push({ ...baseSource, requiresBrowserContext: true, officialTextEvents: [config] });
        console.log(`OK*   ${label}: 403 here, deferred to ingest browser context (gate unchanged)`);
        continue;
      }
      console.log(`SKIP  ${label}: fetch failed (${page.error})`);
      continue;
    }
    // Keep only fragments the production text-stripper actually finds.
    const passing = config.requiredText.filter((frag) => gatePasses(page.html, baseSource, { ...config, requiredText: [frag] }));
    const droppedFragments = config.requiredText.filter((f) => !passing.includes(f));
    if (passing.length < 2) { console.log(`REJECT ${label}: only ${passing.length}/${config.requiredText.length} gate fragments match visible text`); continue; }
    const finalConfig = { ...config, requiredText: passing };
    if (!gatePasses(page.html, baseSource, finalConfig)) { console.log(`REJECT ${label}: final gate does not extract`); continue; }

    accepted.push({ ...baseSource, ...(p.requiresBrowserContext ? { requiresBrowserContext: true } : {}), officialTextEvents: [finalConfig] });
    console.log(`OK    ${label} (${passing.length} fragments${droppedFragments.length ? `, dropped: ${JSON.stringify(droppedFragments)}` : ""})`);
  }

  if (apply && accepted.length) {
    sources.push(...accepted);
    // Ingest validation rejects events whose city is outside coverage.cities —
    // register any new city alongside the source (runbook step 3).
    const cities = srcDoc.coverage?.cities;
    if (Array.isArray(cities)) {
      for (const src of accepted) {
        if (src.city && !cities.includes(src.city)) {
          cities.push(src.city);
          console.log(`CITY  ${metro}: added "${src.city}" to coverage.cities`);
        }
      }
    }
    fs.writeFileSync(srcPath, `${JSON.stringify(srcDoc, null, 2)}\n`);
    console.log(`WROTE ${srcPath}: +${accepted.length} sources`);
  }
  mergedTotal += accepted.length;
}

console.log(`${apply ? "merged" : "would merge"}: ${mergedTotal} sources`);
