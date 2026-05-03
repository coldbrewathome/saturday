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

const outputPath =
  process.env.SPOT_OUTPUT || path.join("public", "data", "bay-area-spots.json");
const minSpots = Number(process.env.MIN_SPOTS || 150);

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

async function main() {
  const query = buildOverpassQuery();
  console.log("Fetching Bay Area spots from Overpass...");
  const raw = await fetchOverpass(query);
  const dataset = buildDataset(raw.elements || [], { query });
  await enrichImages(dataset);
  const errors = validateDataset(dataset, { minSpots });

  if (errors.length > 0) {
    throw new Error(`Generated dataset failed validation:\n${errors.join("\n")}`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Wrote ${dataset.count} sanitized spots to ${outputPath}`);
  console.log(`Generated at ${dataset.generatedAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
