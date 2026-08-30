import { readFileSync } from "node:fs";
import { extractOfficialTextEvents } from "../scripts/eventPipeline.mjs";
const reg = JSON.parse(readFileSync("data/event-sources.json", "utf8"));
const src = reg.sources.find((s) => s.id === "millbrae-art-wine-fest-2026");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const res = await fetch(src.url, { headers: { "user-agent": UA } });
const html = await res.text();

// Variant A: registry entry as-is
const e0 = src.officialTextEvents[0];
let n = extractOfficialTextEvents(html, src, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("A registry as-is:", n.length);

// Variant B: strip description
const srcB = { ...src, officialTextEvents: [{ ...e0, description: "" }] };
n = extractOfficialTextEvents(html, srcB, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("B no description:", n.length);

// Variant C: no ageBands
const srcC = { ...src, officialTextEvents: [{ ...e0, ageBands: undefined }] };
n = extractOfficialTextEvents(html, srcC, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("C no ageBands:", n.length);

// Variant D: no category on event
const srcD = { ...src, officialTextEvents: [{ ...e0, category: undefined }] };
n = extractOfficialTextEvents(html, srcD, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("D no event category:", n.length);

// Variant E: source without audienceIds
const srcE = { ...src, audienceIds: undefined };
n = extractOfficialTextEvents(html, srcE, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("E no audienceIds:", n.length);

// Variant F: description without 'wine'
const srcF = { ...src, officialTextEvents: [{ ...e0, description: e0.description.replace(/wine /gi, "") }] };
n = extractOfficialTextEvents(html, srcF, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
console.log("F no 'wine' in desc:", n.length);
