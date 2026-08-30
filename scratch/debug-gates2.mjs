import { readFileSync } from "node:fs";
import { extractOfficialTextEvents } from "../scripts/eventPipeline.mjs";

const reg = JSON.parse(readFileSync("data/event-sources.json", "utf8"));
const src = reg.sources.find((s) => s.id === "millbrae-art-wine-fest-2026");
console.log("source:", JSON.stringify({ id: src.id, events: src.officialTextEvents.length, e0: src.officialTextEvents[0].requiredText, sd: src.officialTextEvents[0].startDateTime }));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const res = await fetch(src.url, { headers: { "user-agent": UA } });
const html = await res.text();
const events = extractOfficialTextEvents(html, src, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("extracted:", events.length, events.map((e) => e.startDateTime));
