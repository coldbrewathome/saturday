#!/usr/bin/env node
// Emit a per-metro YouTube upload sheet from the built manifest, so the
// description can never drift from what the video actually shows.
//
//   node videos/build-shorts-metadata.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PICKS = JSON.parse(readFileSync(join(HERE, "weekend-picks.json"), "utf8"));
const SHORTS_DIR = "shorts-" + PICKS.weekend.saturday;
const M = JSON.parse(readFileSync(join(HERE, SHORTS_DIR, "manifest.json"), "utf8"));
const FILE_TAG = "aug" + Number(PICKS.weekend.saturday.slice(8));

const SEARCH_TERMS = {
  "bay-area": ["things to do with kids bay area", "free things to do san francisco", "bay area events this weekend", "san francisco with kids", "oakland with kids"],
  "los-angeles": ["things to do with kids los angeles", "free things to do la", "la events this weekend", "los angeles with kids", "socal family activities"],
  "san-diego": ["things to do with kids san diego", "free things to do san diego", "san diego events this weekend", "balboa park with kids", "san diego family activities"],
  "seattle": ["things to do with kids seattle", "free things to do seattle", "seattle events this weekend", "seattle with kids", "bellevue family activities"],
  "phoenix": ["things to do with kids phoenix", "free things to do phoenix", "phoenix events this weekend", "phoenix with kids", "arizona family activities"],
  "chicago": ["things to do with kids chicago", "free things to do chicago", "chicago events this weekend", "chicago with kids", "forest preserve programs"],
  "houston": ["things to do with kids houston", "free things to do houston", "houston events this weekend", "houston with kids", "texas family activities"],
  "dallas-fort-worth": ["things to do with kids dallas", "free things to do dfw", "dallas events this week", "fort worth with kids", "plano family activities"],
  "austin": ["things to do with kids austin", "free things to do austin", "austin events this week", "zilker park with kids", "austin family activities"],
  "new-york-city": ["free things to do nyc with kids", "nyc with kids", "things to do in new york this weekend", "prospect park with kids", "free nyc events"],
  "washington-dc": ["things to do with kids dc", "free things to do washington dc", "dc events this weekend", "northern virginia with kids", "dmv family activities"],
  "philadelphia": ["things to do with kids philadelphia", "free things to do philly", "philadelphia events this weekend", "philly with kids", "bucks county family activities"],
  "boston": ["things to do with kids boston", "free things to do boston", "boston events this weekend", "boston with kids", "salem massachusetts family"],
  "atlanta": ["things to do with kids atlanta", "free things to do atlanta", "atlanta events this weekend", "atlanta with kids", "marietta family activities"],
  "miami": ["things to do with kids miami", "free things to do miami", "miami events this weekend", "miami beach with kids", "south florida family activities"],
  "honolulu": ["things to do with kids honolulu", "free things to do oahu", "honolulu events this week", "oahu with kids", "hawaii family activities"],
};

const HASHTAG = {
  "bay-area": "#bayarea #sanfrancisco", "los-angeles": "#losangeles #la", "san-diego": "#sandiego",
  "seattle": "#seattle", "phoenix": "#phoenix", "chicago": "#chicago", "houston": "#houston",
  "dallas-fort-worth": "#dallas #fortworth", "austin": "#austin", "new-york-city": "#nyc #newyork",
  "washington-dc": "#washingtondc #dmv", "philadelphia": "#philly #philadelphia", "boston": "#boston",
  "atlanta": "#atlanta #atl", "miami": "#miami", "honolulu": "#honolulu #oahu",
};

const out = [];
out.push(`# FamHop metro Shorts — weekend of Sat ${M.weekend.saturday} / Sun ${M.weekend.sunday}`);
out.push("");
out.push(`Files: \`videos/delivery-${PICKS.weekend.saturday}/famhop-<metro>-${FILE_TAG}.mp4\` · 1080×1920 · H.264 · 30fps.`);
out.push(`Sources: \`videos/${SHORTS_DIR}/<metro>/\` — rebuild any of them with`);
out.push("`node videos/pick-weekend-events.mjs && node videos/build-metro-shorts.mjs`.");
out.push("");
const sunday = new Date(M.weekend.sunday + "T12:00:00Z");
const expiry = `Sun ${sunday.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${sunday.getUTCDate()}, ${sunday.getUTCFullYear()}`;
out.push(`**Every cut expires ${expiry}.** The cards name dated events and the closing`);
out.push("stat is a one-week count. Re-cut weekly; do not leave these up.");
out.push("");
out.push("Each cut shows five picks, then proves it is showing a fraction: a dot per");
out.push("event in that metro this week with the five you just saw lit, a real filter");
out.push("cascade, and the address. The description lists every pick, including the ones");
out.push("the video did not show.");
out.push("");
out.push("## Shared form settings (identical for all 16)");
out.push("");
out.push("| Field | Value |");
out.push("|---|---|");
out.push("| Visibility | Public |");
out.push("| Category | Travel & Events |");
out.push("| Audience | **Not made for kids** — the audience is parents. |");
out.push("| Altered content | No |");
out.push("| Language | English |");
out.push("| Comments | On, sort by top |");
out.push("| Thumbnail | Shorts pick a frame — use the closing famhop.com card (~last 3s) |");
out.push("| Playlist | This Weekend With Kids |");
out.push("");

for (const m of M.metros) {
  const the = m.name === "Bay Area" ? "the " : "";
  const win = m.window === "weekend" ? "this weekend" : "this week";
  const Win = m.window === "weekend" ? "This weekend" : "This week";
  const url = `https://famhop.com/${m.id}/this-weekend`;
  const title = m.allFree
    ? `${m.cards} FREE things to do with kids in ${the}${m.name} ${win}`
    : `${m.cards} things to do with kids in ${the}${m.name} ${win}`;

  out.push("---");
  out.push("");
  out.push(`## ${m.name} — \`famhop-${m.id}-${FILE_TAG}.mp4\` (${m.duration}s, ${m.cards} cards${m.allFree ? ", all free" : `, ${m.freeCards}/${m.cards} free`})`);
  out.push("");
  out.push(`**Title (${title.length} chars)**`);
  out.push("```");
  out.push(title);
  out.push("```");
  out.push("");
  out.push("**Description**");
  out.push("```");
  out.push(`${Win} in ${the}${m.name}, from the venues' own calendars. All ${m.weekTotal} of them: ${url}`);
  out.push("");
  // The video shows five; the description lists every pick, so clicking through
  // over-delivers instead of repeating.
  for (const [i, p] of m.picks.entries()) {
    const days = p.days.split(" + ");
    const day = days.length > 3 ? `${days[0]}–${days[days.length - 1]}` : days.join(" + ");
    const mark = i < m.cards ? String(i + 1).padStart(2, "0") : "+ ";
    out.push(`${mark} · ${p.title} — ${p.venue}, ${p.city} — ${day} ${p.time} — ${p.cost}${p.ages ? ` — ${p.ages}` : ""}`);
  }
  out.push("");
  // Only quote the deep filter count where it is actually a selling number;
  // a metro on the plan payoff would be quoting "1", which sells nothing.
  const c = m.cascade;
  out.push(m.payoff === "filter"
    ? `${m.name} this week: ${c[0].n} family events · ${c[1].n} free · ${c[3].n} free ${c[2].chip.toLowerCase()} mornings.`
    : `${m.name} this week: ${c[0].n} family events, ${c[1].n} of them free.`);
  out.push(`Filter by age, cost and time of day, then turn what you pick into one mapped day.`);
  out.push(`Free to use across 16 U.S. metros: https://famhop.com`);
  out.push(`Or get 5 picks by email every Friday morning, free.`);
  out.push("");
  out.push(`${HASHTAG[m.id]} #thingstodowithkids #familyactivities`);
  out.push("```");
  out.push("");
  out.push("**Tags**");
  out.push("```");
  out.push([...SEARCH_TERMS[m.id], "family events near me", "famhop"].join(", "));
  out.push("```");
  out.push("");
  out.push("**Pinned comment**");
  out.push("```");
  out.push(`These ${m.cards} come straight from the venues' own calendars — and they're ${m.cards} of ${m.weekTotal} on this week. The rest, filterable by your kid's age: ${url}`);
  out.push("```");
  out.push("");
}

writeFileSync(join(HERE, SHORTS_DIR, "YOUTUBE-METADATA.md"), out.join("\n"));
console.log(`wrote videos/${SHORTS_DIR}/YOUTUBE-METADATA.md`);
