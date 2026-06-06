import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaTypeForGoogleType } from "../scripts/lib/placeSchemaType.mjs";

test("maps the high-frequency food types to Restaurant", () => {
  for (const t of [
    "Restaurant",
    "Italian Restaurant",
    "Mexican Restaurant",
    "Fast Food Restaurant",
    "Sushi Restaurant",
    "Ramen Restaurant",
    "Dim Sum Restaurant",
    "Barbecue Restaurant",
    "Korean Barbecue Restaurant",
    "Steak House",
    "Diner",
    "Bistro",
    "Sandwich Shop",
    "Deli",
  ]) {
    assert.equal(schemaTypeForGoogleType(t), "Restaurant", t);
  }
});

test("maps coffee/tea types to CafeOrCoffeeShop", () => {
  for (const t of ["Coffee Shop", "Cafe", "Café", "Tea House", "Juice Shop", "Espresso Bar"]) {
    assert.equal(schemaTypeForGoogleType(t), "CafeOrCoffeeShop", t);
  }
});

test("maps baked-goods shops to Bakery, sweets to FoodEstablishment", () => {
  assert.equal(schemaTypeForGoogleType("Bakery"), "Bakery");
  assert.equal(schemaTypeForGoogleType("Bagel Shop"), "Bakery");
  assert.equal(schemaTypeForGoogleType("Donut Shop"), "Bakery");
  assert.equal(schemaTypeForGoogleType("Ice Cream Shop"), "FoodEstablishment");
  assert.equal(schemaTypeForGoogleType("Dessert Shop"), "FoodEstablishment");
  assert.equal(schemaTypeForGoogleType("Chocolate Shop"), "FoodEstablishment");
});

test("maps nightlife types to BarOrPub / NightClub", () => {
  assert.equal(schemaTypeForGoogleType("Bar"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Sports Bar"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Wine Bar"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Lounge bar"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Brewery"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Brewpub"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Cocktail Lounge"), "BarOrPub");
  assert.equal(schemaTypeForGoogleType("Night Club"), "NightClub");
  assert.equal(schemaTypeForGoogleType("Nightclub"), "NightClub");
});

test("ORDERING: food beats bar/cafe/store when both keywords present", () => {
  // "Oyster Bar Restaurant" has both "bar" and "restaurant" — food must win.
  assert.equal(schemaTypeForGoogleType("Oyster Bar Restaurant"), "Restaurant");
  // "Sushi Bar" is food, not a bar.
  assert.equal(schemaTypeForGoogleType("Sushi Bar"), "Restaurant");
  // gastropub serves food.
  assert.equal(schemaTypeForGoogleType("Gastropub"), "Restaurant");
  // "Ice Cream Shop" / "Bagel Shop" contain "shop" but are food, not Store.
  assert.equal(schemaTypeForGoogleType("Ice Cream Shop"), "FoodEstablishment");
  assert.equal(schemaTypeForGoogleType("Bagel Shop"), "Bakery");
});

test("maps culture/entertainment types", () => {
  assert.equal(schemaTypeForGoogleType("Museum"), "Museum");
  assert.equal(schemaTypeForGoogleType("Art museum"), "Museum"); // "Art museum" → Museum, not gallery
  assert.equal(schemaTypeForGoogleType("History Museum"), "Museum");
  assert.equal(schemaTypeForGoogleType("Art Gallery"), "ArtGallery");
  assert.equal(schemaTypeForGoogleType("Aquarium"), "Aquarium");
  assert.equal(schemaTypeForGoogleType("Zoo"), "Zoo");
  assert.equal(schemaTypeForGoogleType("Library"), "Library");
  assert.equal(schemaTypeForGoogleType("Movie Theater"), "MovieTheater");
  assert.equal(schemaTypeForGoogleType("Performing Arts Theater"), "PerformingArtsTheater");
  assert.equal(schemaTypeForGoogleType("Live Music Venue"), "EventVenue");
  assert.equal(schemaTypeForGoogleType("Event Venue"), "EventVenue");
  assert.equal(schemaTypeForGoogleType("Amusement Center"), "AmusementPark");
});

test("ORDERING: 'Movie Theater' beats the generic theater rule", () => {
  // Both rules could match "theater"; movie must win.
  assert.equal(schemaTypeForGoogleType("Movie Theater"), "MovieTheater");
});

test("maps outdoors types", () => {
  for (const t of ["Park", "City Park", "State Park", "Playground", "Picnic Ground", "Botanical Garden", "Garden"]) {
    assert.equal(schemaTypeForGoogleType(t), "Park", t);
  }
  for (const t of [
    "Hiking Area",
    "Nature Preserve",
    "Wildlife Refuge",
    "Scenic Spot",
    "Observation Deck",
    "Historical Landmark",
    "Monument",
    "Tourist Attraction",
    "Visitor Center",
    "Mountain Peak",
  ]) {
    assert.equal(schemaTypeForGoogleType(t), "TouristAttraction", t);
  }
});

test("maps wellness + retail", () => {
  assert.equal(schemaTypeForGoogleType("Yoga Studio"), "ExerciseGym");
  assert.equal(schemaTypeForGoogleType("Fitness Center"), "ExerciseGym");
  assert.equal(schemaTypeForGoogleType("Nail Salon"), "HealthAndBeautyBusiness");
  assert.equal(schemaTypeForGoogleType("Massage"), "HealthAndBeautyBusiness");
  assert.equal(schemaTypeForGoogleType("Grocery Store"), "Store");
  assert.equal(schemaTypeForGoogleType("Book Store"), "Store");
  assert.equal(schemaTypeForGoogleType("Boutique"), "Store");
});

test("returns null for absent / unrecognized types (caller falls back to category)", () => {
  assert.equal(schemaTypeForGoogleType(null), null);
  assert.equal(schemaTypeForGoogleType(undefined), null);
  assert.equal(schemaTypeForGoogleType(""), null);
  assert.equal(schemaTypeForGoogleType(123), null);
  // Data-quality noise / mismatched OSM venues — must NOT be force-typed.
  assert.equal(schemaTypeForGoogleType("Apartment Building"), null);
  assert.equal(schemaTypeForGoogleType("Bus stop"), null);
  assert.equal(schemaTypeForGoogleType("Elementary School"), null);
  assert.equal(schemaTypeForGoogleType("Cemetery"), null);
  assert.equal(schemaTypeForGoogleType("Chiropractor"), null);
  assert.equal(schemaTypeForGoogleType("Bridge"), null);
});
