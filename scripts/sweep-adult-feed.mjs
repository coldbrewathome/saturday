#!/usr/bin/env node
// One-off sweep: apply the adult-feed gate (scripts/lib/adultAudience.mjs) to
// every existing public/data/*/events-adults.json. Removal-only, no network —
// kids-venue programs, virtual/Zoom events, university-admin noise, and
// audiences:["all"] events without adult-positive signals are dropped. Adult
// feeds are expected to shrink drastically; that is honest.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadMetroConfig, metroDataFile } from "./metroConfig.mjs";
import { qualifiesForAdultFeed } from "./lib/adultAudience.mjs";

const metroConfig = loadMetroConfig();

let totalBefore = 0;
let totalAfter = 0;
for (const metro of metroConfig.metros) {
  const filePath = path.join(ROOT, metroDataFile(metro, "events")).replace(/events\.json$/, "events-adults.json");
  if (!fs.existsSync(filePath)) continue;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const events = Array.isArray(doc.events) ? doc.events : [];
  const kept = events.filter(qualifiesForAdultFeed);
  totalBefore += events.length;
  totalAfter += kept.length;
  if (kept.length !== events.length) {
    doc.events = kept;
    if (typeof doc.count === "number") doc.count = kept.length;
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  }
  console.log(`[${metro.id}] events-adults: ${events.length} -> ${kept.length} (removed ${events.length - kept.length})`);
}
console.log(`Adult-feed sweep: ${totalBefore} -> ${totalAfter} events across all metros.`);
