// Generates the per-metro weekend highlight posters (1080x1350 PNG) from each
// metro's published kids event feed, using the metro's theme in
// weekend-poster-themes.mjs. Output: public/weekend-posters/<metro>.png plus
// manifest.json recording which weekend each poster covers — the SEO generator
// only embeds a poster whose weekend matches the page it is rendering, so a
// stale poster silently drops off instead of showing wrong dates.
//
// Usage: node scripts/generate-weekend-posters.mjs [--metro=<slug>]

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, loadMetroConfig, metroDataFile } from "./metroConfig.mjs";
import { POSTER_THEMES, POSTER_W, POSTER_H, buildPosterHtml } from "./weekend-poster-themes.mjs";

const OUT_DIR = path.join(ROOT, "public", "weekend-posters");

// --- weekend window (mirrors generate-seo-pages.mjs so page + poster agree) ---

function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

function zonedTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const hour = Number(get("hour"));
  return { hour: hour === 24 ? 0 : hour, minute: Number(get("minute")) };
}

function weekdayNumber(shortName) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(String(shortName || "").slice(0, 3).toLowerCase());
}

function addDaysToYmd(ymd, days) {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const ymdKey = (ymd) => `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
const zonedDateKey = (date, tz) => ymdKey(zonedDateParts(date, tz));

function getWeekend(now, timeZone) {
  const todayParts = zonedDateParts(now, timeZone);
  const dow = weekdayNumber(todayParts.weekday);
  const daysToSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
  const saturday = addDaysToYmd(todayParts, daysToSat);
  const sunday = addDaysToYmd(saturday, 1);
  return { saturday, sunday, saturdayKey: ymdKey(saturday), sundayKey: ymdKey(sunday) };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function dateChips(weekend) {
  const { saturday: sa, sunday: su } = weekend;
  const short = sa.month === su.month
    ? `${MONTHS[sa.month - 1]} ${sa.day}–${su.day}`
    : `${MONTHS[sa.month - 1]} ${sa.day}–${MONTHS[su.month - 1]} ${su.day}`;
  const long = `SAT ${MONTHS[sa.month - 1]} ${sa.day} + SUN ${MONTHS[su.month - 1]} ${su.day}`;
  return { short, long };
}

// --- highlight selection ---

const FREE_RE = /free/i;

function likelyFree(event) {
  if (typeof event.cost === "string" && FREE_RE.test(event.cost)) return true;
  if (typeof event.cost === "string" && event.cost !== "Unknown" && event.cost.trim()) return false;
  return event.category === "Library";
}

function costBadge(event) {
  if (likelyFree(event)) return "FREE";
  const cost = typeof event.cost === "string" ? event.cost : "";
  if (/^\$+$/.test(cost.trim())) return null;
  const m = cost.match(/\$\s*(\d+)/);
  if (m) return `from $${m[1]}`;
  return null;
}

const GENERIC_RE = /storytime|story time|book sale|summer reading|open house|drop-in|challenge|volunteer|registration required/i;
const CLOSURE_RE = /\b(closed|closure|cancel{1,2}ed|cancelation|cancellation)\b/i;
// Civic-utility listings that are technically in the feed but are never a
// "weekend highlight" (LA surfaced a household-hazardous-waste drop-off).
const UTILITY_RE = /hazard|hazarous|waste|recycl|shred|blood drive|vaccin|job fair|hiring|census/i;

const CATEGORY_SCORE = {
  Festival: 3, Zoo: 2, Museum: 2, Culture: 2, Music: 2, Theater: 2,
  Park: 1, Outdoors: 1, Community: 1, Market: 1, Farm: 1, Ticketed: 1, Library: -1,
};

// Date-only feeds stamp midnight UTC; treat those as untimed.
function isDateOnly(event) {
  return /T00:00(:00(\.000)?)?Z$/.test(event.startDateTime || "");
}

function scoreEvent(event, tz) {
  const title = event.title || "";
  let score = 0;
  if (/parade|firework|drone show/i.test(title)) score += 4;
  if (/\bfair\b|festival|celebration|carnival|street fest|block party/i.test(title)) score += 3;
  score += CATEGORY_SCORE[event.category] ?? 0;
  if (likelyFree(event)) score += 1.5;
  const t = zonedTimeParts(new Date(event.startDateTime), tz);
  if (!isDateOnly(event) && (t.hour !== 0 || t.minute !== 0)) score += 1.5;
  if (GENERIC_RE.test(title)) score -= 3;
  if (title.length < 8 || title.length > 90) score -= 1;
  return score;
}

function titleKey(title) {
  return String(title || "").split(/[—:|·(]/)[0].trim().toLowerCase();
}

const TRAILING_STOPWORDS_RE = /(\s+(at|the|of|in|for|on|and|&|to|a|an|with)|[\s,:;·\-–—+])+$/i;
const LEADING_JUNK_RE = /^[\s\-–—·:;,]+/;
// "Sunday Jul 26"-style segments: some feeds prefix the event title with its
// date, which reads as nonsense on a poster.
const PURE_DATE_RE = /^(sun|mon|tues|wednes|thurs|fri|satur)day,?\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s*\d{0,2})?$/i;

function titleSegments(title) {
  return String(title || "").replace(LEADING_JUNK_RE, "").trim()
    .split(/\s[–—-]\s|\s\(|:|\|/).map((s) => s.trim()).filter(Boolean);
}

function bestSegment(title) {
  const segs = titleSegments(title);
  return segs.find((s) => !PURE_DATE_RE.test(s)) || segs[0] || "";
}

// Drop " - Venue Plaza"- and ": subtitle"-style suffixes (skipping pure-date
// segments), then hard-cap at a word boundary so poster slots never overflow
// their fixed boxes. No ellipsis: a clean short name reads better than a stump.
function displayTitle(title, cap) {
  let t = String(title || "").replace(LEADING_JUNK_RE, "").trim();
  if (t.length > cap || PURE_DATE_RE.test(titleSegments(t)[0] || "")) {
    const head = bestSegment(t);
    if (head.length >= 10) t = head;
  }
  if (t.length > cap) t = t.slice(0, cap).replace(/\s+\S*$/, "");
  return t.replace(TRAILING_STOPWORDS_RE, "");
}

// A title "fits cleanly" if capping it required no mid-title word cut.
function cleanTitle(title, cap) {
  const t = displayTitle(title, cap);
  const full = String(title || "").replace(LEADING_JUNK_RE, "").trim();
  const head = bestSegment(full).replace(TRAILING_STOPWORDS_RE, "");
  return t === head || t === full ? t : null;
}

const VENUE_JUNK_RE = /^(event location|tbd\b|various|multiple locations|see description)/i;

function venueShort(event, cap = 34) {
  const raw = String(event.venue || "");
  if (VENUE_JUNK_RE.test(raw.trim())) return "";
  let v = raw.split(/,|\.|\s - |\s\(/)[0].trim();
  if (v.length > cap) v = v.slice(0, cap).replace(/\s+\S*$/, "");
  return v.replace(TRAILING_STOPWORDS_RE, "");
}

function timeLabel(event, tz) {
  if (isDateOnly(event)) return "All day";
  const t = zonedTimeParts(new Date(event.startDateTime), tz);
  if (t.hour === 0 && t.minute === 0) return "All day";
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const mm = t.minute ? `:${String(t.minute).padStart(2, "0")}` : ":00";
  return `${h12}${mm} ${t.hour < 12 ? "AM" : "PM"}`;
}

function eventDay(event, weekend, tz) {
  const startKey = zonedDateKey(new Date(event.startDateTime), tz);
  let spansBoth = false;
  if (event.endDateTime) {
    const endKey = zonedDateKey(new Date(event.endDateTime), tz);
    spansBoth = startKey <= weekend.saturdayKey && endKey >= weekend.sundayKey;
  }
  if (spansBoth) return "both";
  return startKey === weekend.sundayKey ? "sun" : "sat";
}

function pickHighlights(events, weekend, tz) {
  const seen = new Set();
  const deduped = [];
  for (const e of events) {
    if (!e.startDateTime || !e.title) continue;
    if (CLOSURE_RE.test(e.title)) continue;
    // Some feeds emit records whose whole title is just the date.
    if (PURE_DATE_RE.test(String(e.title).trim())) continue;
    const startKey = zonedDateKey(new Date(e.startDateTime), tz);
    if (startKey !== weekend.saturdayKey && startKey !== weekend.sundayKey) continue;
    const key = `${titleKey(e.title)}|${(e.venue || "").toLowerCase().slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  const ranked = deduped
    .filter((e) => !UTILITY_RE.test(e.title || ""))
    .map((e) => ({ e, score: scoreEvent(e, tz) }))
    .sort((a, b) => b.score - a.score);

  // "Clute - Toddler Movers & Shakers" vs "Manvel - ..." are the same program
  // at different branches; the shared tail is the real identity.
  const tailKey = (title) => {
    const tail = String(title || "").split(/\s[–—-]\s/).pop().trim().toLowerCase();
    return tail.length >= 8 ? tail : null;
  };

  // Progressive diversity caps: strict city/category spread first, then relax
  // so single-city metros (Philly, DC) still fill all their slots.
  const picked = [];
  const titles = new Set();
  const tails = new Set();
  const TARGET = 12;
  for (const [cityCap, catCap] of [[2, 2], [3, 3], [99, 99]]) {
    const cityCount = new Map();
    const catCount = new Map();
    for (const prev of picked) {
      const c = (prev.city || prev.neighborhood || "").toLowerCase();
      cityCount.set(c, (cityCount.get(c) || 0) + 1);
      catCount.set(prev.category || "Other", (catCount.get(prev.category || "Other") || 0) + 1);
    }
    for (const { e } of ranked) {
      if (picked.length >= TARGET) break;
      const city = (e.city || e.neighborhood || "").toLowerCase();
      const cat = e.category || "Other";
      const tKey = titleKey(e.title);
      const tlKey = tailKey(e.title);
      if (titles.has(tKey) || (tlKey && tails.has(tlKey))) continue;
      if ((cityCount.get(city) || 0) >= cityCap) continue;
      if ((catCount.get(cat) || 0) >= catCap) continue;
      picked.push(e);
      titles.add(tKey);
      if (tlKey) tails.add(tlKey);
      cityCount.set(city, (cityCount.get(city) || 0) + 1);
      catCount.set(cat, (catCount.get(cat) || 0) + 1);
    }
    if (picked.length >= TARGET) break;
  }

  // Keep the poster from reading all-Saturday: if Sunday exists in the pool,
  // guarantee at least two Sunday-only picks among the first six ("both"-day
  // spans don't count — the bill layout files those under Saturday).
  const isSunday = (e) => eventDay(e, weekend, tz) === "sun";
  const sundayPicked = picked.slice(0, 6).filter(isSunday).length;
  if (sundayPicked < 2) {
    const spare = ranked
      .map(({ e }) => e)
      .filter((e) => isSunday(e) && !picked.includes(e) && !GENERIC_RE.test(e.title || "")
        && !titles.has(titleKey(e.title)) && !(tailKey(e.title) && tails.has(tailKey(e.title))));
    for (let need = Math.min(2 - sundayPicked, spare.length); need > 0; need--) {
      const idx = picked.slice(0, 6).map((e, i) => i).reverse().find((i) => !isSunday(picked[i]));
      if (idx === undefined) break;
      const inserted = spare.shift();
      picked.splice(idx, 1, inserted);
      titles.add(titleKey(inserted.title));
    }
  }
  return { picked, weekendCount: deduped.length, freeCount: deduped.filter(likelyFree).length };
}

// --- per-layout data assembly ---

const DAY_LABEL = { sat: "SAT", sun: "SUN", both: "SAT+SUN" };
const DAY_LABEL_CIRCLE = { sat: "SAT", sun: "SUN", both: "S+S" };

function stickersData(theme, metro, weekend, tz, picked, weekendCount, freeCount) {
  const cards = picked.slice(0, 6).map((e) => {
    const dayKey = eventDay(e, weekend, tz);
    const venue = venueShort(e);
    const city = e.city || e.neighborhood || "";
    const where = venue && city && !venue.toLowerCase().includes(city.toLowerCase())
      ? `${venue}, ${city}` : venue || city;
    return {
      dayKey,
      dayLabel: (theme.dayShape === "circle" ? DAY_LABEL_CIRCLE : DAY_LABEL)[dayKey],
      time: timeLabel(e, tz),
      title: displayTitle(e.title, 56),
      where,
      badge: costBadge(e),
    };
  });
  const extra = weekendCount - cards.length;
  return {
    dateChipShort: dateChips(weekend).short,
    count: weekendCount,
    subTail: `across ${theme.placeShort || metro.label} — grab these first`,
    footerLeft: extra > 0 ? `+ ${extra} more family picks inside` : "every pick from official sources",
    cards,
  };
}

function billData(theme, metro, weekend, tz, picked, weekendCount, freeCount) {
  const byDay = { sat: [], sun: [] };
  for (const e of picked) {
    const d = eventDay(e, weekend, tz);
    byDay[d === "both" ? "sat" : d].push(e);
  }
  const days = [];
  for (const key of ["sat", "sun"]) {
    const list = byDay[key];
    if (!list.length) continue;
    // Headliner: best-scored event whose title fits the big slot without a
    // mid-title cut, checked among the day's top three; else fall back.
    const headIdx = Math.max(0, list.slice(0, 3).findIndex((e) => cleanTitle(e.title, 26)));
    const head = list[headIdx];
    const rest = list.filter((_, i) => i !== headIdx);
    const undercard = [];
    const noteEvents = [];
    for (const e of rest) {
      const clean = cleanTitle(e.title, 26);
      if (clean && undercard.length < 4) undercard.push(clean);
      else if (noteEvents.length < 2) {
        const t = cleanTitle(e.title, 34);
        if (t) noteEvents.push(t.toLowerCase());
      }
    }
    days.push({
      key,
      label: key === "sat" ? "SATURDAY" : "SUNDAY",
      headliner: {
        title: displayTitle(head.title, 26),
        free: likelyFree(head),
        venueLine: [venueShort(head, 30), head.city || head.neighborhood || "", timeLabel(head, tz)]
          .filter(Boolean).join(" · ").slice(0, 60),
      },
      undercard,
      note: noteEvents.length ? noteEvents.join(" · ") : null,
    });
  }
  const freeShare = weekendCount ? freeCount / weekendCount : 0;
  return {
    dateChipLong: dateChips(weekend).long,
    cityLine: (theme.cityLine || metro.label).toUpperCase(),
    count: weekendCount,
    tagLine: freeShare >= 0.7 ? "almost everything is FREE" : `${freeCount} of them FREE`,
    days,
  };
}

// --- main ---

async function main() {
  const metroArg = process.argv.find((a) => a.startsWith("--metro="))?.slice("--metro=".length);
  const config = loadMetroConfig();
  const metros = config.metros.filter((m) => !metroArg || m.id === metroArg);
  if (!metros.length) throw new Error(`No metro matches --metro=${metroArg}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: POSTER_W, height: POSTER_H } });

  const manifest = { generatedAt: new Date().toISOString(), posters: {} };
  for (const metro of metros) {
    const theme = POSTER_THEMES[metro.id];
    if (!theme) { console.log(`[posters] ${metro.id}: no theme, skipping`); continue; }
    const tz = metro.timezone || "America/Los_Angeles";
    const dataPath = path.join(ROOT, metroDataFile(metro, "events"));
    if (!fs.existsSync(dataPath)) { console.log(`[posters] ${metro.id}: no events feed, skipping`); continue; }
    const doc = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const events = Array.isArray(doc) ? doc : doc.events || [];
    const weekend = getWeekend(new Date(), tz);
    const { picked, weekendCount, freeCount } = pickHighlights(events, weekend, tz);
    const minimum = theme.layout === "bill" ? 3 : 4;
    if (picked.length < minimum) {
      console.log(`[posters] ${metro.id}: only ${picked.length} highlights for ${weekend.saturdayKey}, skipping`);
      continue;
    }

    const data = theme.layout === "bill"
      ? billData(theme, metro, weekend, tz, picked, weekendCount, freeCount)
      : stickersData(theme, metro, weekend, tz, picked, weekendCount, freeCount);
    const html = buildPosterHtml(theme, data);

    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const file = `${metro.id}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file) });
    manifest.posters[metro.id] = { file, saturdayKey: weekend.saturdayKey, sundayKey: weekend.sundayKey, count: weekendCount };
    console.log(`[posters] ${metro.id}: ${weekendCount} weekend events → ${file}`);
  }

  await browser.close();

  // Full runs own the manifest and prune stale files; single-metro runs merge
  // into the existing manifest so other metros' entries survive.
  if (metroArg) {
    const manifestPath = path.join(OUT_DIR, "manifest.json");
    const existing = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      : { posters: {} };
    manifest.posters = { ...existing.posters, ...manifest.posters };
  } else {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.endsWith(".png") && !manifest.posters[f.replace(/\.png$/, "")]) {
        fs.unlinkSync(path.join(OUT_DIR, f));
        console.log(`[posters] pruned stale ${f}`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[posters] wrote ${Object.keys(manifest.posters).length} posters to public/weekend-posters/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
