#!/usr/bin/env node
// Dry-run preview for the weekly newsletter digest.
//   node scripts/newsletter-preview.mjs <metro>
// Renders the metro's HTML + plaintext digest to tmp/ for visual QA.
// No network calls — reads from public/data/<metro>/{featured-plans,events}.json
// and uses the same renderer the worker uses.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
} from "./metroConfig.mjs";

// Node ≥22.6 strips types from imported .ts files; tested on the runtime
// pinned in package.json. The worker has no build step, so we import the
// source module directly to keep one source of truth for the template.
const { renderWeekendDigest } = await import(
  "../worker/src/newsletter-template.ts"
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith("-"));
if (!slug) {
  console.error("usage: node scripts/newsletter-preview.mjs <metro>");
  process.exit(1);
}

const config = loadMetroConfig();
const key = String(slug).replace(/^\/+|\/+$/g, "").toLowerCase();
const metro = config.bySlug.get(key) || config.byId.get(key);
if (!metro) {
  // metroFromSlug() would silently fall back to the default metro — for a
  // preview tool we want a hard error on typos.
  console.error(
    `unknown metro: ${slug}. known: ${config.metros.map((m) => m.id).join(", ")}`,
  );
  process.exit(1);
}

function readJsonOrEmpty(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function metroJson(key, fallback) {
  const primary = path.join(ROOT, metroDataFile(metro, key));
  const doc = readJsonOrEmpty(primary, null);
  if (doc) return doc;
  const legacy = legacyMetroDataFile(metro, key);
  return legacy ? readJsonOrEmpty(path.join(ROOT, legacy), fallback) : fallback;
}

const plansDoc = metroJson("featuredPlans", { plans: [] });
const eventsDoc = metroJson("events", { events: [] });
const plans = Array.isArray(plansDoc?.plans) ? plansDoc.plans : [];
const events = Array.isArray(eventsDoc?.events) ? eventsDoc.events : [];

const digest = renderWeekendDigest({
  metroId: metro.id,
  metroLabel: metro.label || metro.id,
  timezone: metro.timezone || "America/Los_Angeles",
  plans,
  events,
});

const outDir = path.join(ROOT, "tmp");
fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, "newsletter-preview.html");
const textPath = path.join(outDir, "newsletter-preview.txt");
fs.writeFileSync(htmlPath, digest.html);
fs.writeFileSync(textPath, digest.text);

console.log(
  `wrote ${path.relative(ROOT, htmlPath)} and ${path.relative(ROOT, textPath)}`,
);
console.log(
  `  subject: ${digest.subject}`,
);
console.log(
  `  plans:   ${digest.planCount}/${plans.length}    events: ${digest.eventCount}/${events.length}`,
);
