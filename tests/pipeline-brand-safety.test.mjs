import test from "node:test";
import assert from "node:assert/strict";
import {
  brandSafetyViolation,
  isBrandSafeForAdults,
  isBrandSafeForKids,
  isKidsPrimaryVenue,
} from "../scripts/lib/brandSafety.mjs";
import { qualifiesForAdultFeed } from "../scripts/lib/adultAudience.mjs";
import { isKidsFacingAudience, kidsEventBrandSafetyViolation } from "../scripts/eventPipeline.mjs";

test("brandSafetyViolation flags weapons venues by name", () => {
  assert.equal(brandSafetyViolation({ name: "Zero Whiskey Tactical Arms" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "Eagle Sports Range" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "Range USA" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "Range USA Villa Park" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "Bullseye Shooting Range" }), "weapons");
});

test("brandSafetyViolation flags cannabis venues via OSM tags", () => {
  // "Barbary Coast" (SF dispensary) carries no cannabis word in its name —
  // the shop=cannabis tag is the signal.
  assert.equal(
    brandSafetyViolation({ name: "Barbary Coast", tags: ["Friends", "Food", "cafe", "cannabis"] }),
    "cannabis",
  );
  assert.equal(brandSafetyViolation({ name: "Green Door Dispensary" }), "cannabis");
});

test("brandSafetyViolation does not flag innocent lookalikes", () => {
  assert.equal(brandSafetyViolation({ name: "Target" }), null);
  assert.equal(brandSafetyViolation({ name: "Smokehouse BBQ" }), null);
  assert.equal(brandSafetyViolation({ name: "The Smoke Shop BBQ" }), null);
  assert.equal(brandSafetyViolation({ name: "Golden Gate Park" }), null);
});

test("kids feed drops all violations; adults feed drops weapons and cannabis retail only", () => {
  const gunRange = { name: "Range USA" };
  const dispensary = { name: "Barbary Coast", tags: ["cannabis"] };
  const bar = { name: "The Local", tags: ["bar"] };
  assert.equal(isBrandSafeForKids(gunRange), false);
  assert.equal(isBrandSafeForKids(dispensary), false);
  assert.equal(isBrandSafeForKids(bar), false);
  assert.equal(isBrandSafeForAdults(gunRange), false);
  // v2: cannabis retail is dropped for adults too (SPEC-TRUST-GATE.md A2) —
  // only lounges (age_gated) and non-retail classes survive the adults gate.
  assert.equal(isBrandSafeForAdults(dispensary), false);
  assert.equal(isBrandSafeForAdults(bar), true);
});

test("qualifiesForAdultFeed rejects kids-venue, library, and virtual events", () => {
  assert.equal(
    qualifiesForAdultFeed({ title: "Library Storytime", venue: "Main Library", audiences: ["all"] }),
    false,
  );
  assert.equal(
    qualifiesForAdultFeed({
      title: "Drop-in Play",
      venue: "Children's Creativity Museum",
      audiences: ["all"],
    }),
    false,
  );
  assert.equal(
    qualifiesForAdultFeed({ title: "Career Talk (Zoom)", venue: "Online", audiences: ["all"] }),
    false,
  );
  assert.equal(
    qualifiesForAdultFeed({ title: "Toddler Dance Party", venue: "Rec Center", audiences: ["kids"] }),
    false,
  );
});

test("qualifiesForAdultFeed accepts brewery, comedy, and live-music events", () => {
  assert.equal(
    qualifiesForAdultFeed({
      title: "Trivia Night at Standard Deviant Brewing",
      venue: "Standard Deviant Brewing",
      audiences: ["all"],
    }),
    true,
  );
  assert.equal(
    qualifiesForAdultFeed({ title: "Stand-up Showcase", venue: "Punch Line SF", audiences: ["all"] }),
    true,
  );
  assert.equal(
    qualifiesForAdultFeed({
      title: "Khruangbin",
      venue: "The Fillmore",
      category: "Music",
      audiences: ["all"],
    }),
    true,
  );
});

// E1: taxonomy v2 — each name, as a kids spot, returns the given class with
// no tags.
test("E1: taxonomy v2 classes by name, no tags", () => {
  assert.equal(brandSafetyViolation({ name: "Realco Guns", category: "Shopping" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "TruePrep Guns And Gear" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "Rod & Gun Club of Anytown" }), "weapons");
  assert.equal(brandSafetyViolation({ name: "Casino Miami" }), "gambling");
  assert.equal(brandSafetyViolation({ name: "CAKE Nightclub" }), "alcohol");
  assert.equal(brandSafetyViolation({ name: "Coyote Creek Brewery" }), "alcohol");
  assert.equal(brandSafetyViolation({ name: "City Winery" }), "alcohol");
  assert.equal(brandSafetyViolation({ name: "Adair's Saloon" }), "alcohol");
  assert.equal(
    brandSafetyViolation({ name: "The Apothecarium", tags: ["cannabis"] }),
    "cannabis",
  );
  assert.equal(brandSafetyViolation({ name: "Puff N Stuff Smoke Shop" }), "cannabis");
  assert.equal(brandSafetyViolation({ name: "Lucky Lady Card Room" }), "gambling");
});

// E2: each of these is safe for kids (no violation).
test("E2: taxonomy v2 does not flag known-safe lookalikes", () => {
  const safeNames = [
    "False Gun Vista",
    "Gunston Park",
    "Gunzo's Sports Center",
    "The Gundis",
    "Shogun",
    "Gunther-Hirsh Family Center",
    "Range Cafe",
    "Target",
    "The Smoke Shop BBQ",
    "Hardwood Bar & Smokery",
    "International Smoke",
    "Movie Tavern",
    "Fraunces Tavern Museum",
    "Golden Ball Tavern Museum",
    "Nojo Ramen Tavern",
    "Dorlan's Tavern & Oyster Bar",
    "Park Avenue Armory",
    "Highland Park Adult Senior Citizen Center",
  ];
  for (const name of safeNames) {
    assert.equal(brandSafetyViolation({ name }), null, `expected "${name}" to be safe`);
  }
});

// E3: tag-only detection.
test("E3: tag-only detection blocks kids, and the adults split differs by class", () => {
  assert.equal(
    brandSafetyViolation({ name: "Green Leaf Wellness", tags: ["cannabis"] }),
    "cannabis",
  );
  assert.equal(
    isBrandSafeForKids({ name: "Corner Store", tags: ["alcohol"] }),
    false,
  );
  assert.equal(isBrandSafeForKids({ name: "The Local", tags: ["bar"] }), false);
  assert.equal(isBrandSafeForAdults({ name: "The Local", tags: ["bar"] }), true);
});

// E6: kids events gate (A3) — an event at a blocklisted-venue-class is
// excluded regardless of its audiences tag; a genuinely kids event stays.
test("E6: kids event brand-safety gate blocks venue-class violations", () => {
  assert.equal(
    kidsEventBrandSafetyViolation({
      title: "Trivia Night",
      venue: "Barebottle Brewery",
      audiences: ["all"],
    }),
    "alcohol",
  );
  assert.equal(
    kidsEventBrandSafetyViolation({
      title: "Kids' Craft Hour at the Library",
      venue: "Main Library",
      audiences: ["all"],
    }),
    null,
  );
});

// E17/E18: D1 precedence — content evidence outranks a source-level
// audiences:["adults"] tag, unless an explicit override is present.
test("E17: kids-content title drops an adults-tagged event unless overridden", () => {
  assert.equal(
    qualifiesForAdultFeed({
      title: "Toishan Lions Dance Troupe (Kids' Show)",
      audiences: ["adults"],
    }),
    false,
  );
  assert.equal(
    qualifiesForAdultFeed({
      title: "Toishan Lions Dance Troupe 21+ After Dark",
      audiences: ["adults"],
    }),
    true,
  );
});

test("E18: conservative kids-signal drop vs. adults-tagged acceptance", () => {
  assert.equal(
    qualifiesForAdultFeed({
      title: "Drag Brunch (family friendly!)",
      audiences: ["all"],
    }),
    false,
  );
  assert.equal(
    qualifiesForAdultFeed({
      title: "Comedy Night at Cobb's",
      audiences: ["adults"],
    }),
    true,
  );
});

// E19: D2 — adults spots exclude kids-primary venues; Walt Disney Family
// Museum is allowlisted; a normal adult-interest spot is unaffected.
test("E19: isKidsPrimaryVenue excludes playgrounds/kids museums, allowlist keeps Disney", () => {
  assert.equal(isKidsPrimaryVenue({ name: "Raymond Kimbell Playground" }), true);
  assert.equal(
    isKidsPrimaryVenue({ name: "Children's Discovery Museum of San Jose" }),
    true,
  );
  assert.equal(isKidsPrimaryVenue({ name: "Walt Disney Family Museum" }), false);
  assert.equal(isKidsPrimaryVenue({ name: "Top of the Mark" }), false);
});

// E21: kids feed audience exclusions (D4) — locking down existing behavior.
test("E21: kids feed never carries adults-only audiences", () => {
  assert.equal(isKidsFacingAudience(["adults"]), false);
  assert.equal(isKidsFacingAudience(["kids"]), true);
  assert.equal(isKidsFacingAudience(["all"]), true);
  assert.equal(isKidsFacingAudience(undefined), true);
});
