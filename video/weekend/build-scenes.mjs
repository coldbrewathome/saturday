#!/usr/bin/env node
// Turn a weekend plan into the ordered, narrated scene list the template renders.
// Exports buildScenes(plan) for the multi-metro builder; also runs as a CLI that
// reads weekend-plan.json → weekend-scenes.json.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { METROS, DEFAULT_THEME } from "./metros.mjs";

const LEADS = {
  festival:  ["Don't miss", "Catch"],
  outdoors:  ["Get outside for", "Spend the day at"],
  museum:    ["Explore", "Wander through"],
  shows:     ["Catch", "Tap into"],
  community: ["Swing by", "Head to"],
  library:   ["Cozy up with", "Drop in for"],
};
function cleanTitle(t) {
  let s = t.split(/ [—–-] | \| /)[0].split(": ")[0].trim();
  if (s.length < 6) s = t;
  return s.length > 52 ? s.slice(0, 51).trimEnd() + "…" : s;
}
function eventVo(e, i) {
  const opts = LEADS[e.bucket] || ["Check out"];
  return `${opts[i % opts.length]} ${cleanTitle(e.title)}${e.free ? ", free" : ""}.`;
}

const EMOJI = { Festival: "🎉", Park: "🌳", Museum: "🏛️", Library: "📚", Zoo: "🦁",
  Farm: "🚜", Music: "🎵", Culture: "🎨", Community: "🎪", Theater: "🎭", Sports: "⚽",
  "Amusement Park": "🎢", Ticketed: "🎟️" };
const PLURAL = { Library: "story-times", Community: "community events", Culture: "culture",
  Music: "music", Sports: "sports", Theater: "theater", Festival: "festivals", Park: "parks",
  Museum: "museums", Zoo: "zoos", Farm: "farms", "Amusement Park": "rides" };

export function buildScenes(plan) {
  const theme = METROS[plan.metroId] || DEFAULT_THEME;
  const topCats = Object.entries(plan.counts.byCategory)
    .sort((a, b) => b[1] - a[1])
    .filter(([c]) => EMOJI[c]).slice(0, 5)
    .map(([c, n]) => ({ emoji: EMOJI[c], n, label: PLURAL[c] || c.toLowerCase() }));

  const scenes = [];
  scenes.push({ id: "open", type: "open", min: 2800, metro: plan.metroLabel, weekend: plan.weekend.label,
    vo: `This weekend in ${plan.metroLabel}.` });
  scenes.push({ id: "hook", type: "hook", min: 3600, metro: plan.metroLabel, nickname: theme.nickname,
    weekend: plan.weekend.label, count: plan.counts.total,
    vo: `${plan.counts.total} things to do with the kids in the ${plan.metroLabel} this weekend.` });
  scenes.push({ id: "free", type: "free", min: 2600, free: plan.counts.free,
    vo: `${plan.counts.free} of them, completely free. Here are a few we love.` });
  plan.events.forEach((e, i) => {
    scenes.push({ id: `event-${i + 1}`, type: "event", min: 3400, index: i + 1,
      emoji: e.emoji, title: e.title, venue: e.venue, city: e.city, whenLabel: e.whenLabel,
      costLabel: e.costLabel, free: e.free, lat: e.lat, lon: e.lon, category: e.category,
      vo: eventVo(e, i) });
  });
  scenes.push({ id: "montage", type: "montage", min: 3800, chips: topCats,
    vo: "Festivals, parks, museums, and story-times — all mapped near you." });
  scenes.push({ id: "outro", type: "outro", min: 4400, metro: plan.metroLabel,
    vo: "Find your weekend, free, at FamHop dot com. New picks every weekend." });

  return {
    metroId: plan.metroId, metroLabel: plan.metroLabel, weekend: plan.weekend, generatedAt: plan.generatedAt,
    meta: { accent: theme.accent, emojis: theme.emojis, nickname: theme.nickname,
      map: theme.map, bbox: plan.bbox, label: plan.metroLabel },
    scenes,
  };
}

// ── CLI ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const plan = JSON.parse(await readFile(join(here, "weekend-plan.json"), "utf8"));
  const out = buildScenes(plan);
  await writeFile(join(here, "weekend-scenes.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote weekend-scenes.json — ${out.scenes.length} scenes`);
  for (const s of out.scenes) console.log(`  [${s.type}] ${s.vo}`);
}
