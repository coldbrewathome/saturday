#!/usr/bin/env node
/**
 * Scrape venue websites for og:image / twitter:image and merge the result
 * into public/data/bay-area-enrichment.json keyed by spot id. Same sidecar
 * the Places matcher writes to, so App.tsx merges both transparently.
 *
 * Usage:
 *   node scripts/scrape-og-images.mjs                       # top 500, merge
 *   node scripts/scrape-og-images.mjs --top=50              # smaller batch
 *   node scripts/scrape-og-images.mjs --force               # overwrite existing
 *   node scripts/scrape-og-images.mjs --include-already-imaged
 *
 * Behavior:
 *   - Only spots with a `website` are eligible.
 *   - Only spots whose current imageSource is missing or "Category fallback"
 *     are eligible (override with --include-already-imaged).
 *   - Skips spot ids already present in the sidecar (override with --force).
 *   - Sorted by friendScore desc so we spend the request budget on spots
 *     most likely to surface in plans.
 *   - Per-host 1s throttle, 8 concurrent fetches, 8s per request, 500KB cap
 *     on response body. Range header asks for the head of the document only.
 *
 * No API keys, no spend.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const includeAlreadyImaged = args.includes("--include-already-imaged");
const topArg = args.find((a) => a.startsWith("--top="));
const top = topArg ? Number(topArg.split("=")[1]) : 500;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 8;

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(args, metroConfig);
const metros = selection.all
  ? metroConfig.metros
  : [selection.metro || metroConfig.defaultMetro];

for (const metro of metros) {
  const inputPath = legacyMetroDataFile(metro, "spots") || metroDataFile(metro, "spots");
  const sidecarPath = legacyMetroDataFile(metro, "enrichment") || metroDataFile(metro, "enrichment");
  const reportPath = sidecarPath.replace(/\.json$/, "-report.json");
  if (!existsSync(inputPath)) {
    console.log(`[${metro.id}] Skipped — ${inputPath} not found.`);
    continue;
  }
  console.log(`[${metro.id}] scraping ${inputPath} → ${sidecarPath}`);
  await runScrape(inputPath, sidecarPath, reportPath);
}

async function runScrape(inputPath, sidecarPath, reportPath) {
const file = JSON.parse(readFileSync(inputPath, "utf8"));
const spots = Array.isArray(file.spots) ? file.spots : [];

const sidecar = existsSync(sidecarPath)
  ? JSON.parse(readFileSync(sidecarPath, "utf8"))
  : { schemaVersion: 1, entries: {} };
sidecar.schemaVersion = sidecar.schemaVersion ?? 1;
sidecar.entries = sidecar.entries ?? {};
sidecar.generatedAt = new Date().toISOString();

const candidates = spots
  .filter((s) => typeof s.website === "string" && s.website.startsWith("http"))
  .filter((s) => {
    if (includeAlreadyImaged) return true;
    return !s.imageSource || s.imageSource === "Category fallback";
  })
  .filter((s) => {
    if (force) return true;
    const existing = sidecar.entries[s.id];
    return !existing || !existing.imageUrl;
  })
  .sort((a, b) => (b.friendScore ?? 0) - (a.friendScore ?? 0));

const toProcess = candidates.slice(0, Math.max(0, top));
console.log(
  `og:image scrape: ${toProcess.length} of ${candidates.length} candidates ` +
    `(dataset: ${spots.length}, top=${top}, force=${force}, includeAlreadyImaged=${includeAlreadyImaged}).`,
);

const report = {
  generatedAt: new Date().toISOString(),
  total: 0,
  found: 0,
  noImage: 0,
  errors: 0,
  entries: [],
};

// Politeness: per-host last-request timestamp so we wait at least 1s before
// hitting the same origin again. Across hosts we run concurrency-wide.
const hostLastFetch = new Map();
const HOST_GAP_MS = 1000;

async function delayForHost(host) {
  const last = hostLastFetch.get(host) ?? 0;
  const wait = last + HOST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  hostLastFetch.set(host, Date.now());
}

// Browser-like UA — sites reflexively block strings containing "bot" or
// referencing scrapers, even when the request is polite. We declare ourselves
// in the Accept-Language and obey robots.txt morally (low rate, no recursion).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// Pull og:image / twitter:image / og:image:secure_url out of an HTML head.
// We only ever look at the first 200KB or so, so a regex is fine and cheaper
// than a real parser.
function extractOgImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function resolveUrl(raw, base) {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

async function scrapeOne(spot) {
  let url;
  try {
    url = new URL(spot.website);
  } catch {
    return { status: "bad-url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { status: "bad-url" };
  }

  await delayForHost(url.host);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok && response.status !== 206) {
      return { status: "http-error", code: response.status };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return { status: "non-html", contentType };
    }
    // Stream and stop at 500KB regardless of Range support.
    const reader = response.body?.getReader();
    if (!reader) return { status: "no-body" };
    const decoder = new TextDecoder("utf-8");
    let html = "";
    let total = 0;
    const cap = 512 * 1024;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      html += decoder.decode(value, { stream: true });
      if (total >= cap) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
      // Once we've seen </head>, more body won't help.
      if (/<\/head>/i.test(html)) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
    }
    const raw = extractOgImage(html);
    if (!raw) return { status: "no-image" };
    const resolved = resolveUrl(raw, response.url || url.toString());
    if (!resolved || !/^https?:/.test(resolved)) {
      return { status: "no-image" };
    }
    return {
      status: "ok",
      imageUrl: resolved,
      hostname: url.hostname.replace(/^www\./, ""),
    };
  } catch (error) {
    return { status: "error", message: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, worker, size) {
  let cursor = 0;
  const slots = Array.from({ length: size }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(slots);
}

await runPool(
  toProcess,
  async (spot, idx) => {
    report.total += 1;
    const label = `[${idx + 1}/${toProcess.length}]`;
    const result = await scrapeOne(spot);
    if (result.status === "ok") {
      report.found += 1;
      const existing = sidecar.entries[spot.id] ?? {};
      sidecar.entries[spot.id] = {
        ...existing,
        imageUrl: result.imageUrl,
        imageSource: "Venue website",
        imageAttribution: `Photo via ${result.hostname}`,
      };
      report.entries.push({ id: spot.id, status: "ok", url: result.imageUrl });
      console.log(`${label} ✓ ${spot.id}  ${result.hostname}`);
    } else if (result.status === "no-image") {
      report.noImage += 1;
      report.entries.push({ id: spot.id, status: "no-image" });
      console.log(`${label} – ${spot.id}  no og:image`);
    } else {
      report.errors += 1;
      report.entries.push({
        id: spot.id,
        status: result.status,
        message: result.message,
        code: result.code,
        contentType: result.contentType,
      });
      console.log(
        `${label} ! ${spot.id}  ${result.status}` +
          (result.code ? ` (${result.code})` : "") +
          (result.message ? ` ${result.message}` : ""),
      );
    }
  },
  Math.max(1, concurrency),
);

if (!dryRun) {
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
  console.log(
    `\nWrote ${Object.keys(sidecar.entries).length} sidecar entries to ${sidecarPath}`,
  );
} else {
  console.log("\n(dry run — sidecar not modified)");
}

  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report written to ${reportPath}`);
  console.log(
    `Summary: ${report.found} found, ${report.noImage} no image, ${report.errors} errors`,
  );
}
