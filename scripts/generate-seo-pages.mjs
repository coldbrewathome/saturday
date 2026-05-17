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

const SITE = envValue("VITE_APP_SITE_URL").replace(/\/$/, "") ||
  (IS_ADULTS ? "https://nighthop.pages.dev" : "https://famhop.com");
const BRAND = envValue("VITE_APP_BRAND", IS_ADULTS ? "NightHop" : "FamHop");
const BRAND_TAG = IS_ADULTS ? "night-out planner" : "family weekend planner";
const OG_IMAGE = envValue("VITE_APP_OG_IMAGE", `${SITE}/og-image.png`);
const POLLS_API = envValue("VITE_POLLS_API").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = envValue("VITE_GOOGLE_CLIENT_ID");
const MAX_SPOT_PAGES_PER_METRO = Number(process.env.SEO_MAX_SPOT_PAGES_PER_METRO || 700);
const SEO_PINNED_PATHS = readJson(path.join(ROOT, "data", "seo-pinned-paths.json")) || {};
const FREE_CATEGORIES = new Set(["Library", "Park"]);
function eventLikelyFree(event) {
  if (typeof event.cost === "string" && /free/i.test(event.cost)) return true;
  if (typeof event.cost === "string" && event.cost !== "Unknown" && !/free/i.test(event.cost)) return false;
  return FREE_CATEGORIES.has(event.category);
}
let activeMetro = metroConfig.defaultMetro;
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
const CATEGORY_PAGES = [
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

const PAGE_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap");
:root{--font-ui:"Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--font-display:"Bricolage Grotesque","Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,sans-serif;--bg:#faf5eb;--surface:#fff;--surface-strong:#f2ead9;--line:#e8dfca;--ink:#1b1916;--muted:#6b7280;--blue:#5a7896;--accent:#dd6a1a;--accent-strong:#b8541a;--brand:var(--accent);--brand-strong:var(--accent-strong);--card:var(--surface);--glass-bg:rgba(250,245,235,.82);--glass-blur:blur(20px) saturate(160%);--glass-border:.5px solid rgba(255,255,255,.6);--glass-shadow:0 6px 24px rgba(0,0,0,.08);--glass-radius:16px;--overlay-gap:16px;}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 var(--font-ui);background:var(--bg);color:var(--ink);}
button,input,select,textarea{font:inherit}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.famhop-topbar{align-items:center;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border:var(--glass-border);border-radius:var(--glass-radius);box-shadow:0 1px 0 rgba(255,255,255,.6) inset,var(--glass-shadow);column-gap:12px;display:flex;flex-wrap:nowrap;left:var(--overlay-gap);margin:0 auto 16px;max-width:1500px;min-height:62px;padding:8px 12px;position:fixed;right:var(--overlay-gap);row-gap:0;top:var(--overlay-gap);z-index:500;}
.famhop-brand{align-items:center;color:var(--ink);display:flex;flex:0 0 auto;font-weight:800;gap:8px;margin-right:4px;}
.famhop-brand:hover{text-decoration:none;}
.famhop-mark{align-items:center;display:inline-flex;flex:0 0 auto;justify-content:center;}
.famhop-wordmark{color:var(--ink);font-family:var(--font-display);font-size:1.15rem;font-weight:700;letter-spacing:-.02em;line-height:1;margin:0;}
.famhop-metro{align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:8px;display:inline-flex;flex:0 0 auto;gap:6px;padding:7px 10px 7px 12px;}
.famhop-metro-prefix{color:var(--muted);font-size:.78rem;font-weight:500;line-height:normal;}
.famhop-metro select{appearance:none;-webkit-appearance:none;background-color:transparent;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%236b7280' d='M0 0h10L5 6z'/></svg>");background-position:right 0 center;background-repeat:no-repeat;border:0;color:var(--ink);cursor:pointer;font:inherit;font-family:var(--font-display);font-size:.88rem;font-weight:700;letter-spacing:-.01em;line-height:normal;outline:0;padding:0 16px 0 0;}
.famhop-tabs{align-items:center;background:var(--surface-strong);border-radius:999px;display:inline-flex;flex:0 0 auto;gap:2px;padding:3px;}
.famhop-tabs a{align-items:center;background:transparent;border:0;border-radius:999px;color:var(--muted);display:inline-flex;font:600 .78rem/1 var(--font-ui);gap:5px;padding:6px 12px;text-decoration:none;transition:background .15s ease,color .15s ease;}
.famhop-tabs a:hover{color:var(--ink);text-decoration:none;}
.famhop-tabs a[aria-current="page"]{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06);color:var(--ink);}
.famhop-tabs svg{height:14px;width:14px;}
.famhop-tabs .tab-count{background:rgba(0,0,0,.06);border-radius:999px;color:var(--muted);font-size:.72rem;font-style:normal;font-weight:700;margin-left:2px;padding:1px 6px;}
.famhop-tabs a[aria-current="page"] .tab-count{background:#fdece7;color:var(--brand-strong);}
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
.famhop-auth .sync-pill{background:#fdece7;border-radius:999px;color:var(--brand-strong);font-size:.7rem;font-style:normal;font-weight:900;letter-spacing:.04em;padding:2px 6px;}
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
.guide-summary{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;margin:20px 0 24px;box-shadow:0 12px 30px rgba(34,34,31,.05);}
.guide-summary h2,.guide-day h2{font-size:22px;line-height:1.25;margin:0 0 10px;}
.guide-summary p{margin:0 0 12px;color:var(--muted);}
.guide-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0 0;}
.guide-fact{background:#fff8ec;border:1px solid rgba(245,158,11,.22);border-radius:12px;padding:12px;}
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
.event-chip{display:inline-block;background:#fff3d5;border:1px solid rgba(245,158,11,.3);border-radius:999px;color:#8a4f00;font-size:11px;font-weight:900;letter-spacing:.07em;padding:3px 8px;text-transform:uppercase;}
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
`;

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

for (const metro of metroConfig.metros) {
  activeMetro = metro;
  generateMetroAppShellPage(metro);

  const spotsDoc = readJson(metroDataPath(metro, "spots"));
  const eventsDoc = readJson(metroDataPath(metro, "events"));

  const spots = (Array.isArray(spotsDoc?.spots) ? spotsDoc.spots : []).filter(
    audienceVisible,
  );
  const events = (Array.isArray(eventsDoc?.events) ? eventsDoc.events : []).filter(
    audienceVisible,
  );

  const spotSlugs = generateSpotPages(spots);
  const eventSlugs = generateEventPages(events, eventsDoc?.generatedAt);
  const citySlugs = generateCityPages(spots, events, spotSlugs, eventSlugs);
  const categorySlugs = generateCategoryPages(spots, events);
  const wroteThisWeekend = generateThisWeekendPage(events);

  totalSpotPages += spotSlugs.size;
  totalEventPages += eventSlugs.size;
  totalCityPages += citySlugs.size;
  totalCategoryPages += categorySlugs.size;
  totalWeekendPages += wroteThisWeekend ? 1 : 0;
}

const totalLocalizedPages = IS_ADULTS ? 0 : generateLocalizedWeekendPages();

writeSitemap(sitemapEntries);

console.log(
  `[seo] wrote ${totalSpotPages} spot pages, ${totalEventPages} event pages, ${totalCityPages} city pages, ${totalCategoryPages} category pages, ${totalWeekendPages} this-weekend pages, ${totalLocalizedPages} localized i18n pages, sitemap with ${sitemapEntries.length} URLs.`,
);

function metroDataPath(metro, key) {
  const primary = path.join(ROOT, metroDataFile(metro, key));
  if (fs.existsSync(primary)) return primary;
  const legacy = legacyMetroDataFile(metro, key);
  return legacy ? path.join(ROOT, legacy) : primary;
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

function generateMetroAppShellPage(metro) {
  const shellPath = path.join(DIST, "index.html");
  if (!fs.existsSync(shellPath)) return;
  const canonical = metroUrl("");
  const title = `${metroLabel()} family weekend planner | ${BRAND}`;
  const description =
    `Find family-friendly parks, libraries, museums, events, and ready-made weekend plans in ${metroLabel()} with ${BRAND}.`.slice(
      0,
      300,
    );
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
  html = replaceMetroShellCopy(html, title, description);
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
  const title = `${BRAND} family weekend planner by metro`;
  const description =
    `${BRAND} helps families find kid-friendly spots, family events, and ready-made weekend plans across major U.S. metros.`;
  const canonical = `${SITE}/`;
  const metroCards = metroConfig.metros
    .map((metro) => {
      const label = metro.seoName || metro.label || metro.id;
      const href = `${String(metro.canonicalPath || "").replace(/\/+$/, "")}/`;
      return `<li><a href="${esc(href)}"><strong>${esc(label)}</strong><p>Browse family activities, events, and kid-friendly places in ${esc(label)}.</p></a></li>`;
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
        alternateName: [
          `${BRAND} weekend planner`,
          "family events near me",
          "things to do with kids this weekend",
        ],
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

function replaceMetroShellCopy(html, title, description) {
  const area = metroLabel();
  const noscript = `
      <noscript>
        <header>
          <h1>${esc(title)}</h1>
          <p>${esc(description)} Search 1,500+ kid-friendly spots and upcoming family events, then build a shareable weekend plan.</p>
        </header>
        <section>
          <h2>What you can do on ${esc(BRAND)}</h2>
          <ul>
            <li>Browse family-friendly ${esc(area)} spots: parks, libraries, museums, playgrounds, zoos and family farms.</li>
            <li>See upcoming family events from official calendars.</li>
            <li>Filter by age band: toddler, preschool, school-age and tween.</li>
            <li>Build a 3-stop plan and share a link so co-parents and friends can vote.</li>
          </ul>
        </section>
        <section>
          <h2>Browse ${esc(area)}</h2>
          <p>
            <a href="${metroPath("this-weekend/")}">Weekend guide</a>,
            <a href="${metroPath("category/library/")}">library events</a>,
            <a href="${metroPath("category/museum/")}">museums</a>,
            <a href="${metroPath("category/park/")}">parks and outdoors</a>, and
            <a href="${metroPath("category/festival/")}">family festivals</a>.
          </p>
        </section>
        <p><strong>Heads-up:</strong> ${esc(BRAND)} is an interactive planner. Please enable JavaScript to plan, share and vote.</p>
      </noscript>`;

  return html
    .replace(/<noscript>[\s\S]*?<\/noscript>/, noscript)
    .replace(
      /Events are pulled directly from public source pages \(libraries like SFPL, SJPL, Oakland; parks; museums; family festivals\) using their official event calendars in JSON-LD, iCal, RSS, LibCal, and dated HTML formats\./g,
      `Events are pulled directly from public source pages for ${area} libraries, parks, museums, and family venues.`,
    )
    .replace(
      /FamHop covers (?:the )?[^.:]+: San Francisco, the Peninsula, the East Bay, the South Bay, and the North Bay\./g,
      `FamHop covers ${area} and nearby family-friendly places and events.`,
    );
}

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

function generateSpotPages(items) {
  const all = new Map();
  const pinnedSlugs = pinnedSpotSlugsForMetro(activeMetro.id);
  const missingPinnedSlugs = new Set(pinnedSlugs);

  for (const spot of items) {
    if (!spot || typeof spot.name !== "string") continue;
    const baseSlug = slugify(`${spot.name} ${spot.neighborhood ?? ""}`);
    if (!baseSlug) continue;
    let slug = baseSlug;
    let n = 2;
    while (all.has(slug)) slug = `${baseSlug}-${n++}`;
    all.set(slug, spot);
    missingPinnedSlugs.delete(slug);
  }

  const seen = new Map();
  let uncappedCount = 0;
  for (const [slug, spot] of all) {
    if (uncappedCount < MAX_SPOT_PAGES_PER_METRO || pinnedSlugs.has(slug)) {
      seen.set(slug, spot);
    }
    uncappedCount += 1;
  }

  if (missingPinnedSlugs.size) {
    console.warn(
      `[seo] pinned spot slugs not found for ${activeMetro.id}: ${[...missingPinnedSlugs].sort().join(", ")}`,
    );
  }

  for (const [slug, spot] of seen) {
    const canonical = metroUrl(`spot/${slug}/`);
    const cityName = (spot.neighborhood || metroLabel()).trim();
    const title = `${spot.name} — ${cityName} family-friendly spot | ${BRAND}`;
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
      ${cityName ? `<p class="see-also">See more <a href="${metroPath(`city/${slugify(cityName)}/`)}">family activities in ${esc(cityName)}</a>.</p>` : ""}
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
        cityName ? { name: cityName, url: metroUrl(`city/${slugify(cityName)}/`) } : null,
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
  const tier = spot.category ? spot.category.toLowerCase() : "family";
  const tagsBit = Array.isArray(spot.tags) && spot.tags.length
    ? ` Tagged: ${spot.tags.slice(0, 4).join(", ")}.`
    : "";
  const opening = spot.openingHours ? ` Hours: ${spot.openingHours}.` : "";
  const cost = spot.cost ? ` Cost: ${spot.cost}.` : "";
  return `${spot.name} is a ${tier} stop in ${city} for a ${metroLabel()} weekend with the kids.${cost}${opening}${tagsBit}`.trim().slice(0, 280);
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
  const placeType = mapPlaceType(spot.category);
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

function generateEventPages(items, generatedAt) {
  const slugs = new Set();
  const used = new Set();
  for (const event of items) {
    if (!event || typeof event.title !== "string") continue;
    if (!event.startDateTime) continue;
    const id = typeof event.id === "string" ? event.id : "";
    let slug = slugify(id) || slugify(`${event.title} ${event.venue ?? ""}`);
    if (!slug) continue;
    let candidate = slug;
    let n = 2;
    while (used.has(candidate)) candidate = `${slug}-${n++}`;
    used.add(candidate);

    const canonical = metroUrl(`event/${candidate}/`);
    const cityName = event.city || event.neighborhood || metroLabel();
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
      ${cityName ? `<p class="see-also">More <a href="${metroPath(`city/${slugify(cityName)}/`)}">kid-friendly things to do in ${esc(cityName)}</a>.</p>` : ""}
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
        { name: cityName, url: metroUrl(`city/${slugify(cityName)}/`) },
        { name: event.title, url: canonical },
      ],
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

function buildEventDescription(event, dateStr) {
  const where = event.venue || event.city || metroLabel();
  const when = dateStr ? ` on ${dateStr}` : "";
  const cat = event.category ? ` (${event.category})` : "";
  const cost = event.cost && event.cost !== "Unknown" ? ` Cost: ${event.cost}.` : "";
  const ages = Array.isArray(event.ageBands) && event.ageBands.length
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
  if (Array.isArray(event.ageBands) && event.ageBands.length) {
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
  };
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
    const offers = {
      "@type": "Offer",
      url: event.url,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    };
    if (free) {
      offers.price = "0";
    }
    node.offers = offers;
  }
  if (Array.isArray(event.ageBands) && event.ageBands.length) {
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

function generateCityPages(spotItems, eventItems, spotSlugMap, eventSlugMap) {
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

  // For cross-linking: rebuild the same slug rule the spot page used.
  const spotToSlug = new Map();
  {
    const used = new Map();
    for (const spot of spotItems) {
      if (!spot || typeof spot.name !== "string") continue;
      const baseSlug = slugify(`${spot.name} ${spot.neighborhood ?? ""}`);
      if (!baseSlug) continue;
      let s = baseSlug;
      let n = 2;
      while (used.has(s)) s = `${baseSlug}-${n++}`;
      used.set(s, true);
      spotToSlug.set(spot, s);
    }
  }
  const eventToSlug = new Map();
  {
    const used = new Set();
    for (const event of eventItems) {
      if (!event || typeof event.title !== "string") continue;
      const id = typeof event.id === "string" ? event.id : "";
      let base = slugify(id) || slugify(`${event.title} ${event.venue ?? ""}`);
      if (!base) continue;
      let s = base;
      let n = 2;
      while (used.has(s)) s = `${base}-${n++}`;
      used.add(s);
      eventToSlug.set(event, s);
    }
  }

  for (const city of cities) {
    const slug = slugify(city.name);
    if (!slug) continue;
    const canonical = metroUrl(`city/${slug}/`);
    const title = `Things to do with kids in ${city.name} — ${BRAND}`;
    const description = `Family-friendly things to do in ${city.name}: ${city.spots.length} parks, museums and venues plus ${city.events.length} weekend events for kids. Plan a day in seconds with ${BRAND}.`;

    const topSpots = city.spots.slice().sort((a, b) => (b.friendScore || 0) - (a.friendScore || 0)).slice(0, 24);
    const upcomingEvents = city.events
      .slice()
      .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""))
      .slice(0, 24);

    const spotsList = topSpots.length
      ? `<section><h2>Family-friendly spots in ${esc(city.name)}</h2><ul class="card-list">${topSpots.map((s) => {
          const sslug = spotToSlug.get(s);
          if (!sslug) return "";
          return `<li><a href="${metroPath(`spot/${sslug}/`)}"><strong>${esc(s.name)}</strong>${s.category ? `<span> · ${esc(s.category)}</span>` : ""}</a>${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
        }).join("")}</ul></section>`
      : "";

    const eventsList = upcomingEvents.length
      ? `<section><h2>Upcoming family events in ${esc(city.name)}</h2><ul class="card-list">${upcomingEvents.map((e) => {
          const eslug = eventToSlug.get(e);
          if (!eslug) return "";
          const dateStr = formatEventDate(e);
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
      name: `Things to do with kids in ${city.name}`,
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
      h1: `Things to do with kids in ${city.name}`,
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
  return slugs;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function generateCategoryPages(spotItems, eventItems) {
  const slugs = new Set();
  const eventSlugLookup = buildEventSlugLookup(eventItems);
  const spotSlugLookup = buildSpotSlugLookup(spotItems);

  for (const cat of CATEGORY_PAGES) {
    const matchingSpots = spotItems
      .filter((s) => cat.spotMatch(s))
      .sort((a, b) => (b.friendScore || 0) - (a.friendScore || 0))
      .slice(0, 30);
    const matchingEvents = eventItems
      .filter((e) => cat.eventMatch(e))
      .sort((a, b) => (a.startDateTime || "").localeCompare(b.startDateTime || ""))
      .slice(0, 40);

    if (matchingSpots.length + matchingEvents.length === 0) continue;

    const canonical = metroUrl(`category/${cat.slug}/`);
    const description =
      `${metroText(cat.blurb)} Browse ${matchingSpots.length} family-friendly spots and ${matchingEvents.length} upcoming events on ${BRAND}.`.slice(
        0,
        300,
      );

    const spotsList = matchingSpots.length
      ? `<section><h2>${esc(cat.label)} spots</h2><ul class="card-list">${matchingSpots
          .map((s) => {
            const sslug = spotSlugLookup.get(s);
            if (!sslug) return "";
            return `<li><a href="${metroPath(`spot/${sslug}/`)}"><strong>${esc(s.name)}</strong>${s.neighborhood ? `<span> · ${esc(s.neighborhood)}</span>` : ""}</a>${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
          })
          .join("")}</ul></section>`
      : "";

    const eventsList = matchingEvents.length
      ? `<section><h2>Upcoming ${esc(cat.label.toLowerCase())}</h2><ul class="card-list">${matchingEvents
          .map((e) => {
            const eslug = eventSlugLookup.get(e);
            if (!eslug) return "";
            const dateStr = formatEventDate(e);
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
      name: metroText(cat.title),
      description,
      isPartOf: { "@id": `${metroUrl("")}#website` },
      about: {
        "@type": "Place",
        name: metroLabel(),
      },
    };

    const html = renderShell({
      title: `${metroText(cat.title)} — ${BRAND}`,
      description,
      canonical,
      ogImage: OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: metroUrl("") },
        { name: cat.label, url: canonical },
      ],
      h1: metroText(cat.title),
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
// This weekend
// ---------------------------------------------------------------------------

function generateThisWeekendPage(eventItems) {
  const eventSlugLookup = buildEventSlugLookup(eventItems);
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

  if (upcoming.length === 0) return false;

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
  const title = `${metroLabel()} weekend guide: family events for ${weekendLabel} — ${BRAND}`;
  const description = `A timeline weekend guide to family-friendly events in ${metroLabel()} from ${weekendLabel} through ${sundayLabel}: ${upcoming.length} events with times, venues, details, and official links. Build a 3-stop plan with ${BRAND}.`.slice(
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
  const highlights = pickWeekendHighlights(upcoming, eventSlugLookup).slice(0, 6);
  const qualityCount = upcoming.filter((event) => eventQualityScore(event) >= 70).length;
  const planPresets = buildWeekendPlanPresets(upcoming, eventSlugLookup);
  const editorialBuckets = buildWeekendEditorialBuckets(upcoming, eventSlugLookup);
  const daySections = [weekend.saturdayKey, weekend.sundayKey]
    .map((dayKey) => renderWeekendDaySection(dayKey, byDay.get(dayKey) || [], eventSlugLookup))
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
        <div class="guide-fact"><strong>${upcoming.length}</strong><span>dated family events</span></div>
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
      ${daySections.join("")}
    </section>
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
        name: `${metroLabel()} family events this weekend`,
        itemListElement: upcoming.slice(0, 30).map((event, index) => {
          const slug = eventSlugLookup.get(event);
          return {
            "@type": "ListItem",
            position: index + 1,
            url: slug ? metroUrl(`event/${slug}/`) : event.url || canonical,
            name: event.title,
          };
        }),
      },
    ],
  };

  const weekendRouteKey = findRouteKey("en", metroPath("this-weekend/"));
  const hreflangLinks = weekendRouteKey ? getAlternateLinks(weekendRouteKey, SITE) : [];
  const langSwitcherHtml = weekendRouteKey ? renderLangSwitcher(weekendRouteKey, "en") : "";

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
    h1: `${metroLabel()} weekend guide for families`,
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
  return `From ${saturdayLabel} through ${sundayLabel}, ${BRAND} found ${events.length} dated family events across ${metroLabel()}. The biggest clusters are ${categoryText}, with options in ${cityText}. Use the timeline below to compare times, venues, costs, age fit, and official event links before building a plan.`;
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
    "Free family day",
    "No-ticket or likely-free events that work well as the anchor for a low-cost weekend plan.",
    source.filter(eventLikelyFree),
  );
  addPreset(
    "little-kids",
    "Toddler and preschool picks",
    "Shorter, earlier programs with age signals that are easier for little kids.",
    source.filter((event) =>
      eventHasAge(event, ["toddler", "preschool"]) ||
      /storytime|toddler|preschool|music and movement/i.test(`${event.title} ${event.description}`),
    ),
  );
  addPreset(
    "indoor-backup",
    "Indoor backup plan",
    "Libraries, museums, makerspaces, and indoor culture picks for weather or low-energy days.",
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

function buildWeekendEditorialBuckets(events, eventSlugLookup) {
  const source = highSignalEvents(events);
  const buckets = [
    {
      title: "Best free bets",
      blurb: "Good first stops when you want a flexible family day without committing to tickets.",
      events: pickPresetEvents(source.filter(eventLikelyFree)).slice(0, 4),
    },
    {
      title: "Morning starters",
      blurb: "Earlier programs that leave the rest of the day open for lunch, naps, or a park stop.",
      events: pickPresetEvents(source.filter((event) => timelineBucket(event) === "Morning")).slice(0, 4),
    },
    {
      title: "Culture and learning",
      blurb: "Museums, libraries, performances, and hands-on programs with strong family fit.",
      events: pickPresetEvents(source.filter((event) =>
        /library|museum|art|music|theater|theatre|science|story/i.test(
          `${event.category} ${event.title} ${event.description}`,
        ),
      )).slice(0, 4),
    },
  ];
  return buckets
    .map((bucket) => ({
      ...bucket,
      eventSlugLookup,
      events: bucket.events.filter(Boolean),
    }))
    .filter((bucket) => bucket.events.length > 0);
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
  return `<section class="guide-editorial" aria-label="Weekend highlights by need">
    <div class="guide-section-heading">
      <h2>Weekend picks by need</h2>
      <p>Short editorial clusters help parents scan the weekend without reading every listing.</p>
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
  const description = buildTimelineDescription(event);
  const meta = formatTimelineMeta(event);
  const quality = eventQualityLabel(eventQualityScore(event));
  const timeTba = { en: "Time TBA", es: "Hora por confirmar", "zh-Hans": "时间待定" };
  const detailsLabel = { en: "FamHop event details", es: "Detalles del evento en FamHop", "zh-Hans": "FamHop 活动详情" };
  const officialLabel = { en: "Official event page", es: "Página oficial del evento", "zh-Hans": "官方活动页面" };
  return `<li class="timeline-card">
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
  if (Array.isArray(event.ageBands) && event.ageBands.length) {
    parts.push(`Ages: ${event.ageBands.join(", ")}`);
  }
  return parts.join(" · ");
}

function buildTimelineDescription(event) {
  const desc = String(event.description || "").replace(/\s+/g, " ").trim();
  if (desc) return desc.length > 210 ? `${desc.slice(0, 207)}…` : desc;
  const where = [event.venue, event.city].filter(Boolean).join(" in ");
  const cat = event.category ? `${event.category.toLowerCase()} event` : "family event";
  return `${event.title} is a ${cat}${where ? ` at ${where}` : ""}. Confirm registration, cost, and age fit on the official listing.`;
}

function buildEventSlugLookup(eventItems) {
  const map = new Map();
  const used = new Set();
  for (const event of eventItems) {
    if (!event || typeof event.title !== "string") continue;
    const id = typeof event.id === "string" ? event.id : "";
    let base = slugify(id) || slugify(`${event.title} ${event.venue ?? ""}`);
    if (!base) continue;
    let s = base;
    let n = 2;
    while (used.has(s)) s = `${base}-${n++}`;
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
    let n = 2;
    while (used.has(s)) s = `${baseSlug}-${n++}`;
    used.set(s, true);
    map.set(spot, s);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Language switcher
// ---------------------------------------------------------------------------

function renderLangSwitcher(routeKey, currentLocale) {
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
      let events = (Array.isArray(eventsDoc?.events) ? eventsDoc.events : []).filter(audienceVisible);

      if (cluster.subMetro) {
        const cities = subMetroCities[cluster.subMetro];
        if (cities) {
          events = events.filter((e) => {
            const city = (e.city || "").toLowerCase();
            return cities.some((c) => city.includes(c));
          });
        }
      }

      const wrote = generateLocalizedWeekendPage(events, locale, routeKey, cluster);
      if (wrote) count++;
      activeMetro = previousMetro;
    }
  }
  console.log(`[seo:i18n] generated ${count} localized weekend guide pages`);
  return count;
}

function generateLocalizedWeekendPage(eventItems, locale, routeKey, cluster) {
  const eventSlugLookup = buildEventSlugLookup(eventItems);
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
  const highlights = pickWeekendHighlights(upcoming, eventSlugLookup).slice(0, 6);
  const daySections = [weekend.saturdayKey, weekend.sundayKey]
    .map((dayKey) => renderWeekendDaySection(dayKey, byDay.get(dayKey) || [], eventSlugLookup, locale))
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
      ${daySections.join("")}
    </section>
  `;

  const jsonLd = buildLocalizedJsonLd(canonical, title, description, area, locale);
  jsonLd["@graph"].push({
    "@type": "ItemList",
    "@id": `${canonical}#timeline`,
    name: h1,
    itemListElement: upcoming.slice(0, 30).map((event, index) => {
      const slug = eventSlugLookup.get(event);
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

function renderShell({ title, description, canonical, ogImage, jsonLd, breadcrumb, h1, eyebrow, body, lang = "en", hreflangLinks = [], langSwitcherHtml = "", ogLocale = "en_US" }) {
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

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
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
<meta name="theme-color" content="#f59e0b">
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
  for (const filename of [".env", ".env.local"]) {
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
