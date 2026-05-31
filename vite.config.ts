import { loadEnv, type Plugin } from "vite";
// vitest/config re-exports vite's defineConfig with the `test` field typed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base =
  process.env.GITHUB_PAGES === "true" && repositoryName ? `/${repositoryName}/` : "/";

const kidsMetroNames = [
  "San Francisco Bay Area",
  "Los Angeles",
  "New York City",
  "Seattle",
  "Chicago",
  "Dallas-Fort Worth",
  "Houston",
  "Washington DC",
  "Atlanta",
  "Philadelphia",
  "Miami",
  "Phoenix",
  "Boston",
  "San Diego",
];

// Swap the home-page JSON-LD block based on the audience the build is for.
// Kids gets the FamHop FAQ + WebApp graph; adults gets a NightHop-flavored
// version so structured data and FAQ rich results match the visible brand.
function audienceJsonLdPlugin(env: Record<string, string>): Plugin {
  const audience = env.VITE_APP_AUDIENCE || "kids";
  const isAdults = audience === "adults";
  const brand = env.VITE_APP_BRAND || (isAdults ? "NightHop" : "FamHop");
  const siteUrl =
    (env.VITE_APP_SITE_URL || (isAdults
      ? "https://nighthop.pages.dev/"
      : "https://famhop.com/")).replace(/\/?$/, "/");
  const logo = isAdults
    ? `${siteUrl}icon-512.png`
    : `${siteUrl}icon-512.png`;
  const slogan = env.VITE_APP_TAGLINE || "Plan · Hop · Repeat.";
  const description = env.VITE_APP_OG_DESCRIPTION || "";
  const faq = isAdults
    ? [
        {
          q: `What is ${brand}?`,
          a: `${brand} is a free Bay Area night-out planner for adults. Pick a vibe (chill night, foodie crawl, music & culture, etc.) and ${brand} builds a 3-stop plan combining bars, breweries, restaurants, music venues, and comedy clubs. Share a link with friends so the crew can vote on each stop.`,
        },
        {
          q: `Is ${brand} free to use?`,
          a: `Yes, ${brand} is free for visitors. Cover charges and tabs at each venue vary — pricing for ticketed events is shown on each event card.`,
        },
        {
          q: `How does the share-and-vote feature work?`,
          a: `After you build a plan, tap Share to mint a vote link. Anyone you send it to can vote Yes / Maybe / Skip on each stop without signing up. The crew sees the running tally to settle on the night.`,
        },
        {
          q: `Where does ${brand} pull events from?`,
          a: `Events are pulled from the official calendars of Bay Area music venues, comedy clubs, breweries, and 21+ festivals using their published JSON-LD, iCal, RSS, and structured-HTML feeds.`,
        },
        {
          q: `Where does ${brand} cover?`,
          a: `${brand} covers the San Francisco Bay Area: SF, the Peninsula, the South Bay, the East Bay, Marin, and the North Bay.`,
        },
      ]
    : [
        {
          q: `What is ${brand}?`,
          a: `${brand} is a free family weekend planner for major U.S. metro areas. Pick a vibe (chill, adventure, museum day…) and ${brand} builds a 3-stop plan combining family-friendly parks, libraries, museums, and weekend events, then lets you share a link so co-parents and friends can vote on each stop.`,
        },
        {
          q: `Is ${brand} free to use?`,
          a: `Yes. ${brand} is free for visitors. The places and events themselves vary — most parks and library events are free, while museums and ticketed events show their price on each card.`,
        },
        {
          q: `How does the share-and-vote feature work?`,
          a: `After you build a plan, tap Share to generate a vote link. Anyone you send it to can vote Yes / Maybe / Skip on each stop without signing up. The plan creator sees the running tally to settle on what the family is doing.`,
        },
        {
          q: `Where do ${brand}'s events come from?`,
          a: `Events are pulled directly from public source pages such as libraries, parks, museums, zoos, theaters, family festivals, and selected ticketed sources using official JSON-LD, iCal, RSS, LibCal, BiblioEvents, Communico, and dated HTML formats.`,
        },
        {
          q: `What ages does ${brand} cover?`,
          a: `${brand} covers four age bands you can filter by: toddler (0–2), preschool (3–5), school-age (6–9), and tween (10–14).`,
        },
        {
          q: `Where does ${brand} work?`,
          a: `${brand} covers ${kidsMetroNames.join(", ")}.`,
        },
      ];

  const alternateName = isAdults
    ? [`${brand} night-out planner`, "Bay Area nightlife", "nighthop.pages.dev"]
    : [`${brand} weekend planner`, "family events", "family activities", "major metro family planner", "famhop.com"];
  const featureList = isAdults
    ? [
        "Pick-a-vibe 3-stop night-out plan in one tap",
        "Bay Area bars, breweries, music and comedy venues",
        "Live nightlife events by city and category",
        "Share a vote link with friends",
        "Find me on the map and sort venues by distance",
      ]
    : [
        "Pick-a-vibe 3-stop family plan in one tap",
        "Major metro parks, libraries, museums and family venues",
        "Live weekend family events by city and category",
        "Share a vote link with co-parents and friends",
        "Filter by age band: toddler, preschool, school-age, tween",
        "Find me on the map and sort spots by distance",
      ];
  const audienceLd = isAdults
    ? { "@type": "PeopleAudience", suggestedMinAge: 21 }
    : { "@type": "PeopleAudience", suggestedMinAge: 0, suggestedMaxAge: 14 };

  const block = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}#website`,
        url: siteUrl,
        name: brand,
        alternateName,
        description,
        inLanguage: "en-US",
        publisher: { "@id": `${siteUrl}#org` },
      },
      {
        "@type": "Organization",
        "@id": `${siteUrl}#org`,
        name: brand,
        url: siteUrl,
        logo,
        slogan,
      },
      {
        "@type": "WebApplication",
        "@id": `${siteUrl}#app`,
        name: brand,
        url: siteUrl,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript",
        description,
        featureList,
        areaServed: isAdults
          ? { "@type": "Place", name: "San Francisco Bay Area" }
          : kidsMetroNames.map((name) => ({ "@type": "Place", name })),
        audience: audienceLd,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@type": "FAQPage",
        "@id": `${siteUrl}#faq`,
        mainEntity: faq.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      },
    ],
  };
  const json = JSON.stringify(block).replace(/</g, "\\u003c");

  return {
    name: "famhop-audience-json-ld",
    transformIndexHtml(html: string) {
      // Replace the entire existing JSON-LD <script> with the audience-aware
      // version. Matches the exact pattern emitted by the source index.html.
      return html.replace(
        /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        `<script type="application/ld+json">${json}</script>`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base,
    plugins: [
      react(),
      audienceJsonLdPlugin(env),
      // Service worker registration. Per ADR 05, the static
      // `public/manifest.webmanifest` remains the source of truth (commit
      // f85385a fixed it), so `manifest: false` keeps VitePWA from
      // generating a competing copy. Runtime-caching table below implements
      // ADR 05 §(a). Note: in production the per-metro JSON is served
      // cross-origin from VITE_DATA_ORIGIN (famhop-data.pages.dev), so the
      // urlPatterns match on the `/data/<metro>/…json` path, not origin.
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null, // we register from src/main.tsx behind import.meta.env.PROD
        manifest: false,
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
          // SPA shell fallback for the app's own routes (root + single-segment
          // metro paths like /bay-area/; the SPA routes via hash within those).
          // CRITICAL: deny any deeper path — the prerendered SEO pages
          // (/<metro>/this-weekend/, /<metro>/events/<slug>/, /<metro>/spot/…,
          // city/category pages) must fetch their real HTML, not the shell.
          // Without this denylist the SW served index.html for "Guide" et al.,
          // bouncing the user into the SPA browse view (regression fix).
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/[^/]+\/.+/, /^\/api\//],
          runtimeCaching: [
            {
              // Per-metro weekend feed (kids + adults). Rotates ~weekly, so
              // a short SWR window keeps a single weekend fresh while still
              // surviving offline. Anchoring to `.json$` means a `?nocache=1`
              // request falls through to network (ADR 05 escape hatch).
              urlPattern: /\/data\/[^/]+\/(events|featured-plans)(-adults)?\.json$/,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "famhop-events-v1",
                expiration: { maxEntries: 60, maxAgeSeconds: 6 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Curated spot catalog — churns slowly, ~2.7 MB, cache hard.
              urlPattern: /\/data\/[^/]+\/spots(-adults)?\.json$/,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "famhop-spots-v1",
                expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Map tiles + remote imagery. Opaque cross-origin responses,
              // so allow status 0.
              urlPattern:
                /^https:\/\/([a-c]\.tile\.openstreetmap\.org|images\.unsplash\.com|[^/]*\.wikimedia\.org)\//,
              handler: "CacheFirst",
              options: {
                cacheName: "famhop-images-v1",
                expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    // Vitest: component/logic tests only (.ts/.tsx). The .mjs pipeline tests
    // run separately under `node --test` (test:unit). jsdom so the component +
    // localStorage/navigator tests have a DOM; the pure planner tests don't
    // care which environment they run in.
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      environment: "jsdom",
      setupFiles: ["tests/setup.ts"],
    },
  };
});
