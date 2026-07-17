import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDataset,
  buildSplitDatasets,
  commonsFileUrl,
  extractFriendlyTags,
  imageFromTags,
  normalizeElement,
  sanitizeUrl,
  stripUnsafeText,
  validateDataset,
} from "../scripts/spotPipeline.mjs";

test("stripUnsafeText removes markup and control characters", () => {
  assert.equal(stripUnsafeText("  <b>Arcade</b>\u0000 Night  "), "Arcade Night");
});

test("sanitizeUrl accepts only http and https URLs", () => {
  assert.equal(sanitizeUrl("example.com"), null);
  assert.equal(sanitizeUrl("www.example.com/path"), "https://www.example.com/path");
  assert.equal(sanitizeUrl("javascript:alert(1)"), null);
});

test("imageFromTags prefers place-specific image metadata", () => {
  assert.deepEqual(imageFromTags({ image: "https://example.com/park.jpg" }, "Outdoors", "a"), {
    url: "https://example.com/park.jpg",
    source: "OSM image tag",
    attribution: "Source image from OpenStreetMap tag",
  });

  const commons = imageFromTags({ image: "File:Ferry_Building_SF.jpg" }, "Culture", "b");
  assert.equal(commons.source, "Wikimedia Commons");
  assert.match(commons.url, /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//);

  assert.equal(commonsFileUrl("Category:Golden Gate Park"), null);
});

test("normalizeElement creates a friend-friendly Bay Area spot", () => {
  const spot = normalizeElement({
    type: "node",
    id: 123,
    lat: 37.7749,
    lon: -122.4194,
    tags: {
      name: "Mission Board Games",
      amenity: "cafe",
      "addr:city": "San Francisco",
      website: "https://example.com",
      image: "https://example.com/mission-board-games.webp",
      opening_hours: "Mo-Fr 10:00-20:00",
    },
  });

  assert.equal(spot.category, "Food");
  assert.deepEqual(spot.bestWith, ["friends"]);
  assert.equal(spot.neighborhood, "San Francisco");
  assert.equal(spot.openNow, true);
  assert.equal(spot.imageSource, "OSM image tag");
  assert.equal(spot.imageUrl, "https://example.com/mission-board-games.webp");
  assert.match(spot.sourceUrl, /openstreetmap\.org\/node\/123/);
});

test("normalizeElement rejects private and out-of-area records", () => {
  assert.equal(
    normalizeElement({
      type: "node",
      id: 1,
      lat: 37.7,
      lon: -122.4,
      tags: { name: "Private Club", amenity: "bar", access: "private" },
    }),
    null,
  );

  assert.equal(
    normalizeElement({
      type: "node",
      id: 2,
      lat: 40.7,
      lon: -74,
      tags: { name: "Far Away Cafe", amenity: "cafe" },
    }),
    null,
  );
});

test("buildDataset dedupes, ranks, and validates", () => {
  const dataset = buildDataset(
    [
      {
        type: "node",
        id: 1,
        lat: 37.78,
        lon: -122.41,
        tags: {
          name: "Shared Plates",
          amenity: "restaurant",
          "addr:city": "San Francisco",
          website: "https://example.com/shared-plates",
          opening_hours: "Mo-Su 11:00-22:00",
        },
      },
      {
        type: "node",
        id: 2,
        lat: 37.7801,
        lon: -122.4101,
        tags: {
          name: "Shared Plates",
          amenity: "restaurant",
          "addr:city": "San Francisco",
          website: "https://example.com/shared-plates",
          opening_hours: "Mo-Su 11:00-22:00",
        },
      },
      {
        type: "node",
        id: 3,
        lat: 37.8,
        lon: -122.27,
        tags: {
          name: "Escape Room",
          leisure: "escape_game",
          "addr:city": "Oakland",
          opening_hours: "Mo-Su 10:00-22:00",
          website: "https://example.com/escape",
        },
      },
    ],
    { generatedAt: "2026-05-02T00:00:00.000Z" },
  );

  assert.equal(dataset.count, 2);
  assert.equal(validateDataset(dataset, { minSpots: 2 }).length, 0);
});

test("extractFriendlyTags propagates the OSM craft tag (brewery/winery/distillery)", () => {
  const tags = extractFriendlyTags("Culture", { craft: "brewery" });
  assert.ok(tags.includes("brewery"), `expected craft tag in ${JSON.stringify(tags)}`);
});

// D2/D4: buildSplitDatasets must drop Nightlife + alcohol-tagged (via the
// craft=brewery propagation fix) venues from kids, keep them for adults, and
// drop kids-primary venues from the adults split even with no brand-safety
// violation.
test("buildSplitDatasets applies brand-safety + D2 kids-primary gates per audience", () => {
  const { kids, adults } = buildSplitDatasets([
    {
      type: "node",
      id: 10,
      lat: 37.78,
      lon: -122.41,
      tags: {
        name: "Coyote Creek Brewery",
        craft: "brewery",
        "addr:city": "San Francisco",
        website: "https://example.com/coyote-creek",
        opening_hours: "Mo-Su 16:00-23:00",
      },
    },
    {
      type: "node",
      id: 11,
      lat: 37.781,
      lon: -122.411,
      tags: {
        name: "Kidspace Discovery Play Gym",
        leisure: "escape_game",
        "addr:city": "San Francisco",
        website: "https://example.com/kidspace",
        opening_hours: "Mo-Su 09:00-18:00",
      },
    },
  ]);

  const kidsNames = kids.spots.map((s) => s.name);
  const adultsNames = adults.spots.map((s) => s.name);
  assert.ok(!kidsNames.includes("Coyote Creek Brewery"), "brewery must not ship to kids");
  assert.ok(adultsNames.includes("Coyote Creek Brewery"), "brewery should stay on adults (alcohol is kept)");
  assert.ok(!adultsNames.includes("Kidspace Discovery Play Gym"), "kids-primary venue must not ship to adults");
});
