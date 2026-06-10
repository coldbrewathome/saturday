import test from "node:test";
import assert from "node:assert/strict";
import {
  brandSafetyViolation,
  isBrandSafeForAdults,
  isBrandSafeForKids,
} from "../scripts/lib/brandSafety.mjs";
import { qualifiesForAdultFeed } from "../scripts/lib/adultAudience.mjs";

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

test("kids feed drops all violations, adults feed drops weapons only", () => {
  const gunRange = { name: "Range USA" };
  const dispensary = { name: "Barbary Coast", tags: ["cannabis"] };
  assert.equal(isBrandSafeForKids(gunRange), false);
  assert.equal(isBrandSafeForKids(dispensary), false);
  assert.equal(isBrandSafeForAdults(gunRange), false);
  assert.equal(isBrandSafeForAdults(dispensary), true);
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
