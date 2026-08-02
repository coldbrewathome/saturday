// Category-based hero images for events. Events don't carry photos in the
// feed data, so cards/detail pages use a curated Unsplash fallback per event
// category — the same proven photo ids the spot pipeline already ships
// (public/data/*/spots.json), so they are known to load.

import type { FamilyEvent } from "./App";

const CATEGORY_PHOTO: Record<string, string> = {
  Library: "1485738422979-f5c462d49f74",
  Museum: "1485738422979-f5c462d49f74",
  Community: "1518998053901-5348d3961a04",
  Festival: "1418065460487-3e41a6c84dc5",
  Zoo: "1441974231531-c6227db76b6e",
  Farm: "1418065460487-3e41a6c84dc5",
  Park: "1441974231531-c6227db76b6e",
  Music: "1518998053901-5348d3961a04",
  Comedy: "1506629082955-511b1aa562c8",
  Brewery: "1481833761820-0509d3217039",
  Food: "1481833761820-0509d3217039",
};

const FALLBACK_PHOTO = "1464822759023-fed622ff2c3b";

export function eventImage(event: FamilyEvent, width = 1200): string | null {
  const id = CATEGORY_PHOTO[event.category] ?? FALLBACK_PHOTO;
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;
}

/** Small crop for feed cards. */
export function eventImageSmall(event: FamilyEvent): string {
  return eventImage(event, 400)!;
}
