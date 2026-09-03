import { describe, expect, it } from "vitest";
import {
  isValidFamilyProfile,
  readStoredProfile,
  writeStoredProfile,
  scoreEventForFamily,
  profileSettingMatches,
  type FamilyProfile,
} from "../src/familyProfile";
// distanceMiles moved to appUtils (as haversineMiles) when haversine copies
// were deduped.
import { haversineMiles as distanceMiles } from "../src/appUtils";
import type { FamilyEvent } from "../src/App";

function makeEvent(overrides: Partial<FamilyEvent> & { id: string }): FamilyEvent {
  return {
    title: "Storytime at the Library",
    description: "A weekly read-aloud for little ones.",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.7749,
    lon: -122.4194,
    category: "Community",
    daysOfWeek: [6],
    timeWindow: "Morning",
    ageBands: ["toddler"],
    cost: "Free",
    url: "https://example.com/storytime",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

const validProfile: FamilyProfile = {
  ageBands: ["toddler", "preschool"],
  zipCode: "94110",
  interests: ["story-time", "stem"],
  budget: "free",
  setting: "any",
};

describe("FamilyProfile validation", () => {
  it("accepts a well-formed profile", () => {
    expect(isValidFamilyProfile(validProfile)).toBe(true);
  });

  it("rejects unknown age bands", () => {
    expect(
      isValidFamilyProfile({ ...validProfile, ageBands: ["teen"] }),
    ).toBe(false);
  });

  it("rejects unknown interest theme ids", () => {
    expect(
      isValidFamilyProfile({ ...validProfile, interests: ["not-a-theme"] }),
    ).toBe(false);
  });

  it("rejects unknown budget/setting values", () => {
    expect(
      isValidFamilyProfile({ ...validProfile, budget: "luxury" }),
    ).toBe(false);
    expect(
      isValidFamilyProfile({ ...validProfile, setting: "underwater" }),
    ).toBe(false);
  });

  it("rejects non-objects and null", () => {
    expect(isValidFamilyProfile(null)).toBe(false);
    expect(isValidFamilyProfile("profile")).toBe(false);
  });
});

describe("FamilyProfile storage", () => {
  it("round-trips through localStorage", () => {
    const stored = readStoredProfile();
    writeStoredProfile(validProfile);
    expect(readStoredProfile()).toEqual(validProfile);
    // Restore prior state so tests don't leak into each other.
    if (stored) writeStoredProfile(stored);
    else window.localStorage.removeItem("famhop:profile");
  });

  it("returns null for corrupt storage", () => {
    window.localStorage.setItem("famhop:profile", "not-json{");
    expect(readStoredProfile()).toBeNull();
    window.localStorage.removeItem("famhop:profile");
  });
});

describe("scoreEventForFamily", () => {
  const ctx = { profile: validProfile };

  it("boosts events matching the profile's age bands", () => {
    const match = makeEvent({ id: "a", ageBands: ["toddler"] });
    const miss = makeEvent({ id: "b", ageBands: ["tween"] });
    expect(scoreEventForFamily(match, ctx)).toBeGreaterThan(
      scoreEventForFamily(miss, ctx),
    );
  });

  it("keeps unknown-age events neutral rather than excluding them", () => {
    const unknown = makeEvent({ id: "c", ageBands: [] });
    const tweenOnly = makeEvent({ id: "d", ageBands: ["tween"] });
    expect(scoreEventForFamily(unknown, ctx)).toBeGreaterThan(
      scoreEventForFamily(tweenOnly, ctx),
    );
  });

  it("boosts by overlapping interests", () => {
    const themed = makeEvent({ id: "e", themes: ["story-time", "stem"] });
    const plain = makeEvent({ id: "f", themes: [] });
    expect(scoreEventForFamily(themed, ctx)).toBeGreaterThan(
      scoreEventForFamily(plain, ctx),
    );
  });

  it("boosts free events for a free-budget profile and discounts ticketed", () => {
    const free = makeEvent({ id: "g", cost: "Free" });
    const ticketed = makeEvent({ id: "h", cost: "$$" });
    expect(scoreEventForFamily(free, ctx)).toBeGreaterThan(
      scoreEventForFamily(ticketed, ctx),
    );
  });

  it("returns zero when no profile exists", () => {
    expect(scoreEventForFamily(makeEvent({ id: "i" }), { profile: null })).toBe(0);
  });

  it("adds proximity boost for a nearby home", () => {
    const near = makeEvent({ id: "j", lat: 37.76, lon: -122.42 });
    const far = makeEvent({ id: "k", lat: 34.05, lon: -118.24 });
    const withHome = { profile: validProfile, home: { lat: 37.7749, lon: -122.4194 } };
    expect(scoreEventForFamily(near, withHome)).toBeGreaterThan(
      scoreEventForFamily(far, withHome),
    );
  });
});

describe("profileSettingMatches", () => {
  it("matches indoor setting to culture/library events", () => {
    const library = makeEvent({ id: "l", category: "Community", description: "story time inside the library" });
    expect(profileSettingMatches(library, "indoor")).toBe(true);
    expect(profileSettingMatches(library, "outdoor")).toBe(false);
  });

  it("matches outdoor setting to park events", () => {
    const park = makeEvent({ id: "m", category: "Park", description: "playground splash day" });
    expect(profileSettingMatches(park, "outdoor")).toBe(true);
    expect(profileSettingMatches(park, "indoor")).toBe(false);
  });

  it("is neutral for 'any'", () => {
    const any = makeEvent({ id: "n" });
    expect(profileSettingMatches(any, "any")).toBe(true);
  });
});

describe("distanceMiles", () => {
  it("computes ~0 for identical points and a plausible SF→LA distance", () => {
    expect(distanceMiles({ lat: 37.77, lon: -122.42 }, { lat: 37.77, lon: -122.42 })).toBeLessThan(0.01);
    const sfLa = distanceMiles({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 });
    expect(sfLa).toBeGreaterThan(330);
    expect(sfLa).toBeLessThan(360);
  });
});
