// Hash routing for the SPA shell, extracted from App.tsx (2026-08).
// `#/weekend` | `#/browse` | `#/event/<slug>` | `#/spot/<id>` | `#/plans[/<id>]`,
// plus the path-based `/<metro>/event/<slug>/` handoff from prerendered SEO
// pages. main.tsx handles `#/p/…` and `#/card/…` before App mounts.

import { APP_AUDIENCE } from "./appConfig";

export type AppRoute = {
  view: "browse" | "plans" | "event" | "weekend";
  planId: string | null;
  eventSlug: string | null;
  /** Spot to open on the map (from a shared `#/spot/<id>` deep link). */
  focusSpotId: string | null;
};

// Kids land on the decision-first Weekend feed; the map ("Explore") is one
// tap away. Adults (Mosey) keep the map-first landing — hangout discovery is
// spontaneous, not weekend-anchored.
export const DEFAULT_VIEW: AppRoute["view"] =
  APP_AUDIENCE === "kids" ? "weekend" : "browse";

export function readAppRoute(): AppRoute {
  const browse: AppRoute = {
    view: "browse",
    planId: null,
    eventSlug: null,
    focusSpotId: null,
  };
  const landing: AppRoute = { ...browse, view: DEFAULT_VIEW };
  if (typeof window === "undefined") {
    return landing;
  }
  const hash = window.location.hash;
  if (hash.startsWith("#/p/")) {
    // Poll route — main.tsx handles rendering. App still mounts when the user
    // navigates back, so default to the landing view.
    return landing;
  }
  if (hash.startsWith("#/weekend")) {
    return { ...browse, view: "weekend" };
  }
  // Explicit map request (incl. "#/browse?hopnow=1" from static SEO pages).
  if (hash.startsWith("#/browse")) {
    return browse;
  }
  // Per ADR-04: the SPA hash route is `#/event/<slug>`. The prerendered SEO
  // path `/<metro>/events/<slug>/` is a sibling surface, not handled here.
  const eventMatch = hash.match(/^#\/event\/(.+)$/);
  if (eventMatch) {
    return {
      view: "event",
      planId: null,
      eventSlug: decodeURIComponent(eventMatch[1]),
      focusSpotId: null,
    };
  }
  // Shareable spot deep link: opens the spot's map sheet (one-shot — the hash
  // then normalizes to #/browse). Uses the stable spot id, so it resolves for
  // any spot regardless of the prerendered spot-page cap.
  const spotMatch = hash.match(/^#\/spot\/(.+)$/);
  if (spotMatch) {
    return { ...browse, focusSpotId: decodeURIComponent(spotMatch[1]) };
  }
  const planMatch = hash.match(/^#\/plans\/(.+)$/);
  if (planMatch) {
    return {
      view: "plans",
      planId: decodeURIComponent(planMatch[1]),
      eventSlug: null,
      focusSpotId: null,
    };
  }
  if (hash === "#/plans") {
    return { ...browse, view: "plans" };
  }
  // Prerendered event SEO pages are path-based (/<metro>/event/<slug>/). A human
  // with JS who lands there from search or a shared link should open the in-app
  // event detail, not bounce to browse. The path slug equals event.slug, and the
  // metro is resolved from the same path, so EventDetailView finds the event.
  const eventPathMatch = window.location.pathname.match(/\/event\/([^/]+)\/?$/);
  if (eventPathMatch) {
    return {
      view: "event",
      planId: null,
      eventSlug: decodeURIComponent(eventPathMatch[1]),
      focusSpotId: null,
    };
  }
  return landing;
}

export function buildAppHash(
  view: AppRoute["view"],
  planId: string | null,
  eventSlug: string | null,
): string {
  if (view === "event" && eventSlug) {
    return `#/event/${encodeURIComponent(eventSlug)}`;
  }
  if (view === "plans") {
    return planId ? `#/plans/${encodeURIComponent(planId)}` : "#/plans";
  }
  if (view === "weekend") return "#/weekend";
  if (view === "browse") return "#/browse";
  return "#/";
}
