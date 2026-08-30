#!/usr/bin/env node
// PR weekly pipeline: turn this weekend's upcoming events into paste-ready
// listicles journalists/bloggers can publish as-is, with a famhop.com source
// link on every event. Runs before the weekend so editors have copy in hand.
//
//   node scripts/pr-weekly.mjs                      # generate drafts only
//   node scripts/pr-weekly.mjs --send               # generate + email contacts
//   node scripts/pr-weekly.mjs --date=2026-08-08    # target a specific Saturday
//   node scripts/pr-weekly.mjs --metro=bay-area     # one metro (iteration)
//
// Output: output/pr-weekly/<sat>/famhop-<metro>-weekend.{html,txt}  (gitignored)
// Sending pairs data/pr-contacts.json with the matching metro draft, writes
// output/pr-weekly/<sat>/send-batch.json, then POSTs each to the worker's
// /pr/send endpoint (requires NEWSLETTER_ADMIN_TOKEN — same gate as
// newsletter-send.mjs). Review drafts before --send; expected hit rate is low
// (5-10%), the point is a consistent Friday pipeline, not volume.
//
// Ranking mirrors worker/src/newsletter-template.ts scoreEvent (marquee
// one-offs > free > routine library programming), with one addition: venues
// that span the whole weekend (museums/zoos) get a small "all weekend" boost
// because PR copy wants always-on options too.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "pr-weekly");
const CONTACTS_PATH = path.join(ROOT, "data", "pr-contacts.json");
const SITE = "https://famhop.com";
const DEFAULT_WORKER_URL = "https://saturday-polls.santaclararental2016.workers.dev";
const TOP_N = 10;
const REF_TZ = "America/Los_Angeles"; // --date default resolves in this tz

const METROS = [
  "bay-area", "los-angeles", "new-york-city", "seattle", "chicago",
  "dallas-fort-worth", "houston", "washington-dc", "atlanta", "philadelphia",
  "miami", "phoenix", "boston", "san-diego", "honolulu", "austin",
];

const args = process.argv.slice(2);
const send = args.includes("--send");
const dateFlag = args.find((a) => a.startsWith("--date="));
const metroFlag = args.find((a) => a.startsWith("--metro="));
const workerUrlFlag = args.find((a) => a.startsWith("--worker-url="));
const satYmd = dateFlag ? dateFlag.split("=")[1] : nextSaturdayYmd(REF_TZ);
const onlyMetro = metroFlag ? metroFlag.split("=")[1] : undefined;
const workerUrl = (workerUrlFlag ? workerUrlFlag.split("=")[1] : undefined) ||
  process.env.NEWSLETTER_WORKER_URL || DEFAULT_WORKER_URL;

// ── tiny helpers ──────────────────────────────────────────────────────────
function jsonOrNull(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function ymdInTz(utcMs, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function nextSaturdayYmd(tz) {
  const today = new Date(`${ymdInTz(Date.now(), tz)}T00:00:00Z`);
  const daysToSat = (6 - today.getUTCDay() + 7) % 7 || 7; // next Saturday, not today
  today.setUTCDate(today.getUTCDate() + daysToSat);
  return today.toISOString().slice(0, 10);
}
function localMidnightUtc(ymd, tz) {
  // UTC instant whose wall clock in tz is ymd 00:00:00 (converges in <=2 iters).
  // Each step shifts d by (targetWallAsZ − currentWallAsZ), i.e. by how far
  // the observed wall clock is from the target wall clock.
  let d = new Date(ymd + "T00:00:00Z");
  const target = `${ymd}T00:00:00`;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d);
    const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    const wall = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
    if (wall === target) return d.getTime();
    const error = new Date(target + "Z").getTime() - new Date(wall + "Z").getTime();
    d = new Date(d.getTime() + error);
  }
  throw new Error(`could not resolve local midnight for ${ymd} in ${tz}`);
}
function fmt(iso, tz, opts) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(iso));
}
function metroLabel(metro) {
  const coverage = jsonOrNull(path.join(ROOT, "public", "data", metro, "events.json"))?.coverage;
  return coverage?.name || metro;
}

// ── interestingness ranking (mirror of worker scoreEvent + always-on boost) ─
const MARQUEE_RE =
  /\b(festival|fest|parade|fireworks|carnival|fair|circus|rodeo|air ?show|balloon|drone show|block party|touch[- ]a[- ]truck|grand opening)\b/i;
const BIG_DRAW_RE =
  /\b(concert|live music|symphony|orchestra|movie night|outdoor movie|drive[- ]in|train ride|zoo|aquarium|museum day|splash|water play|pumpkin|holiday lights|ice skating|kite|dinosaur|pirate|princess|superhero|magic show|puppet)\b/i;
const ROUTINE_RE =
  /\b(storytime|story time|story hour|book club|lego club|toddler time|craft(ernoon)?|lap ?sit|read to a dog|homework help|teen advisory|knitting|chess club)\b/i;
const ALWAYS_ON_RE = /\b(museum|zoo|aquarium|farm|garden|science center|botanical)\b/i;

function scoreEvent(event, spansBothDays) {
  const title = String(event.title || "");
  let score = 0;
  if (MARQUEE_RE.test(title)) score += 5;
  if (BIG_DRAW_RE.test(title)) score += 3;
  if (event.category && /fest|fair|music|outdoor|seasonal/i.test(event.category)) score += 2;
  if (event.cost && /free/i.test(event.cost)) score += 2;
  if (ROUTINE_RE.test(title)) score -= 3;
  if (!/[a-z]{3,}/i.test(title)) score -= 10;
  if (spansBothDays && ALWAYS_ON_RE.test(`${title} ${event.category}`)) score += 1;
  return score;
}

// "(Saturday)" suffix is feed plumbing; the meta line carries the day.
function stripDaySuffix(title) {
  return String(title || "").replace(
    /\s*\((?:this\s+)?(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\)\s*$/i,
    "",
  );
}

function whenLine(e, satStart, sunEnd, tz) {
  const start = new Date(e.startDateTime).getTime();
  const end = new Date(e.endDateTime).getTime();
  if (start <= satStart && end >= sunEnd) return "All weekend";
  const dayTime = fmt(e.startDateTime, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(", ", " ");
  if (end - start < 26 * 3600_000) {
    const endTime = fmt(e.endDateTime, tz, { hour: "numeric", minute: "2-digit" });
    return `${dayTime}–${endTime}`;
  }
  return `${dayTime}${e.endDateTime ? ` – ${fmt(e.endDateTime, tz, { weekday: "short", month: "short", day: "numeric" })}` : ""}`;
}

// ── pick the weekend's events for one metro ────────────────────────────────
function pickWeekend(metro) {
  const doc = jsonOrNull(path.join(ROOT, "public", "data", metro, "events.json"));
  if (!doc) return { metro, label: metro, satYmd, picked: [], error: `no events.json for ${metro}` };
  const tz = doc.coverage?.timezone || "America/Los_Angeles";
  const satStart = localMidnightUtc(satYmd, tz);
  const sunEnd = localMidnightUtc(ymdInTz(satStart + 86_400_000, tz), tz) + 86_400_000;

  const weekend = (doc.events || [])
    .filter((e) => e.slug && e.startDateTime && e.endDateTime && e.url)
    .filter((e) => {
      const s = new Date(e.startDateTime).getTime();
      const en = new Date(e.endDateTime).getTime();
      return s < sunEnd && en > satStart; // overlaps the weekend window
    })
    .map((e) => ({
      ...e,
      spansBoth: new Date(e.startDateTime).getTime() <= satStart && new Date(e.endDateTime).getTime() >= sunEnd,
    }))
    .sort((a, b) => scoreEvent(b, b.spansBoth) - scoreEvent(a, a.spansBoth))
    .filter((e) => scoreEvent(e, e.spansBoth) > -5)
    // one occurrence per (title, venue) — multi-day events emit one record/day
    .filter((e, i, arr) => {
      const key = `${stripDaySuffix(e.title)}|${e.venue}`.toLowerCase();
      return arr.findIndex((x) => `${stripDaySuffix(x.title)}|${x.venue}`.toLowerCase() === key) === i;
    })
    .slice(0, TOP_N);

  const satLabel = fmt(new Date(satStart), tz, { weekday: "short", month: "short", day: "numeric" });
  const sunLabel = fmt(new Date(sunEnd - 86_400_000), tz, { weekday: "short", month: "short", day: "numeric" });
  return { metro, label: doc.coverage?.name || metro, tz, satYmd, satStart, sunEnd, satLabel, sunLabel, picked: weekend, error: null };
}

// ── copy ───────────────────────────────────────────────────────────────────
function eventHref(pick, e) {
  // In-app event URL wins only when it's a famhop page; otherwise use the SEO
  // page path (same slug the SEO pipeline publishes at /{metro}/event/{slug}/).
  return e.url?.startsWith(SITE) ? e.url : `${SITE}/${pick.metro}/event/${e.slug}/`;
}

function listicleHtml(pick) {
  const rows = pick.picked
    .map((e) => {
      const title = stripDaySuffix(e.title);
      return `<li><strong><a href="${eventHref(pick, e)}">${title}</a></strong> — ${e.venue}${e.city ? `, ${e.city}` : ""}. ${whenLine(e, pick.satStart, pick.sunEnd, pick.tz)}${/free/i.test(String(e.cost)) ? " · Free" : ""}</li>`;
    })
    .join("\n");
  const countFree = pick.picked.filter((e) => /free/i.test(String(e.cost))).length;
  const head = pick.picked[0] ? stripDaySuffix(pick.picked[0].title) : "";
  const lead = `Looking for things to do with kids ${pick.satLabel}–${pick.sunLabel}? FamHop curates family events from official sources — here's what stands out${countFree ? ` (${countFree} of these are free)` : ""}:`;
  return `<h1>${head} and more: family events in the ${pick.label} this weekend (${pick.satLabel}–${pick.sunLabel})</h1>\n<p>${lead}</p>\n<ol>\n${rows}\n</ol>\n<p><em>Compiled by <a href="${SITE}/${pick.metro}/">FamHop</a> — free family event guide. Full calendar at ${SITE}/${pick.metro}/.</em></p>`;
}

function listicleText(pick) {
  const lines = pick.picked.map((e, i) => {
    const title = stripDaySuffix(e.title);
    return `${i + 1}. ${title} — ${e.venue}${e.city ? `, ${e.city}` : ""} (${whenLine(e, pick.satStart, pick.sunEnd, pick.tz)}${/free/i.test(String(e.cost)) ? ", free" : ""}) ${eventHref(pick, e)}`;
  });
  return [
    `FamHop weekend listicle — ${pick.label} (${pick.satLabel}–${pick.sunLabel})`,
    "",
    `Looking for things to do with kids ${pick.satLabel}–${pick.sunLabel}? FamHop curates family events from official sources — here's what stands out:`,
    "",
    ...lines,
    "",
    `Compiled by FamHop — free family event guide. Full calendar: ${SITE}/${pick.metro}/`,
  ].join("\n");
}

// ── main ───────────────────────────────────────────────────────────────────
const picks = METROS
  .filter((m) => !onlyMetro || m === onlyMetro)
  .map(pickWeekend);

const outDir = path.join(OUT, satYmd);
fs.mkdirSync(outDir, { recursive: true });
for (const pick of picks) {
  if (pick.error) { console.error(`  skip ${pick.metro}: ${pick.error}`); continue; }
  fs.writeFileSync(path.join(outDir, `famhop-${pick.metro}-weekend.html`), listicleHtml(pick));
  fs.writeFileSync(path.join(outDir, `famhop-${pick.metro}-weekend.txt`), listicleText(pick));
  console.log(`${pick.metro}: ${pick.picked.length} events → ${path.join("output/pr-weekly", satYmd, `famhop-${pick.metro}-weekend.txt`)}`);
}

if (!send) {
  console.log(`\nDrafts in ${outDir} (no email sent). Run with --send after review.`);
  process.exit(0);
}

// ── send: pair contacts with their metro draft ─────────────────────────────
const contactsDoc = jsonOrNull(CONTACTS_PATH);
const contacts = (contactsDoc?.contacts || []).filter((c) => !c.placeholder && c.email);
if (contacts.length === 0) {
  console.error(`\nNo real contacts in ${CONTACTS_PATH} — fill editorial emails there first.`);
  process.exit(1);
}
const token = process.env.NEWSLETTER_ADMIN_TOKEN;
if (!token) {
  console.error("\n--send requires NEWSLETTER_ADMIN_TOKEN (same bearer token as newsletter-send.mjs).");
  process.exit(1);
}

const batch = [];
for (const c of contacts) {
  const pick = picks.find((p) => p.metro === c.metroId);
  if (!pick?.picked.length) { console.error(`  no draft for ${c.metroId} (contact ${c.outlet}) — skipped`); continue; }
  const html = listicleHtml(pick);
  const text = listicleText(pick);
  const subject = `Top family events in the ${pick.label} this weekend (${pick.satLabel}–${pick.sunLabel})`;
  batch.push({
    contactId: c.id || c.outlet, outlet: c.outlet, to: c.email,
    subject: subject.slice(0, 120),
    html: `Hi ${c.name || c.outlet},<br><br>FamHop (famhop.com) tracks family events from official sources. Paste-ready copy below — use as-is, or lift individual events. <a href="${SITE}/">FamHop</a> is a free guide; we'd appreciate a credit/link if you publish.<br><br>${html}`,
    text: `Hi ${c.name || c.outlet},\n\nFamHop (famhop.com) tracks family events from official sources. Paste-ready copy below — use as-is, or lift individual events. We'd appreciate a credit/link if you publish.\n\n${text}`,
  });
}
fs.writeFileSync(path.join(outDir, "send-batch.json"), JSON.stringify(batch, null, 2));
console.log(`\n${batch.length} email(s) staged → ${path.join("output/pr-weekly", satYmd, "send-batch.json")}`);

let failures = 0;
for (const b of batch) {
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/pr/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ to: [b.to], subject: b.subject, html: b.html, text: b.text }),
  });
  const body = await res.text();
  if (res.ok) console.log(`  sent → ${b.outlet} <${b.to}> (${res.status})`);
  else { failures++; console.error(`  FAILED ${b.outlet} (${res.status}): ${body.slice(0, 200)}`); }
}
process.exit(failures ? 1 : 0);
