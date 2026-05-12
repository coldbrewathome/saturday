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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "public", "data");
const metroConfig = loadMetroConfig();

// SEO output adapts to the same VITE_APP_AUDIENCE the SPA reads. Defaults
// to the kids brand. Override with VITE_APP_AUDIENCE=adults at build time
// (the `npm run build:adults` script sets it via .env.adults + Vite).
const APP_AUDIENCE = process.env.VITE_APP_AUDIENCE || "kids";
const IS_ADULTS = APP_AUDIENCE === "adults";

const SITE = process.env.VITE_APP_SITE_URL?.replace(/\/$/, "") ||
  (IS_ADULTS ? "https://nighthop.pages.dev" : "https://famhop.com");
const BRAND = process.env.VITE_APP_BRAND || (IS_ADULTS ? "NightHop" : "FamHop");
const BRAND_TAG = IS_ADULTS ? "night-out planner" : "family weekend planner";
const OG_IMAGE = process.env.VITE_APP_OG_IMAGE || `${SITE}/og-image.png`;
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
:root{--bg:#FFF6EE;--ink:#22221f;--muted:#5b5b54;--brand:#f59e0b;--brand-strong:#d97706;--card:#fff;--line:rgba(34,34,31,.08);}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.famhop-topbar{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid var(--line);background:#fff;}
.famhop-brand{font-weight:800;font-size:20px;color:var(--ink);}
.metro-links{display:flex;align-items:center;justify-content:flex-end;gap:14px;flex-wrap:wrap;}
.metro-links a{font-weight:600;color:var(--ink);font-size:14px;}
.metro-links a[aria-current="page"]{color:var(--brand-strong);}
.famhop-page{max-width:780px;margin:0 auto;padding:32px 24px 56px;}
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
.famhop-footer{border-top:1px solid var(--line);padding:24px 28px;color:var(--muted);font-size:13px;}
.famhop-footer p{margin:0 0 4px;}
@media (max-width:640px){.famhop-topbar{align-items:flex-start;gap:12px;flex-direction:column;}.metro-links{justify-content:flex-start;gap:10px 12px;}.famhop-page{padding:22px 18px 40px;}.famhop-page h1{font-size:28px;}}
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

writeSitemap(sitemapEntries);

console.log(
  `[seo] wrote ${totalSpotPages} spot pages, ${totalEventPages} event pages, ${totalCityPages} city pages, ${totalCategoryPages} category pages, ${totalWeekendPages} this-weekend pages, sitemap with ${sitemapEntries.length} URLs.`,
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
            <a href="${metroPath("this-weekend/")}">Things to do this weekend</a>,
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
  const seen = new Map();
  for (const spot of items) {
    if (!spot || typeof spot.name !== "string") continue;
    const baseSlug = slugify(`${spot.name} ${spot.neighborhood ?? ""}`);
    if (!baseSlug) continue;
    let slug = baseSlug;
    let n = 2;
    while (seen.has(slug)) slug = `${baseSlug}-${n++}`;
    seen.set(slug, spot);
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

  const cities = [...byCity.values()]
    .filter((c) => c.spots.length + c.events.length >= 3)
    .sort((a, b) => b.spots.length + b.events.length - (a.spots.length + a.events.length))
    .slice(0, 40);

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
      <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a day with ${BRAND}</a> <a class="cta-secondary" href="${metroPath("this-weekend/")}">This weekend's events</a></p>
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
  // Snap to the upcoming Saturday/Sunday in the metro timezone. If today is Sat or
  // Sun, "this weekend" means today + tomorrow; otherwise it means the next
  // weekend (Sat 00:00 → Sun 23:59 Pacific).
  const dow = now.getDay();
  const daysToSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
  const sat = new Date(now);
  sat.setDate(sat.getDate() + daysToSat);
  sat.setHours(0, 0, 0, 0);
  const monMidnight = new Date(sat);
  monMidnight.setDate(sat.getDate() + 2);

  const upcoming = eventItems
    .filter((e) => {
      if (!e.startDateTime) return false;
      const t = new Date(e.startDateTime).getTime();
      return Number.isFinite(t) && t >= sat.getTime() && t < monMidnight.getTime();
    })
    .sort((a, b) =>
      (a.startDateTime || "").localeCompare(b.startDateTime || ""),
    );

  if (upcoming.length === 0) return false;

  const canonical = metroUrl("this-weekend/");
  const weekendLabel = sat.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: activeMetro.timezone || "America/Los_Angeles",
  });
  const title = `Things to do with kids this weekend in ${metroLabel()} — ${BRAND}`;
  const description = `Family-friendly things to do in ${metroLabel()} this weekend (starting ${weekendLabel}): ${upcoming.length} events including library storytimes, museum free days, festivals, and family activities. Build a 3-stop plan in seconds with ${BRAND}.`.slice(
    0,
    300,
  );

  // Group by category for scannability.
  const byCat = new Map();
  for (const e of upcoming) {
    const k = e.category || "Other";
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(e);
  }
  const sections = [...byCat.entries()].map(([cat, list]) => {
    const items = list
      .map((e) => {
        const eslug = eventSlugLookup.get(e);
        if (!eslug) return "";
        const dateStr = formatEventDate(e);
        return `<li><a href="${metroPath(`event/${eslug}/`)}"><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</a>${e.venue ? `<p>${esc(e.venue)}${e.city ? `, ${esc(e.city)}` : ""}${e.cost && e.cost !== "Unknown" ? ` · ${esc(e.cost)}` : ""}</p>` : ""}</li>`;
      })
      .join("");
    return `<section><h2>${esc(cat)}</h2><ul class="card-list">${items}</ul></section>`;
  });

  const body = `
    <p class="lede">${esc(description)}</p>
    <p class="cta-row"><a class="cta" href="${metroPath("")}">Plan a 3-stop day with ${BRAND}</a></p>
    ${sections.join("")}
  `;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${canonical}#page`,
    url: canonical,
    name: `Things to do with kids this weekend in ${metroLabel()}`,
    description,
    isPartOf: { "@id": `${metroUrl("")}#website` },
    about: {
      "@type": "Place",
      name: metroLabel(),
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
      { name: "This weekend", url: canonical },
    ],
    h1: `Things to do with kids this weekend in ${metroLabel()}`,
    eyebrow: metroTag(),
    body,
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

function renderShell({ title, description, canonical, ogImage, jsonLd, breadcrumb, h1, eyebrow, body }) {
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="en_US">
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
<header class="famhop-topbar">
  <a class="famhop-brand" href="${metroPath("")}">${BRAND}</a>
  <nav class="metro-links">
    ${metroLinksHtml()}
    <a href="${metroPath("this-weekend/")}">This weekend</a>
  </nav>
</header>
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
