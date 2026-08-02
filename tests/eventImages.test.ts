import { describe, expect, it } from "vitest";
import {
  buildVenueImageMap,
  eventImage,
  eventImageSmall,
  venueImageFor,
} from "../src/eventImages";
import type { FamilyEvent } from "../src/App";

function makeEvent(overrides: Partial<FamilyEvent> & { id: string }): FamilyEvent {
  return {
    title: "Storytime",
    description: "",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.78,
    lon: -122.41,
    category: "Community",
    daysOfWeek: [6],
    timeWindow: "Morning",
    ageBands: [],
    cost: "Free",
    url: "https://example.com/e",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

const spots = [
  { name: "Stern Grove", city: "San Francisco", imageUrl: "https://images.unsplash.com/photo-1?w=1200" },
  { name: "Fairyland", city: "Oakland", imageUrl: "https://images.unsplash.com/photo-2?w=1200" },
  { name: "Golden Gate Park", city: null, imageUrl: "https://images.unsplash.com/photo-3?w=1200" },
  { name: "Zz", city: "SF", imageUrl: "https://images.unsplash.com/photo-4?w=1200" }, // name too short
];

describe("eventImage", () => {
  it("returns null when the event has no real photo", () => {
    expect(eventImage(makeEvent({ id: "a" }))).toBeNull();
    expect(eventImageSmall(makeEvent({ id: "a" }))).toBeNull();
  });

  it("returns the real photo and re-crops Unsplash at the requested width", () => {
    const event = makeEvent({
      id: "a",
      imageUrl: "https://images.unsplash.com/photo-99?auto=format&w=1200&q=80",
    });
    expect(eventImage(event)).toContain("w=1200");
    expect(eventImageSmall(event)).toContain("w=400");
  });

  it("passes non-Unsplash photos through untouched", () => {
    const event = makeEvent({
      id: "a",
      imageUrl: "https://media.ticketmaster.com/tm-images/x.jpg",
    });
    expect(eventImageSmall(event)).toBe("https://media.ticketmaster.com/tm-images/x.jpg");
  });
});

describe("buildVenueImageMap + venueImageFor", () => {
  const map = buildVenueImageMap(spots);

  it("indexes spots with a real image and a long-enough name", () => {
    expect(map.size).toBe(3);
    expect(map.has("stern grove")).toBe(true);
    expect(map.has("zz")).toBe(false);
  });

  it("matches an exact venue name", () => {
    expect(
      venueImageFor(makeEvent({ id: "a", venue: "Stern Grove", city: "San Francisco" }), map),
    ).toContain("photo-1");
  });

  it("matches a contains-relationship both directions (venue vs spot name)", () => {
    expect(
      venueImageFor(makeEvent({ id: "a", venue: "Sigmund Stern Grove", city: "San Francisco" }), map),
    ).toContain("photo-1");
    expect(
      venueImageFor(makeEvent({ id: "a", venue: "Grove", city: "SF" }), map),
    ).toBeNull();
  });

  it("rejects a match contradicted by differing cities", () => {
    // "Fairyland" spot is Oakland; the event claims SF — no match.
    expect(
      venueImageFor(makeEvent({ id: "a", venue: "Fairyland", city: "San Francisco" }), map),
    ).toBeNull();
    expect(
      venueImageFor(makeEvent({ id: "a", venue: "Fairyland", city: "Oakland" }), map),
    ).toContain("photo-2");
  });

  it("allows a match when the event city is unknown", () => {
    expect(
      venueImageFor(makeEvent({ id: "a", venue: "Fairyland", city: "" }), map),
    ).toContain("photo-2");
  });

  it("returns null when no venue matches", () => {
    expect(venueImageFor(makeEvent({ id: "a", venue: "Nowhere Hall" }), map)).toBeNull();
    expect(venueImageFor(makeEvent({ id: "a", venue: "" }), map)).toBeNull();
  });
});
