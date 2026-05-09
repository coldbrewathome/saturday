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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "data");
const OUT = path.join(ROOT, "data-site", "dist");

if (!fs.existsSync(SRC)) {
  console.error(`[data-site] no source data at ${SRC}`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

let count = 0;
let bytes = 0;
for (const file of fs.readdirSync(SRC)) {
  if (!file.endsWith(".json")) continue;
  const dest = path.join(OUT, "data", file);
  fs.copyFileSync(path.join(SRC, file), dest);
  bytes += fs.statSync(dest).size;
  count += 1;
}

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

const llms = `# FamHop shared data feed

> The scanned, normalized, audience-tagged data that powers the FamHop
> family of apps (kids: famhop.com; adults sibling: TBD). Read here once,
> filter by audience client-side. The scanning pipeline runs in the
> upstream repo (https://github.com/coldbrewathome/saturday).

Generated: ${generatedAt}

## Available files

- /data/bay-area-spots.json — 1500+ Bay Area places (parks, libraries, museums, family venues). Each entry carries an \`audiences\` array (\`"kids"\`, \`"adults"\`, or \`"all"\`).
- /data/events.json — Time-bounded events (storytimes, festivals, free days, etc.) tagged by audience.
- /data/event-build-report.json — Per-source diagnostics from the most recent event ingest (live vs. fallback counts, fetch errors).
- /data/curated-spots.json — Hand-picked entries that augment the OSM dataset.
- /data/featured-plans.json — Editor's-pick starter plans.
- /data/boa-museums.json — Bank of America Museums on Us free-day metadata.
- /data/bay-area-enrichment.json — Per-spot Google rating overlay.

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
<p>This origin serves the scanned and normalized Bay Area places &amp; events used by the FamHop family of apps. The data is public; CORS is open. The user-facing apps live elsewhere — start at <a href="https://famhop.com/">famhop.com</a>.</p>
<h2>Endpoints</h2>
<ul>
<li><code><a href="/data/bay-area-spots.json">/data/bay-area-spots.json</a></code></li>
<li><code><a href="/data/events.json">/data/events.json</a></code></li>
<li><code><a href="/data/event-build-report.json">/data/event-build-report.json</a></code></li>
<li><code><a href="/data/curated-spots.json">/data/curated-spots.json</a></code></li>
<li><code><a href="/data/featured-plans.json">/data/featured-plans.json</a></code></li>
<li><code><a href="/data/boa-museums.json">/data/boa-museums.json</a></code></li>
<li><code><a href="/data/bay-area-enrichment.json">/data/bay-area-enrichment.json</a></code></li>
<li><code><a href="/llms.txt">/llms.txt</a></code> — feed manifest for AI crawlers</li>
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
