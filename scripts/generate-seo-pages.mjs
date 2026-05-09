#!/usr/bin/env node
// Generates static SEO landing pages and a dynamic sitemap from the Bay Area
// spot + event datasets. Runs after `vite build` so output lands in dist/.
//
// Output layout:
//   dist/spot/<slug>/index.html     — one per spot (Place JSON-LD)
//   dist/event/<slug>/index.html    — one per event (Event JSON-LD)
//   dist/city/<slug>/index.html     — one per Bay Area city with content
//   dist/sitemap.xml                — overwrites the static sitemap with full URL list

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "public", "data");

const SITE = "https://famhop.com";
const BRAND = "FamHop";
const BRAND_TAG = "Bay Area family weekend planner";
const OG_IMAGE = `${SITE}/og-image.png`;

const PAGE_CSS = `
:root{--bg:#FFF6EE;--ink:#22221f;--muted:#5b5b54;--brand:#ff6b5b;--card:#fff;--line:rgba(34,34,31,.08);}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.famhop-topbar{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid var(--line);background:#fff;}
.famhop-brand{font-weight:800;font-size:20px;color:var(--ink);}
.famhop-topbar nav a{font-weight:600;color:var(--ink);}
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
@media (max-width:640px){.famhop-page{padding:22px 18px 40px;}.famhop-page h1{font-size:28px;}}
`;

if (!fs.existsSync(DIST)) {
  console.error(`[seo] dist/ not found at ${DIST} — run \`vite build\` first.`);
  process.exit(1);
}

const spotsDoc = readJson(path.join(DATA, "bay-area-spots.json"));
const eventsDoc = readJson(path.join(DATA, "events.json"));

const spots = Array.isArray(spotsDoc?.spots) ? spotsDoc.spots : [];
const events = Array.isArray(eventsDoc?.events) ? eventsDoc.events : [];

const sitemapEntries = [
  { loc: `${SITE}/`, lastmod: today(), changefreq: "daily", priority: 1.0 },
];

const spotSlugs = generateSpotPages(spots);
const eventSlugs = generateEventPages(events);
const citySlugs = generateCityPages(spots, events, spotSlugs, eventSlugs);

writeSitemap(sitemapEntries);

console.log(
  `[seo] wrote ${spotSlugs.size} spot pages, ${eventSlugs.size} event pages, ${citySlugs.size} city pages, sitemap with ${sitemapEntries.length} URLs.`,
);

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
    const canonical = `${SITE}/spot/${slug}/`;
    const cityName = (spot.neighborhood || "the Bay Area").trim();
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
        <a class="cta" href="/">Plan a day with ${BRAND}</a>
        ${spot.website ? `<a class="cta-secondary" rel="noopener nofollow" href="${esc(spot.website)}">Visit official website</a>` : ""}
      </p>
      ${cityName ? `<p class="see-also">See more <a href="/city/${esc(slugify(cityName))}/">family activities in ${esc(cityName)}</a>.</p>` : ""}
    `;

    const jsonLd = buildSpotJsonLd(spot, canonical);
    const html = renderShell({
      title,
      description,
      canonical,
      ogImage: heroImage || OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: `${SITE}/` },
        cityName ? { name: cityName, url: `${SITE}/city/${slugify(cityName)}/` } : null,
        { name: spot.name, url: canonical },
      ].filter(Boolean),
      h1: spot.name,
      eyebrow: `${esc(cityName)}${spot.category ? ` · ${esc(spot.category)}` : ""}`,
      body,
    });

    writePage(`spot/${slug}/index.html`, html);

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
  const city = spot.neighborhood || "the Bay Area";
  const tier = spot.category ? spot.category.toLowerCase() : "family";
  const tagsBit = Array.isArray(spot.tags) && spot.tags.length
    ? ` Tagged: ${spot.tags.slice(0, 4).join(", ")}.`
    : "";
  const opening = spot.openingHours ? ` Hours: ${spot.openingHours}.` : "";
  const cost = spot.cost ? ` Cost: ${spot.cost}.` : "";
  return `${spot.name} is a ${tier} stop in ${city} for a Bay Area weekend with the kids.${cost}${opening}${tagsBit}`.trim().slice(0, 280);
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
      addressRegion: "CA",
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

function generateEventPages(items) {
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

    const canonical = `${SITE}/event/${candidate}/`;
    const cityName = event.city || event.neighborhood || "the Bay Area";
    const dateStr = formatEventDate(event);
    const title = `${event.title} — ${cityName}${dateStr ? `, ${dateStr}` : ""} | ${BRAND}`;
    const description = buildEventDescription(event, dateStr);

    const detailRows = buildEventDetailRows(event, dateStr);

    const body = `
      <p class="lede">${esc(description)}</p>
      ${detailRows.length ? `<dl class="meta-grid">${detailRows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${r.html}</dd></div>`).join("")}</dl>` : ""}
      <p class="cta-row">
        <a class="cta" href="/">Plan a day with ${BRAND}</a>
        ${event.url ? `<a class="cta-secondary" rel="noopener nofollow" href="${esc(event.url)}">Event details</a>` : ""}
      </p>
      ${cityName ? `<p class="see-also">More <a href="/city/${esc(slugify(cityName))}/">kid-friendly things to do in ${esc(cityName)}</a>.</p>` : ""}
    `;

    const jsonLd = buildEventJsonLd(event, canonical);
    const html = renderShell({
      title,
      description,
      canonical,
      ogImage: OG_IMAGE,
      jsonLd,
      breadcrumb: [
        { name: BRAND, url: `${SITE}/` },
        { name: cityName, url: `${SITE}/city/${slugify(cityName)}/` },
        { name: event.title, url: canonical },
      ],
      h1: event.title,
      eyebrow: `${esc(cityName)}${dateStr ? ` · ${esc(dateStr)}` : ""}`,
      body,
    });

    writePage(`event/${candidate}/index.html`, html);
    slugs.add(candidate);

    sitemapEntries.push({
      loc: canonical,
      lastmod: event.fetchedAt || event.startDateTime || today(),
      changefreq: "daily",
      priority: 0.7,
    });
  }
  return slugs;
}

function buildEventDescription(event, dateStr) {
  const where = event.venue || event.city || "the Bay Area";
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
  const node = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": `${canonical}#event`,
    name: event.title,
    url: canonical,
    description: buildEventDescription(event, formatEventDate(event)),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
  };
  if (event.startDateTime) node.startDate = event.startDateTime;
  if (event.endDateTime) node.endDate = event.endDateTime;
  const venue = event.venue || event.city;
  if (venue) {
    node.location = {
      "@type": "Place",
      name: venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.city || "Bay Area",
        addressRegion: "CA",
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
  if (event.url) {
    node.offers = {
      "@type": "Offer",
      url: event.url,
      availability: "https://schema.org/InStock",
      price: event.cost && /free/i.test(event.cost) ? "0" : undefined,
      priceCurrency: "USD",
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
    timeZone: "America/Los_Angeles",
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
    const canonical = `${SITE}/city/${slug}/`;
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
          return `<li><a href="/spot/${esc(sslug)}/"><strong>${esc(s.name)}</strong>${s.category ? `<span> · ${esc(s.category)}</span>` : ""}</a>${s.note ? `<p>${esc(s.note)}</p>` : ""}</li>`;
        }).join("")}</ul></section>`
      : "";

    const eventsList = upcomingEvents.length
      ? `<section><h2>Upcoming family events in ${esc(city.name)}</h2><ul class="card-list">${upcomingEvents.map((e) => {
          const eslug = eventToSlug.get(e);
          if (!eslug) return "";
          const dateStr = formatEventDate(e);
          return `<li><a href="/event/${esc(eslug)}/"><strong>${esc(e.title)}</strong>${dateStr ? `<span> · ${esc(dateStr)}</span>` : ""}</a>${e.venue ? `<p>${esc(e.venue)}${e.cost && e.cost !== "Unknown" ? ` · ${esc(e.cost)}` : ""}</p>` : ""}</li>`;
        }).join("")}</ul></section>`
      : "";

    const body = `
      <p class="lede">${esc(description)}</p>
      <p class="cta-row"><a class="cta" href="/">Plan a day with ${BRAND}</a></p>
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
          addressRegion: "CA",
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
        { name: BRAND, url: `${SITE}/` },
        { name: city.name, url: canonical },
      ],
      h1: `Things to do with kids in ${city.name}`,
      eyebrow: BRAND_TAG,
      body,
    });

    writePage(`city/${slug}/index.html`, html);
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
  const allLd = breadcrumbLd ? [jsonLd, breadcrumbLd] : [jsonLd];
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
<meta name="theme-color" content="#ff6b5b">
<style>${PAGE_CSS}</style>
${allLd.map((node) => `<script type="application/ld+json">${safeJsonScript(node)}</script>`).join("\n")}
</head>
<body>
<header class="famhop-topbar">
  <a class="famhop-brand" href="/">${BRAND}</a>
  <nav><a href="/">Plan a day</a></nav>
</header>
<main class="famhop-page">
  ${breadcrumbHtml}
  ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}
  <h1>${esc(h1)}</h1>
  ${body}
</main>
<footer class="famhop-footer">
  <p>© ${BRAND} · ${BRAND_TAG}.</p>
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
