#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  OVERPASS_ENDPOINT,
  buildDataset,
  buildOverpassQuery,
  commonsFileUrl,
  validateDataset,
} from "./spotPipeline.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(process.argv.slice(2), metroConfig);

async function fetchOverpass(query) {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "saturday-with-friends/0.1 (local development)",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Overpass request failed ${response.status}: ${detail.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchWikidataImages(ids) {
  const result = new Map();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const batches = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    batches.push(uniqueIds.slice(i, i + 50));
  }

  for (const batch of batches) {
    const values = batch.map((id) => `wd:${id}`).join(" ");
    const query = `SELECT ?item ?image WHERE { VALUES ?item { ${values} } ?item wdt:P18 ?image. }`;
    const url = new URL("https://query.wikidata.org/sparql");
    url.searchParams.set("query", query);
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "saturday-with-friends/0.1 (local development)",
      },
    });

    if (!response.ok) {
      throw new Error(`Wikidata image request failed ${response.status}`);
    }

    const json = await response.json();
    for (const binding of json.results?.bindings ?? []) {
      const id = binding.item?.value?.match(/(Q\d+)$/)?.[1];
      const imageUrl = commonsFileUrl(binding.image?.value);
      if (id && imageUrl && !result.has(id)) {
        result.set(id, imageUrl);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return result;
}

async function enrichImages(dataset) {
  const candidates = dataset.spots.filter(
    (spot) => spot.imageSource === "Category fallback" && spot.wikidataId,
  );

  if (candidates.length === 0) {
    dataset.imageStats = { wikidata: 0, tagged: 0, fallback: dataset.spots.length };
    return;
  }

  try {
    const images = await fetchWikidataImages(candidates.map((spot) => spot.wikidataId));
    for (const spot of dataset.spots) {
      const image = spot.wikidataId ? images.get(spot.wikidataId) : null;
      if (image && spot.imageSource === "Category fallback") {
        spot.imageUrl = image;
        spot.imageSource = "Wikidata image";
        spot.imageAttribution = "Wikimedia Commons";
      }
    }
  } catch (error) {
    console.warn(
      `Image enrichment skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  dataset.imageStats = dataset.spots.reduce(
    (stats, spot) => {
      if (spot.imageSource === "Wikidata image") stats.wikidata += 1;
      else if (spot.imageSource === "OSM image tag" || spot.imageSource === "Wikimedia Commons") {
        stats.tagged += 1;
      } else stats.fallback += 1;
      return stats;
    },
    { wikidata: 0, tagged: 0, fallback: 0 },
  );
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function ingestMetro(metro) {
  const coverage = metro.spotCoverage || {};
  const boxes = coverage.boxes;
  const cityCenters = coverage.cityCenters;
  const center = metro.center;
  const outputPath =
    process.env.SPOT_OUTPUT || metroDataFile(metro, "spots");
  const minSpots = Number(process.env.MIN_SPOTS || metro.minSpots || 150);
  const query = buildOverpassQuery(boxes);
  console.log(`Fetching ${metro.label} spots from Overpass...`);
  const raw = await fetchOverpass(query);
  const dataset = buildDataset(raw.elements || [], {
    query,
    metroId: metro.id,
    coverage,
    boxes,
    center,
    cityCenters,
    coverageName: coverage.name || metro.seoName || metro.label,
  });
  await enrichImages(dataset);
  const errors = validateDataset(dataset, {
    minSpots,
    boxes,
    coverageName: coverage.name || metro.label,
  });

  if (errors.length > 0) {
    throw new Error(`Generated dataset failed validation:\n${errors.join("\n")}`);
  }

  await writeJson(outputPath, dataset);
  const legacyPath = legacyMetroDataFile(metro, "spots");
  if (legacyPath && legacyPath !== outputPath) {
    await writeJson(legacyPath, dataset);
  }
  console.log(`Wrote ${dataset.count} sanitized spots to ${outputPath}`);
  if (legacyPath && legacyPath !== outputPath) {
    console.log(`Wrote legacy copy to ${legacyPath}`);
  }
  console.log(`Generated at ${dataset.generatedAt}`);
}

async function main() {
  const metros = selection.all ? metroConfig.metros : [selection.metro];
  for (const metro of metros) {
    await ingestMetro(metro);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
