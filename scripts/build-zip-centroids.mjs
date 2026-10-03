#!/usr/bin/env node
// ZIP → location table, sliced per metro.
//
// The family profile collects a ZIP but nothing geocodes it, so "near me"
// ranking silently needed the browser's location permission. This writes
// public/data/<metro>/zip-centroids.json — the Census 2020 ZCTA gazetteer
// filtered to each metro's spot bbox — which the app fetches on demand
// (src/zipCentroids.ts). A few hundred entries per metro, ~11 KB for the
// largest, so it rides along with the rest of the feed on famhop-data.
//
//   node scripts/build-zip-centroids.mjs [--source <gazetteer.txt>]
//
// The 6.6 MB gazetteer is not vendored; it is downloaded once into tmp/
// (gitignored) and reused. Pass --source to run fully offline.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMetroConfig } from "./metroConfig.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(ROOT, "public", "data");
const TMP = path.join(ROOT, "tmp");
const GAZETTEER_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip";

function sourceFromArgs(args) {
  const flag = args.findIndex((arg) => arg === "--source");
  if (flag !== -1 && args[flag + 1]) return path.resolve(args[flag + 1]);
  const inline = args.find((arg) => arg.startsWith("--source="));
  return inline ? path.resolve(inline.slice("--source=".length)) : null;
}

async function downloadGazetteer() {
  const zipPath = path.join(TMP, "2020_Gaz_zcta_national.zip");
  if (!fs.existsSync(zipPath)) {
    fs.mkdirSync(TMP, { recursive: true });
    console.log(`[zips] downloading ${GAZETTEER_URL}`);
    const response = await fetch(GAZETTEER_URL);
    if (!response.ok) {
      throw new Error(`gazetteer download failed: ${response.status}`);
    }
    fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  }
  // The archive holds exactly one .txt; `unzip -p` streams it to stdout so
  // nothing is extracted to disk.
  return execFileSync("unzip", ["-p", zipPath, "2020_Gaz_zcta_national.txt"], {
    encoding: "latin1",
    maxBuffer: 64 * 1024 * 1024,
  });
}

// GEOID, ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG
function parseGazetteer(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const cells = line.split("\t");
    if (cells.length < 7) continue;
    const geoid = cells[0].trim();
    if (!/^\d{5}$/.test(geoid)) continue;
    const lat = Number(cells[5]);
    const lon = Number(cells[6]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows.push({ geoid, lat, lon });
  }
  return rows;
}

function inBbox(row, bbox) {
  return (
    row.lat >= bbox.south &&
    row.lat <= bbox.north &&
    row.lon >= bbox.west &&
    row.lon <= bbox.east
  );
}

const args = process.argv.slice(2);
const source = sourceFromArgs(args);
const text = source ? fs.readFileSync(source, "latin1") : await downloadGazetteer();
const rows = parseGazetteer(text);
if (rows.length < 30000) {
  console.error(`[zips] only ${rows.length} ZCTAs parsed — source looks wrong`);
  process.exit(1);
}
console.log(`[zips] ${rows.length} national ZCTAs`);

const config = loadMetroConfig();
let written = 0;
for (const metro of config.metros) {
  const bbox = metro.spotCoverage?.bbox;
  if (!bbox) {
    console.error(`[zips] ${metro.id}: no spotCoverage bbox — skipped`);
    continue;
  }
  const zips = {};
  for (const row of rows) {
    if (!inBbox(row, bbox)) continue;
    // 4 decimals ≈ 11 m — far finer than a ZCTA, and it halves the file.
    zips[row.geoid] = [Number(row.lat.toFixed(4)), Number(row.lon.toFixed(4))];
  }
  const metroId = metro.dataDir || metro.id;
  const file = path.join(OUT_ROOT, metroId, "zip-centroids.json");
  if (!fs.existsSync(path.dirname(file))) {
    console.error(`[zips] ${metro.id}: no data dir at ${path.dirname(file)} — skipped`);
    continue;
  }
  const doc = {
    schemaVersion: 1,
    metroId: metro.id,
    source: "Census 2020 ZCTA gazetteer (INTPTLAT/INTPTLONG)",
    generatedAt: new Date().toISOString(),
    zips,
  };
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 0)}\n`);
  written += 1;
  console.log(`[zips] ${metro.id}: ${Object.keys(zips).length} ZIPs → ${path.relative(ROOT, file)}`);
}
console.log(`[zips] wrote ${written} metro tables`);
