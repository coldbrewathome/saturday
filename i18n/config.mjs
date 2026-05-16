// Central i18n configuration: locales, route map, and helpers.
// Consumed by scripts/generate-seo-pages.mjs at build time.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const defaultLocale = "en";
export const supportedLocales = ["en", "es", "zh-Hans"];

export const localeConfig = {
  en: { pathPrefix: "", displayName: "English", hreflang: "en", htmlLang: "en" },
  es: { pathPrefix: "/es", displayName: "Español", hreflang: "es", htmlLang: "es" },
  "zh-Hans": { pathPrefix: "/zh", displayName: "中文", hreflang: "zh-Hans", htmlLang: "zh-Hans" },
};

// Route clusters: each key groups equivalent pages across locales.
// Only locales with an entry exist — don't fabricate missing pages.
export const routeMap = {
  "bay-area-weekend": {
    metroId: "bay-area",
    en: "/bay-area/this-weekend/",
    es: "/es/bay-area/fin-de-semana-con-ninos/",
    "zh-Hans": "/zh/bay-area/zhoumo-qinzi-huodong/",
  },
  "los-angeles-weekend": {
    metroId: "los-angeles",
    en: "/los-angeles/this-weekend/",
    es: "/es/los-angeles/fin-de-semana-con-ninos/",
  },
  "houston-weekend": {
    metroId: "houston",
    en: "/houston/this-weekend/",
    es: "/es/houston/fin-de-semana-con-ninos/",
  },
  "dallas-fort-worth-weekend": {
    metroId: "dallas-fort-worth",
    en: "/dallas-fort-worth/this-weekend/",
    es: "/es/dallas-fort-worth/fin-de-semana-con-ninos/",
  },
  "miami-weekend": {
    metroId: "miami",
    en: "/miami/this-weekend/",
    es: "/es/miami/fin-de-semana-con-ninos/",
  },
  "phoenix-weekend": {
    metroId: "phoenix",
    en: "/phoenix/this-weekend/",
    es: "/es/phoenix/fin-de-semana-con-ninos/",
  },
  // Chinese-only sub-metro pages (Bay Area focused)
  "zh-south-bay-weekend": {
    metroId: "bay-area",
    subMetro: "south-bay",
    "zh-Hans": "/zh/south-bay/zhoumo-qinzi-huodong/",
  },
  "zh-sunnyvale": {
    metroId: "bay-area",
    subMetro: "sunnyvale",
    "zh-Hans": "/zh/sunnyvale/qinzi-huodong/",
  },
  "zh-cupertino": {
    metroId: "bay-area",
    subMetro: "cupertino",
    "zh-Hans": "/zh/cupertino/qinzi-huodong/",
  },
  "zh-fremont": {
    metroId: "bay-area",
    subMetro: "fremont",
    "zh-Hans": "/zh/fremont/qinzi-huodong/",
  },
  "zh-san-francisco": {
    metroId: "bay-area",
    subMetro: "san-francisco",
    "zh-Hans": "/zh/san-francisco/qinzi-huodong/",
  },
};

// Cities belonging to each sub-metro filter (lowercase match against event.city)
export const subMetroCities = {
  "south-bay": [
    "san jose", "sunnyvale", "cupertino", "santa clara", "mountain view",
    "milpitas", "campbell", "los gatos", "saratoga", "gilroy", "morgan hill",
    "palo alto", "menlo park", "los altos", "los altos hills",
  ],
  sunnyvale: ["sunnyvale"],
  cupertino: ["cupertino"],
  fremont: ["fremont", "newark", "union city"],
  "san-francisco": ["san francisco", "sf"],
};

// Display names for sub-metros
export const subMetroLabels = {
  "south-bay": "South Bay",
  sunnyvale: "Sunnyvale",
  cupertino: "Cupertino",
  fremont: "Fremont",
  "san-francisco": "San Francisco",
};

const translationCache = new Map();

export function loadTranslations(locale) {
  if (translationCache.has(locale)) return translationCache.get(locale);
  const filePath = join(__dirname, `${locale}.json`);
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  translationCache.set(locale, data);
  return data;
}

export function t(locale, key, vars = {}) {
  const dict = loadTranslations(locale);
  let value = dict[key];
  if (!value) return key;
  for (const [k, v] of Object.entries(vars)) {
    value = value.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  }
  return value;
}

// Returns hreflang alternate links for a given route key
export function getAlternateLinks(routeKey, siteUrl) {
  const cluster = routeMap[routeKey];
  if (!cluster) return [];
  const links = [];
  for (const locale of supportedLocales) {
    const path = cluster[locale];
    if (!path) continue;
    links.push({
      hreflang: localeConfig[locale].hreflang,
      href: `${siteUrl}${path}`,
    });
  }
  if (cluster.en) {
    links.push({ hreflang: "x-default", href: `${siteUrl}${cluster.en}` });
  }
  return links;
}

// Find the route key for a given locale + path
export function findRouteKey(locale, path) {
  for (const [key, cluster] of Object.entries(routeMap)) {
    if (cluster[locale] === path) return key;
  }
  return null;
}

// Get the best link for a locale given a route key
export function getLocalizedLink(routeKey, targetLocale, siteUrl) {
  const cluster = routeMap[routeKey];
  if (!cluster) return null;
  const path = cluster[targetLocale];
  if (path) return `${siteUrl}${path}`;
  // Fallback: localized homepage
  const prefix = localeConfig[targetLocale]?.pathPrefix || "";
  return `${siteUrl}${prefix}/`;
}
