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

// --- Round 2 (ultracode review) regression tests ---------------------------

// Findings 0/25/38: allowlist is exact-match, and hard OSM tag signals
// (weapons/cannabis-retail/adult/gambling) outrank it entirely.
test("finding 0/25/38: allowlist is exact-match, not substring, and hard tags outrank it", () => {
  // "International Smoke" is allowlisted; "International Smoke Shop" is a
  // different (unlisted) name and must not inherit the allowlist by
  // substring collision, especially with an authoritative tobacco tag.
  assert.equal(
    brandSafetyViolation({ name: "International Smoke Shop", category: "Shopping", tags: ["tobacco"] }),
    "cannabis",
  );
  assert.equal(brandSafetyViolation({ name: "International Smoke" }), null);
  // "Range Cafe" is allowlisted exactly; a name that merely contains it must
  // not bypass a hard weapons pattern.
  assert.equal(brandSafetyViolation({ name: "Test Gun Shop Range Cafe", category: "Shopping" }), "weapons");
  // A real chain location suffix still matches via match:"prefix".
  assert.equal(brandSafetyViolation({ name: "Movie Tavern Phoenix" }), null);
});

// Finding 2: curly apostrophe (U+2019) and singular "Gentleman's Club".
test("finding 2: gentlemen's-club pattern survives curly quotes and the singular form", () => {
  assert.equal(brandSafetyViolation({ name: "Sapphire Gentlemen’s Club" }), "adult");
  assert.equal(brandSafetyViolation({ name: "Christie's Gentleman's Club" }), "adult");
});

// Finding 5: Golden Nugget denylist entry is metro-scoped so it never
// collides with the unrelated Golden Nugget Pancake House (chicago).
test("finding 5: Golden Nugget Pancake House is not blocked by the casino denylist entry", () => {
  assert.equal(
    brandSafetyViolation({ name: "Golden Nugget Pancake House", category: "Food", metro: "chicago" }),
    null,
  );
});

// Finding 6: age-gate text covers "21 and over" / "21 and up" / "21 & up".
test("finding 6: age-gate text matches common 21+ phrasings beyond '21+'", () => {
  for (const description of ["Guests 21 and over welcome.", "21 and up only", "21 & up", "Must be 18 and older"]) {
    assert.equal(
      brandSafetyViolation({ name: "Neutral Hall", description }),
      "age_gated",
      description,
    );
  }
});

// Finding 26: "$21+" (a price) must not trip the age-gate text tier, on
// either the kids-drop side or the adults-force-include side.
test("finding 26: a $21+ price does not misfire as 21+ age-gate text", () => {
  assert.equal(
    brandSafetyViolation({ name: "Family Puppet Show", description: "Tickets $21+ at the door." }),
    null,
  );
  assert.equal(
    qualifiesForAdultFeed({
      title: "Family Puppet Show",
      description: "Tickets $21+ at the door.",
      audiences: ["all"],
    }),
    false,
  );
});

// Finding 7: hookah venues (tag or bare name) are age_gated, not cannabis —
// adults keep them.
test("finding 7: hookah venues are age_gated (adults keep), not cannabis", () => {
  assert.equal(brandSafetyViolation({ name: "Sahara Hookah Bar" }), "age_gated");
  assert.equal(isBrandSafeForAdults({ name: "Sahara Hookah Bar" }), true);
  assert.equal(brandSafetyViolation({ name: "Cloud 9", tags: ["hookah"] }), "age_gated");
});

// Finding 4: hookah_lounge and swingerclub OSM tag values are covered.
test("finding 4: amenity=hookah_lounge and amenity=swingerclub tag values are classed", () => {
  assert.equal(brandSafetyViolation({ name: "Arabian Nights", tags: ["hookah_lounge"] }), "age_gated");
  assert.equal(brandSafetyViolation({ name: "Club Vibe", tags: ["swingerclub"] }), "adult");
});

// Finding 8: semicolon-separated multi-value OSM tags are split before the
// Set lookup.
test("finding 8: semicolon multi-value tags are split, not treated as one opaque string", () => {
  assert.equal(brandSafetyViolation({ name: "Random Shop", tags: ["alcohol;convenience"] }), "alcohol");
});

// Finding 9: metro scoping actually applies (and is a no-op without a metro
// on the probe, by design — see findings 35/36 for the intended use).
test("finding 9: metro-scoped entries only apply when the probe carries that metro", () => {
  assert.equal(
    brandSafetyViolation({ name: "CBD Provisions", category: "Food", metro: "dallas-fort-worth" }),
    null,
  );
  assert.equal(brandSafetyViolation({ name: "CBD Provisions", category: "Food" }), "cannabis");
  assert.equal(
    brandSafetyViolation({ name: "CBD Provisions", category: "Food", metro: "houston" }),
    "cannabis",
  );
});

// Finding 10: "Showgirls" strip-club naming convention.
test("finding 10: Déjà Vu Showgirls is caught by name pattern and denylist prefix", () => {
  assert.equal(brandSafetyViolation({ name: "Déjà Vu Showgirls", category: "Culture" }), "adult");
  assert.equal(brandSafetyViolation({ name: "Déjà Vu San Francisco" }), "adult");
});

// Finding 33: gambling's card-room pattern excludes trading-card contexts —
// library TCG clubs (a staple kids event type) must survive.
test("finding 33: trading-card clubs are not misclassified as gambling", () => {
  assert.equal(
    kidsEventBrandSafetyViolation({ venue: "...Library", title: "Pokémon Trading Card Club" }),
    null,
  );
  assert.equal(brandSafetyViolation({ name: "Magic: The Gathering Card Club for Teens" }), null);
  // A real card room/club (no trading-card context word) still hits.
  assert.equal(brandSafetyViolation({ name: "Lucky Lady Card Room" }), "gambling");
});

// Finding 34: dominant alcohol-venue naming forms that were missing.
test("finding 34: additional alcohol-venue name patterns", () => {
  for (const name of [
    "Koko's Beer Hall",
    "Sipsip Rum Bar",
    "Old Town Pour House",
    "Fieldwork Brewing Company",
    "Wente Vineyards",
    "Seven Stills Distilling Co.",
    "Testarossa Cellars",
    "Mad Fritz Ales",
  ]) {
    assert.equal(brandSafetyViolation({ name, category: "Food" }), "alcohol", name);
  }
  // Church-name guard: "Vineyard" is also a nondenominational church
  // movement name.
  assert.equal(brandSafetyViolation({ name: "Vineyard Christian Fellowship" }), null);
});

// Finding 35/36: category-blind name patterns deleted real restaurants —
// metro-scoped allowlist entries restore them without reopening the pattern.
test("finding 35/36: CBD Provisions, Casino (NYC), and The Smoke Shop (Boston) are restored via metro-scoped allowlist", () => {
  assert.equal(
    brandSafetyViolation({ name: "Casino", category: "Food", metro: "new-york-city" }),
    null,
  );
  assert.equal(brandSafetyViolation({ name: "Casino", category: "Food", metro: "chicago" }), "gambling");
  assert.equal(brandSafetyViolation({ name: "The Smoke Shop", category: "Food", metro: "boston" }), null);
  assert.equal(brandSafetyViolation({ name: "The Smoke Shop", category: "Food" }), "cannabis");
});

// Manual find H1: bare "gun(s)" blocks regardless of category — a
// miscategorized gun store must not pass.
test("H1: bare guns pattern blocks regardless of category", () => {
  assert.equal(brandSafetyViolation({ name: "Realco Guns", category: "Wellness" }), "weapons");
  // Known false positive protected by exact-match allowlist, not category.
  assert.equal(brandSafetyViolation({ name: "False Gun Vista", category: "Outdoors" }), null);
});

// Manual find H2: plural "Liquors" — "Airport Cafe & Liquors" is live in
// miami kids spots.
test("H2: plural 'Liquors' is caught by the alcohol name pattern", () => {
  assert.equal(brandSafetyViolation({ name: "Airport Cafe & Liquors", category: "Food" }), "alcohol");
});

// Finding 28: D2 kids-primary brands (Fairyland, LEGOLAND Discovery, Chuck
// E. Cheese, Junior Museum) shipped in spots-adults.json.
test("finding 28: D2 catches Fairyland, LEGOLAND Discovery, Chuck E. Cheese, Junior Museum", () => {
  assert.equal(isKidsPrimaryVenue({ name: "Children's Fairyland" }), true);
  assert.equal(isKidsPrimaryVenue({ name: "LEGOLAND Discovery Center Boston" }), true);
  assert.equal(isKidsPrimaryVenue({ name: "Chuck E. Cheese" }), true);
  assert.equal(isKidsPrimaryVenue({ name: "Palo Alto Junior Museum and Zoo" }), true);
});

// Finding 1: OSM sport=shooting / club=* propagation (unit-tested at the
// spotPipeline level too — this confirms the taxonomy side once tagged).
test("finding 1: sport=shooting tag value is a reachable weapons signal", () => {
  assert.equal(brandSafetyViolation({ name: "Shoot Point Blank", category: "Wellness", tags: ["sports_centre", "shooting"] }), "weapons");
});

// Finding 16/25: events' allowlist match is venue-only — a safe-venue exact
// match is expected to still short-circuit (that's inherent to allowlisting
// a real venue), but a title-only keyword collision must never rescue an
// unsafe venue.
// Finding 27: kid-event title shapes (Tot/Lil/Junior/Sensory/Little
// Ones/Tiny Tots/Homeschool) evaded D1 when adults-tagged.
test("finding 27: KIDS_CONTENT_RE additions drop kid-titled events even when adults-tagged", () => {
  for (const title of [
    "Tot Shabbat",
    "Lil Explorers Club",
    "Junior Rangers Day",
    "Sensory Hour",
    "Little Ones Music Class",
    "Tiny Tots Dance",
    "Homeschool Science Day",
  ]) {
    assert.equal(qualifiesForAdultFeed({ title, audiences: ["adults"] }), false, title);
  }
  // Control: genuinely adult content is unaffected.
  assert.equal(
    qualifiesForAdultFeed({ title: "Comedy Night at Cobb's", audiences: ["adults"] }),
    true,
  );
});

test("finding 16: event allowlist matches venue only, never venue+title concatenation", () => {
  // Allowlisted word appears only in the TITLE, not the (unsafe) venue —
  // must not bypass the venue's own violation.
  assert.equal(
    kidsEventBrandSafetyViolation({ venue: "Barebottle Brewery", title: "Shogun Movie Screening" }),
    "alcohol",
  );
  assert.equal(
    kidsEventBrandSafetyViolation({ venue: "Lucky Lady Card Room", title: "Range Cafe Pop-up" }),
    "gambling",
  );
  // Genuinely kids-safe control.
  assert.equal(
    kidsEventBrandSafetyViolation({ venue: "Main Library", title: "Kids' Craft Hour" }),
    null,
  );
});
