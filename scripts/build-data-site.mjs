#!/usr/bin/env node
// Builds the standalone shared-data Pages project (famhop-data).
//
// Reads the canonical scanned outputs from ./public/data/ and produces a
// minimal static site at ./data-site/dist/ that just serves the JSON +
// CORS headers + a tiny index page. Deploy with:
//
//   npm run deploy:data
//
// The kids and adults frontends fetch from this site's origin (set via
// VITE_DATA_ORIGIN at frontend build time) instead of fetching from each
// app's own domain. That decouples a frontend deploy from the data feed
// and vice versa.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
} from "./metroConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "data");
const OUT = path.join(ROOT, "data-site", "dist");
const metroConfig = loadMetroConfig();

if (!fs.existsSync(SRC)) {
  console.error(`[data-site] no source data at ${SRC}`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

let count = 0;
let bytes = 0;
function copyJsonTree(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyJsonTree(src, dest);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    bytes += fs.statSync(dest).size;
    count += 1;
  }
}
copyJsonTree(SRC, path.join(OUT, "data"));

const headers = `# Cloudflare Pages headers — shared data feed (famhop-data)
#
# CORS is open because every consumer is a public frontend and the data is
# already public. Short browser TTL so a data refresh propagates quickly to
# devices that already have the page open; longer CDN TTL with revalidation
# absorbs traffic spikes while still picking up new ingest output within
# a couple of minutes.
/data/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Cache-Control: public, max-age=30, s-maxage=120, stale-while-revalidate=60

/llms.txt
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600

/
  Cache-Control: public, max-age=120
`;
fs.writeFileSync(path.join(OUT, "_headers"), headers);

const generatedAt = new Date().toISOString();
const metroFileLines = metroConfig.metros
  .flatMap((metro) => [
    `- ${metro.label}: /data/${path.relative(
      path.join("public", "data"),
      metroDataFile(metro, "spots"),
    )} - scanned places.`,
    `- ${metro.label}: /data/${path.relative(
      path.join("public", "data"),
      metroDataFile(metro, "events"),
    )} - time-bounded events.`,
    `- ${metro.label}: /data/${path.relative(
      path.join("public", "data"),
      metroDataFile(metro, "eventReport"),
    )} - event ingest diagnostics.`,
    `- ${metro.label}: /data/${path.relative(
      path.join("public", "data"),
      metroDataFile(metro, "featuredPlans"),
    )} - editor starter plans.`,
  ])
  .join("\n");
const legacyLines = metroConfig.metros
  .flatMap((metro) =>
    ["spots", "events", "eventReport", "featuredPlans", "curatedSpots", "enrichment"]
      .map((key) => legacyMetroDataFile(metro, key))
      .filter(Boolean)
      .map((file) => `- /data/${path.basename(file)} - legacy ${metro.label} feed.`),
  )
  .join("\n");
const endpointLinks = [
  ...metroConfig.metros.flatMap((metro) => [
    path.relative(path.join("public", "data"), metroDataFile(metro, "spots")),
    `${metro.dataDir}/spots-adults.json`,
    path.relative(path.join("public", "data"), metroDataFile(metro, "events")),
    `${metro.dataDir}/events-adults.json`,
    path.relative(path.join("public", "data"), metroDataFile(metro, "featuredPlans")),
  ]),
  "boa-museums.json",
  "llms.txt",
];

const llms = `# FamHop shared data feed

> The scanned, normalized, audience-tagged data that powers the FamHop
> family of apps (kids: famhop.com; adults sibling: TBD). Read here once,
> filter by audience and metro client-side. The scanning pipeline runs in the
> upstream repo (https://github.com/coldbrewathome/saturday).

Generated: ${generatedAt}

## Metro feeds

${metroFileLines}

## Legacy and shared files

${legacyLines}
- /data/boa-museums.json — Bank of America Museums on Us free-day metadata.

All files are served with \`Access-Control-Allow-Origin: *\` so any frontend can fetch them directly.

## Audience tagging

Every place and event carries an \`audiences\` array of one or more of \`"kids"\`, \`"adults"\`, \`"all"\`. Filter to your app's audience on read. Entries lacking the field are legacy data and should be treated as \`"all"\`.
`;
fs.writeFileSync(path.join(OUT, "llms.txt"), llms);

const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>FamHop shared data feed</title>
<style>
:root{--ink:#22221f;--muted:#5b5b54;--brand:#f59e0b;}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#FFF6EE;color:var(--ink);}
.wrap{max-width:680px;margin:0 auto;padding:48px 24px;}
h1{font-size:28px;letter-spacing:-.01em;margin:0 0 8px;}
p{color:var(--muted);}
ul{padding-left:20px;}
code{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:4px;padding:1px 6px;font-size:14px;}
a{color:var(--brand);}
</style>
</head>
<body>
<main class="wrap">
<h1>FamHop shared data feed</h1>
<p>This origin serves scanned and normalized places &amp; events for FamHop metros. The data is public; CORS is open. The user-facing apps live elsewhere — start at <a href="https://famhop.com/">famhop.com</a>.</p>
<h2>Endpoints</h2>
<ul>
${endpointLinks
  .map((file) => {
    const href = file === "llms.txt" ? "/llms.txt" : `/data/${file}`;
    return `<li><code><a href="${href}">${href}</a></code></li>`;
  })
  .join("\n")}
</ul>
<p style="margin-top:32px;font-size:13px;">Generated ${generatedAt}.</p>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, "index.html"), indexHtml);

console.log(
  `[data-site] copied ${count} JSON files (${(bytes / 1024).toFixed(1)} KB) to ${path.relative(ROOT, OUT)}/`,
);
