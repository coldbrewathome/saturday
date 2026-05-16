#!/usr/bin/env node
// Validates localized SEO pages for correct hreflang, canonical, metadata,
// and language-switcher mapping. Run after `npm run build`.
//
// Usage: node scripts/validate-i18n-seo.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  supportedLocales,
  localeConfig,
  routeMap,
  defaultLocale,
  getAlternateLinks,
} from "../i18n/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SITE = "https://famhop.com";

let errors = 0;
let warnings = 0;
let checked = 0;

function error(msg) { errors++; console.error(`  ✗ ${msg}`); }
function warn(msg) { warnings++; console.warn(`  ⚠ ${msg}`); }
function pass(msg) { console.log(`  ✓ ${msg}`); }

function readHtml(pagePath) {
  const filePath = path.join(DIST, pagePath.replace(/^\//, "").replace(/\/$/, "/index.html"));
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function extractTag(html, regex) {
  const match = html.match(regex);
  return match ? match[1] : null;
}

function extractAll(html, regex) {
  const results = [];
  let match;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((match = re.exec(html)) !== null) {
    results.push(match);
  }
  return results;
}

console.log("Validating i18n SEO pages...\n");

for (const [routeKey, cluster] of Object.entries(routeMap)) {
  for (const locale of supportedLocales) {
    const pagePath = cluster[locale];
    if (!pagePath) continue;

    checked++;
    const cfg = localeConfig[locale];
    const fullUrl = `${SITE}${pagePath}`;
    console.log(`[${routeKey}] ${locale}: ${pagePath}`);

    const html = readHtml(pagePath);
    if (!html) {
      error(`Page not found in dist: ${pagePath}`);
      continue;
    }

    // 1. Check <html lang>
    const htmlLang = extractTag(html, /<html\s+lang="([^"]+)"/i);
    if (!htmlLang) {
      error("Missing lang attribute on <html>");
    } else if (htmlLang !== cfg.htmlLang) {
      error(`Wrong lang: expected "${cfg.htmlLang}", got "${htmlLang}"`);
    } else {
      pass(`lang="${htmlLang}"`);
    }

    // 2. Check <title> exists and is non-empty
    const title = extractTag(html, /<title>([^<]+)<\/title>/i);
    if (!title || title.trim().length === 0) {
      error("Missing or empty <title>");
    } else if (locale !== "en" && /weekend guide/i.test(title) && locale === "es") {
      error(`Title appears untranslated (English text on ${locale} page): "${title}"`);
    } else {
      pass(`title: "${title.slice(0, 60)}..."`);
    }

    // 3. Check meta description
    const metaDesc = extractTag(html, /<meta\s+name="description"\s+content="([^"]+)"/i);
    if (!metaDesc) {
      error("Missing meta description");
    } else {
      pass(`meta description present (${metaDesc.length} chars)`);
    }

    // 4. Check canonical
    const canonical = extractTag(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (!canonical) {
      error("Missing canonical link");
    } else if (canonical !== fullUrl) {
      error(`Wrong canonical: expected "${fullUrl}", got "${canonical}"`);
    } else {
      pass(`canonical self-references correctly`);
    }

    // 5. Check hreflang
    const hreflangMatches = extractAll(html, /<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/gi);
    const hreflangMap = new Map(hreflangMatches.map(m => [m[1], m[2]]));
    const expectedLinks = getAlternateLinks(routeKey, SITE);

    if (expectedLinks.length > 1) {
      // Should have hreflang self-reference
      const selfHreflang = hreflangMap.get(cfg.hreflang);
      if (!selfHreflang) {
        error(`Missing hreflang self-reference for "${cfg.hreflang}"`);
      } else if (selfHreflang !== fullUrl) {
        error(`Wrong hreflang self-reference: expected "${fullUrl}", got "${selfHreflang}"`);
      } else {
        pass(`hreflang self-reference correct`);
      }

      // Check x-default
      const xDefault = hreflangMap.get("x-default");
      const enPath = cluster.en;
      if (enPath) {
        if (!xDefault) {
          error("Missing x-default hreflang");
        } else if (xDefault !== `${SITE}${enPath}`) {
          error(`Wrong x-default: expected "${SITE}${enPath}", got "${xDefault}"`);
        } else {
          pass("x-default points to English page");
        }
      }

      // Check all expected alternates present
      for (const expected of expectedLinks) {
        if (expected.hreflang === "x-default") continue;
        const actual = hreflangMap.get(expected.hreflang);
        if (!actual) {
          error(`Missing hreflang alternate for "${expected.hreflang}"`);
        } else if (actual !== expected.href) {
          error(`Wrong hreflang for "${expected.hreflang}": expected "${expected.href}", got "${actual}"`);
        }
      }
      pass(`${hreflangMap.size} hreflang alternates present`);
    } else if (expectedLinks.length === 1) {
      // Single-locale page (e.g., Chinese sub-metro) — should still have self-hreflang
      if (hreflangMap.size === 0) {
        warn("No hreflang tags (single-locale page)");
      } else {
        pass(`${hreflangMap.size} hreflang tag(s)`);
      }
    }

    // 6. Check H1 is not English on localized pages
    const h1 = extractTag(html, /<h1>([^<]+)<\/h1>/i);
    if (!h1) {
      error("Missing <h1>");
    } else if (locale === "es" && /weekend guide for families/i.test(h1)) {
      error(`H1 appears untranslated on Spanish page: "${h1}"`);
    } else if (locale === "zh-Hans" && /weekend guide for families/i.test(h1)) {
      error(`H1 appears untranslated on Chinese page: "${h1}"`);
    } else {
      pass(`h1: "${h1.slice(0, 60)}"`);
    }

    // 7. Check OG locale
    const ogLocale = extractTag(html, /<meta\s+property="og:locale"\s+content="([^"]+)"/i);
    if (!ogLocale) {
      warn("Missing og:locale");
    } else {
      pass(`og:locale="${ogLocale}"`);
    }

    // 8. Check language switcher on multi-locale pages
    if (expectedLinks.length > 1) {
      const hasSwitcher = html.includes("famhop-lang-switcher");
      if (!hasSwitcher) {
        error("Missing language switcher on multi-locale page");
      } else {
        // Verify switcher links
        const switcherMatches = extractAll(html, /class="famhop-lang-switcher"[^>]*>([\s\S]*?)<\/nav>/i);
        if (switcherMatches.length > 0) {
          const switcherHtml = switcherMatches[0][1];
          for (const otherLocale of supportedLocales) {
            const otherPath = cluster[otherLocale];
            if (!otherPath) continue;
            const otherUrl = `${SITE}${otherPath}`;
            if (!switcherHtml.includes(otherUrl)) {
              error(`Language switcher missing link for ${otherLocale}: ${otherUrl}`);
            }
          }
          pass("Language switcher present with correct links");
        }
      }
    }

    console.log("");
  }
}

// 9. Check sitemap includes localized URLs
const sitemapPath = path.join(DIST, "sitemap.xml");
if (fs.existsSync(sitemapPath)) {
  const sitemap = fs.readFileSync(sitemapPath, "utf8");
  console.log("Checking sitemap...");
  let sitemapMissing = 0;
  for (const [routeKey, cluster] of Object.entries(routeMap)) {
    for (const locale of supportedLocales) {
      const pagePath = cluster[locale];
      if (!pagePath) continue;
      const fullUrl = `${SITE}${pagePath}`;
      if (!sitemap.includes(fullUrl)) {
        error(`Sitemap missing localized URL: ${fullUrl}`);
        sitemapMissing++;
      }
    }
  }
  if (sitemapMissing === 0) {
    pass("All localized URLs present in sitemap");
  }
  console.log("");
}

console.log(`\nResults: ${checked} pages checked, ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
