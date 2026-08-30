import { readFileSync } from "node:fs";
import { extractOfficialTextEvents } from "../scripts/eventPipeline.mjs";
const reg = JSON.parse(readFileSync("data/event-sources.json", "utf8"));
const src = reg.sources.find((s) => s.id === "millbrae-art-wine-fest-2026");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const res = await fetch(src.url, { headers: { "user-agent": UA } });
const html = await res.text();
const e0 = src.officialTextEvents[0];
const variants = [
  ["no 'beer'", e0.description.replace(/beer /gi, "")],
  ["no 'wine and beer'", e0.description.replace(/wine and beer /gi, "")],
  ["no 'wine' or 'beer'", e0.description.replace(/wine /gi, "").replace(/beer /gi, "")],
  ["short desc", "Annual art and wine festival in downtown Millbrae with food trucks and kids' activities."],
];
for (const [label, desc] of variants) {
  const n = extractOfficialTextEvents(html, { ...src, officialTextEvents: [{ ...e0, description: desc }] }, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
  console.log(label, "->", n.length);
}
