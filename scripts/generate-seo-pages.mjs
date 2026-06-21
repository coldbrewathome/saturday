#!/usr/bin/env node
// Generates static SEO pages and a dynamic sitemap from the metro spot + event
// datasets. Runs after `vite build` so output lands in dist/.
//
// Output layout:
//   dist/<metro>/spot/<slug>/index.html     — one per spot (Place JSON-LD)
//   dist/<metro>/event/<slug>/index.html    — one per event (Event JSON-LD)
//   dist/<metro>/city/<slug>/index.html     — one per city with content
//   dist/sitemap.xml                — overwrites the static sitemap with full URL list

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
} from "./metroConfig.mjs";
import { THEMES, classifyEventThemes } from "./eventThemes.mjs";
import { schemaTypeForGoogleType } from "./lib/placeSchemaType.mjs";
import {
  defaultLocale,
  supportedLocales,
  localeConfig,
  routeMap,
  subMetroCities,
  subMetroLabels,
  getAlternateLinks,
  findRouteKey,
  t,
} from "../i18n/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "public", "data");
const metroConfig = loadMetroConfig();
const BUILD_ENV = readBuildEnv();

function envValue(name, fallback = "") {
  return process.env[name] || BUILD_ENV[name] || fallback;
}

// SEO output adapts to the same VITE_APP_AUDIENCE the SPA reads. Defaults
// to the kids brand. Override with VITE_APP_AUDIENCE=adults at build time
// (the `npm run build:adults` script sets it via .env.adults + Vite).
const APP_AUDIENCE = envValue("VITE_APP_AUDIENCE", "kids");
const IS_ADULTS = APP_AUDIENCE === "adults";

// Mosey (adults) is a Bay Area-only product for now: the adults build
// generates pages and the sitemap for bay-area alone so trymosey.com never
// indexes thin pages for metros the client app does not offer.
if (IS_ADULTS) {
  metroConfig.metros = metroConfig.metros.filter((m) => m.id === "bay-area");
}

const SITE = envValue("VITE_APP_SITE_URL").replace(/\/$/, "") ||
  (IS_ADULTS ? "https://trymosey.com" : "https://famhop.com");
const BRAND = envValue("VITE_APP_BRAND", IS_ADULTS ? "Mosey" : "FamHop");
const BRAND_TAG = IS_ADULTS ? "hangout planner" : "family weekend planner";

// Audience-aware copy for the canonical homepage + metro landing pages. The
// long-tail per-spot/event/city templates below still use kids phrasing —
// de-kid-ifying those is the tracked "content/parity audit" follow-up.
const SHELL_TITLE = IS_ADULTS
  ? `${BRAND} hangout planner by metro`
  : `${BRAND} family weekend planner by metro`;
const SHELL_DESC = IS_ADULTS
  ? `${BRAND} helps adults find good places to hang out — cafes, bars, parks, music, and local events — solo or with friends, across major U.S. metros.`
  : `${BRAND} helps families find kid-friendly spots, family events, and ready-made weekend plans across major U.S. metros.`;
const metroSeoTitle = (label) =>
  IS_ADULTS ? `${label} hangout planner | ${BRAND}` : `${label} family weekend planner | ${BRAND}`;
const metroSeoDesc = (label) =>
  IS_ADULTS
    ? `Find good places to hang out in ${label} — cafes, bars, parks, music, and local events — plus ready-made plans with ${BRAND}.`
    : `Find family-friendly parks, libraries, museums, events, and ready-made weekend plans in ${label} with ${BRAND}.`;
const metroCardBlurb = (label) =>
  IS_ADULTS
    ? `Browse things to do and good places to hang out in ${label}.`
    : `Browse family activities, events, and kid-friendly places in ${label}.`;
const siteAltNames = IS_ADULTS
  ? [`${BRAND} hangout planner`, "places to hang out", "things to do near me"]
  : [`${BRAND} weekend planner`, "family events near me", "things to do with kids this weekend"];

// Audience-aware copy fragments reused across the per-spot/event/city/category
// page templates so the adults (Mosey) build reads as adult hangout content,
// not kids/family. `friendlyAdj` is the adjective prefix ("family-friendly " vs
// none); the rest are whole phrases.
const A = IS_ADULTS
  ? {
      friendlyAdj: "",
      spotLabel: "spot",
      thingsToDoIn: (c) => `Things to do in ${c}`,
      thingsToDoLower: "things to do",
      placesAndEvents: "places and events",
      cityActivities: "things to do",
      eventsAdj: "",
      voters: "friends",
      planNoun: "hangout",
      withWhom: "with friends",
    }
  : {
      friendlyAdj: "family-friendly ",
      spotLabel: "family-friendly spot",
      thingsToDoIn: (c) => `Things to do with kids in ${c}`,
      thingsToDoLower: "things to do with kids",
      placesAndEvents: "family-friendly places and events",
      cityActivities: "family activities",
      eventsAdj: "family ",
      voters: "co-parents and friends",
      planNoun: "weekend plan",
      withWhom: "with the kids",
    };
const OG_IMAGE = envValue("VITE_APP_OG_IMAGE", `${SITE}/og-image.png`);
const POLLS_API = envValue("VITE_POLLS_API").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = envValue("VITE_GOOGLE_CLIENT_ID");
// Google Search Console ownership verification. Optional: set
// GSC_VERIFICATION_FAMHOP (kids) / GSC_VERIFICATION_MOSEY (adults) at build
// time to emit the google-site-verification meta tag into the SPA shells and
// every prerendered page. Unset = no tag (no-op).
const GSC_VERIFICATION = envValue(
  IS_ADULTS ? "GSC_VERIFICATION_MOSEY" : "GSC_VERIFICATION_FAMHOP",
);
// Build timestamp surfaced as `verifiedAt` in Event JSON-LD so crawlers and
// assistants can tell how fresh each listing is.
const BUILD_VERIFIED_AT = new Date().toISOString();
// Spot pages are the bulk of the deployment (Cloudflare Pages caps a deploy
// at 20k files). 300/metro × 16 metros plus capped event pages keeps the kids
// build comfortably under ~19k even as event datasets grow; the quality gate
// in generateSpotPages decides *which* spots make the cut.
const MAX_SPOT_PAGES_PER_METRO = Number(process.env.SEO_MAX_SPOT_PAGES_PER_METRO || 300);
// Cloudflare Pages caps a deployment at 20k files. As the event dataset grows
// (big metros have thousands of mostly-recurring instances in the 45-day
// window), uncapped event pages blow that. Keep the soonest-N upcoming events
// per metro. Capped-out *current* events keep their in-app #/event/<slug>
// route (served by the SPA shell); they just lack a prerendered page and are
// excluded from the sitemap — they are NOT mislabeled as "ended" (see caller).
const MAX_EVENT_PAGES_PER_METRO = Number(process.env.SEO_MAX_EVENT_PAGES_PER_METRO || 800);
// Also bounded by the 20k-file Pages limit. Ended-event stubs are noindex
// bounce pages (lowest SEO value), so when a dataset has a large recently-
// expired tail they are the first thing to cap. Default uncapped (preserves
// kids behavior); the adults build sets this since its dataset overflows 20k.
const MAX_ENDED_STUBS = Number(process.env.SEO_MAX_ENDED_STUBS || Infinity);
// The shared metroDataFile() only knows the kids filenames. For the adults
// (Mosey) build, metroDataPath() reads these audience-specific files so SEO
// pages are built from adult spots/events (bars, music, etc.), not kids data.
const ADULTS_DATA_FILES = {
  spots: "spots-adults.json",
  events: "events-adults.json",
  featuredPlans: "featured-plans-adults.json",
};
// Global budget across ALL metros (not per-metro), so it reliably bounds the
// total deployment file count regardless of how stubs distribute by metro.
let endedStubBudget = MAX_ENDED_STUBS;

function capEventsForPages(events) {
  if (events.length <= MAX_EVENT_PAGES_PER_METRO) return events;
  const FAR = "9999"; // undated (recurring) events sort last → dropped first
  return [...events]
    .sort((a, b) => (a.startDateTime || FAR).localeCompare(b.startDateTime || FAR))
    .slice(0, MAX_EVENT_PAGES_PER_METRO);
}
const SEO_PINNED_PATHS = readJson(path.join(ROOT, "data", "seo-pinned-paths.json")) || {};
const FREE_CATEGORIES = new Set(["Library", "Park"]);
function eventLikelyFree(event) {
  if (typeof event.cost === "string" && /free/i.test(event.cost)) return true;
  if (typeof event.cost === "string" && event.cost !== "Unknown" && !/free/i.test(event.cost)) return false;
  return FREE_CATEGORIES.has(event.category);
}
let activeMetro = metroConfig.defaultMetro;
// Event-page slugs actually written per metro (set in main()); the localized
// weekend guides run after the main loop and reuse it to avoid linking to
// capped-out event pages.
const generatedEventSlugsByMetro = new Map();
// Restrict an event→slug lookup to events whose pages were generated. Every
// consumer (timeline renderer, highlights, JSON-LD ItemList) already falls
// back to the official event URL when the lookup misses.
function lookupOfGenerated(lookup, generatedSlugs) {
  const filtered = new Map();
  for (const [event, slug] of lookup) {
    if (generatedSlugs.has(slug)) filtered.set(event, slug);
  }
  return filtered;
}
let sitemapEntries = [
  { loc: `${SITE}/`, lastmod: today(), changefreq: "daily", priority: 1.0 },
];
// Filter the data feed to the app's audience the same way the SPA does at
// runtime, so static SEO pages never expose entries the app would hide.
function audienceVisible(item) {
  if (!item) return false;
  const tags = Array.isArray(item.audiences) ? item.audiences : null;
  if (!tags || tags.length === 0) return true;
  return tags.includes(APP_AUDIENCE) || tags.includes("all");
}

// Defined inline because generateCategoryPages references it during the
// top-level execution. Keep ordering stable.
const KIDS_CATEGORY_PAGES = [
  {
    slug: "library",
    label: "Library events",
    title: "Bay Area library events for kids",
    blurb:
      "Free family storytimes, maker programs, and special weekend events at public libraries across the San Francisco Bay Area — SFPL, OPL, SJPL, county systems, and more.",
    spotMatch: (s) => /library/i.test(`${s.name} ${s.tags?.join(" ") || ""}`),
    eventMatch: (e) => e.category === "Library",
  },
  {
    slug: "museum",
    label: "Museums",
    title: "Bay Area museums for kids and families",
    blurb:
      "Family-friendly museums in the Bay Area: hands-on science, art, history, and children's museums, plus their upcoming free days and family programs.",
    spotMatch: (s) => /museum|science/i.test(`${s.name} ${s.tags?.join(" ") || ""}`),
    eventMatch: (e) => e.category === "Museum",
  },
  {
    slug: "park",
    label: "Parks & outdoors",
    title: "Bay Area parks and outdoor spots for kids",
    blurb:
      "Family-friendly parks, playgrounds, regional open space and outdoor adventures across San Francisco, the Peninsula, the East Bay, and the South Bay.",
    spotMatch: (s) => s.category === "Outdoors" || s.category === "Wellness",
    eventMatch: (e) => e.category === "Park",
  },
  {
    slug: "festival",
    label: "Festivals",
    title: "Bay Area family festivals and weekend events",
    blurb:
      "Free and ticketed family festivals, street fairs, cultural celebrations, and weekend events for kids in the Bay Area.",
    spotMatch: () => false,
    eventMatch: (e) => e.category === "Festival",
  },
  {
    slug: "zoo",
    label: "Zoos & aquariums",
    title: "Bay Area zoos and aquariums for kids",
    blurb:
      "Family-friendly zoos and aquariums in the Bay Area — daily animal programs, Junior Keeper days, and weekend events.",
    spotMatch: (s) => /zoo|aquarium/i.test(`${s.name} ${s.tags?.join(" ") || ""}`),
    eventMatch: (e) => e.category === "Zoo",
  },
  {
    slug: "farm",
    label: "Family farms",
    title: "Family farms and U-pick spots in the Bay Area",
    blurb:
      "Bay Area family farms, petting zoos, U-pick orchards, and farm-day events for kids across the Peninsula, South Bay, and East Bay.",
    spotMatch: (s) => /farm|orchard/i.test(`${s.name} ${s.tags?.join(" ") || ""}`),
    eventMatch: (e) => e.category === "Farm",
  },
  {
    slug: "community",
    label: "Community events",
    title: "Bay Area community events for families",
    blurb:
      "Open houses, free previews, neighborhood events, and community gatherings for families across the Bay Area.",
    spotMatch: () => false,
    eventMatch: (e) => e.category === "Community",
  },
];

// Adult (Mosey) category landing pages — built from the adult dataset's real
// categories (bars, food, music, museums, outdoors, festivals) rather than the
// kids taxonomy (zoos, farms, library storytimes).
const ADULT_CATEGORY_PAGES = [
  {
    slug: "bars",
    label: "Bars & nightlife",
    title: "Bay Area bars & nightlife",
    blurb:
      "Cocktail bars, breweries, wine bars, and late-night spots across the San Francisco Bay Area — solo or with friends.",
    spotMatch: (s) => s.category === "Nightlife",
    eventMatch: () => false,
  },
  {
    slug: "food",
    label: "Food & drink",
    title: "Bay Area restaurants & food spots",
    blurb:
      "Restaurants, cafes, food halls, and standout bites across the San Francisco Bay Area for a meal out or a casual hang.",
    spotMatch: (s) => s.category === "Food",
    eventMatch: (e) => e.category === "Market",
  },
  {
    slug: "music",
    label: "Live music",
    title: "Bay Area live music & shows",
    blurb:
      "Live music, concerts, and gigs across the San Francisco Bay Area, pulled from official venue calendars.",
    spotMatch: () => false,
    eventMatch: (e) => e.category === "Music",
  },
  {
    slug: "museum",
    label: "Museums & galleries",
    title: "Bay Area museums & galleries",
    blurb:
      "Museums, galleries, and exhibitions across the San Francisco Bay Area — current shows, late nights, and member events.",
    spotMatch: (s) =>
      s.category === "Culture" || /museum|gallery/i.test(`${s.name} ${s.tags?.join(" ") || ""}`),
    eventMatch: (e) => e.category === "Museum" || e.category === "Culture",
  },
  {
    slug: "outdoors",
    label: "Parks & outdoors",
    title: "Bay Area parks & outdoor spots",
    blurb:
      "Parks, trails, gardens, and outdoor hangs across San Francisco, the Peninsula, the East Bay, and the South Bay.",
    spotMatch: (s) => s.category === "Outdoors" || s.category === "Wellness",
    eventMatch: () => false,
  },
  {
    slug: "festival",
    label: "Festivals & events",
    title: "Bay Area festivals & events",
    blurb:
      "Festivals, street fairs, markets, and cultural events across the San Francisco Bay Area.",
    spotMatch: () => false,
    eventMatch: (e) => e.category === "Festival" || e.category === "Community",
  },
];

const CATEGORY_PAGES = IS_ADULTS ? ADULT_CATEGORY_PAGES : KIDS_CATEGORY_PAGES;

const PAGE_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap");
:root{--font-ui:"Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--font-display:"Bricolage Grotesque","Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,sans-serif;--bg:#faf5eb;--surface:#fff;--surface-strong:#f2ead9;--line:#e8dfca;--ink:#1b1916;--muted:#6b7280;--blue:#5a7896;--accent:#dd6a1a;--accent-strong:#b8541a;--accent-soft:#fdece7;--fact-bg:#fff8ec;--fact-border:rgba(245,158,11,.22);--chip-bg:#fff3d5;--chip-border:rgba(245,158,11,.3);--chip-ink:#8a4f00;--brand:var(--accent);--brand-strong:var(--accent-strong);--card:var(--surface);--glass-bg:rgba(250,245,235,.82);--glass-blur:blur(20px) saturate(160%);--glass-border:.5px solid rgba(255,255,255,.6);--glass-shadow:0 6px 24px rgba(0,0,0,.08);--glass-radius:16px;--overlay-gap:16px;}
${IS_ADULTS ? `:root{--bg:#f3f0fa;--surface-strong:#e8e2f4;--line:#d4cde5;--ink:#1e1a2b;--muted:#6b6580;--blue:#3b5998;--accent:#7c3aed;--accent-strong:#5b21b6;--accent-soft:#ede5fc;--fact-bg:#f4f0fc;--fact-border:rgba(124,58,237,.18);--chip-bg:#ede5fc;--chip-border:rgba(124,58,237,.3);--chip-ink:#5b21b6;--glass-bg:rgba(243,240,250,.85);--glass-border:.5px solid rgba(124,58,237,.15);--font-display:"Inter",ui-sans-serif,system-ui,sans-serif;}` : ""}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 var(--font-ui);background:var(--bg);color:var(--ink);}
button,input,select,textarea{font:inherit}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.famhop-topbar{align-items:center;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border:var(--glass-border);border-radius:var(--glass-radius);box-shadow:0 1px 0 rgba(255,255,255,.6) inset,var(--glass-shadow);column-gap:12px;display:flex;flex-wrap:nowrap;left:var(--overlay-gap);margin:0;max-width:none;min-height:62px;padding:8px 12px;position:fixed;right:var(--overlay-gap);row-gap:0;top:var(--overlay-gap);z-index:500;}
.famhop-brand{align-items:center;color:var(--ink);display:flex;flex:0 0 auto;font-weight:800;gap:8px;margin-right:4px;}
.famhop-brand:hover{text-decoration:none;}
.famhop-mark{align-items:center;display:inline-flex;flex:0 0 auto;justify-content:center;}
.famhop-wordmark{color:var(--ink);font-family:var(--font-display);font-size:1.15rem;font-weight:700;letter-spacing:-.02em;line-height:1;margin:0;}
.famhop-metro{align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:8px;display:inline-flex;flex:0 0 auto;gap:6px;padding:7px 10px 7px 12px;}
.famhop-metro-prefix{color:var(--muted);font-size:.78rem;font-weight:500;line-height:normal;}
.famhop-metro select{appearance:none;-webkit-appearance:none;background-color:transparent;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%236b7280' d='M0 0h10L5 6z'/></svg>");background-position:right 0 center;background-repeat:no-repeat;border:0;color:var(--ink);cursor:pointer;font:inherit;font-family:var(--font-display);font-size:.88rem;font-weight:700;letter-spacing:-.01em;line-height:normal;outline:0;overflow:hidden;padding:0 16px 0 0;width:140px;min-width:140px;max-width:140px;text-overflow:ellipsis;white-space:nowrap;}
.famhop-tabs{align-items:center;background:var(--surface-strong);border-radius:999px;display:inline-flex;flex:0 0 auto;gap:2px;padding:3px;}
.famhop-tabs a{align-items:center;background:transparent;border:0;border-radius:999px;color:var(--muted);display:inline-flex;font:600 .78rem/1 var(--font-ui);gap:5px;padding:6px 12px;text-decoration:none;transition:background .15s ease,color .15s ease;}
.famhop-tabs a:hover{color:var(--ink);text-decoration:none;}
.famhop-tabs a[aria-current="page"]{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06);color:var(--ink);}
.famhop-tabs svg{height:14px;width:14px;}
.famhop-tabs .tab-count{background:rgba(0,0,0,.06);border-radius:999px;color:var(--muted);font-size:.72rem;font-style:normal;font-weight:700;margin-left:2px;padding:1px 6px;}
.famhop-tabs a[aria-current="page"] .tab-count{background:var(--accent-soft);color:var(--brand-strong);}
.famhop-topbar-spacer{flex:1 1 auto;}
.famhop-auth{display:flex;flex:0 0 auto;justify-content:flex-end;}
.famhop-auth-link{align-items:center;background:var(--surface-strong);border:1px solid var(--line);border-radius:999px;color:var(--muted);display:flex;height:40px;justify-content:center;text-decoration:none;width:40px;}
.famhop-auth-link:hover{border-color:var(--brand);color:var(--brand);text-decoration:none;}
.famhop-auth-link svg{height:16px;width:16px;}
.famhop-auth .user-chip{align-items:center;background:#fff;border:1px solid var(--line);border-radius:999px;display:inline-flex;gap:8px;padding:4px 12px 4px 4px;}
.famhop-auth .user-chip-avatar{background:none;border:0;border-radius:50%;cursor:pointer;display:flex;padding:0;text-decoration:none;}
.famhop-auth .user-chip-avatar img{border-radius:50%;height:28px;width:28px;}
.famhop-auth .user-avatar-fallback{align-items:center;background:var(--surface-strong);border:1px solid var(--line);border-radius:50%;color:var(--muted);display:flex;height:28px;justify-content:center;width:28px;}
.famhop-auth .user-avatar-fallback svg{height:14px;width:14px;}
.famhop-auth .user-name{color:var(--ink);font-size:.86rem;font-weight:800;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.famhop-auth .text-button{align-items:center;background:transparent;border:0;color:var(--blue);display:inline-flex;font-size:.78rem;font-weight:800;gap:6px;justify-content:center;padding:0;text-decoration:none;}
.famhop-auth .text-button:hover{color:var(--brand);text-decoration:none;}
.famhop-auth .sync-pill{background:var(--accent-soft);border-radius:999px;color:var(--brand-strong);font-size:.7rem;font-style:normal;font-weight:900;letter-spacing:.04em;padding:2px 6px;}
.famhop-auth .signin-wrap{align-items:center;display:flex;justify-content:flex-end;min-height:40px;}
.famhop-auth .signin-slot{align-items:center;display:inline-flex;min-height:36px;}
.famhop-auth .signin-wrap .user-avatar-fallback{border-radius:999px;display:none;height:40px;text-decoration:none;width:40px;}
.famhop-auth .signin-wrap.no-google .user-avatar-fallback{display:flex;}
.famhop-auth .signin-error{color:var(--brand-strong);font-size:.72rem;font-weight:800;margin-left:8px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.famhop-page{max-width:780px;margin:0 auto;padding:108px 24px 56px;}
.famhop-page h1{font-size:34px;line-height:1.18;margin:8px 0 18px;letter-spacing:-.01em;}
.eyebrow{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:600;margin:0 0 4px;}
.lede{font-size:18px;color:#33332e;margin:8px 0 22px;}
.breadcrumb{font-size:13px;color:var(--muted);margin-bottom:6px;}
.breadcrumb ol{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px;}
.breadcrumb li+li::before{content:"›";margin-right:6px;color:var(--muted);}
.hero{margin:0 0 24px;border-radius:14px;overflow:hidden;background:#eee;}
.hero img{display:block;width:100%;height:auto;}
.hero figcaption{padding:6px 10px;font-size:12px;color:var(--muted);}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:18px 0;}
.meta-grid dt{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:2px;}
.meta-grid dd{margin:0;font-size:15px;}
.tags{margin:18px 0;}
.chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;font-size:13px;color:var(--ink);}
.cta-row{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0;}
.cta,.cta-secondary{display:inline-block;padding:12px 18px;border-radius:999px;font-weight:700;font-size:15px;}
.cta{background:var(--brand);color:#fff;}
.cta:hover{filter:brightness(.95);text-decoration:none;}
.cta-secondary{background:#fff;border:1px solid var(--line);color:var(--ink);}
.see-also{margin-top:28px;color:var(--muted);}
.card-list{list-style:none;padding:0;margin:14px 0 26px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;}
.card-list li{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;}
.card-list li a{color:var(--ink);}
.card-list li a:hover strong{color:var(--brand);}
.card-list li p{margin:6px 0 0;color:var(--muted);font-size:14px;}
.cat-rating{display:inline-block;margin-top:4px;color:var(--brand-strong,var(--brand));font-weight:700;font-size:13px;}
.guide-summary{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;margin:20px 0 24px;box-shadow:0 12px 30px rgba(34,34,31,.05);}
.guide-summary h2,.guide-day h2{font-size:22px;line-height:1.25;margin:0 0 10px;}
.guide-summary p{margin:0 0 12px;color:var(--muted);}
.guide-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0 0;}
.guide-fact{background:var(--fact-bg);border:1px solid var(--fact-border);border-radius:12px;padding:12px;}
.guide-fact strong{display:block;font-size:22px;line-height:1;color:var(--brand-strong);}
.guide-fact span{display:block;margin-top:5px;color:var(--muted);font-size:13px;font-weight:700;}
.guide-highlights{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:10px;}
.guide-highlights li{border-top:1px solid var(--line);padding-top:10px;}
.guide-highlights a{color:var(--ink);font-weight:800;}
.guide-presets,.guide-editorial,.guide-newsletter{margin:26px 0;}
.guide-section-heading{margin:0 0 12px;}
.guide-section-heading h2{font-size:22px;line-height:1.25;margin:0 0 6px;}
.guide-section-heading p{color:var(--muted);margin:0;}
.guide-preset-grid,.guide-editorial-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;}
.guide-preset-card,.guide-editorial-card,.guide-newsletter{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:0 10px 28px rgba(34,34,31,.05);}
.guide-preset-card h3,.guide-editorial-card h3{font-size:18px;line-height:1.25;margin:0 0 6px;}
.guide-preset-card p,.guide-editorial-card p{color:var(--muted);font-size:14px;margin:0 0 10px;}
.guide-mini-list{display:grid;gap:8px;list-style:none;margin:12px 0;padding:0;}
.guide-mini-list li{border-top:1px solid var(--line);padding-top:8px;}
.guide-mini-list a{color:var(--ink);font-size:14px;font-weight:900;}
.guide-mini-list span{color:var(--muted);display:block;font-size:12px;font-weight:700;margin-top:2px;}
.guide-card-cta{display:inline-flex;align-items:center;background:var(--brand);border-radius:999px;color:#fff;font-size:14px;font-weight:900;margin-top:4px;padding:9px 13px;}
.guide-card-cta:hover{filter:brightness(.95);text-decoration:none;}
.guide-newsletter{display:grid;gap:12px;}
.guide-newsletter h2{font-size:22px;line-height:1.25;margin:0;}
.guide-newsletter p{color:var(--muted);margin:0;}
.guide-newsletter form{display:grid;gap:10px;grid-template-columns:minmax(0,1fr) 150px auto;}
.guide-newsletter input,.guide-newsletter select{background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:11px 12px;width:100%;}
.guide-newsletter button{background:var(--brand);border:0;border-radius:999px;color:#fff;cursor:pointer;font-weight:900;padding:11px 16px;}
.guide-newsletter button:hover{filter:brightness(.95);}
.guide-newsletter-status{color:var(--muted);font-size:13px;font-weight:700;min-height:18px;}
.guide-day{margin:30px 0 0;}
.guide-day-note{color:var(--muted);font-size:14px;margin:0 0 12px;}
.timeline-list{list-style:none;margin:0;padding:0;display:grid;gap:12px;}
.timeline-card{background:var(--card);border:1px solid var(--line);border-radius:16px;display:grid;grid-template-columns:92px minmax(0,1fr);gap:16px;padding:16px;box-shadow:0 10px 28px rgba(34,34,31,.05);}
.timeline-time{color:var(--brand-strong);font-size:15px;font-weight:900;line-height:1.2;}
.timeline-time span{display:block;color:var(--muted);font-size:12px;font-weight:800;margin-top:4px;}
.timeline-card h3{font-size:18px;line-height:1.25;margin:4px 0 6px;}
.timeline-card h3 a{color:var(--ink);}
.timeline-meta{color:var(--muted);font-size:14px;font-weight:700;margin:0 0 8px;}
.timeline-desc{color:#3b3b35;font-size:14px;margin:0 0 10px;}
.timeline-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;}
.timeline-links a{font-size:14px;font-weight:800;}
.event-chip{display:inline-block;background:var(--chip-bg);border:1px solid var(--chip-border);border-radius:999px;color:var(--chip-ink);font-size:11px;font-weight:900;letter-spacing:.07em;padding:3px 8px;text-transform:uppercase;}
.timeline-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 4px;}
.quality-chip{display:inline-block;border:1px solid var(--line);border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.06em;padding:3px 8px;text-transform:uppercase;}
.quality-high{background:#ecfdf5;border-color:#a7f3d0;color:#047857;}
.quality-medium{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
.quality-low{background:#fff7ed;border-color:#fed7aa;color:#9a3412;}
.famhop-lang-switcher{display:flex;gap:4px;align-items:center;justify-content:flex-end;max-width:1500px;margin:78px auto 0;padding:0 var(--overlay-gap);font-size:13px;font-weight:600;}
.famhop-lang-switcher a{color:var(--muted);padding:4px 8px;border-radius:6px;text-decoration:none;}
.famhop-lang-switcher a:hover{color:var(--ink);background:var(--surface-strong);}
.famhop-lang-switcher a[aria-current="page"]{color:var(--ink);background:var(--surface);border:1px solid var(--line);}
@media (max-width:820px){.famhop-lang-switcher{margin-top:66px;padding:0 12px;}}
.famhop-footer{border-top:1px solid var(--line);padding:24px 28px;color:var(--muted);font-size:13px;}
.famhop-footer p{margin:0 0 4px;}
@media (max-width:820px){.famhop-topbar{column-gap:5px;flex-wrap:nowrap;left:12px;min-height:0;padding:8px;right:12px;row-gap:0;}.famhop-brand{gap:5px;margin-right:0;min-width:0;order:1;}.famhop-mark svg{height:20px;width:20px;}.famhop-wordmark{display:block;font-size:.9rem;letter-spacing:0;max-width:none;overflow:visible;white-space:nowrap;}.famhop-metro{flex:1 1 72px;max-width:none;min-width:72px;order:2;padding:5px 6px 5px 7px;}.famhop-metro-prefix{display:none;}.famhop-metro select{font-family:var(--font-ui);font-size:.76rem;max-width:none;min-width:0;overflow:hidden;padding-right:11px;text-overflow:ellipsis;width:100%;}.famhop-tabs{flex:0 0 88px;margin-left:0;order:3;width:88px;}.famhop-tabs a{font-size:0;gap:0;padding:5px 6px;}.famhop-tabs svg{height:14px;width:14px;}.famhop-tabs .tab-count{display:none;}.famhop-topbar-spacer{display:none;}.famhop-auth{flex:0 0 40px;justify-content:flex-end;margin-left:0;order:4;width:40px;}.famhop-auth .user-chip{gap:0;padding:0;}.famhop-auth .user-name,.famhop-auth .sync-pill,.famhop-auth .text-button,.famhop-auth .signin-error{display:none;}.famhop-auth .signin-wrap{min-height:32px;}.famhop-auth .signin-slot{min-height:32px;}.famhop-auth .user-chip-avatar,.famhop-auth .user-chip-avatar img,.famhop-auth .user-avatar-fallback{height:32px;width:32px;}.famhop-auth .user-avatar-fallback svg{height:16px;width:16px;}}
@media (max-width:640px){.famhop-page{padding:100px 18px 40px;}.famhop-page h1{font-size:28px;}.guide-newsletter form{grid-template-columns:1fr;}.timeline-card{grid-template-columns:1fr;gap:8px}.timeline-time{display:flex;gap:8px;align-items:baseline}.timeline-time span{margin-top:0}}
@media (max-width:370px){.famhop-topbar{column-gap:4px;left:10px;right:10px;}.famhop-wordmark{font-size:.84rem;max-width:none;}.famhop-metro{flex-basis:68px;min-width:68px;padding-left:5px;padding-right:5px;}.famhop-metro select{font-size:.72rem;}.famhop-tabs{flex-basis:76px;width:76px;}.famhop-tabs a{padding:5px 4px;}}

/* Interactive Timeline Filters */
.timeline-filters-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 20px;
  margin: 24px 0;
  box-shadow: 0 10px 30px rgba(34, 34, 31, 0.04);
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: all 0.25s ease;
}
.filters-header {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--surface-strong);
  padding-bottom: 12px;
}
.filters-header h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
}
.filters-icon {
  color: var(--brand);
}
.filters-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  width: 90px;
  flex-shrink: 0;
}
.filter-options {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.filter-chip {
  background: var(--surface-strong);
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
}
.filter-chip:hover {
  background: var(--surface-strong);
  color: var(--ink);
  border-color: var(--line);
}
.filter-chip.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
  box-shadow: 0 4px 12px rgba(221, 106, 26, 0.25);
}
.filter-row-secondary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: center;
}
@media (max-width: 640px) {
  .filter-row-secondary {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
.category-filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
}
.select-wrapper {
  position: relative;
  flex-grow: 1;
}
.filter-select {
  width: 100%;
  appearance: none;
  -webkit-appearance: none;
  background: var(--surface-strong);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 32px 8px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  outline: none;
}
.filter-select:hover {
  border-color: var(--brand);
}
.select-wrapper::after {
  content: "";
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 5px solid var(--muted);
  pointer-events: none;
}
.filter-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--surface-strong);
  padding-top: 12px;
  margin-top: 4px;
}
.filter-results-count {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
}
.clear-filters-btn {
  background: transparent;
  border: 0;
  color: var(--brand-strong);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
}
.clear-filters-btn:hover {
  background: var(--accent-soft);
  text-decoration: none;
}
.no-events-found-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  margin: 32px 0;
  box-shadow: 0 10px 28px rgba(34,34,31,.04);
}
.no-events-icon {
  color: var(--muted);
  margin-bottom: 12px;
}
.no-events-found-card p {
  font-size: 15px;
  color: var(--muted);
  margin: 0 0 16px;
  max-width: 320px;
}
.no-events-found-card button {
  padding: 10px 20px;
  font-size: 14px;
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
}
`;

// Guarded so tests can import the exported helpers (spotPassesQualityGate,
// formatWeekendRange) without generating pages. The call itself lives at the
// bottom of the file: main() runs during module evaluation, so it must come
// after every top-level const it depends on (e.g. JUNK_CHAIN_NAME_RE) — only
// function declarations hoist.
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function main() {
  if (!fs.existsSync(DIST)) {
    console.error(`[seo] dist/ not found at ${DIST} — run \`vite build\` first.`);
    process.exit(1);
  }

  generateRootAppShellPage();

  let totalSpotPages = 0;
  let totalEventPages = 0;
  let totalCityPages = 0;
  let totalCategoryPages = 0;
  let totalWeekendPages = 0;
  let totalWeekendSubPages = 0;
  let totalEndedEventStubs = 0;

  for (const metro of metroConfig.metros) {
    activeMetro = metro;

    const spotsDoc = readJson(metroDataPath(metro, "spots"));
    const eventsDoc = readJson(metroDataPath(metro, "events"));

    // Merge the enrichment sidecar (Google ratings, etc.) by spot id — same as the
    // runtime app — so spot pages can emit aggregateRating rich snippets.
    const enrichmentDoc = readJson(metroDataPath(metro, "enrichment"));
    const enrichmentEntries = enrichmentDoc?.entries ?? {};
    const spots = (Array.isArray(spotsDoc?.spots) ? spotsDoc.spots : [])
      .filter(audienceVisible)
      .map((spot) => {
        const extra = enrichmentEntries[spot.id];
        return extra ? { ...spot, ...extra } : spot;
      });
    const events = (Array.isArray(eventsDoc?.events) ? eventsDoc.events : []).filter(
      audienceVisible,
    );

    // Spots referenced by editor's picks / featured plans pass the spot-page
    // quality gate even without rating data.
    const featuredPlansDoc = readJson(metroDataPath(metro, "featuredPlans"));
    const featuredSpotIds = new Set(
      (Array.isArray(featuredPlansDoc?.plans) ? featuredPlansDoc.plans : [])
        .filter(audienceVisible)
        .flatMap((plan) => (Array.isArray(plan.stopIds) ? plan.stopIds : [])),
    );

    const spotSlugLookup = buildSpotSlugLookup(spots);
    const eventSlugLookup = buildEventSlugLookup(events);
    const citySlugsPre = getGeneratedCitySlugs(spots, events);

    const spotSlugs = generateSpotPages(spots, spotSlugLookup, citySlugsPre, featuredSpotIds);
    // Full set of current-dataset slugs — used to suppress "ended" stubs so a
    // capped-out *live* event isn't falsely stubbed (it just has no page).
    const allCurrentEventSlugs = new Set();
    for (const ev of events) {
      const s = eventSlugLookup.get(ev);
      if (s) allCurrentEventSlugs.add(s);
    }
    const eventSlugs = generateEventPages(capEventsForPages(events), eventsDoc?.generatedAt, eventSlugLookup, citySlugsPre);
    generatedEventSlugsByMetro.set(metro.id, eventSlugs);
    const { slugs: citySlugs, cities } = generateCityPages(spots, events, spotSlugLookup, eventSlugLookup, spotSlugs, eventSlugs);
    const categorySlugs = generateCategoryPages(spots, events, spotSlugLookup, eventSlugLookup, spotSlugs, eventSlugs);
    const cityCategorySlugs = generateCityCategoryPages(spots, events, spotSlugLookup, eventSlugLookup, spotSlugs, eventSlugs, cities);
    // Weekend guides link events through this lookup; restrict it to events
    // whose pages were actually written so capped-out events fall back to
    // their official link instead of a broken internal one.
    const weekendEventLookup = lookupOfGenerated(eventSlugLookup, eventSlugs);
    const wroteThisWeekend = generateThisWeekendPage(events, weekendEventLookup);
    totalWeekendSubPages +=
      generateCityWeekendPages(events, weekendEventLookup) +
      generateFreeThisWeekendPage(events, weekendEventLookup);

    generateMetroAppShellPage(metro, categorySlugs);

    const slugHistory = readEventSlugHistory(metro);
    totalEndedEventStubs += generateEndedEventStubs(
      slugHistory,
      allCurrentEventSlugs,
      events,
      eventSlugLookup,
      eventSlugs,
      spots,
      spotSlugLookup,
      spotSlugs
    );
    writeEventSeoManifest(metro, events, eventSlugLookup, allCurrentEventSlugs, eventSlugs, slugHistory);

    totalSpotPages += spotSlugs.size;
    totalEventPages += eventSlugs.size;
    totalCityPages += citySlugs.size;
    totalCategoryPages += categorySlugs.size + cityCategorySlugs.size;
    totalWeekendPages += wroteThisWeekend ? 1 : 0;
  }

  const totalLocalizedPages = IS_ADULTS ? 0 : generateLocalizedWeekendPages();

  writeSitemap(sitemapEntries);
  writeRobotsAndLlms();

  console.log(
    `[seo] wrote ${totalSpotPages} spot pages, ${totalEventPages} event pages, ${totalEndedEventStubs} ended-event stubs, ${totalCityPages} city pages, ${totalCategoryPages} category pages, ${totalWeekendPages} this-weekend pages, ${totalWeekendSubPages} city/free weekend pages, ${totalLocalizedPages} localized i18n pages, sitemap with ${sitemapEntries.length} URLs.`,
  );
}

// Keep robots.txt pointed at this build's own sitemap (the static public/
// robots.txt hardcodes famhop.com), and give the adults build its own
// Mosey-branded llms.txt instead of the shared FamHop one.
function writeRobotsAndLlms() {
  fs.writeFileSync(
    path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
  );
  if (!IS_ADULTS) {
    patchKidsLlmsCoverage();
    return;
  }
  const metroLines = metroConfig.metros
    .map((m) => `- ${m.seoName || m.label || m.id}: ${SITE}${String(m.canonicalPath || "").replace(/\/?$/, "/")}`)
    .join("\n");
  const metroSlugs = metroConfig.metros.map((m) => m.id).join("`, `");
  // Mosey is a Bay Area-only beta (metroConfig.metros is filtered above), so
  // describe the actual coverage instead of claiming "major U.S. metros".
  const regionPhrase = metroConfig.metros.length === 1
    ? `in the ${metroConfig.metros[0].seoName || metroConfig.metros[0].label || metroConfig.metros[0].id}`
    : "across major U.S. metros";
  const llms = `# ${BRAND}

> ${BRAND} helps adults find good places to hang out — solo or with friends — ${regionPhrase}. Visitors pick a metro and a vibe, and ${BRAND} builds a 3-stop hangout from cafes, bars, restaurants, parks, music, and local events.

${BRAND} is a JavaScript single-page app at ${SITE}. Static SEO pages and machine-readable data are published per metro so crawlers can read the coverage without executing JavaScript.

## Coverage

${metroLines}

## URL Schema

- Metro home: \`${SITE}/{metro}/\`
- This weekend: \`${SITE}/{metro}/this-weekend/\`
- Place pages: \`${SITE}/{metro}/spot/{slug}/\`
- Event pages: \`${SITE}/{metro}/event/{slug}/\`
- City pages: \`${SITE}/{metro}/city/{slug}/\`
- Category pages: \`${SITE}/{metro}/category/{bars|food|music|museum|outdoors|festival}/\`

Supported metro slugs: \`${metroSlugs}\`.

## API

${BRAND} exposes a small, CORS-enabled, read-only JSON API so assistants and agents can build real plans from the live data. Both accept GET (query string) or POST (JSON body).

### ${SITE}/api/plan
Builds a short adults itinerary. Params: \`metro\` (required), \`vibe\` (balanced | low-effort | active | food-first | culture), \`audience\` (defaults to adults on this host), \`events\` (false to exclude), \`limit\` (1-5). Example: \`${SITE}/api/plan?metro=bay-area&vibe=food-first\`

### ${SITE}/api/search
Keyword lookup over places and events. Params: \`metro\` (required), \`q\` (required), \`type\` (places | events | all), \`limit\` (1-50). Example: \`${SITE}/api/search?metro=bay-area&q=cocktail\`

## Data Sources

Place data is from OpenStreetMap (ODbL). Events are pulled from official venue calendars and public feeds for bars, breweries, music venues, museums, and festivals. Every record carries an \`audiences\` array (\`adults\`, \`kids\`, or \`all\`); ${BRAND} shows records tagged for adults or all audiences.

## Brand

- Product name: ${BRAND}
- Tagline: Find your spot.
- Domain: ${SITE.replace(/^https?:\/\//, "")}
- Sitemap: ${SITE}/sitemap.xml
`;
  fs.writeFileSync(path.join(DIST, "llms.txt"), llms);
}

// The kids llms.txt prose lives in public/llms.txt (copied into dist by
// Vite), but its Coverage list and supported-slug sentence drift when metros
// are added (audit: honolulu + austin were missing). Rewrite both from
// data/metros.json on every build so they can never drift again.
function patchKidsLlmsCoverage() {
  const file = path.join(DIST, "llms.txt");
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, "utf8");
  const coverageLines = metroConfig.metros
    .map((m) => `- ${m.seoName || m.label || m.id}: ${SITE}${String(m.canonicalPath || `/${m.id}`).replace(/\/?$/, "/")}`)
    .join("\n");
  // The Coverage block is the only list of "- Name: https://..." lines.
  text = text.replace(
    /^- [^:\n]+: https:\/\/[^\n]+(?:\n- [^:\n]+: https:\/\/[^\n]+)*/m,
    coverageLines,
  );
  const slugs = metroConfig.metros.map((m) => `\`${m.id}\``);
  const slugSentence = `Supported metro slugs are ${slugs.slice(0, -1).join(", ")}, and ${slugs[slugs.length - 1]}.`;
  text = text.replace(/^Supported metro slugs are [^\n]+$/m, slugSentence);
  fs.writeFileSync(file, text);
}

function metroDataPath(metro, key) {
  if (IS_ADULTS && ADULTS_DATA_FILES[key]) {
    const adultPath = path.join(
      ROOT,
      "public",
      "data",
      metro.dataDir || metro.id,
      ADULTS_DATA_FILES[key],
    );
    if (fs.existsSync(adultPath)) return adultPath;
  }
  const primary = path.join(ROOT, metroDataFile(metro, key));
  if (fs.existsSync(primary)) return primary;
  const legacy = legacyMetroDataFile(metro, key);
  return legacy ? path.join(ROOT, legacy) : primary;
}

// Per ADR-04: the pipeline writes data/<metro>/event-slug-history.json on
// every ingest run. We read it here to emit "event has ended" noindex stubs
// for one-off URLs that just dropped out of events.json (30-day grace).
function readEventSlugHistory(metro) {
  const file = path.join(ROOT, "data", metro.dataDir || metro.id, "event-slug-history.json");
  if (!fs.existsSync(file)) return { slugs: {} };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || { slugs: {} };
  } catch {
    return { slugs: {} };
  }
}

function metroPath(rel = "") {
  const prefix = String(activeMetro.canonicalPath || "").replace(/\/+$/, "");
  const suffix = String(rel || "").replace(/^\/+/, "");
  if (!suffix) return `${prefix || ""}/`;
  return `${prefix}/${suffix}`.replace(/\/{2,}/g, "/");
}

function metroUrl(rel = "") {
  return `${SITE}${metroPath(rel)}`;
}

function writeMetroPage(rel, html) {
  const prefix = String(activeMetro.canonicalPath || "").replace(/^\/+|\/+$/g, "");
  writePage(path.posix.join(prefix, rel), html);
}

function metroLabel() {
  return activeMetro.seoName || activeMetro.label || "your city";
}

function metroTag() {
  return `${metroLabel()} ${BRAND_TAG}`;
}

function metroLinksHtml() {
  return metroConfig.metros
    .map((metro) => {
      const label = esc(metro.seoName || metro.label || metro.id);
      const href = `${SITE}${String(metro.canonicalPath || "").replace(/\/+$/, "")}/`;
      const current = metro.id === activeMetro.id ? ` aria-current="page"` : "";
      return `<a href="${esc(href)}"${current}>${label}</a>`;
    })
    .join("");
}

function metroHrefFor(metro, rel = "") {
  const prefix = String(metro.canonicalPath || "").replace(/\/+$/, "");
  const suffix = String(rel || "").replace(/^\/+/, "");
  const pathname = suffix ? `${prefix}/${suffix}` : `${prefix || ""}/`;
  return `${SITE}${pathname}`.replace(/(?<!:)\/{2,}/g, "/");
}

function metroSelectOptionsHtml(rel = "") {
  return metroConfig.metros
    .map((metro) => {
      const label = esc(metro.label || metro.seoName || metro.id);
      const selected = metro.id === activeMetro.id ? " selected" : "";
      return `<option value="${esc(metroHrefFor(metro, rel))}"${selected}>${label}</option>`;
    })
    .join("");
}

function topbarIcon(name) {
  const paths = {
    explore: `<path d="M12 21s7-6.2 7-12A7 7 0 0 0 5 9c0 5.8 7 12 7 12Z"></path><circle cx="12" cy="9" r="2.5"></circle>`,
    guide: `<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6h4"></path>`,
    plans: `<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>`,
    users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>`,
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

function brandMarkSvg() {
  return `<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--brand)"></rect><path d="M 14 46 Q 32 18 50 46" stroke="#fff" stroke-width="3" stroke-dasharray="3 4" stroke-linecap="round" fill="none"></path><circle cx="14" cy="46" r="3.5" fill="#fff"></circle><circle cx="50" cy="46" r="3.5" fill="#fff"></circle><circle cx="32" cy="24" r="9" fill="#fff"></circle><circle cx="29.5" cy="21.5" r="2.4" fill="var(--brand)" opacity=".55"></circle></svg>`;
}

function activeMetroStorageKey(suffix) {
  return activeMetro.id === "bay-area"
    ? `saturday.${suffix}`
    : `saturday.${activeMetro.id}.${suffix}`;
}

function renderStaticTopbar({ guideCurrent = false } = {}) {
  const guideRel = "this-weekend/";
  return `<header class="famhop-topbar">
  <a class="famhop-brand" href="${metroPath("")}" aria-label="${esc(BRAND)} home">
    <span class="famhop-mark">${brandMarkSvg()}</span>
    <span class="famhop-wordmark">${esc(BRAND)}</span>
  </a>
  <label class="famhop-metro" title="Browsing ${esc(activeMetro.label || metroLabel())}">
    <span class="famhop-metro-prefix">in</span>
    <select aria-label="Choose metro area" onchange="if(this.value) window.location.href=this.value">
      ${metroSelectOptionsHtml(guideCurrent ? guideRel : "")}
    </select>
  </label>
  <nav class="famhop-tabs" aria-label="View">
    <a href="${metroPath("")}#/browse">${topbarIcon("explore")}<span>Explore</span></a>
    <a href="${metroPath(guideRel)}"${guideCurrent ? ` aria-current="page"` : ""}>${topbarIcon("guide")}<span>Guide</span></a>
    <a href="${metroPath("")}#/plans">${topbarIcon("plans")}<span>Plans</span><em class="tab-count" data-static-plan-count>0</em></a>
  </nav>
  <div class="famhop-topbar-spacer"></div>
  <div class="famhop-auth" data-static-auth data-app-href="${metroPath("")}">
    <div class="signin-wrap" data-static-signin>
      <div class="signin-slot" data-static-signin-slot></div>
      <a class="user-avatar-fallback" href="${metroPath("")}" title="Sign in with Google" aria-label="Open ${esc(BRAND)} app to sign in">${topbarIcon("users")}</a>
      <span class="signin-error" data-static-signin-error hidden></span>
    </div>
  </div>
</header>`;
}

function renderStaticAuthScript() {
  const usersIcon = topbarIcon("users");
  const plansKey = activeMetroStorageKey("plans");
  return `<script>
(() => {
  const sessionKey = "saturday.session";
  const plansKey = ${JSON.stringify(plansKey)};
  const apiBase = ${JSON.stringify(POLLS_API)};
  const googleClientId = ${JSON.stringify(GOOGLE_CLIENT_ID)};
  const root = document.querySelector("[data-static-auth]");
  const countEl = document.querySelector("[data-static-plan-count]");
  if (!root) return;
  const signedOutHtml = root.innerHTML;
  const usersIcon = ${JSON.stringify(usersIcon)};
  let gisPromise = null;

  function readJsonStorage(storageKey) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    try {
      window.localStorage.setItem(sessionKey, JSON.stringify(session));
    } catch {
      // ignore storage errors
    }
  }

  function readSession() {
    return readJsonStorage(sessionKey);
  }

  function setPlanCount(count) {
    if (!countEl) return;
    const value = Number.isFinite(count) && count > 0 ? count : 0;
    countEl.textContent = String(value);
  }

  function updatePlanCountFromLocal() {
    const plans = readJsonStorage(plansKey);
    setPlanCount(Array.isArray(plans) ? plans.length : 0);
  }

  async function refreshPlanCount(session) {
    updatePlanCountFromLocal();
    if (!apiBase || !session?.token) return;
    try {
      const response = await fetch(apiBase + "/me/state", {
        headers: { authorization: "Bearer " + session.token },
      });
      if (!response.ok) return;
      const body = await response.json();
      const plans = body?.state?.plans;
      if (!Array.isArray(plans)) return;
      try {
        window.localStorage.setItem(plansKey, JSON.stringify(plans));
      } catch {
        // ignore storage errors
      }
      setPlanCount(plans.length);
    } catch {
      // keep the local count if remote sync is unavailable
    }
  }

  function setSignInError(message) {
    const errorEl = root.querySelector("[data-static-signin-error]");
    if (!errorEl) return;
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const src = "https://accounts.google.com/gsi/client";
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Google Identity script failed to load")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("Google Identity script failed to load")), { once: true });
      document.head.appendChild(script);
    });
    return gisPromise;
  }

  async function googleSignIn(idToken) {
    const response = await fetch(apiBase + "/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!response.ok) throw new Error("Sign-in failed (" + response.status + ")");
    return response.json();
  }

  function logoutSession(token) {
    if (!apiBase || !token) return;
    fetch(apiBase + "/auth/logout", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
    }).catch(() => {});
  }

  function setupGoogleSignIn() {
    const wrap = root.querySelector("[data-static-signin]");
    const slot = root.querySelector("[data-static-signin-slot]");
    const fallback = root.querySelector(".signin-wrap .user-avatar-fallback");
    if (!wrap || !slot) return;
    if (!googleClientId || !apiBase) {
      wrap.classList.add("no-google");
      return;
    }
    loadGoogleIdentity()
      .then(() => {
        if (!window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            try {
              const result = await googleSignIn(response.credential);
              const next = {
                token: result.sessionToken,
                user: result.user,
              };
              writeSession(next);
              setSignInError("");
              render();
            } catch (error) {
              setSignInError(error instanceof Error ? error.message : "Sign-in failed");
            }
          },
          ux_mode: "popup",
          use_fedcm_for_button: true,
          use_fedcm_for_prompt: true,
          itp_support: true,
          auto_select: false,
          cancel_on_tap_outside: false,
        });
        slot.innerHTML = "";
        window.google.accounts.id.renderButton(slot, {
          theme: "outline",
          size: "medium",
          type: "icon",
          shape: "circle",
        });
      })
      .catch((error) => {
        wrap.classList.add("no-google");
        setSignInError(error instanceof Error ? error.message : "Sign-in unavailable");
      });
    if (fallback) {
      fallback.addEventListener("click", (event) => {
        const button = slot.querySelector('[role="button"], iframe, div[tabindex]');
        if (button) {
          event.preventDefault();
          button.click();
          return;
        }
        if (window.google?.accounts?.id?.prompt) {
          event.preventDefault();
          window.google.accounts.id.prompt();
        }
      });
    }
  }

  function signOut() {
    const session = readSession();
    logoutSession(session?.token);
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
      window.localStorage.removeItem(sessionKey);
    } catch {
      // ignore storage errors
    }
    render();
  }

  function render() {
    const session = readSession();
    refreshPlanCount(session);
    const user = session?.user;
    if (!user || (!user.name && !user.email)) {
      root.innerHTML = signedOutHtml;
      setupGoogleSignIn();
      return;
    }

    const name = user.name || user.email;
    root.textContent = "";

    const chip = document.createElement("div");
    chip.className = "user-chip";
    if (user.email) chip.title = user.email;

    const avatar = document.createElement("button");
    avatar.type = "button";
    avatar.className = "user-chip-avatar";
    avatar.title = \`Signed in as \${name} - tap to sign out\`;
    avatar.setAttribute("aria-label", \`Signed in as \${name}. Sign out\`);
    avatar.addEventListener("click", signOut);

    if (user.picture) {
      const img = document.createElement("img");
      img.src = user.picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      avatar.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "user-avatar-fallback";
      fallback.innerHTML = usersIcon;
      avatar.appendChild(fallback);
    }

    const label = document.createElement("span");
    label.className = "user-name";
    label.textContent = name;

    const sync = document.createElement("em");
    sync.className = "sync-pill sync-synced";
    sync.title = "Saved + plans synced to your account";
    sync.textContent = "✓";

    const signOutButton = document.createElement("button");
    signOutButton.type = "button";
    signOutButton.className = "text-button";
    signOutButton.title = "Sign out";
    signOutButton.textContent = "Sign out";
    signOutButton.addEventListener("click", signOut);

    chip.append(avatar, label, sync, signOutButton);
    root.appendChild(chip);
  }

  render();
  window.addEventListener("storage", (event) => {
    if (event.key === sessionKey) render();
    if (event.key === plansKey) updatePlanCountFromLocal();
  });
})();
</script>`;
}

function metroText(text) {
  return String(text || "")
    .replace(/San Francisco Bay Area/g, metroLabel())
    .replace(/the Bay Area/g, metroLabel())
    .replace(/Bay Area/g, metroLabel())
    .replace(/Peninsula, South Bay, and East Bay/g, `${metroLabel()} neighborhoods`);
}

function generateMetroAppShellPage(metro, categorySlugs = null) {
  const shellPath = path.join(DIST, "index.html");
  if (!fs.existsSync(shellPath)) return;
  const canonical = metroUrl("");
  const title = metroSeoTitle(metroLabel());
  const description = metroSeoDesc(metroLabel()).slice(0, 300);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        url: `${SITE}/`,
        name: BRAND,
        inLanguage: "en-US",
        publisher: { "@id": `${SITE}/#org` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE}/#org`,
        name: BRAND,
        url: `${SITE}/`,
        logo: `${SITE}/icon-512.png`,
        slogan: "Plan · Hop · Repeat.",
      },
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: title,
        description,
        isPartOf: { "@id": `${SITE}/#website` },
        about: { "@type": "Place", name: metroLabel() },
        audience: {
          "@type": "PeopleAudience",
          suggestedMinAge: 0,
          suggestedMaxAge: 14,
        },
      },
    ],
  };
  let html = fs.readFileSync(shellPath, "utf8");
  html = metro.id === metroConfig.defaultMetro.id ? html : metroText(html);
  html = replaceMetroShellCopy(html, title, description, categorySlugs);
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">${safeJsonScript(jsonLd)}</script>`,
  );
  html = upsertHeadTag(html, "title", esc(title));
  html = upsertMeta(html, "name", "description", description);
  html = upsertLink(html, "canonical", canonical);
  html = upsertMeta(html, "property", "og:title", title);
  html = upsertMeta(html, "property", "og:description", description);
  html = upsertMeta(html, "property", "og:image:alt", title);
  html = upsertMeta(html, "property", "og:url", canonical);
  html = upsertMeta(html, "name", "twitter:title", title);
  html = upsertMeta(html, "name", "twitter:description", description);
  html = upsertMeta(html, "name", "twitter:image:alt", title);
  writeMetroPage("index.html", html);
  for (const alias of metro.aliases || []) {
    const previousMetro = activeMetro;
    activeMetro = { ...metro, canonicalPath: `/${alias}` };
    writeMetroPage("index.html", html);
    activeMetro = previousMetro;
  }
  sitemapEntries.push({
    loc: canonical,
    lastmod: today(),
    changefreq: "daily",
    priority: metro.id === metroConfig.defaultMetro.id ? 0.95 : 0.9,
  });
}

function generateRootAppShellPage() {
  const shellPath = path.join(DIST, "index.html");
  if (!fs.existsSync(shellPath)) return;
  const title = SHELL_TITLE;
  const description = SHELL_DESC;
  const canonical = `${SITE}/`;
  const metroCards = metroConfig.metros
    .map((metro) => {
      const label = metro.seoName || metro.label || metro.id;
      const href = `${String(metro.canonicalPath || "").replace(/\/+$/, "")}/`;
      return `<li><a href="${esc(href)}"><strong>${esc(label)}</strong><p>${esc(metroCardBlurb(label))}</p></a></li>`;
    })
    .join("");
  const noscript = `
      <noscript>
        <header>
          <h1>${esc(title)}</h1>
          <p>${esc(description)}</p>
        </header>
        <section>
          <h2>Choose your metro</h2>
          <ul>${metroCards}</ul>
        </section>
        <p><strong>Heads-up:</strong> ${esc(BRAND)} is an interactive planner. Please enable JavaScript to plan, share and vote.</p>
      </noscript>`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        url: `${SITE}/`,
        name: BRAND,
        alternateName: siteAltNames,
        description,
        inLanguage: "en-US",
        publisher: { "@id": `${SITE}/#org` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE}/#org`,
        name: BRAND,
        url: `${SITE}/`,
        logo: `${SITE}/icon-512.png`,
        slogan: "Plan · Hop · Repeat.",
      },
      {
        "@type": "ItemList",
        "@id": `${SITE}/#metros`,
        name: `${BRAND} metro areas`,
        itemListElement: metroConfig.metros.map((metro, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: metro.seoName || metro.label || metro.id,
          url: `${SITE}${String(metro.canonicalPath || "").replace(/\/+$/, "")}/`,
        })),
      },
    ],
  };
  let html = fs.readFileSync(shellPath, "utf8");
  html = html
    .replace(/<noscript>[\s\S]*?<\/noscript>/, noscript)
    .replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">${safeJsonScript(jsonLd)}</script>`,
    );
  html = upsertHeadTag(html, "title", esc(title));
  html = upsertMeta(html, "name", "description", description);
  html = upsertLink(html, "canonical", canonical);
  html = upsertMeta(html, "property", "og:title", title);
  html = upsertMeta(html, "property", "og:description", description);
  html = upsertMeta(html, "property", "og:image:alt", title);
  html = upsertMeta(html, "property", "og:url", canonical);
  html = upsertMeta(html, "name", "twitter:title", title);
  html = upsertMeta(html, "name", "twitter:description", description);
  html = upsertMeta(html, "name", "twitter:image:alt", title);
  fs.writeFileSync(shellPath, html);
}

function replaceMetroShellCopy(html, title, description, categorySlugs = null) {
  const area = metroLabel();
  
  const categoriesList = [];
  const allowedCats = IS_ADULTS
    ? [
        { slug: "bars", label: "bars & nightlife" },
        { slug: "food", label: "food & drink" },
        { slug: "music", label: "live music" },
        { slug: "museum", label: "museums" },
        { slug: "outdoors", label: "parks & outdoors" },
      ]
    : [
        { slug: "library", label: "library events" },
        { slug: "museum", label: "museums" },
        { slug: "park", label: "parks and outdoors" },
        { slug: "festival", label: "family festivals" },
      ];
  for (const c of allowedCats) {
    if (!categorySlugs || categorySlugs.has(c.slug)) {
      categoriesList.push(`<a href="${metroPath(`category/${c.slug}/`)}">${esc(c.label)}</a>`);
    }
  }

  const noscript = `
      <noscript>
        <header>
          <h1>${esc(title)}</h1>
          <p>${esc(description)} Search ${IS_ADULTS ? "good spots and upcoming events" : "1,500+ kid-friendly spots and upcoming family events"}, then build a shareable ${A.planNoun}.</p>
        </header>
        <section>
          <h2>What you can do on ${esc(BRAND)}</h2>
          <ul>
            <li>Browse ${A.friendlyAdj}${esc(area)} spots: ${IS_ADULTS ? "cafes, bars, restaurants, parks, music and culture" : "parks, libraries, museums, playgrounds, zoos and family farms"}.</li>
            <li>See upcoming ${A.eventsAdj}events from official calendars.</li>
            ${IS_ADULTS ? "<li>Filter by vibe: chill, foodie, active, music &amp; culture.</li>" : "<li>Filter by age band: toddler, preschool, school-age and tween.</li>"}
            <li>Build a 3-stop plan and share a link so ${A.voters} can vote.</li>
          </ul>
        </section>
        <section>
          <h2>Browse ${esc(area)}</h2>
          <p>
            <a href="${metroPath("this-weekend/")}">Weekend guide</a>${categoriesList.length ? ", " + categoriesList.join(", ") : ""}.
          </p>
        </section>
        <p><strong>Heads-up:</strong> ${esc(BRAND)} is an interactive planner. Please enable JavaScript to plan, share and vote.</p>
      </noscript>`;

  return html
    .replace(/<noscript>[\s\S]*?<\/noscript>/, noscript)
    .replace(
      /Events are pulled directly from public source pages \(libraries like SFPL, SJPL, Oakland; parks; museums; family festivals\) using their official event calendars in JSON-LD, iCal, RSS, LibCal, and dated HTML formats\./g,
      `Events are pulled directly from public source pages for ${area} ${IS_ADULTS ? "music venues, museums, breweries, and festivals" : "libraries, parks, museums, and family venues"}.`,
    )
    .replace(
      /FamHop covers (?:the )?[^.:]+: San Francisco, the Peninsula, the East Bay, the South Bay, and the North Bay\./g,
      `${BRAND} covers ${area} and nearby ${A.placesAndEvents}.`,
    );
}

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

// Spot-page quality gate (audit follow-up: ~70% of sitemap URLs were ~130-word
// spot stubs, including fast-food chains and big-box gyms). Junk names never
// get a prerendered page; beyond that, a spot needs a stable Google rating
// (when the metro has rating data at all) or an editor's-pick/featured-plan
// reference to earn one. Excluded spots also stay out of the sitemap.
const JUNK_CHAIN_NAME_RE =
  /\b(arby'?s|mcdonald'?s?|subway|kfc|wendy'?s|taco bell|burger king|jack in the box|carl'?s jr|domino'?s|pizza hut|little caesars|chick-?fil-?a|popeyes|dunkin'?|sonic drive-?in|whataburger|panda express|chipotle|five guys|starbucks|7-?eleven|circle k)\b/i;
const JUNK_GYM_NAME_RE =
  /\b(ufc gym|anytime fitness|24 hour fitness|planet fitness|crunch fitness|gold'?s gym|la fitness|orangetheory|snap fitness)\b/i;

// Same stable-rating threshold the aggregateRating snippet uses (≥25 reviews).
function hasStableRating(spot) {
  return typeof spot.googleRating === "number" && (spot.googleRatingCount ?? 0) >= 25;
}

export function spotPassesQualityGate(
  spot,
  { adults = false, metroHasRatings = false, featured = false } = {},
) {
  const name = String(spot?.name || "");
  if (!name) return false;
  if (JUNK_CHAIN_NAME_RE.test(name)) return false;
  if (!adults && JUNK_GYM_NAME_RE.test(name)) return false;
  const category = String(spot?.category || "").trim();
  if (!category || /^other$/i.test(category)) return false;
  if (featured) return true;
  if (metroHasRatings && !hasStableRating(spot)) return false;
  return true;
}

// Rank gated spots so the per-metro cap keeps the richest pages (rated, with
// imagery/website/Wikidata/hours) instead of whatever order the dataset is in.
function spotContentScore(spot) {
  let score = 0;
  if (hasStableRating(spot)) score += 4;
  if (spot.imageUrl) score += 2;
  if (spot.website) score += 1;
  if (spot.wikidataId) score += 1;
  if (spot.openingHours) score += 1;
  return score;
}

function generateSpotPages(items, spotSlugLookup, generatedCitySlugs, featuredSpotIds = new Set()) {
  const all = new Map();
  const pinnedSlugs = pinnedSpotSlugsForMetro(activeMetro.id);
  const missingPinnedSlugs = new Set(pinnedSlugs);

  for (const spot of items) {
    const slug = spotSlugLookup.get(spot);
    if (!slug) continue;
    all.set(slug, spot);
    missingPinnedSlugs.delete(slug);
  }

  const aliasCandidates = [];
  const aliasBaseSlugs = new Set();
  for (const pinned of missingPinnedSlugs) {
    const m = /^(.*)-\d+$/.exec(pinned);
    if (!m) continue;
    const base = m[1];
    if (!all.has(base)) continue;
    aliasCandidates.push({ oldSlug: pinned, baseSlug: base, spot: all.get(base) });
    aliasBaseSlugs.add(base);
  }

  const metroHasRatings = [...all.values()].some(hasStableRating);
  const gated = [];
  for (const [slug, spot] of all) {
    const keepAnyway = pinnedSlugs.has(slug) || aliasBaseSlugs.has(slug);
    const passes = spotPassesQualityGate(spot, {
      adults: IS_ADULTS,
      metroHasRatings,
      featured: featuredSpotIds.has(spot.id) || keepAnyway,
    });
    if (passes) gated.push([slug, spot]);
  }
  // Stable sort: best content first, dataset order within ties.
  gated.sort((a, b) => spotContentScore(b[1]) - spotContentScore(a[1]));

  const seen = new Map();
  let uncappedCount = 0;
  for (const [slug, spot] of gated) {
    if (uncappedCount < MAX_SPOT_PAGES_PER_METRO || pinnedSlugs.has(slug) || aliasBaseSlugs.has(slug)) {
      seen.set(slug, spot);
    }
    uncappedCount += 1;
  }

  for (const { oldSlug, baseSlug, spot } of aliasCandidates) {
    if (!seen.has(baseSlug)) continue;
    writeSpotAliasPage(oldSlug, baseSlug, spot);
    missingPinnedSlugs.delete(oldSlug);
  }

  if (missingPinnedSlugs.size) {
    console.warn(
      `[seo] pinned spot slugs not found for ${activeMetro.id}: ${[...missingPinnedSlugs].sort().join(", ")}`,
    );
  }

  for (const [slug, spot] of seen) {
    const canonical = metroUrl(`spot/${slug}/`);
    const cityName = (spot.neighborhood || metroLabel()).trim();
    const citySlug = cityName ? slugify(cityName) : "";
    const showCityLink = citySlug && generatedCitySlugs && generatedCitySlugs.has(citySlug);
    const title = `${spot.name} — ${cityName} ${A.spotLabel} | ${BRAND}`;
    const description = buildSpotDescription(spot);

    const heroImage = spot.imageUrl;
    const detailRows = buildSpotDetailRows(spot);
    const tags = Array.isArray(spot.tags) ? spot.tags.filter(Boolean) : [];

    const body = `
      ${heroImage ? `<figure class="hero"><img src="${esc(heroImage)}" alt="${esc(`${spot.name} in ${cityName}`)}" loading="lazy" decoding="async" width="1200" height="800"><figcaption>${esc(spot.imageAttribution || "")}</figcaption></figure>` : ""}
      <p class="lede">${esc(description)}</p>
      ${detailRows.length ? `<dl class="meta-grid">${detailRows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${r.html}</dd></div>`).join("")}</dl>` : ""}
      ${tags.length ? `<p class="tags">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</p>` : ""}
      <p class="cta-row">
        <a class="cta" href="${metroPath("")}">Plan a day with ${BRAND}</a>
        ${spot.website ? `<a class="cta-secondary" rel="noopener nofollow" href="${esc(spot.website)}">Visit official website</a>` : ""}
      </p>
      ${showCityLink ? `<p class="see-also">See more <a href="${metroPath(`city/${citySlug}/`)}">${A.cityActivities} in ${esc(cityName)}</a>.</p>` : ""}
    `;

    const jsonLd = buildSpotJsonLd(spot, canonical);
    const html = renderShell({
      title,
      description,
      canonical,
      ogImage: heroImage || OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: metroUrl("") },
        showCityLink ? { name: cityName, url: metroUrl(`city/${citySlug}/`) } : null,
        { name: spot.name, url: canonical },
      ].filter(Boolean),
      h1: spot.name,
      eyebrow: `${esc(cityName)}${spot.category ? ` · ${esc(spot.category)}` : ""}`,
      body,
    });

    writeMetroPage(`spot/${slug}/index.html`, html);

    sitemapEntries.push({
      loc: canonical,
      lastmod: spot.updatedAt || today(),
      changefreq: "weekly",
      priority: 0.6,
    });
  }
  return new Set(seen.keys());
}

function writeSpotAliasPage(oldSlug, baseSlug, spot) {
  const canonical = metroUrl(`spot/${baseSlug}/`);
  const cityName = (spot.neighborhood || metroLabel()).trim();
  const title = `${spot.name} — ${cityName} ${A.spotLabel} | ${BRAND}`;
  const description = `${spot.name} in ${cityName} has moved to a new ${BRAND} page.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${esc(canonical)}">
<meta http-equiv="refresh" content="0;url=${esc(canonical)}">
</head>
<body>
<h1>${esc(spot.name)}</h1>
<p>This page has moved. <a href="${esc(canonical)}">Continue to ${esc(spot.name)} in ${esc(cityName)} →</a></p>
<script>location.replace(${JSON.stringify(canonical)});</script>
</body>
</html>`;
  writeMetroPage(`spot/${oldSlug}/index.html`, html);
}

function pinnedSpotSlugsForMetro(metroId) {
  const slugs = SEO_PINNED_PATHS?.metros?.[metroId]?.spotSlugs;
  return new Set(Array.isArray(slugs) ? slugs.filter(Boolean).map(String) : []);
}

function pinnedCitySlugsForMetro(metroId) {
  const slugs = SEO_PINNED_PATHS?.metros?.[metroId]?.citySlugs;
  return new Set(Array.isArray(slugs) ? slugs.filter(Boolean).map(String) : []);
}

function buildSpotDescription(spot) {
  const city = spot.neighborhood || metroLabel();
  const tier = spot.category ? spot.category.toLowerCase() : IS_ADULTS ? "go-to" : "family";
  const tagsBit = Array.isArray(spot.tags) && spot.tags.length
    ? ` Tagged: ${spot.tags.slice(0, 4).join(", ")}.`
    : "";
  const opening = spot.openingHours ? ` Hours: ${spot.openingHours}.` : "";
  const cost = spot.cost ? ` Cost: ${spot.cost}.` : "";
  return `${spot.name} is a ${tier} stop in ${city} for a ${metroLabel()} ${IS_ADULTS ? "day or night out" : "weekend with the kids"}.${cost}${opening}${tagsBit}`.trim().slice(0, 280);
}

function buildSpotDetailRows(spot) {
  const rows = [];
  if (spot.neighborhood) rows.push({ label: "City", html: esc(spot.neighborhood) });
  if (spot.category) rows.push({ label: "Category", html: esc(spot.category) });
  if (spot.cost) rows.push({ label: "Cost", html: esc(spot.cost) });
  if (spot.openingHours) rows.push({ label: "Hours", html: esc(spot.openingHours) });
  if (spot.wheelchair && spot.wheelchair !== "no") {
    rows.push({ label: "Wheelchair access", html: esc(spot.wheelchair) });
  }
  if (spot.dogsAllowed) rows.push({ label: "Dogs allowed", html: esc(String(spot.dogsAllowed)) });
  if (typeof spot.transitMinutes === "number") {
    rows.push({ label: "Typical transit", html: `${spot.transitMinutes} min` });
  }
  if (spot.website) {
    rows.push({
      label: "Website",
      html: `<a rel="noopener nofollow" href="${esc(spot.website)}">${esc(stripProto(spot.website))}</a>`,
    });
  }
  return rows;
}

function buildSpotJsonLd(spot, canonical) {
  // Prefer Google's precise place type (e.g. Restaurant, BarOrPub, Museum) when
  // the spot was enriched; fall back to the coarse category map otherwise.
  const placeType = schemaTypeForGoogleType(spot.googleType) ?? mapPlaceType(spot.category);
  const node = {
    "@context": "https://schema.org",
    "@type": placeType,
    "@id": `${canonical}#place`,
    name: spot.name,
    url: canonical,
    description: buildSpotDescription(spot),
  };
  if (spot.imageUrl) node.image = spot.imageUrl;
  if (spot.neighborhood) {
    node.address = {
      "@type": "PostalAddress",
      addressLocality: spot.neighborhood,
      addressRegion: activeMetro.state || "US",
      addressCountry: "US",
    };
  }
  if (typeof spot.lat === "number" && typeof spot.lon === "number") {
    node.geo = {
      "@type": "GeoCoordinates",
      latitude: spot.lat,
      longitude: spot.lon,
    };
  }
  if (spot.openingHours) node.openingHours = spot.openingHours;
  // Google rating → aggregateRating rich snippet. Require ≥25 reviews (same
  // trust threshold the planner uses) so we only surface stable ratings.
  if (
    typeof spot.googleRating === "number" &&
    (spot.googleRatingCount ?? 0) >= 25
  ) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(spot.googleRating.toFixed(1)),
      reviewCount: spot.googleRatingCount,
    };
  }
  if (spot.website) node.sameAs = [spot.website];
  if (spot.wikidataId) {
    node.sameAs = [...(node.sameAs ?? []), `https://www.wikidata.org/entity/${spot.wikidataId}`];
  }
  return node;
}

function mapPlaceType(category) {
  switch ((category || "").toLowerCase()) {
    case "outdoors":
      return "TouristAttraction";
    case "culture":
      return "TouristAttraction";
    case "food":
      return "Restaurant";
    case "wellness":
      return "LocalBusiness";
    case "shopping":
      return "LocalBusiness";
    default:
      return "Place";
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function generateEventPages(items, generatedAt, eventSlugLookup, generatedCitySlugs) {
  const slugs = new Set();
  for (const event of items) {
    const candidate = eventSlugLookup.get(event);
    if (!candidate) continue;

    const canonical = metroUrl(`event/${candidate}/`);
    const cityName = event.city || event.neighborhood || metroLabel();
    const citySlug = cityName ? slugify(cityName) : "";
    const showCityLink = citySlug && generatedCitySlugs && generatedCitySlugs.has(citySlug);
    const dateStr = formatEventDate(event);
    const title = `${event.title} — ${cityName}${dateStr ? `, ${dateStr}` : ""} | ${BRAND}`;
    const description = buildEventDescription(event, dateStr);

    const detailRows = buildEventDetailRows(event, dateStr);

    const body = `
      <p class="lede">${esc(description)}</p>
      ${detailRows.length ? `<dl class="meta-grid">${detailRows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${r.html}</dd></div>`).join("")}</dl>` : ""}
      <p class="cta-row">
        <a class="cta" href="${metroPath("")}">Plan a day with ${BRAND}</a>
        ${event.url ? `<a class="cta-secondary" rel="noopener nofollow" href="${esc(event.url)}">Event details</a>` : ""}
      </p>
      ${showCityLink ? `<p class="see-also">More <a href="${metroPath(`city/${citySlug}/`)}">${A.thingsToDoLower} in ${esc(cityName)}</a>.</p>` : ""}
    `;

    const jsonLd = buildEventJsonLd(event, canonical);
    const html = renderShell({
      title,
      description,
      canonical,
      ogImage: OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: metroUrl("") },
        showCityLink ? { name: cityName, url: metroUrl(`city/${citySlug}/`) } : null,
        { name: event.title, url: canonical },
      ].filter(Boolean),
      h1: event.title,
      eyebrow: `${esc(cityName)}${dateStr ? ` · ${esc(dateStr)}` : ""}`,
      body,
    });

    writeMetroPage(`event/${candidate}/index.html`, html);
    slugs.add(candidate);

    sitemapEntries.push({
      loc: canonical,
      lastmod: event.fetchedAt || generatedAt || today(),
      changefreq: "daily",
      priority: 0.7,
    });
  }
  return slugs;
}

// Per ADR-04(d): when a one-off event's slug appears in the slug-history
// cache but no longer in the live dataset, emit a noindex "event has ended"
// stub for up to 30 days before dropping the page entirely. Recurring
// templates (entries with isRecurring=true) are skipped — their canonical
// page already comes from the live events.json or — if the template died —
// will simply 404 (future work per the ADR's evergreen-page option).
function generateEndedEventStubs(
  history,
  liveSlugs,
  events,
  eventSlugLookup,
  eventSlugs,
  spots,
  spotSlugLookup,
  spotSlugs,
  now = new Date()
) {
  const stubDays = 30;
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - stubDays);
  const cutoffMs = cutoff.getTime();
  const eligible = [];
  for (const [slug, entry] of Object.entries(history?.slugs || {})) {
    if (!slug || liveSlugs.has(slug)) continue;
    if (entry?.isRecurring) continue;
    const ts = entry?.lastSeenAt ? Date.parse(entry.lastSeenAt) : NaN;
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    eligible.push({ slug, ts });
  }
  // When capped, keep the most recently-seen stubs (closest to still-live),
  // drawing from a global budget shared across every metro.
  eligible.sort((a, b) => b.ts - a.ts);
  const take = Number.isFinite(endedStubBudget)
    ? Math.max(0, Math.min(eligible.length, endedStubBudget))
    : eligible.length;
  const capped = eligible.slice(0, take);
  if (Number.isFinite(endedStubBudget)) endedStubBudget -= capped.length;

  const upcomingEvents = events
    .filter((e) => {
      const slug = eventSlugLookup.get(e);
      return slug && eventSlugs.has(slug) && e.startDateTime && new Date(e.startDateTime) >= now;
    })
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    .slice(0, 5);

  const featuredSpots = spots
    .filter((s) => {
      const slug = spotSlugLookup.get(s);
      return slug && spotSlugs.has(slug);
    })
    .sort((a, b) => {
      const ra = typeof a.googleRating === "number" ? a.googleRating : 0;
      const rb = typeof b.googleRating === "number" ? b.googleRating : 0;
      if (rb !== ra) return rb - ra;

      const ca = typeof a.googleRatingCount === "number" ? a.googleRatingCount : 0;
      const cb = typeof b.googleRatingCount === "number" ? b.googleRatingCount : 0;
      if (cb !== ca) return cb - ca;

      const fa = typeof a.friendScore === "number" ? a.friendScore : 0;
      const fb = typeof b.friendScore === "number" ? b.friendScore : 0;
      return fb - fa;
    })
    .slice(0, 5);

  for (const { slug } of capped) {
    writeEndedEventStub(slug, upcomingEvents, featuredSpots, eventSlugLookup, spotSlugLookup);
  }
  return capped.length;
}

// Edge classification manifest consumed by functions/[[path]].ts. For event
// detail URLs with no prerendered page the function reads this to return the
// right status: 410 for ended slugs, 404 for slugs the catalog never recorded,
// noindex-shell for live-but-capped events. Without it every miss is a 200
// soft-404. Written next to the metro's data so env.ASSETS can serve it.
//   live:     every slug in the current dataset (live, possibly capped-out)
//   ended:    slugs in the rolling 90-day history that are no longer live
//   upcoming: soonest prerendered events, for soft-landing links on 410/404
function writeEventSeoManifest(metro, events, eventSlugLookup, liveSlugs, prerenderedSlugs, slugHistory) {
  const ended = [];
  for (const slug of Object.keys(slugHistory?.slugs || {})) {
    if (slug && !liveSlugs.has(slug)) ended.push(slug);
  }
  const upcoming = events
    .map((ev) => ({ ev, slug: eventSlugLookup.get(ev) }))
    .filter(({ slug }) => slug && prerenderedSlugs.has(slug))
    .sort((a, b) => (a.ev.startDateTime || "").localeCompare(b.ev.startDateTime || ""))
    .slice(0, 10)
    .map(({ ev, slug }) => ({ slug, title: String(ev.title || "").slice(0, 90) }));
  const manifest = {
    schemaVersion: 1,
    metroId: metro.id,
    generatedAt: new Date().toISOString(),
    live: [...liveSlugs],
    ended,
    upcoming,
  };
  const dir = path.join(DIST, "data", metro.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "event-seo-manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
}

function writeEndedEventStub(
  slug,
  upcomingEvents,
  featuredSpots,
  eventSlugLookup,
  spotSlugLookup
) {
  const canonical = metroUrl(`event/${slug}/`);
  const metroHomeUrl = metroUrl("");
  const title = `This event has ended — ${metroLabel()} | ${BRAND}`;
  const description = `This ${metroLabel()} event is no longer scheduled. Browse the latest weekend picks on ${BRAND}.`;

  const centers = activeMetro.spotCoverage?.cityCenters;
  const cityName = Array.isArray(centers) && centers.length > 0 && centers[0] ? centers[0][0] : metroLabel();
  const citySlug = cityName ? slugify(cityName) : "";

  // stableRating helper
  const stableRating = (s) =>
    typeof s.googleRating === "number" && (s.googleRatingCount ?? 0) >= 25;

  let upcomingHtml = "";
  if (upcomingEvents.length > 0) {
    upcomingHtml = `
      <h2>Upcoming Events in ${esc(metroLabel())}</h2>
      <ul class="card-list">
        ${upcomingEvents
          .map((e) => {
            const eSlug = eventSlugLookup.get(e);
            return `
              <li>
                <a href="${metroPath(`event/${eSlug}/`)}"><strong>${esc(e.title)}</strong></a>
                <p>${esc(formatEventDate(e))}${e.venue ? ` · ${esc(e.venue)}` : ""}</p>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  let spotsHtml = "";
  if (featuredSpots.length > 0) {
    spotsHtml = `
      <h2>Featured Spots in ${esc(metroLabel())}</h2>
      <ul class="card-list">
        ${featuredSpots
          .map((s) => {
            const sSlug = spotSlugLookup.get(s);
            const ratingHtml = stableRating(s)
              ? ` <span class="cat-rating">★ ${s.googleRating.toFixed(1)} (${s.googleRatingCount})</span>`
              : "";
            return `
              <li>
                <a href="${metroPath(`spot/${sSlug}/`)}"><strong>${esc(s.name)}</strong></a>
                ${ratingHtml}
                <p>${esc(s.category || "")}${s.neighborhood ? ` · ${esc(s.neighborhood)}` : ""}</p>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  const body = `
    <p class="lede">The event at this link is no longer scheduled. It happened recently or was removed by the organizer.</p>
    <p>You will be redirected to the <a href="${esc(metroHomeUrl)}">${esc(BRAND)} ${esc(metroLabel())} homepage</a> in a few seconds, or you can explore the upcoming events and featured spots below.</p>
    
    ${upcomingHtml}
    ${spotsHtml}
  `;

  const html = renderShell({
    title,
    description,
    canonical,
    ogImage: OG_IMAGE,
    jsonLd: null,
    breadcrumb: [
      { name: BRAND, url: metroUrl("") },
      { name: cityName, url: metroUrl(`city/${citySlug}/`) },
    ],
    h1: "This event has ended",
    eyebrow: metroLabel(),
    body,
    noindex: true,
    refresh: `10;url=${metroHomeUrl}`,
  });

  writeMetroPage(`event/${slug}/index.html`, html);
}

function buildEventDescription(event, dateStr) {
  const where = event.venue || event.city || metroLabel();
  const when = dateStr ? ` on ${dateStr}` : "";
  const cat = event.category ? ` (${event.category})` : "";
  const cost = event.cost && event.cost !== "Unknown" ? ` Cost: ${event.cost}.` : "";
  const ages = !IS_ADULTS && Array.isArray(event.ageBands) && event.ageBands.length
    ? ` Best for: ${event.ageBands.join(", ")}.`
    : "";
  const desc = (event.description || "").replace(/\s+/g, " ").trim();
  const trimmedDesc = desc.length > 160 ? desc.slice(0, 160) + "…" : desc;
  return `${event.title}${when} at ${where}${cat}.${cost}${ages} ${trimmedDesc}`.trim().slice(0, 300);
}

function buildEventDetailRows(event, dateStr) {
  const rows = [];
  if (dateStr) rows.push({ label: "When", html: esc(dateStr) });
  if (event.venue) rows.push({ label: "Venue", html: esc(event.venue) });
  if (event.city) rows.push({ label: "City", html: esc(event.city) });
  if (event.category) rows.push({ label: "Category", html: esc(event.category) });
  if (event.cost && event.cost !== "Unknown") rows.push({ label: "Cost", html: esc(event.cost) });
  if (!IS_ADULTS && Array.isArray(event.ageBands) && event.ageBands.length) {
    rows.push({ label: "Age bands", html: esc(event.ageBands.join(", ")) });
  }
  if (event.url) {
    rows.push({
      label: "Event page",
      html: `<a rel="noopener nofollow" href="${esc(event.url)}">${esc(stripProto(event.url))}</a>`,
    });
  }
  return rows;
}

function buildEventJsonLd(event, canonical) {
  if (!event.startDateTime) return null;

  const free = eventLikelyFree(event);
  const node = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": `${canonical}#event`,
    name: event.title,
    url: canonical,
    description: buildEventDescription(event, formatEventDate(event)),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    startDate: event.startDateTime,
    // AEO/trust: when this listing was last verified against its source
    // (build time) and the official source URL. Non-schema.org keys are
    // ignored by validators but readable by assistants and LLM crawlers.
    verifiedAt: BUILD_VERIFIED_AT,
  };
  const officialUrl = event.sourceUrl || event.url;
  if (officialUrl) node.sourceUrl = officialUrl;
  if (free) node.isAccessibleForFree = true;
  if (event.endDateTime) node.endDate = event.endDateTime;
  if (event.imageUrl) {
    node.image = event.imageUrl;
  } else {
    node.image = OG_IMAGE;
  }
  const venue = event.venue || event.city;
  if (venue) {
    node.location = {
      "@type": "Place",
      name: venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.city || metroLabel(),
        addressRegion: activeMetro.state || "US",
        addressCountry: "US",
      },
    };
    if (typeof event.lat === "number" && typeof event.lon === "number") {
      node.location.geo = {
        "@type": "GeoCoordinates",
        latitude: event.lat,
        longitude: event.lon,
      };
    }
  }
  if (event.sourceName) {
    node.organizer = {
      "@type": "Organization",
      name: event.sourceName,
      url: event.sourceUrl || event.url || canonical,
    };
  }
  if (event.url) {
    let price = null;
    if (free) {
      price = "0";
    } else if (event.cost) {
      const costStr = String(event.cost);
      const priceMatch = costStr.match(/([0-9]+(?:\.[0-9]{2})?)/);
      if (priceMatch) {
        price = priceMatch[1];
      }
    }

    if (price !== null) {
      node.offers = {
        "@type": "Offer",
        url: event.url,
        price: price,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      };
    }
  }
  if (!IS_ADULTS && Array.isArray(event.ageBands) && event.ageBands.length) {
    node.audience = {
      "@type": "PeopleAudience",
      audienceType: event.ageBands.join(", "),
    };
  }
  return node;
}

function formatEventDate(event) {
  if (!event.startDateTime) return "";
  const d = new Date(event.startDateTime);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });
}

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

function generateCityPages(spotItems, eventItems, spotSlugLookup, eventSlugLookup, spotSlugs, eventSlugs) {
  const byCity = new Map();

  function bucket(city) {
    if (!city) return null;
    const key = city.trim();
    if (!key) return null;
    if (!byCity.has(key)) byCity.set(key, { name: key, spots: [], events: [] });
    return byCity.get(key);
  }

  for (const spot of spotItems) {
    const b = bucket(spot.neighborhood);
    if (!b) continue;
    b.spots.push(spot);
  }
  for (const event of eventItems) {
    const b = bucket(event.city || event.neighborhood);
    if (!b) continue;
    b.events.push(event);
  }

  const pinnedCitySlugs = pinnedCitySlugsForMetro(activeMetro.id);
  const missingPinnedCitySlugs = new Set(pinnedCitySlugs);
  const rankedCities = [...byCity.values()]
    .filter((c) => {
      const slug = slugify(c.name);
      missingPinnedCitySlugs.delete(slug);
      return c.spots.length + c.events.length >= 3 || pinnedCitySlugs.has(slug);
    })
    .sort((a, b) => b.spots.length + b.events.length - (a.spots.length + a.events.length));
  const cities = [];
  for (const city of rankedCities) {
    const slug = slugify(city.name);
    if (cities.length < 40 || pinnedCitySlugs.has(slug)) {
      cities.push(city);
    }
  }

  if (missingPinnedCitySlugs.size) {
    console.warn(
      `[seo] pinned city slugs not found for ${activeMetro.id}: ${[...missingPinnedCitySlugs].sort().join(", ")}`,
    );
  }

  const slugs = new Set();

  for (const city of cities) {
    const slug = slugify(city.name);
    if (!slug) continue;
    const canonical = metroUrl(`city/${slug}/`);
    const topSpots = city.spots.slice().sort((a, b) => (b.friendScore || 0) - (a.friendScore || 0)).slice(0, 24);
    const upcomingEvents = city.events
      .slice()
      .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""))
      .slice(0, 24);

    // P3/CTR: lead the title + snippet with the query intent — place first,
    // "family events", and the current year for freshness — and surface a real
    // upcoming date so the SERP snippet reads as current, not evergreen.
    const cityYear = new Date().getUTCFullYear();
    const nextDateStr = upcomingEvents.map((e) => formatEventDate(e)).find(Boolean);
    const freshness = nextDateStr ? ` Next up: ${nextDateStr}.` : "";
    const title = IS_ADULTS
      ? `${city.name} Events & Things to Do (${cityYear}) — ${BRAND}`
      : `${city.name} Family Events & Things to Do (${cityYear}) — ${BRAND}`;
    const description = IS_ADULTS
      ? `Things to do in ${city.name} in ${cityYear}: ${city.events.length} upcoming events plus ${city.spots.length} bars, cafes and venues.${freshness} Plan a day or night with ${BRAND}.`
      : `Family-friendly things to do in ${city.name} in ${cityYear}: ${city.events.length} kid-friendly events plus ${city.spots.length} parks, museums and venues.${freshness} Plan a weekend with ${BRAND}.`;

    const spotsList = topSpots.length
      ? `<section><h2>${IS_ADULTS ? "Spots" : "Family-friendly spots"} in ${esc(city.name)}</h2><ul class="card-list">${topSpots.map((s) => {
          const sslug = spotSlugLookup.get(s);
          if (!sslug) return "";
          if (!spotSlugs.has(sslug)) {
            return `<li><strong>${esc(s.name)}</strong>${s.category ? `<span> · ${esc(s.category)}</span>` : ""}${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
          }
          return `<li><a href="${metroPath(`spot/${sslug}/`)}"><strong>${esc(s.name)}</strong>${s.category ? `<span> · ${esc(s.category)}</span>` : ""}</a>${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
        }).join("")}</ul></section>`
      : "";

    const eventsList = upcomingEvents.length
      ? `<section><h2>Upcoming ${A.eventsAdj}events in ${esc(city.name)}</h2><ul class="card-list">${upcomingEvents.map((e) => {
          const eslug = eventSlugLookup.get(e);
          if (!eslug) return "";
          const dateStr = formatEventDate(e);
          if (!eventSlugs.has(eslug)) {
            return `<li><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}${e.venue ? `<p>${esc(e.venue)}${e.cost && e.cost !== "Unknown" ? ` · ${esc(e.cost)}` : ""}</p>` : ""}</li>`;
          }
          return `<li><a href="${metroPath(`event/${eslug}/`)}"><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</a>${e.venue ? `<p>${esc(e.venue)}${e.cost && e.cost !== "Unknown" ? ` · ${esc(e.cost)}` : ""}</p>` : ""}</li>`;
        }).join("")}</ul></section>`
      : "";

    const body = `
      <p class="lede">${esc(description)}</p>
      <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a day with ${BRAND}</a></p>
      ${spotsList}
      ${eventsList}
    `;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${canonical}#page`,
      url: canonical,
      name: A.thingsToDoIn(city.name),
      description,
      about: {
        "@type": "Place",
        name: city.name,
        address: {
          "@type": "PostalAddress",
          addressLocality: city.name,
          addressRegion: activeMetro.state || "US",
          addressCountry: "US",
        },
      },
    };

    const html = renderShell({
      title,
      description,
      canonical,
      ogImage: OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: metroUrl("") },
        { name: city.name, url: canonical },
      ],
      h1: A.thingsToDoIn(city.name),
      eyebrow: metroTag(),
      body,
    });

    writeMetroPage(`city/${slug}/index.html`, html);
    slugs.add(slug);

    sitemapEntries.push({
      loc: canonical,
      lastmod: today(),
      changefreq: "daily",
      priority: 0.8,
    });
  }
  return { slugs, cities };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function generateCategoryPages(spotItems, eventItems, spotSlugLookup, eventSlugLookup, spotSlugs, eventSlugs) {
  const slugs = new Set();

  // Only trust a Google rating with enough reviews to be stable (matches the
  // planner's threshold). Drives the "best-rated" sort + the star badge.
  const stableRating = (s) =>
    typeof s.googleRating === "number" && (s.googleRatingCount ?? 0) >= 25;
  const ratingBadge = (s) =>
    stableRating(s)
      ? ` <span class="cat-rating">★ ${s.googleRating.toFixed(1)} (${s.googleRatingCount})</span>`
      : "";

  for (const cat of CATEGORY_PAGES) {
    const matchingSpots = spotItems
      .filter((s) => cat.spotMatch(s))
      .sort((a, b) => {
        // Top-rated first (so the page reads as "best {category}"), then by
        // friendScore for unrated venues.
        const ra = stableRating(a) ? a.googleRating : -1;
        const rb = stableRating(b) ? b.googleRating : -1;
        if (rb !== ra) return rb - ra;
        return (b.friendScore || 0) - (a.friendScore || 0);
      })
      .slice(0, 30);
    const matchingEvents = eventItems
      .filter((e) => cat.eventMatch(e))
      .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""))
      .slice(0, 40);

    if (matchingSpots.length + matchingEvents.length === 0) continue;

    const canonical = metroUrl(`category/${cat.slug}/`);
    // High-intent, rating-led title ("best bars in {metro}" queries).
    const pageName = `Best ${cat.label.toLowerCase()} in ${metroLabel()}`;
    const description =
      `${metroText(cat.blurb)} Browse ${matchingSpots.length} ${A.friendlyAdj}spots and ${matchingEvents.length} upcoming events on ${BRAND}.`.slice(
        0,
        300,
      );

    const spotsList = matchingSpots.length
      ? `<section><h2>Top-rated ${esc(cat.label.toLowerCase())}</h2><ul class="card-list">${matchingSpots
          .map((s) => {
            const sslug = spotSlugLookup.get(s);
            if (!sslug) return "";
            if (!spotSlugs.has(sslug)) {
              return `<li><strong>${esc(s.name)}</strong>${s.neighborhood ? `<span> · ${esc(s.neighborhood)}</span>` : ""}${ratingBadge(s)}</li>`;
            }
            return `<li><a href="${metroPath(`spot/${sslug}/`)}"><strong>${esc(s.name)}</strong>${s.neighborhood ? `<span> · ${esc(s.neighborhood)}</span>` : ""}${ratingBadge(s)}</a>${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
          })
          .join("")}</ul></section>`
      : "";

    const eventsList = matchingEvents.length
      ? `<section><h2>Upcoming ${esc(cat.label.toLowerCase())}</h2><ul class="card-list">${matchingEvents
          .map((e) => {
            const eslug = eventSlugLookup.get(e);
            if (!eslug) return "";
            const dateStr = formatEventDate(e);
            if (!eventSlugs.has(eslug)) {
              return `<li><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</li>`;
            }
            return `<li><a href="${metroPath(`event/${eslug}/`)}"><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</a>${e.venue ? `<p>${esc(e.venue)}${e.city ? `, ${esc(e.city)}` : ""}${e.cost && e.cost !== "Unknown" ? ` · ${esc(e.cost)}` : ""}</p>` : ""}</li>`;
          })
          .join("")}</ul></section>`
      : "";

    const body = `
      <p class="lede">${esc(description)}</p>
      <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a day with ${BRAND}</a> <a class="cta-secondary" href="${metroPath("this-weekend/")}">Weekend guide</a></p>
      ${eventsList}
      ${spotsList}
    `;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${canonical}#page`,
      url: canonical,
      name: pageName,
      description,
      isPartOf: { "@id": `${metroUrl("")}#website` },
      about: {
        "@type": "Place",
        name: metroLabel(),
      },
    };

    const html = renderShell({
      // Year in the <title> only (not the H1/JSON-LD name) for SERP freshness.
      title: `${pageName} (${new Date().getUTCFullYear()}) — ${BRAND}`,
      description,
      canonical,
      ogImage: OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: metroUrl("") },
        { name: cat.label, url: canonical },
      ],
      h1: pageName,
      eyebrow: metroTag(),
      body,
    });

    writeMetroPage(`category/${cat.slug}/index.html`, html);
    slugs.add(cat.slug);

    sitemapEntries.push({
      loc: canonical,
      lastmod: today(),
      changefreq: "daily",
      priority: 0.85,
    });
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// City Categories
// ---------------------------------------------------------------------------

function generateCityCategoryPages(spotItems, eventItems, spotSlugLookup, eventSlugLookup, spotSlugs, eventSlugs, cities) {
  const slugs = new Set();

  // Only trust a Google rating with enough reviews to be stable.
  const stableRating = (s) =>
    typeof s.googleRating === "number" && (s.googleRatingCount ?? 0) >= 25;
  const ratingBadge = (s) =>
    stableRating(s)
      ? ` <span class="cat-rating">★ ${s.googleRating.toFixed(1)} (${s.googleRatingCount})</span>`
      : "";

  for (const city of cities) {
    const citySlug = slugify(city.name);
    if (!citySlug) continue;

    for (const cat of CATEGORY_PAGES) {
      const matchingSpots = city.spots
        .filter((s) => cat.spotMatch(s))
        .sort((a, b) => {
          const ra = stableRating(a) ? a.googleRating : -1;
          const rb = stableRating(b) ? b.googleRating : -1;
          if (rb !== ra) return rb - ra;
          return (b.friendScore || 0) - (a.friendScore || 0);
        })
        .slice(0, 30);
      const matchingEvents = city.events
        .filter((e) => cat.eventMatch(e))
        .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""))
        .slice(0, 40);

      if (matchingSpots.length + matchingEvents.length === 0) continue;

      const canonical = metroUrl(`city/${citySlug}/category/${cat.slug}/`);
      const canonicalCity = metroUrl(`city/${citySlug}/`);
      const pageName = `Best ${cat.label.toLowerCase()} in ${city.name}`;
      const description =
        `Best ${cat.label.toLowerCase()} in ${city.name}. Browse ${matchingSpots.length} ${A.friendlyAdj}spots and ${matchingEvents.length} upcoming events on ${BRAND}.`;

      const spotsList = matchingSpots.length
        ? `<section><h2>Top-rated ${esc(cat.label.toLowerCase())}</h2><ul class="card-list">${matchingSpots
            .map((s) => {
              const sslug = spotSlugLookup.get(s);
              if (!sslug) return "";
              if (!spotSlugs.has(sslug)) {
                return `<li><strong>${esc(s.name)}</strong>${s.neighborhood ? `<span> · ${esc(s.neighborhood)}</span>` : ""}${ratingBadge(s)}</li>`;
              }
              return `<li><a href="${metroPath(`spot/${sslug}/`)}"><strong>${esc(s.name)}</strong>${s.neighborhood ? `<span> · ${esc(s.neighborhood)}</span>` : ""}${ratingBadge(s)}</a>${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
            })
            .join("")}</ul></section>`
        : "";

      const eventsList = matchingEvents.length
        ? `<section><h2>Upcoming ${esc(cat.label.toLowerCase())}</h2><ul class="card-list">${matchingEvents
            .map((e) => {
              const eslug = eventSlugLookup.get(e);
              if (!eslug) return "";
              const dateStr = formatEventDate(e);
              if (!eventSlugs.has(eslug)) {
                return `<li><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</li>`;
              }
              return `<li><a href="${metroPath(`event/${eslug}/`)}"><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</a>${e.venue ? `<p>${esc(e.venue)}${e.city ? `, ${esc(e.city)}` : ""}${e.cost && e.cost !== "Unknown" ? ` · ${esc(e.cost)}` : ""}</p>` : ""}</li>`;
            })
            .join("")}</ul></section>`
        : "";

      const body = `
        <p class="lede">${esc(description)}</p>
        <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a day with ${BRAND}</a> <a class="cta-secondary" href="${metroPath("this-weekend/")}">Weekend guide</a></p>
        ${eventsList}
        ${spotsList}
      `;

      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: pageName,
        description,
        isPartOf: { "@id": `${metroUrl("")}#website` },
        about: {
          "@type": "Place",
          name: city.name,
          address: {
            "@type": "PostalAddress",
            addressLocality: city.name,
            addressRegion: activeMetro.state || "US",
            addressCountry: "US",
          },
        },
      };

      const html = renderShell({
        title: `${pageName} — ${BRAND}`,
        description,
        canonical,
        ogImage: OG_IMAGE,
        jsonLd,
        breadcrumb: [
          { name: BRAND, url: metroUrl("") },
          { name: city.name, url: canonicalCity },
          { name: cat.label, url: canonical },
        ],
        h1: pageName,
        eyebrow: metroTag(),
        body,
      });

      writeMetroPage(`city/${citySlug}/category/${cat.slug}/index.html`, html);
      slugs.add(`${citySlug}/category/${cat.slug}`);

      sitemapEntries.push({
        loc: canonical,
        lastmod: today(),
        changefreq: "daily",
        priority: 0.7,
      });
    }
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// This weekend
// ---------------------------------------------------------------------------

function generateThisWeekendPage(eventItems, eventSlugLookup = null) {
  const lookup = eventSlugLookup || buildEventSlugLookup(eventItems);
  const now = new Date();
  const weekend = getWeekendDateKeys(now, activeMetro.timezone);

  const upcoming = eventItems
    .filter((e) => {
      if (!e.startDateTime) return false;
      const d = new Date(e.startDateTime);
      if (!Number.isFinite(d.getTime())) return false;
      return weekend.keys.has(zonedDateKey(d, activeMetro.timezone));
    })
    .sort((a, b) =>
      (a.startDateTime || "").localeCompare(b.startDateTime || ""),
    );

  // Query-shaped, high-intent guide titles ("things to do ... this weekend").
  const guideH1 = weekendGuideTitle(metroLabel(), IS_ADULTS);

  if (upcoming.length === 0) {
    const canonical = metroUrl("this-weekend/");
    const title = `${guideH1} | ${BRAND}`;
    const description = `A weekend guide to ${IS_ADULTS ? "things to do" : "family-friendly events"} in ${metroLabel()}. No events are scheduled for this weekend. Plan a customized ${IS_ADULTS ? "outing" : "day out"} with ${BRAND}.`;

    const body = `
      <p class="lede">${esc(description)}</p>
      <section class="guide-summary" aria-label="Weekend snapshot">
        <h2>Weekend snapshot</h2>
        <p>No events scheduled for this weekend. Please check back soon!</p>
      </section>
      <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a 3-stop day with ${BRAND}</a></p>
    `;

    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          "@id": `${canonical}#page`,
          url: canonical,
          name: `${metroLabel()} weekend guide`,
          description,
          isPartOf: { "@id": `${metroUrl("")}#website` },
          about: {
            "@type": "Place",
            name: metroLabel(),
          },
        }
      ]
    };

    const weekendRouteKey = findRouteKey("en", metroPath("this-weekend/"));
    const hreflangLinks = (!IS_ADULTS && weekendRouteKey) ? getAlternateLinks(weekendRouteKey, SITE) : [];
    const langSwitcherHtml = (!IS_ADULTS && weekendRouteKey) ? renderLangSwitcher(weekendRouteKey, "en") : "";

    const html = renderShell({
      title,
      description,
      canonical,
      ogImage: OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: metroUrl("") },
        { name: "Weekend guide", url: canonical },
      ],
      h1: guideH1,
      eyebrow: metroTag(),
      body,
      hreflangLinks,
      langSwitcherHtml,
    });

    writeMetroPage("this-weekend/index.html", html);

    sitemapEntries.push({
      loc: canonical,
      lastmod: today(),
      changefreq: "daily",
      priority: 0.95,
    });

    return true;
  }

  const canonical = metroUrl("this-weekend/");
  const weekendLabel = weekend.saturday.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });
  const sundayLabel = weekend.sunday.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });
  const rangeLabel = formatWeekendRange(weekend.saturday, weekend.sunday, activeMetro.timezone);
  const title = IS_ADULTS
    ? `${guideH1} | ${BRAND}`
    : `${guideH1} (${rangeLabel}) | ${BRAND}`;
  const description = `A timeline weekend guide to ${IS_ADULTS ? "things to do" : "family-friendly events"} in ${metroLabel()} from ${weekendLabel} through ${sundayLabel}: ${upcoming.length} events with times, venues, details, and official links. Build a 3-stop plan with ${BRAND}.`.slice(
    0,
    300,
  );

  const byDay = new Map();
  for (const e of upcoming) {
    const dayKey = zonedDateKey(new Date(e.startDateTime), activeMetro.timezone);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(e);
  }

  const categoryCounts = countBy(upcoming, (event) => event.category || "Other");
  const cityCounts = countBy(upcoming, (event) => event.city || event.neighborhood || metroLabel());
  const topCategories = topCountLabels(categoryCounts, 4);
  const topCities = topCountLabels(cityCounts, 5);
  const freeCount = upcoming.filter(eventLikelyFree).length;
  const highlights = pickWeekendHighlights(upcoming, lookup).slice(0, 6);
  const qualityCount = upcoming.filter((event) => eventQualityScore(event) >= 70).length;
  const planPresets = buildWeekendPlanPresets(upcoming, lookup);
  const editorialBuckets = buildWeekendEditorialBuckets(upcoming, lookup);
  const daySections = [weekend.saturdayKey, weekend.sundayKey]
    .map((dayKey) => renderWeekendDaySection(dayKey, byDay.get(dayKey) || [], lookup))
    .filter(Boolean);
  const generatedLabel = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });

  const body = `
    <p class="lede">${esc(description)}</p>
    <section class="guide-summary" aria-label="Weekend summary">
      <h2>Weekend snapshot</h2>
      <p>${esc(buildWeekendGuideSummary(upcoming, topCategories, topCities, weekendLabel, sundayLabel))}</p>
      <div class="guide-facts">
        <div class="guide-fact"><strong>${upcoming.length}</strong><span>dated ${A.eventsAdj}events</span></div>
        <div class="guide-fact"><strong>${freeCount}</strong><span>likely free options</span></div>
        <div class="guide-fact"><strong>${qualityCount}</strong><span>strong-detail listings</span></div>
        <div class="guide-fact"><strong>${cityCounts.size}</strong><span>metro cities represented</span></div>
      </div>
      ${highlights.length ? `<ul class="guide-highlights">${highlights.map((item) => `<li><a href="${item.href}">${esc(item.event.title)}</a><p>${esc(formatTimelineMeta(item.event))}</p></li>`).join("")}</ul>` : ""}
    </section>
    ${planPresets.length ? renderWeekendPlanPresets(planPresets) : ""}
    ${editorialBuckets.length ? renderWeekendEditorialBuckets(editorialBuckets) : ""}
    ${renderNewsletterSignup()}
    <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a 3-stop day with ${BRAND}</a> <a class="cta-secondary" href="#timeline">Jump to the timeline</a></p>
    <section id="timeline" aria-label="Weekend event timeline">
      <p class="eyebrow">Generated ${esc(generatedLabel)} from official event sources</p>
      ${renderWeekendFilters("en", upcoming.length)}
      ${daySections.join("")}
    </section>
    ${renderWeekendFilterScript("en")}
  `;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: `${metroLabel()} weekend guide`,
        description,
        isPartOf: { "@id": `${metroUrl("")}#website` },
        about: {
          "@type": "Place",
          name: metroLabel(),
        },
      },
      {
        "@type": "Article",
        "@id": `${canonical}#guide`,
        headline: title,
        description,
        dateModified: today(),
        author: { "@type": "Organization", name: BRAND },
        publisher: { "@type": "Organization", name: BRAND },
        mainEntityOfPage: canonical,
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#timeline`,
        name: `${metroLabel()} ${A.eventsAdj}events this weekend`,
        itemListElement: upcoming.slice(0, 30).map((event, index) => {
          const slug = lookup.get(event);
          const eventUrl = slug ? metroUrl(`event/${slug}/`) : event.url || canonical;
          const listItem = {
            "@type": "ListItem",
            position: index + 1,
            url: eventUrl,
            name: event.title,
          };
          // Embed the full Event object so the weekend guide is eligible for
          // Google's event rich results / "things to do" carousel, not just a
          // plain list of names.
          const eventNode = buildEventJsonLd(event, eventUrl);
          if (eventNode) {
            delete eventNode["@context"];
            listItem.item = eventNode;
          }
          return listItem;
        }),
      },
    ],
  };

  const weekendRouteKey = findRouteKey("en", metroPath("this-weekend/"));
  const hreflangLinks = (!IS_ADULTS && weekendRouteKey) ? getAlternateLinks(weekendRouteKey, SITE) : [];
  const langSwitcherHtml = (!IS_ADULTS && weekendRouteKey) ? renderLangSwitcher(weekendRouteKey, "en") : "";

  const html = renderShell({
    title,
    description,
    canonical,
    ogImage: OG_IMAGE,
    jsonLd,
    breadcrumb: [
      { name: BRAND, url: metroUrl("") },
      { name: "Weekend guide", url: canonical },
    ],
    h1: guideH1,
    eyebrow: metroTag(),
    body,
    hreflangLinks,
    langSwitcherHtml,
  });

  writeMetroPage("this-weekend/index.html", html);

  sitemapEntries.push({
    loc: canonical,
    lastmod: today(),
    changefreq: "daily",
    priority: 0.95,
  });
  return true;
}

// Query-shaped, high-intent guide H1/title ("things to do ... this weekend").
// Exported (with formatWeekendRange below) so tests can pin the title shape.
export function weekendGuideTitle(placeLabel, adults = false) {
  return adults
    ? `Things to do in ${placeLabel} this weekend`
    : `Things to do with kids this weekend in ${placeLabel}`;
}

// "June 13–14" (or "October 31 – November 1" across a month boundary) for
// query-shaped weekend guide titles.
export function formatWeekendRange(saturday, sunday, timeZone = "America/Los_Angeles") {
  const fmt = (d, opts) => d.toLocaleDateString("en-US", { ...opts, timeZone });
  const satMonth = fmt(saturday, { month: "long" });
  const sunMonth = fmt(sunday, { month: "long" });
  const satDay = fmt(saturday, { day: "numeric" });
  const sunDay = fmt(sunday, { day: "numeric" });
  return satMonth === sunMonth
    ? `${satMonth} ${satDay}–${sunDay}`
    : `${satMonth} ${satDay} – ${sunMonth} ${sunDay}`;
}

// ---------------------------------------------------------------------------
// Per-city + free weekend pages (Bay Area kids only for now)
// ---------------------------------------------------------------------------

// /{metro}/this-weekend/{city}/ for the cities with the most dated weekend
// events, plus one /{metro}/free-this-weekend/ page. Same quality bar as the
// main guide (real dated events + embedded Event JSON-LD); a city needs at
// least MIN_WEEKEND_SUB_PAGE_EVENTS dated events to earn a page, and the page
// count stays small (≤ MAX_CITY_WEEKEND_PAGES + 1 per metro).
const CITY_WEEKEND_METROS = new Set(["bay-area"]);
const MAX_CITY_WEEKEND_PAGES = 20;
const MIN_WEEKEND_SUB_PAGE_EVENTS = 3;

function weekendEventsFor(eventItems) {
  const weekend = getWeekendDateKeys(new Date(), activeMetro.timezone);
  const upcoming = eventItems
    .filter((e) => {
      if (!e.startDateTime) return false;
      const d = new Date(e.startDateTime);
      if (!Number.isFinite(d.getTime())) return false;
      return weekend.keys.has(zonedDateKey(d, activeMetro.timezone));
    })
    .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""));
  return { weekend, upcoming };
}

function generateCityWeekendPages(eventItems, lookup) {
  if (IS_ADULTS || !CITY_WEEKEND_METROS.has(activeMetro.id)) return 0;
  const { weekend, upcoming } = weekendEventsFor(eventItems);
  if (!upcoming.length) return 0;

  const byCity = new Map();
  for (const e of upcoming) {
    const name = String(e.city || e.neighborhood || "").trim();
    if (!name) continue;
    if (!byCity.has(name)) byCity.set(name, []);
    byCity.get(name).push(e);
  }
  const cities = [...byCity.entries()]
    .filter(([, evs]) => evs.length >= MIN_WEEKEND_SUB_PAGE_EVENTS)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CITY_WEEKEND_PAGES);

  let wrote = 0;
  for (const [cityName, cityEvents] of cities) {
    const slug = slugify(cityName);
    if (!slug) continue;
    writeWeekendSubPage({
      rel: `this-weekend/${slug}/`,
      heading: weekendGuideTitle(cityName),
      placeName: cityName,
      events: cityEvents,
      weekend,
      lookup,
    });
    wrote += 1;
  }
  return wrote;
}

function generateFreeThisWeekendPage(eventItems, lookup) {
  if (IS_ADULTS || !CITY_WEEKEND_METROS.has(activeMetro.id)) return 0;
  const { weekend, upcoming } = weekendEventsFor(eventItems);
  const freeEvents = upcoming.filter(eventLikelyFree);
  if (freeEvents.length < MIN_WEEKEND_SUB_PAGE_EVENTS) return 0;
  writeWeekendSubPage({
    rel: "free-this-weekend/",
    heading: `Free things to do with kids this weekend in ${metroLabel()}`,
    placeName: metroLabel(),
    events: freeEvents,
    weekend,
    lookup,
  });
  return 1;
}

function writeWeekendSubPage({ rel, heading, placeName, events, weekend, lookup }) {
  const canonical = metroUrl(rel);
  const rangeLabel = formatWeekendRange(weekend.saturday, weekend.sunday, activeMetro.timezone);
  const title = `${heading} (${rangeLabel}) | ${BRAND}`;
  const freeCount = events.filter(eventLikelyFree).length;
  const description = `${heading}: ${events.length} dated family events for ${rangeLabel}, with times, venues, costs, and official links. Build a 3-stop plan with ${BRAND}.`.slice(
    0,
    300,
  );

  const byDay = new Map();
  for (const e of events) {
    const dayKey = zonedDateKey(new Date(e.startDateTime), activeMetro.timezone);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(e);
  }
  const daySections = [weekend.saturdayKey, weekend.sundayKey]
    .map((dayKey) => renderWeekendDaySection(dayKey, byDay.get(dayKey) || [], lookup))
    .filter(Boolean);

  const body = `
    <p class="lede">${esc(description)}</p>
    <section class="guide-summary" aria-label="Weekend snapshot">
      <h2>Weekend snapshot</h2>
      <div class="guide-facts">
        <div class="guide-fact"><strong>${events.length}</strong><span>dated family events</span></div>
        <div class="guide-fact"><strong>${freeCount}</strong><span>likely free options</span></div>
      </div>
    </section>
    <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a 3-stop day with ${BRAND}</a> <a class="cta-secondary" href="${metroPath("this-weekend/")}">Full weekend guide</a></p>
    ${daySections.join("")}
  `;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: heading,
        description,
        isPartOf: { "@id": `${metroUrl("")}#website` },
        about: { "@type": "Place", name: placeName },
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#timeline`,
        name: heading,
        itemListElement: events.slice(0, 30).map((event, index) => {
          const slug = lookup.get(event);
          const eventUrl = slug ? metroUrl(`event/${slug}/`) : event.url || canonical;
          const listItem = {
            "@type": "ListItem",
            position: index + 1,
            url: eventUrl,
            name: event.title,
          };
          const eventNode = buildEventJsonLd(event, eventUrl);
          if (eventNode) {
            delete eventNode["@context"];
            listItem.item = eventNode;
          }
          return listItem;
        }),
      },
    ],
  };

  const html = renderShell({
    title,
    description,
    canonical,
    ogImage: OG_IMAGE,
    jsonLd,
    breadcrumb: [
      { name: BRAND, url: metroUrl("") },
      { name: "Weekend guide", url: metroUrl("this-weekend/") },
      { name: heading, url: canonical },
    ],
    h1: heading,
    eyebrow: metroTag(),
    body,
  });

  writeMetroPage(`${rel}index.html`, html);

  sitemapEntries.push({
    loc: canonical,
    lastmod: today(),
    changefreq: "daily",
    priority: 0.85,
  });
}

function getWeekendDateKeys(now, timeZone = "America/Los_Angeles") {
  const todayParts = zonedDateParts(now, timeZone);
  const dow = weekdayNumber(todayParts.weekday);
  const daysToSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
  const saturdayYmd = addDaysToYmd(todayParts, daysToSat);
  const sundayYmd = addDaysToYmd(saturdayYmd, 1);
  const saturdayKey = ymdKey(saturdayYmd);
  const sundayKey = ymdKey(sundayYmd);
  return {
    saturday: ymdToUtcDate(saturdayYmd),
    sunday: ymdToUtcDate(sundayYmd),
    saturdayKey,
    sundayKey,
    keys: new Set([saturdayKey, sundayKey]),
  };
}

function zonedDateParts(date, timeZone = "America/Los_Angeles") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

function zonedTimeParts(date, timeZone = "America/Los_Angeles") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(get("hour"));
  return {
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
  };
}

function weekdayNumber(shortName) {
  const normalized = String(shortName || "").slice(0, 3).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(normalized);
}

function addDaysToYmd(ymd, days) {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function ymdKey(ymd) {
  return `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
}

function ymdToUtcDate(ymd) {
  return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12));
}

function zonedDateKey(date, timeZone = "America/Los_Angeles") {
  return ymdKey(zonedDateParts(date, timeZone));
}

function countBy(items, getter) {
  const map = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function topCountLabels(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildWeekendGuideSummary(events, topCategories, topCities, saturdayLabel, sundayLabel) {
  const categoryText = topCategories.length
    ? topCategories.map((item) => `${item.label.toLowerCase()} (${item.count})`).join(", ")
    : "family programs";
  const cityText = topCities.length
    ? topCities.map((item) => item.label).join(", ")
    : metroLabel();
  return `From ${saturdayLabel} through ${sundayLabel}, ${BRAND} found ${events.length} dated ${A.eventsAdj}events across ${metroLabel()}. The biggest clusters are ${categoryText}, with options in ${cityText}. Use the timeline below to compare times, venues, costs${IS_ADULTS ? "" : ", age fit"}, and official event links before building a plan.`;
}

function eventQualityScore(event) {
  let score = 0;
  if (event.verified) score += 20;
  if (event.startDateTime) score += 22;
  if (event.endDateTime) score += 4;
  if (event.url) score += 8;
  if (event.venue && event.city) score += 10;
  if (Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lon))) score += 8;
  if (event.cost && event.cost !== "Unknown") score += 6;
  if (Array.isArray(event.ageBands) && event.ageBands.length) score += 7;
  if (String(event.description || "").replace(/\s+/g, " ").trim().length > 80) score += 9;
  if (event.sourceMode === "recurring-template") score -= 18;
  return Math.max(0, Math.min(100, score));
}

function eventQualityLabel(score) {
  if (score >= 78) return { text: "Verified detail", className: "quality-high" };
  if (score >= 58) return { text: "Good detail", className: "quality-medium" };
  return { text: "Confirm details", className: "quality-low" };
}

function highSignalEvents(events) {
  const strong = events.filter((event) => eventQualityScore(event) >= 58);
  return strong.length >= 3 ? strong : events;
}

function buildWeekendPlanPresets(events, eventSlugLookup) {
  const source = highSignalEvents(events);
  const presets = [];
  const addPreset = (id, title, blurb, candidates) => {
    const picked = pickPresetEvents(candidates);
    if (picked.length === 0) return;
    presets.push({
      id,
      title,
      blurb,
      events: picked,
      href: buildGuidePlanHref(id, title, picked),
      eventSlugLookup,
    });
  };

  addPreset(
    "free-family-day",
    IS_ADULTS ? "Free this weekend" : "Free family day",
    IS_ADULTS
      ? "No-ticket or likely-free events to anchor a low-cost weekend out."
      : "No-ticket or likely-free events that work well as the anchor for a low-cost weekend plan.",
    source.filter(eventLikelyFree),
  );
  if (IS_ADULTS) {
    addPreset(
      "live-music",
      "Live music & shows",
      "Concerts and gigs pulled from official venue calendars this weekend.",
      source.filter(
        (event) =>
          event.category === "Music" ||
          /concert|live music|\bdj\b|\bband\b|gig/i.test(`${event.title} ${event.description}`),
      ),
    );
  } else {
    addPreset(
      "little-kids",
      "Toddler and preschool picks",
      "Shorter, earlier programs with age signals that are easier for little kids.",
      source.filter((event) =>
        eventHasAge(event, ["toddler", "preschool"]) ||
        /storytime|toddler|preschool|music and movement/i.test(`${event.title} ${event.description}`),
      ),
    );
  }
  addPreset(
    "indoor-backup",
    "Indoor backup plan",
    IS_ADULTS
      ? "Museums, galleries, and indoor culture picks for weather or low-energy days."
      : "Libraries, museums, makerspaces, and indoor culture picks for weather or low-energy days.",
    source.filter(isIndoorEvent),
  );

  const cityCounts = countBy(source, (event) => event.city || event.neighborhood || "");
  const topCity = topCountLabels(cityCounts, 1)[0]?.label;
  if (topCity) {
    addPreset(
      "low-drive",
      `Low-drive plan in ${topCity}`,
      "A tighter cluster in one city so the day does not become a cross-Bay drive.",
      source.filter((event) => (event.city || event.neighborhood || "") === topCity),
    );
  }

  const seen = new Set();
  return presets.filter((preset) => {
    if (seen.has(preset.id)) return false;
    seen.add(preset.id);
    return true;
  });
}

function pickPresetEvents(events) {
  const seen = new Set();
  return events
    .slice()
    .sort((a, b) => {
      const time = (a.startDateTime || "").localeCompare(b.startDateTime || "");
      if (time !== 0) return time;
      return eventQualityScore(b) - eventQualityScore(a);
    })
    .filter((event) => {
      if (!event.id || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .slice(0, 3);
}

function buildGuidePlanHref(id, title, events) {
  const params = new URLSearchParams();
  params.set("guidePlan", id);
  params.set("guideTitle", title);
  params.set("guideEventIds", events.map((event) => event.id).join(","));
  return `${metroPath("")}?${params.toString()}#/plans`;
}

function eventHasAge(event, ages) {
  return Array.isArray(event.ageBands) && ages.some((age) => event.ageBands.includes(age));
}

function isIndoorEvent(event) {
  const haystack = `${event.category} ${event.title} ${event.venue} ${event.description}`;
  return /library|museum|indoor|theater|theatre|gallery|workshop|maker|storytime|class|concert/i.test(haystack);
}

// Interest-theme buckets (ROADMAP: themed weekend summary). Each event carries
// a `themes[]` from ingest; fall back to classifying at render so this still
// works if a feed predates the backfill. Themes are ordered by how many events
// they have this weekend so the richest interests lead, keeping the venue-type
// `category` skew (77% "Library") from flattening the summary.
function eventThemeIds(event) {
  return Array.isArray(event.themes) ? event.themes : classifyEventThemes(event);
}

function buildWeekendEditorialBuckets(events, eventSlugLookup) {
  const source = highSignalEvents(events);
  return THEMES.map((theme) => {
    const matched = source.filter((event) => eventThemeIds(event).includes(theme.id));
    return {
      title: theme.label,
      blurb: theme.blurb,
      count: matched.length,
      events: pickPresetEvents(matched).slice(0, 4).filter(Boolean),
      eventSlugLookup,
    };
  })
    .filter((bucket) => bucket.events.length > 0)
    .sort((a, b) => b.count - a.count);
}

function renderWeekendPlanPresets(presets) {
  return `<section class="guide-presets" aria-label="Weekend plan starters">
    <div class="guide-section-heading">
      <h2>Start with a ready-made plan</h2>
      <p>Pick a guide preset and ${BRAND} will open it as an editable plan you can share for votes.</p>
    </div>
    <div class="guide-preset-grid">
      ${presets.map(renderWeekendPlanPresetCard).join("")}
    </div>
  </section>`;
}

function renderWeekendPlanPresetCard(preset) {
  return `<article class="guide-preset-card">
    <h3>${esc(preset.title)}</h3>
    <p>${esc(preset.blurb)}</p>
    ${renderMiniEventList(preset.events, preset.eventSlugLookup)}
    <a class="guide-card-cta" href="${esc(preset.href)}">Open this plan</a>
  </article>`;
}

function renderWeekendEditorialBuckets(buckets) {
  return `<section class="guide-editorial" aria-label="Weekend events by interest">
    <div class="guide-section-heading">
      <h2>Browse by interest</h2>
      <p>Jump to the kind of weekend you're after — story time, hands-on science, music, the outdoors, and more.</p>
    </div>
    <div class="guide-editorial-grid">
      ${buckets.map((bucket) => `<article class="guide-editorial-card">
        <h3>${esc(bucket.title)}</h3>
        <p>${esc(bucket.blurb)}</p>
        ${renderMiniEventList(bucket.events, bucket.eventSlugLookup)}
      </article>`).join("")}
    </div>
  </section>`;
}

function renderMiniEventList(events, eventSlugLookup) {
  return `<ul class="guide-mini-list">
    ${events.map((event) => {
      const slug = eventSlugLookup.get(event);
      const href = slug ? metroPath(`event/${slug}/`) : event.url || metroPath("this-weekend/");
      return `<li><a href="${esc(href)}">${esc(event.title)}</a><span>${esc(formatTimelineMeta(event))}</span></li>`;
    }).join("")}
  </ul>`;
}

function renderNewsletterSignup() {
  if (IS_ADULTS) return "";
  return `<section class="guide-newsletter" data-guide-newsletter data-api-base="${esc(POLLS_API)}" data-metro="${esc(activeMetro.id)}" aria-label="Weekend guide email signup">
    <div>
      <h2>Get the weekend guide before Friday</h2>
      <p>A short family-events email for ${esc(metroLabel())}, ordered by time and grouped by age fit.</p>
    </div>
    <form data-guide-newsletter-form>
      <input name="email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address" required>
      <select name="ageBand" aria-label="Child age range">
        <option value="">Any age</option>
        <option value="toddler">Toddler</option>
        <option value="preschool">Preschool</option>
        <option value="school-age">School age</option>
        <option value="tween">Tween</option>
      </select>
      <button type="submit">Notify me</button>
    </form>
    <p class="guide-newsletter-status" data-guide-newsletter-status>One useful guide, no daily noise.</p>
  </section>${renderNewsletterScript()}`;
}

function renderNewsletterScript() {
  return `<script>
(() => {
  const root = document.querySelector("[data-guide-newsletter]");
  if (!root) return;
  const form = root.querySelector("[data-guide-newsletter-form]");
  const status = root.querySelector("[data-guide-newsletter-status]");
  const apiBase = root.getAttribute("data-api-base") || "";
  const metroId = root.getAttribute("data-metro") || "";
  if (!form || !status) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    if (!email) return;
    if (!apiBase) {
      status.textContent = "Email signup is not configured in this build.";
      return;
    }
    const button = form.querySelector("button");
    if (button) button.disabled = true;
    status.textContent = "Saving...";
    try {
      const response = await fetch(apiBase + "/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          metroId,
          ageBand: String(data.get("ageBand") || ""),
          source: "weekend-guide",
          url: window.location.href
        })
      });
      if (!response.ok) throw new Error("Subscribe failed");
      status.textContent = "You're on the list for the next weekend guide.";
      form.reset();
    } catch {
      status.textContent = "Could not save that email. Please try again.";
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
</script>`;
}

function pickWeekendHighlights(events, eventSlugLookup) {
  const picked = [];
  const seenCategories = new Set();
  const sorted = events.slice().sort((a, b) => {
    const aFree = eventLikelyFree(a) ? 0 : 1;
    const bFree = eventLikelyFree(b) ? 0 : 1;
    return (
      aFree - bFree ||
      eventQualityScore(b) - eventQualityScore(a) ||
      (a.startDateTime || "").localeCompare(b.startDateTime || "")
    );
  });
  for (const event of sorted) {
    const category = event.category || "Other";
    if (seenCategories.has(category) && picked.length < 4) continue;
    const slug = eventSlugLookup.get(event);
    if (!slug) continue;
    picked.push({ event, href: metroPath(`event/${slug}/`) });
    seenCategories.add(category);
    if (picked.length >= 6) break;
  }
  return picked;
}

function renderWeekendDaySection(dayKey, events, eventSlugLookup, locale = "en") {
  if (!events.length) return "";
  const date = ymdToUtcDate({
    year: Number(dayKey.slice(0, 4)),
    month: Number(dayKey.slice(5, 7)),
    day: Number(dayKey.slice(8, 10)),
  });
  const dateLocale = locale === "zh-Hans" ? "zh-CN" : (locale === "es" ? "es-US" : "en-US");
  const dayLabel = date.toLocaleDateString(dateLocale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const sorted = events
    .slice()
    .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""));
  const items = sorted.map((event) => renderTimelineEvent(event, eventSlugLookup, locale)).join("");
  const noteMap = {
    en: `${events.length} event${events.length === 1 ? "" : "s"} ordered by start time.`,
    es: `${events.length} evento${events.length === 1 ? "" : "s"} en orden cronológico.`,
    "zh-Hans": `${events.length} 个活动，按开始时间排列。`,
  };
  return `<section class="guide-day"><h2>${esc(dayLabel)}</h2><p class="guide-day-note">${noteMap[locale] || noteMap.en}</p><ol class="timeline-list">${items}</ol></section>`;
}

function renderTimelineEvent(event, eventSlugLookup, locale = "en") {
  const slug = eventSlugLookup.get(event);
  const internalHref = slug ? metroPath(`event/${slug}/`) : "";
  const time = formatEventTime(event, locale);
  const bucket = timelineBucket(event, locale);
  const bucketKey = timelineBucket(event, "en").toLowerCase();
  const free = eventLikelyFree(event);
  const ageBands = Array.isArray(event.ageBands) ? event.ageBands.join(",") : "";
  const description = buildTimelineDescription(event);
  const meta = formatTimelineMeta(event);
  const quality = eventQualityLabel(eventQualityScore(event));
  const timeTba = { en: "Time TBA", es: "Hora por confirmar", "zh-Hans": "时间待定" };
  const detailsLabel = { en: "FamHop event details", es: "Detalles del evento en FamHop", "zh-Hans": "FamHop 活动详情" };
  const officialLabel = { en: "Official event page", es: "Página oficial del evento", "zh-Hans": "官方活动页面" };
  return `<li class="timeline-card" data-age-bands="${esc(ageBands)}" data-cost-free="${free}" data-category="${esc(event.category || "")}" data-bucket="${esc(bucketKey)}">
    <time class="timeline-time" datetime="${esc(event.startDateTime || "")}">${esc(time || (timeTba[locale] || timeTba.en))}<span>${esc(bucket)}</span></time>
    <div>
      <div class="timeline-chip-row">
        ${event.category ? `<span class="event-chip">${esc(event.category)}</span>` : ""}
        <span class="quality-chip ${esc(quality.className)}">${esc(quality.text)}</span>
      </div>
      <h3>${internalHref ? `<a href="${internalHref}">${esc(event.title)}</a>` : esc(event.title)}</h3>
      <p class="timeline-meta">${esc(meta)}</p>
      ${description ? `<p class="timeline-desc">${esc(description)}</p>` : ""}
      <p class="timeline-links">
        ${internalHref ? `<a href="${internalHref}">${detailsLabel[locale] || detailsLabel.en}</a>` : ""}
        ${event.url ? `<a rel="noopener nofollow" href="${esc(event.url)}">${officialLabel[locale] || officialLabel.en}</a>` : ""}
      </p>
    </div>
  </li>`;
}

function timelineBucket(event, locale = "en") {
  const buckets = {
    en: { tba: "Time TBA", morning: "Morning", afternoon: "Afternoon", evening: "Evening" },
    es: { tba: "Hora por confirmar", morning: "Mañana", afternoon: "Tarde", evening: "Noche" },
    "zh-Hans": { tba: "时间待定", morning: "上午", afternoon: "下午", evening: "晚上" },
  };
  const b = buckets[locale] || buckets.en;
  if (!event.startDateTime) return b.tba;
  const date = new Date(event.startDateTime);
  const { hour } = zonedTimeParts(date, activeMetro.timezone);
  if (hour < 12) return b.morning;
  if (hour < 17) return b.afternoon;
  return b.evening;
}

function renderWeekendFilters(locale, totalCount) {
  const ageFilterHtml = IS_ADULTS ? "" : `
    <div class="filter-group">
      <span class="filter-label">${esc(t(locale, "filterLabelAge"))}</span>
      <div class="filter-options" data-filter-group="age">
        <button class="filter-chip active" data-age-band="all">${esc(t(locale, "filterAllAges"))}</button>
        <button class="filter-chip" data-age-band="toddler">${esc(t(locale, "filterAgeToddler"))}</button>
        <button class="filter-chip" data-age-band="preschool">${esc(t(locale, "filterAgePreschool"))}</button>
        <button class="filter-chip" data-age-band="school-age">${esc(t(locale, "filterAgeSchoolAge"))}</button>
        <button class="filter-chip" data-age-band="tween">${esc(t(locale, "filterAgeTween"))}</button>
      </div>
    </div>
  `;

  return `
    <div class="timeline-filters-card" data-timeline-filters>
      <div class="filters-header">
        <svg class="filters-icon" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
          <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" />
        </svg>
        <h3>${locale === "es" ? "Buscador interactivo" : (locale === "zh-Hans" ? "互动活动筛选" : "Interactive Event Finder")}</h3>
      </div>
      <div class="filters-body">
        ${ageFilterHtml}
        <div class="filter-group">
          <span class="filter-label">${esc(t(locale, "filterLabelTime"))}</span>
          <div class="filter-options" data-filter-group="time">
            <button class="filter-chip active" data-time="all">${esc(t(locale, "filterAllTimes"))}</button>
            <button class="filter-chip" data-time="morning">${esc(t(locale, "filterMorning"))}</button>
            <button class="filter-chip" data-time="afternoon">${esc(t(locale, "filterAfternoon"))}</button>
            <button class="filter-chip" data-time="evening">${esc(t(locale, "filterEvening"))}</button>
          </div>
        </div>
        <div class="filter-row-secondary">
          <div class="filter-group">
            <span class="filter-label">${esc(t(locale, "filterLabelCost"))}</span>
            <div class="filter-options" data-filter-group="cost">
              <button class="filter-chip active" data-free="all">${esc(t(locale, "filterAllPrices"))}</button>
              <button class="filter-chip" data-free="true">${esc(t(locale, "filterFreeOnly"))}</button>
            </div>
          </div>
          <div class="filter-group category-filter-group">
            <span class="filter-label">${esc(t(locale, "filterLabelCategory"))}</span>
            <div class="select-wrapper">
              <select class="filter-select" data-category-select aria-label="${esc(t(locale, "filterLabelCategory"))}">
                <option value="all">${esc(t(locale, "filterAllCategories"))}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="filter-status-row" data-filter-status>
        <span class="filter-results-count" data-results-text>${esc(t(locale, "filterResultsCount", { count: String(totalCount), total: String(totalCount) }))}</span>
        <button class="clear-filters-btn" data-reset-btn type="button" style="display: none;">${esc(t(locale, "filterReset"))}</button>
      </div>
    </div>
    <div id="no-matching-events-message" class="no-events-found-card" style="display: none;">
      <svg class="no-events-icon" viewBox="0 0 20 20" fill="currentColor" width="48" height="48">
        <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
      </svg>
      <p>${esc(t(locale, "noMatchingEvents"))}</p>
      <button class="cta-secondary" data-reset-btn-empty type="button">${esc(t(locale, "filterReset"))}</button>
    </div>
  `;
}

function renderWeekendFilterScript(locale) {
  return `<script>
(() => {
  const container = document.querySelector("[data-timeline-filters]");
  if (!container) return;

  const cards = Array.from(document.querySelectorAll(".timeline-list .timeline-card"));
  const days = Array.from(document.querySelectorAll(".guide-day"));
  const categorySelect = container.querySelector("[data-category-select]");
  const statusText = container.querySelector("[data-results-text]");
  const resetBtn = container.querySelector("[data-reset-btn]");
  const resetBtnEmpty = document.querySelector("[data-reset-btn-empty]");
  const noEventsMsg = document.getElementById("no-matching-events-message");

  let activeFilters = {
    age: "all",
    time: "all",
    cost: "all",
    category: "all"
  };

  const categories = new Set();
  cards.forEach(card => {
    const cat = card.getAttribute("data-category");
    if (cat) categories.add(cat);
  });
  
  Array.from(categories).sort().forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });

  const resultsTpl = ${JSON.stringify(t(locale, "filterResultsCount", { count: "{count}", total: "{total}" }))};

  function updateResults() {
    let visibleCount = 0;
    const dayCardCount = new Map();
    days.forEach(day => {
      dayCardCount.set(day, 0);
    });

    cards.forEach(card => {
      const ageBands = (card.getAttribute("data-age-bands") || "").split(",").filter(Boolean);
      const isFree = card.getAttribute("data-cost-free") === "true";
      const category = card.getAttribute("data-category") || "";
      const bucket = card.getAttribute("data-bucket") || "";

      let matchAge = activeFilters.age === "all" || ageBands.includes(activeFilters.age);
      let matchTime = activeFilters.time === "all" || bucket === activeFilters.time;
      let matchCost = activeFilters.cost === "all" || (activeFilters.cost === "true" && isFree);
      let matchCategory = activeFilters.category === "all" || category === activeFilters.category;

      if (matchAge && matchTime && matchCost && matchCategory) {
        card.style.display = "";
        visibleCount++;
        const parentDay = card.closest(".guide-day");
        if (parentDay) {
          dayCardCount.set(parentDay, dayCardCount.get(parentDay) + 1);
        }
      } else {
        card.style.display = "none";
      }
    });

    days.forEach(day => {
      const count = dayCardCount.get(day);
      if (count === 0) {
        day.style.display = "none";
      } else {
        day.style.display = "";
      }
    });

    statusText.textContent = resultsTpl.replace("{count}", visibleCount).replace("{total}", cards.length);

    const hasActiveFilters = activeFilters.age !== "all" || activeFilters.time !== "all" || activeFilters.cost !== "all" || activeFilters.category !== "all";
    resetBtn.style.display = hasActiveFilters ? "" : "none";

    if (visibleCount === 0) {
      noEventsMsg.style.display = "flex";
    } else {
      noEventsMsg.style.display = "none";
    }
  }

  function handleFilterClick(group, value, clickedBtn) {
    activeFilters[group] = value;
    const buttons = container.querySelectorAll(\`[data-filter-group="\${group}"] .filter-chip\`);
    buttons.forEach(btn => btn.classList.remove("active"));
    clickedBtn.classList.add("active");
    updateResults();
  }

  const filterGroups = ["age", "time", "cost"];
  filterGroups.forEach(group => {
    const buttons = container.querySelectorAll(\`[data-filter-group="\${group}"] .filter-chip\`);
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-age-band") || btn.getAttribute("data-time") || btn.getAttribute("data-free");
        handleFilterClick(group, val, btn);
      });
    });
  });

  categorySelect.addEventListener("change", (e) => {
    activeFilters.category = e.target.value;
    updateResults();
  });

  function resetAll() {
    activeFilters = { age: "all", time: "all", cost: "all", category: "all" };
    filterGroups.forEach(group => {
      const buttons = container.querySelectorAll(\`[data-filter-group="\${group}"] .filter-chip\`);
      buttons.forEach(btn => {
        const val = btn.getAttribute("data-age-band") || btn.getAttribute("data-time") || btn.getAttribute("data-free");
        if (val === "all") {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    });
    categorySelect.value = "all";
    updateResults();
  }

  resetBtn.addEventListener("click", resetAll);
  if (resetBtnEmpty) resetBtnEmpty.addEventListener("click", resetAll);
})();
</script>`;
}

function formatEventTime(event, locale = "en") {
  if (!event.startDateTime) return "";
  const date = new Date(event.startDateTime);
  if (!Number.isFinite(date.getTime())) return "";
  const dateLocale = locale === "zh-Hans" ? "zh-CN" : (locale === "es" ? "es-US" : "en-US");
  return date.toLocaleTimeString(dateLocale, {
    timeZone: activeMetro.timezone || "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimelineMeta(event) {
  const parts = [];
  if (event.venue) parts.push(event.venue);
  if (event.city) parts.push(event.city);
  if (event.cost && event.cost !== "Unknown") parts.push(event.cost);
  if (!IS_ADULTS && Array.isArray(event.ageBands) && event.ageBands.length) {
    parts.push(`Ages: ${event.ageBands.join(", ")}`);
  }
  return parts.join(" · ");
}

function buildTimelineDescription(event) {
  const desc = String(event.description || "").replace(/\s+/g, " ").trim();
  if (desc) return desc.length > 210 ? `${desc.slice(0, 207)}…` : desc;
  const where = [event.venue, event.city].filter(Boolean).join(" in ");
  const cat = event.category ? `${event.category.toLowerCase()} event` : IS_ADULTS ? "event" : "family event";
  return `${event.title} is a ${cat}${where ? ` at ${where}` : ""}. Confirm registration, cost, and age fit on the official listing.`;
}

function getStableSuffix(id) {
  if (!id) return "";
  return slugify(id.replace("osm-node-", "n").replace("osm-way-", "w").replace("osm-relation-", "r"));
}

function getGeneratedCitySlugs(spotItems, eventItems) {
  const byCity = new Map();
  function bucket(city) {
    if (!city) return null;
    const key = city.trim();
    if (!key) return null;
    if (!byCity.has(key)) byCity.set(key, { name: key, spots: [], events: [] });
    return byCity.get(key);
  }
  for (const spot of spotItems) {
    const b = bucket(spot.neighborhood);
    if (b) b.spots.push(spot);
  }
  for (const event of eventItems) {
    const b = bucket(event.city || event.neighborhood);
    if (b) b.events.push(event);
  }

  const pinnedCitySlugs = pinnedCitySlugsForMetro(activeMetro.id);
  const generated = new Set();
  const rankedCities = [...byCity.values()]
    .filter((c) => {
      const slug = slugify(c.name);
      return c.spots.length + c.events.length >= 3 || pinnedCitySlugs.has(slug);
    })
    .sort((a, b) => b.spots.length + b.events.length - (a.spots.length + a.events.length));
  
  let count = 0;
  for (const city of rankedCities) {
    const slug = slugify(city.name);
    if (count < 40 || pinnedCitySlugs.has(slug)) {
      generated.add(slug);
      count++;
    }
  }
  return generated;
}

function buildEventSlugLookup(eventItems) {
  // Per ADR-04 the source of truth is `event.slug` (assigned by
  // scripts/eventPipeline.mjs:assignEventSlugs) — title+venue based, with a
  // stable baseId/id suffix on collision. Recurring-template occurrences
  // intentionally share one slug and collapse to a single canonical URL.
  // We only fall back to recomputing if the field is missing (legacy/older
  // datasets); the validate:events audit prevents on-disk drift.
  const map = new Map();
  const used = new Set();
  for (const event of eventItems) {
    if (!event || typeof event.title !== "string") continue;
    let s = typeof event.slug === "string" && event.slug ? event.slug : null;
    if (!s) {
      const base =
        slugify(`${event.title} ${event.venue ?? ""}`) ||
        slugify(event.id || "");
      if (!base) continue;
      s = base;
      let n = 2;
      while (used.has(s)) s = `${base}-${n++}`;
    }
    used.add(s);
    map.set(event, s);
  }
  return map;
}

function buildSpotSlugLookup(spotItems) {
  const map = new Map();
  const used = new Map();
  for (const spot of spotItems) {
    if (!spot || typeof spot.name !== "string") continue;
    const baseSlug = slugify(`${spot.name} ${spot.neighborhood ?? ""}`);
    if (!baseSlug) continue;
    let s = baseSlug;
    if (used.has(s)) {
      const suffix = getStableSuffix(spot.id);
      s = suffix ? `${baseSlug}-${suffix}` : `${baseSlug}-${used.get(baseSlug)}`;
      used.set(baseSlug, (used.get(baseSlug) || 2) + 1);
    } else {
      used.set(s, 2);
    }
    map.set(spot, s);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Language switcher
// ---------------------------------------------------------------------------

function renderLangSwitcher(routeKey, currentLocale) {
  if (IS_ADULTS) return "";
  const cluster = routeMap[routeKey];
  if (!cluster) return "";
  const links = [];
  for (const locale of supportedLocales) {
    const pagePath = cluster[locale];
    if (!pagePath) continue;
    const cfg = localeConfig[locale];
    const href = `${SITE}${pagePath}`;
    const ariaCurrent = locale === currentLocale ? ` aria-current="page"` : "";
    links.push(`<a href="${esc(href)}" hreflang="${esc(cfg.hreflang)}"${ariaCurrent}>${esc(cfg.displayName)}</a>`);
  }
  if (links.length <= 1) return "";
  return `<nav class="famhop-lang-switcher" aria-label="Change language">${links.join("")}</nav>`;
}

// ---------------------------------------------------------------------------
// Localized (i18n) weekend guide pages
// ---------------------------------------------------------------------------

function generateLocalizedWeekendPages() {
  let count = 0;
  for (const [routeKey, cluster] of Object.entries(routeMap)) {
    for (const locale of supportedLocales) {
      if (locale === defaultLocale) continue;
      const pagePath = cluster[locale];
      if (!pagePath) continue;

      const metro = metroConfig.byId.get(cluster.metroId);
      if (!metro) continue;

      const previousMetro = activeMetro;
      activeMetro = metro;

      const eventsDoc = readJson(metroDataPath(metro, "events"));
      const fullEvents = (Array.isArray(eventsDoc?.events) ? eventsDoc.events : []).filter(audienceVisible);
      // Same generated-pages-only restriction as the English weekend guides:
      // never link an event page the main loop capped out of this build.
      const generatedSlugs = generatedEventSlugsByMetro.get(metro.id);
      const fullLookup = buildEventSlugLookup(fullEvents);
      const eventSlugLookup = generatedSlugs ? lookupOfGenerated(fullLookup, generatedSlugs) : fullLookup;
      let events = fullEvents;

      if (cluster.subMetro) {
        const cities = subMetroCities[cluster.subMetro];
        if (cities) {
          events = events.filter((e) => {
            const city = (e.city || "").toLowerCase();
            return cities.some((c) => city.includes(c));
          });
        }
      }

      const wrote = generateLocalizedWeekendPage(events, locale, routeKey, cluster, eventSlugLookup);
      if (wrote) count++;
      activeMetro = previousMetro;
    }
  }
  console.log(`[seo:i18n] generated ${count} localized weekend guide pages`);
  return count;
}

function generateLocalizedWeekendPage(eventItems, locale, routeKey, cluster, eventSlugLookup = null) {
  const lookup = eventSlugLookup || buildEventSlugLookup(eventItems);
  const now = new Date();
  const weekend = getWeekendDateKeys(now, activeMetro.timezone);
  const cfg = localeConfig[locale];
  const pagePath = cluster[locale];

  const upcoming = eventItems
    .filter((e) => {
      if (!e.startDateTime) return false;
      const d = new Date(e.startDateTime);
      if (!Number.isFinite(d.getTime())) return false;
      return weekend.keys.has(zonedDateKey(d, activeMetro.timezone));
    })
    .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""));

  const area = cluster.subMetro
    ? (subMetroLabels[cluster.subMetro] || cluster.subMetro)
    : metroLabel();

  const canonical = `${SITE}${pagePath}`;
  const hreflangLinks = getAlternateLinks(routeKey, SITE);
  const langSwitcherHtml = renderLangSwitcher(routeKey, locale);

  const weekendLabel = weekend.saturday.toLocaleDateString(cfg.htmlLang === "zh-Hans" ? "zh-CN" : cfg.htmlLang, {
    weekday: "long", month: "long", day: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });
  const sundayLabel = weekend.sunday.toLocaleDateString(cfg.htmlLang === "zh-Hans" ? "zh-CN" : cfg.htmlLang, {
    weekday: "long", month: "long", day: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });

  const title = t(locale, "weekendGuideTitle", { metro: area });
  const description = t(locale, "metaDescription", { metro: area, eventCount: String(upcoming.length) });
  const h1 = t(locale, "weekendGuideH1", { metro: area });
  const intro = t(locale, "weekendGuideIntro", {
    metro: area,
    weekendDate: weekendLabel,
    sundayDate: sundayLabel,
    eventCount: String(upcoming.length),
  });

  const ogLocaleMap = { en: "en_US", es: "es_US", "zh-Hans": "zh_CN" };

  if (upcoming.length === 0) {
    const body = `
      <p class="lede">${esc(intro)}</p>
      <section class="guide-summary" aria-label="${esc(t(locale, "weekendSnapshot"))}">
        <h2>${esc(t(locale, "weekendSnapshot"))}</h2>
        <p>${esc(t(locale, "noEventsFound"))}</p>
        <p>${esc(t(locale, "checkBackSoon"))}</p>
      </section>
      <p class="cta-row"><a class="cta" href="${metroPath("")}">${esc(t(locale, "buildPlanCta"))}</a></p>
    `;

    const html = renderShell({
      title, description, canonical, ogImage: OG_IMAGE,
      jsonLd: buildLocalizedJsonLd(canonical, title, description, area, locale),
      breadcrumb: [
        { name: t(locale, "breadcrumbHome"), url: `${SITE}/` },
        { name: t(locale, "breadcrumbGuide"), url: canonical },
      ],
      h1, eyebrow: "", body,
      lang: cfg.htmlLang, hreflangLinks, langSwitcherHtml,
      ogLocale: ogLocaleMap[locale] || "en_US",
    });

    writeLocalizedPage(pagePath, html);
    pushLocalizedSitemapEntry(canonical);
    return true;
  }

  const byDay = new Map();
  for (const e of upcoming) {
    const dayKey = zonedDateKey(new Date(e.startDateTime), activeMetro.timezone);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(e);
  }

  const categoryCounts = countBy(upcoming, (event) => event.category || "Other");
  const cityCounts = countBy(upcoming, (event) => event.city || event.neighborhood || area);
  const freeCount = upcoming.filter(eventLikelyFree).length;
  const highlights = pickWeekendHighlights(upcoming, lookup).slice(0, 6);
  const daySections = [weekend.saturdayKey, weekend.sundayKey]
    .map((dayKey) => renderWeekendDaySection(dayKey, byDay.get(dayKey) || [], lookup, locale))
    .filter(Boolean);

  const generatedLabel = now.toLocaleDateString(cfg.htmlLang === "zh-Hans" ? "zh-CN" : cfg.htmlLang, {
    month: "long", day: "numeric", year: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });

  const body = `
    <p class="lede">${esc(intro)}</p>
    <section class="guide-summary" aria-label="${esc(t(locale, "weekendSnapshot"))}">
      <h2>${esc(t(locale, "weekendSnapshot"))}</h2>
      <div class="guide-facts">
        <div class="guide-fact"><strong>${upcoming.length}</strong><span>${esc(t(locale, "datedEvents"))}</span></div>
        <div class="guide-fact"><strong>${freeCount}</strong><span>${esc(t(locale, "freeOptions"))}</span></div>
        <div class="guide-fact"><strong>${cityCounts.size}</strong><span>${esc(t(locale, "metroCitiesRepresented"))}</span></div>
      </div>
      ${highlights.length ? `<ul class="guide-highlights">${highlights.map((item) => `<li><a href="${item.href}">${esc(item.event.title)}</a><p>${esc(formatTimelineMeta(item.event))}</p></li>`).join("")}</ul>` : ""}
    </section>
    <p class="cta-row"><a class="cta" href="${metroPath("")}">${esc(t(locale, "buildThreeStopPlan"))}</a> <a class="cta-secondary" href="#timeline">${esc(t(locale, "jumpToTimeline"))}</a></p>
    <section id="timeline" aria-label="${esc(t(locale, "weekendSnapshot"))}">
      <p class="eyebrow">${esc(t(locale, "generatedFrom", { date: generatedLabel }))}</p>
      ${renderWeekendFilters(locale, upcoming.length)}
      ${daySections.join("")}
    </section>
    ${renderWeekendFilterScript(locale)}
  `;

  const jsonLd = buildLocalizedJsonLd(canonical, title, description, area, locale);
  jsonLd["@graph"].push({
    "@type": "ItemList",
    "@id": `${canonical}#timeline`,
    name: h1,
    itemListElement: upcoming.slice(0, 30).map((event, index) => {
      const slug = lookup.get(event);
      return {
        "@type": "ListItem",
        position: index + 1,
        url: slug ? metroUrl(`event/${slug}/`) : event.url || canonical,
        name: event.title,
      };
    }),
  });

  const html = renderShell({
    title, description, canonical, ogImage: OG_IMAGE, jsonLd,
    breadcrumb: [
      { name: t(locale, "breadcrumbHome"), url: `${SITE}/` },
      { name: t(locale, "breadcrumbGuide"), url: canonical },
    ],
    h1, eyebrow: "", body,
    lang: cfg.htmlLang, hreflangLinks, langSwitcherHtml,
    ogLocale: ogLocaleMap[locale] || "en_US",
  });

  writeLocalizedPage(pagePath, html);
  pushLocalizedSitemapEntry(canonical);
  return true;
}

function buildLocalizedJsonLd(canonical, title, description, area, locale) {
  const inLanguage = locale === "zh-Hans" ? "zh-CN" : locale;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: title,
        description,
        inLanguage,
        isPartOf: { "@id": `${SITE}/#website` },
        about: { "@type": "Place", name: area },
      },
      {
        "@type": "Article",
        "@id": `${canonical}#guide`,
        headline: title,
        description,
        inLanguage,
        dateModified: today(),
        author: { "@type": "Organization", name: BRAND },
        publisher: { "@type": "Organization", name: BRAND },
        mainEntityOfPage: canonical,
      },
    ],
  };
}

function writeLocalizedPage(pagePath, html) {
  const rel = pagePath.replace(/^\//, "").replace(/\/$/, "/index.html");
  writePage(rel, html);
}

function pushLocalizedSitemapEntry(canonical) {
  sitemapEntries.push({
    loc: canonical,
    lastmod: today(),
    changefreq: "daily",
    priority: 0.85,
  });
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

function writeSitemap(entries) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((e) => {
    const lastmod = normalizeDate(e.lastmod);
    return `  <url>
    <loc>${esc(e.loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}
    <changefreq>${e.changefreq || "weekly"}</changefreq>
    <priority>${(e.priority ?? 0.5).toFixed(1)}</priority>
  </url>`;
  })
  .join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), xml);
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

function renderShell({
  title,
  description,
  canonical,
  ogImage,
  jsonLd,
  breadcrumb,
  h1,
  eyebrow,
  body,
  lang = "en",
  hreflangLinks = [],
  langSwitcherHtml = "",
  ogLocale = "en_US",
  noindex = false,
  refresh = "",
}) {
  const breadcrumbLd = breadcrumb && breadcrumb.length
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumb.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: b.name,
          item: b.url,
        })),
      }
    : null;
  const allLd = [jsonLd, breadcrumbLd].filter(Boolean);
  const breadcrumbHtml = breadcrumb && breadcrumb.length
    ? `<nav class="breadcrumb" aria-label="Breadcrumb"><ol>${breadcrumb
        .map((b, i, arr) =>
          i === arr.length - 1
            ? `<li aria-current="page">${esc(b.name)}</li>`
            : `<li><a href="${esc(b.url)}">${esc(b.name)}</a></li>`,
        )
        .join("")}</ol></nav>`
    : "";
  const guideCurrent = String(canonical || "").replace(/\/+$/, "").endsWith("/this-weekend");

  const hreflangHtml = hreflangLinks.map((link) =>
    `<link rel="alternate" hreflang="${esc(link.hreflang)}" href="${esc(link.href)}">`
  ).join("\n");

  const robots = noindex ? "noindex,follow" : "index,follow";
  const refreshHtml = refresh ? `\n<meta http-equiv="refresh" content="${esc(refresh)}">` : "";

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${esc(robots)}">${GSC_VERIFICATION ? `\n<meta name="google-site-verification" content="${esc(GSC_VERIFICATION)}">` : ""}${refreshHtml}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${hreflangHtml}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="${esc(ogLocale)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="theme-color" content="${IS_ADULTS ? "#7c3aed" : "#f59e0b"}">
<style>${PAGE_CSS}</style>
${allLd.map((node) => `<script type="application/ld+json">${safeJsonScript(node)}</script>`).join("\n")}
</head>
<body>
${renderStaticTopbar({ guideCurrent })}
${langSwitcherHtml}
${renderStaticAuthScript()}
<main class="famhop-page">
  ${breadcrumbHtml}
  ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
  <h1>${esc(h1)}</h1>
  ${body}
</main>
<footer class="famhop-footer">
  <p>© ${BRAND} · ${metroTag()}.</p>
  <p>Spot data © OpenStreetMap contributors (ODbL). Event listings from configured public sources.</p>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.warn(`[seo] could not read ${p}: ${err.message}`);
    return null;
  }
}

function readBuildEnv() {
  const result = {};
  // Mirror Vite's env loading: base files first, then mode-specific files
  // (.env.<mode>) which override. Without this, `build:adults` would run this
  // script with kids defaults and overwrite the adults-branded homepage/SEO.
  const modeIdx = process.argv.indexOf("--mode");
  const mode = modeIdx !== -1 ? process.argv[modeIdx + 1] : process.env.APP_MODE || "";
  const files = [".env", ".env.local"];
  if (mode) files.push(`.env.${mode}`, `.env.${mode}.local`);
  for (const filename of files) {
    const file = path.join(ROOT, filename);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      let value = rawValue.trim();
      const quote = value[0];
      if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

function upsertHeadTag(html, tag, content) {
  const re = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, "is");
  const next = `<${tag}>${content}</${tag}>`;
  if (re.test(html)) return html.replace(re, next);
  return html.replace("</head>", `${next}\n</head>`);
}

function upsertMeta(html, attrName, attrValue, content) {
  const re = new RegExp(
    `<meta\\s+[^>]*${escapeRegExp(attrName)}=["']${escapeRegExp(attrValue)}["'][^>]*>`,
    "i",
  );
  const next = `<meta ${attrName}="${esc(attrValue)}" content="${esc(content)}">`;
  if (re.test(html)) return html.replace(re, next);
  return html.replace("</head>", `${next}\n</head>`);
}

function upsertLink(html, rel, href) {
  const re = new RegExp(
    `<link\\s+[^>]*rel=["']${escapeRegExp(rel)}["'][^>]*>`,
    "i",
  );
  const next = `<link rel="${esc(rel)}" href="${esc(href)}">`;
  if (re.test(html)) return html.replace(re, next);
  return html.replace("</head>", `${next}\n</head>`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writePage(rel, html) {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
}

function slugify(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonScript(obj) {
  return JSON.stringify(obj, (_k, v) => (v === undefined ? undefined : v))
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\>");
}

function stripProto(url) {
  return String(url || "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

if (isDirectRun) main();
