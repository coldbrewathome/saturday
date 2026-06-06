// Map Google Place "primary type" (the `googleType` carried in the enrichment
// sidecar, e.g. "Italian Restaurant", "Coffee Shop", "Wine Bar") to a concrete
// schema.org type for a spot page's JSON-LD. A precise venue type (Restaurant,
// BarOrPub, CafeOrCoffeeShop, Museum, …) makes the page eligible for richer
// Google results than the coarse category fallback (`mapPlaceType`) — this is
// what surfaces the ★ aggregateRating snippet on bars/restaurants for Mosey.
//
// Returns a schema.org type string, or `null` when the Google type is absent
// or unrecognized — the caller then falls back to the category-based mapping,
// so unenriched spots are unaffected (no regression).
//
// Ordering is deliberate and load-bearing: earlier rules win. Food is matched
// before bar/cafe/store so "Oyster Bar Restaurant" → Restaurant (not BarOrPub)
// and "Ice Cream Shop" → FoodEstablishment (not Store). Keep new keywords in
// the bucket that should win ties, and add a test in tests/placeSchemaType.test.mjs.

/**
 * @param {string|null|undefined} googleType
 * @returns {string|null} a schema.org @type, or null to defer to the category fallback
 */
export function schemaTypeForGoogleType(googleType) {
  if (!googleType || typeof googleType !== "string") return null;
  const g = googleType.toLowerCase();

  // --- Food (first: many food types contain "bar"/"shop"/"cafe" substrings) ---
  // Sweet/frozen shops are food, not retail — catch before the generic "shop".
  if (/ice cream|gelato|\bdessert|frozen yogurt|froyo|chocolate|candy|confection|sweets/.test(g))
    return "FoodEstablishment";
  if (/bakery|patisserie|pâtisserie|bagel|donut|doughnut|pastry|croissant|cupcake/.test(g))
    return "Bakery";
  if (
    /restaurant|steak ?house|diner|bistro|brasserie|gastropub|eatery|pizzeria|barbecue|\bbbq\b|\bfood\b|food court|food truck|food hall|sandwich|noodle|ramen|sushi|taqueria|trattoria|osteria|fine dining|takeout|take ?out|buffet|deli\b|delicatessen|grill\b|creamery/.test(
      g,
    )
  )
    return "Restaurant";

  // --- Drink ---
  if (/coffee|\bcafe\b|café|espresso|tea ?house|tea ?room|\btea\b|juice|smoothie|boba|bubble tea/.test(g))
    return "CafeOrCoffeeShop";
  if (/night ?club|dance club|\bdisco\b/.test(g)) return "NightClub";
  if (
    /\bbar\b|\bpub\b|brewery|brew ?pub|brewing|tap ?room|beer garden|beer hall|biergarten|wine bar|winery|cocktail|\blounge\b|tavern|saloon|distillery|cidery|speakeasy|izakaya/.test(
      g,
    )
  )
    return "BarOrPub";

  // --- Culture / entertainment ---
  if (/museum/.test(g)) return "Museum";
  if (/art gallery|\bgallery\b/.test(g)) return "ArtGallery";
  if (/aquarium/.test(g)) return "Aquarium";
  if (/\bzoo\b|safari park|wildlife park|petting zoo/.test(g)) return "Zoo";
  if (/\blibrary\b/.test(g)) return "Library";
  if (/movie theat|cinema|multiplex/.test(g)) return "MovieTheater";
  if (/music venue|event venue|live music|concert hall|amphitheat/.test(g)) return "EventVenue";
  if (/performing arts|playhouse|opera house|\btheat(er|re)\b/.test(g)) return "PerformingArtsTheater";
  if (/amusement|theme park|water park/.test(g)) return "AmusementPark";

  // --- Outdoors ---
  if (/\bpark\b|garden|playground|picnic|green ?space|botanical/.test(g)) return "Park";
  if (
    /hiking|\bhike\b|\btrail\b|nature preserve|nature reserve|wildlife refuge|wildlife reserve|wildlife sanctuary|scenic|observation|overlook|lookout|viewpoint|\bvista\b|natural feature|\bmountain\b|\bpeak\b|\bsummit\b|waterfall|\bbeach\b|landmark|monument|tourist attraction|visitor center|cultural landmark|historical place|historic site|point of interest/.test(
      g,
    )
  )
    return "TouristAttraction";

  // --- Wellness / fitness ---
  if (/\bgym\b|fitness|crossfit|pilates|yoga/.test(g)) return "ExerciseGym";
  if (/\bspa\b|day spa|massage|sauna|nail salon|hair salon|barbershop|\bbeauty\b/.test(g))
    return "HealthAndBeautyBusiness";

  // --- Retail (last: "shop"/"store" appear in many food types handled above) ---
  if (/grocery|supermarket|\bmarket\b|\bstore\b|\bshop\b|boutique|\bmall\b|bookstore/.test(g))
    return "Store";

  return null;
}
