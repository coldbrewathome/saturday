import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDataset,
  commonsFileUrl,
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
        },
      },
    ],
    { generatedAt: "2026-05-02T00:00:00.000Z" },
  );

  assert.equal(dataset.count, 2);
  assert.equal(validateDataset(dataset, { minSpots: 2 }).length, 0);
});
