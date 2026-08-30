import { extractOfficialTextEvents } from "../scripts/eventPipeline.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const configs = [
  { url: "https://www.millbraechamber.com/artwinefestival2026", id: "millbrae", name: "Millbrae Art & Wine Festival", city: "Millbrae", officialTextEvents: [{ id: "t", title: "Millbrae Art & Wine Festival (55th)", venue: "Broadway", neighborhood: "Millbrae", startDateTime: "2026-09-05T10:00:00-07:00", endDateTime: "2026-09-05T17:00:00-07:00", ageBands: ["school-age"], cost: "Free", category: "Festival", requiredText: ["Art & Wine Festival", "September 5"] }] },
  { url: "https://fiestahermosa.net/", id: "fiesta", name: "Fiesta Hermosa", city: "Hermosa Beach", officialTextEvents: [{ id: "t", title: "Fiesta Hermosa", venue: "Downtown Hermosa Beach", neighborhood: "Hermosa Beach", startDateTime: "2026-09-05T11:00:00-07:00", endDateTime: "2026-09-05T19:00:00-07:00", ageBands: ["school-age"], cost: "Free", category: "Festival", requiredText: ["Fiesta Hermosa", "September 5"] }] },
];
for (const cfg of configs) {
  const res = await fetch(cfg.url, { headers: { "user-agent": UA } });
  const html = await res.text();
  console.log("=== ", cfg.id, "http", res.status, "bytes", html.length);
  const events = extractOfficialTextEvents(html, cfg, { now: new Date("2026-08-30T12:00:00Z"), windowDays: 45 });
  console.log("  extracted:", events.length, events.map((e) => e.startDateTime).slice(0, 4));
}
