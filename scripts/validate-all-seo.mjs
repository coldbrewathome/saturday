#!/usr/bin/env node
// Comprehensive SEO audit script that scans all generated HTML files in dist/
// checks titles, descriptions, canonicals, H1s, JSON-LD schemas, alt tags, sitemaps, and internal links.
//
// Run with: node scripts/validate-all-seo.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SITEMAP_PATH = path.join(DIST, "sitemap.xml");

console.log("Starting full SEO Audit...");
console.log(`DIST folder: ${DIST}\n`);

if (!fs.existsSync(DIST)) {
  console.error("  ✗ Error: dist/ folder not found. Run `npm run build` first.");
  process.exit(1);
}

// Recursively walk and gather HTML files
function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Skip assets folder and data site
      if (file !== "assets" && file !== "node_modules") {
        walkDir(filePath, fileList);
      }
    } else if (file.endsWith(".html")) {
      if (file !== "intro.html") {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

const htmlFiles = walkDir(DIST);
console.log(`Found ${htmlFiles.length} HTML files to audit.`);

const report = {
  totalChecked: 0,
  errors: 0,
  warnings: 0,
  placeholders: [],
  missingTitles: [],
  emptyTitles: [],
  missingDescriptions: [],
  missingCanonicals: [],
  mismatchedCanonicals: [],
  h1Issues: [],
  imagesWithoutAlt: [],
  invalidJsonLd: [],
  brokenLinks: [],
  sitemapIssues: [],
};

const fileToCanonicalMap = new Map();
const canonicalToFileMap = new Map();
const aliasPaths = new Set();

// We will extract siteUrl from sitemap.xml if it exists, otherwise default
let siteUrl = "";
if (fs.existsSync(SITEMAP_PATH)) {
  const sitemapContent = fs.readFileSync(SITEMAP_PATH, "utf8");
  const match = sitemapContent.match(/<loc>(https?:\/\/[^/]+)/);
  if (match) {
    siteUrl = match[1];
  }
}
if (!siteUrl) {
  siteUrl = "https://famhop.com"; // Fallback
}
console.log(`Detected target site URL: ${siteUrl}\n`);

// 1. Audit all HTML files
for (const filePath of htmlFiles) {
  const relPath = path.relative(DIST, filePath);
  const isRootIndex = relPath === "index.html";
  
  report.totalChecked++;
  const html = fs.readFileSync(filePath, "utf8");

  // Detect alias / aged-out stub pages (legacy URL redirected or noindex'd
  // because the underlying entity moved or expired). These are intentionally
  // canonicalized off-page, so we skip mismatch and sitemap-coverage checks.
  // We still verify the canonical target file exists for redirects.
  // Per ADR-04 "event has ended" stubs use a delayed (non-zero) refresh so
  // users actually see the message — match any refresh delay.
  const isAliasPage =
    /<meta\s+http-equiv="refresh"\s+content="\d+\s*;\s*url=/i.test(html) &&
    /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
  if (isAliasPage) aliasPaths.add(relPath);

  // A. Check for unreplaced build placeholders
  const placeholderMatches = html.match(/%[A-Z0-9_]+%/g);
  if (placeholderMatches) {
    for (const placeholder of placeholderMatches) {
      // Skip common patterns that aren't placeholders if any, but %VITE_...% are errors.
      if (placeholder.startsWith("%VITE_") || placeholder.startsWith("%VITE_APP")) {
        report.errors++;
        report.placeholders.push({ file: relPath, placeholder });
      }
    }
  }

  // B. Check title tag
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  let title = "";
  if (!titleMatch) {
    report.errors++;
    report.missingTitles.push(relPath);
  } else {
    title = titleMatch[1].trim();
    if (!title) {
      report.errors++;
      report.emptyTitles.push(relPath);
    } else if (title.startsWith("%VITE_")) {
      report.errors++;
      report.placeholders.push({ file: relPath, placeholder: title });
    }
  }

  // C. Check meta description
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || 
                    html.match(/<meta\s+content="([^"]*)"\s+name="description"/i);
  if (!descMatch) {
    report.errors++;
    report.missingDescriptions.push(relPath);
  } else {
    const desc = descMatch[1].trim();
    if (!desc) {
      report.errors++;
      report.missingDescriptions.push(relPath);
    } else if (desc.startsWith("%VITE_")) {
      report.errors++;
      report.placeholders.push({ file: relPath, placeholder: desc });
    }
  }

  // D. Check canonical
  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) ||
                         html.match(/<link\s+href="([^"]*)"\s+rel="canonical"/i);
  if (!canonicalMatch) {
    report.errors++;
    report.missingCanonicals.push(relPath);
  } else {
    const canonical = canonicalMatch[1].trim();
    fileToCanonicalMap.set(relPath, canonical);
    canonicalToFileMap.set(canonical, relPath);

    // Verify canonical matches file layout
    let expectedPath = "";
    if (isRootIndex) {
      expectedPath = "/";
    } else {
      expectedPath = "/" + relPath.replace(/index\.html$/, "").replace(/\/$/, "") + "/";
    }
    
    try {
      const parsedCanonical = new URL(canonical);
      if (parsedCanonical.pathname !== expectedPath) {
        // Allow aliases index.html pointing to canonical metro path (this is standard redirect canonicalization)
        const parts = relPath.split(path.sep);
        const isMetroAlias = parts.length === 2 && parts[1] === "index.html";

        if (isAliasPage) {
          // Legacy slug alias — verify the canonical target file actually exists.
          const targetRel = parsedCanonical.pathname.replace(/^\//, "").replace(/\/$/, "") + "/index.html";
          if (!fs.existsSync(path.join(DIST, targetRel))) {
            report.errors++;
            report.brokenLinks.push({
              file: relPath,
              href: canonical,
              resolvedPath: targetRel,
              note: "Alias page canonical target does not exist",
            });
          }
        } else if (!isMetroAlias) {
          report.errors++;
          report.mismatchedCanonicals.push({
            file: relPath,
            canonical,
            expectedPath
          });
        }
      }
    } catch (e) {
      report.errors++;
      report.mismatchedCanonicals.push({
        file: relPath,
        canonical,
        error: "Invalid URL format"
      });
    }
  }

  // E. Check H1
  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (h1Matches.length === 0) {
    // Root index.html is just SPA container, might not have static H1 if noscript block has it
    const noscriptBlock = html.match(/<noscript>([\s\S]*?)<\/noscript>/i);
    const hasNoscriptH1 = noscriptBlock && /<h1/i.test(noscriptBlock[1]);
    if (!isRootIndex && !hasNoscriptH1) {
      report.errors++;
      report.h1Issues.push({ file: relPath, error: "Missing <h1> tag" });
    }
  } else if (h1Matches.length > 1) {
    report.errors++;
    report.h1Issues.push({ file: relPath, error: `Multiple <h1> tags (${h1Matches.length})` });
  } else {
    const h1Text = h1Matches[0][1].replace(/<[^>]*>/g, "").trim();
    if (relPath.startsWith("es/") && /weekend guide for families/i.test(h1Text)) {
      report.errors++;
      report.h1Issues.push({ file: relPath, error: `H1 appears untranslated: "${h1Text}"` });
    }
  }

  // F. JSON-LD structured data check
  const jsonLdMatches = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      
      // Look for schema error patterns (e.g. missing price in Event Offer)
      const checkOfferPrice = (obj) => {
        if (!obj) return;
        if (obj["@type"] === "Offer") {
          if (obj.price === undefined && obj.priceSpecification === undefined && obj.lowPrice === undefined) {
            report.warnings++;
            report.invalidJsonLd.push({
              file: relPath,
              warning: "Offer schema is missing price. Google requires price or priceSpecification."
            });
          }
        }
        if (Array.isArray(obj)) {
          obj.forEach(checkOfferPrice);
        } else if (typeof obj === "object") {
          Object.values(obj).forEach(checkOfferPrice);
        }
      };
      checkOfferPrice(parsed);
      
    } catch (e) {
      report.errors++;
      report.invalidJsonLd.push({ file: relPath, error: "JSON Parse Error: " + e.message });
    }
  }

  // G. Check images for alt tags
  const imgRegex = /<img\s+([^>]*?)>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrs = imgMatch[1];
    const srcMatch = attrs.match(/src="([^"]*)"/i);
    const src = srcMatch ? srcMatch[1] : "unknown";
    
    const altMatch = attrs.match(/alt="([^"]*)"/i);
    if (!altMatch || !altMatch[1].trim()) {
      report.warnings++;
      report.imagesWithoutAlt.push({ file: relPath, src });
    }
  }

  // H. Check internal links: crawl all static links in the body
  // We extract all <a href="..."> links that are internal paths (e.g. start with / or the siteUrl)
  const linkRegex = /<a\s+[^>]*?href="([^"]+)"/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    let href = linkMatch[1].trim();
    // Normalize absolute URLs pointing to siteUrl
    if (href.startsWith(siteUrl)) {
      href = href.slice(siteUrl.length);
    }
    
    // Ignore external links, hash-only links, mailto, tel, or client app hash routes
    if (
      href.startsWith("http://") || 
      href.startsWith("https://") || 
      href.startsWith("#") || 
      href.startsWith("mailto:") || 
      href.startsWith("tel:")
    ) {
      continue;
    }

    // Resolve internal paths like /bay-area/spot/foo/ -> relative path from DIST
    const cleanPath = href.split("?")[0].split("#")[0]; // remove query/hash
    if (!cleanPath || cleanPath === "/") continue;

    let targetFile = cleanPath.replace(/^\//, "");
    if (targetFile.endsWith("/")) {
      targetFile += "index.html";
    } else if (!path.extname(targetFile)) {
      targetFile += "/index.html";
    }

    const fullTarget = path.join(DIST, targetFile);
    if (!fs.existsSync(fullTarget)) {
      report.errors++;
      report.brokenLinks.push({
        file: relPath,
        href,
        resolvedPath: targetFile
      });
    }
  }
}

// 2. Audit sitemap.xml coverage
if (fs.existsSync(SITEMAP_PATH)) {
  const xml = fs.readFileSync(SITEMAP_PATH, "utf8");
  const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
  let locMatch;
  const sitemapUrls = [];
  while ((locMatch = locRegex.exec(xml)) !== null) {
    sitemapUrls.push(locMatch[1].trim());
  }

  // A. Check that sitemap URLs exist in dist
  for (const url of sitemapUrls) {
    if (!url.startsWith(siteUrl)) continue;
    const pathname = url.slice(siteUrl.length);
    let relPath = "";
    if (pathname === "/" || pathname === "") {
      relPath = "index.html";
    } else {
      relPath = pathname.replace(/^\//, "").replace(/\/$/, "") + "/index.html";
    }
    
    const fullPath = path.join(DIST, relPath);
    if (!fs.existsSync(fullPath)) {
      report.errors++;
      report.sitemapIssues.push({
        error: `Sitemap contains URL pointing to non-existent file: ${url}`,
        expectedFile: relPath
      });
    }
  }

  // B. Check that generated HTML pages (except aliases and templates) are in the sitemap
  for (const [relPath, canonical] of fileToCanonicalMap.entries()) {
    if (relPath === "index.html") continue;

    // Ignore redirect aliases (only check canonicals)
    const parts = relPath.split(path.sep);
    const isMetroAlias = parts.length === 2 && parts[1] === "index.html" &&
      ["bayarea", "la", "nyc", "dfw", "philly", "sandiego", "dc", "dmv", "newyork", "newyorkcity", "losangeles", "fort-worth", "washington", "oahu", "south-florida", "dallas"].includes(parts[0]);
    const isLegacyAlias = aliasPaths.has(relPath);

    if (!isMetroAlias && !isLegacyAlias) {
      if (!sitemapUrls.includes(canonical)) {
        report.errors++;
        report.sitemapIssues.push({
          error: `Indexable HTML page missing from sitemap: ${canonical}`,
          file: relPath
        });
      }
    }
  }
} else {
  report.errors++;
  report.sitemapIssues.push({ error: "Sitemap.xml is missing from dist/" });
}

// 3. Print Results & Summary
console.log("--- SEO AUDIT RESULTS ---");
console.log(`Total HTML files checked: ${report.totalChecked}`);
console.log(`Errors:   ${report.errors}`);
console.log(`Warnings: ${report.warnings}\n`);

if (report.errors > 0) {
  console.log("✗ Audit Failed!");
  
  if (report.placeholders.length > 0) {
    console.log(`\n[Placeholders] Found ${report.placeholders.length} unreplaced VITE_APP placeholders:`);
    report.placeholders.slice(0, 10).forEach(p => console.log(`  - ${p.file}: ${p.placeholder}`));
    if (report.placeholders.length > 10) console.log("    ...");
  }
  
  if (report.missingTitles.length > 0) {
    console.log(`\n[Missing Titles] Found ${report.missingTitles.length} pages:`);
    report.missingTitles.slice(0, 5).forEach(f => console.log(`  - ${f}`));
  }
  
  if (report.missingCanonicals.length > 0) {
    console.log(`\n[Missing Canonicals] Found ${report.missingCanonicals.length} pages:`);
    report.missingCanonicals.slice(0, 5).forEach(f => console.log(`  - ${f}`));
  }
  
  if (report.mismatchedCanonicals.length > 0) {
    console.log(`\n[Mismatched Canonicals] Found ${report.mismatchedCanonicals.length} pages:`);
    report.mismatchedCanonicals.slice(0, 5).forEach(c => console.log(`  - ${c.file}: got "${c.canonical}", expected path "${c.expectedPath}"`));
    if (report.mismatchedCanonicals.length > 5) console.log("    ...");
  }
  
  if (report.h1Issues.length > 0) {
    console.log(`\n[H1 Issues] Found ${report.h1Issues.length} issues:`);
    report.h1Issues.slice(0, 10).forEach(h => console.log(`  - ${h.file}: ${h.error}`));
  }
  
  if (report.brokenLinks.length > 0) {
    console.log(`\n[Broken Links] Found ${report.brokenLinks.length} internal broken links:`);
    report.brokenLinks.slice(0, 15).forEach(b => console.log(`  - ${b.file}: Link "${b.href}" resolves to non-existent "${b.resolvedPath}"`));
    if (report.brokenLinks.length > 15) console.log("    ...");
  }
  
  if (report.sitemapIssues.length > 0) {
    console.log(`\n[Sitemap Issues] Found ${report.sitemapIssues.length} issues:`);
    report.sitemapIssues.slice(0, 10).forEach(s => console.log(`  - ${s.error}`));
  }
} else {
  console.log("✓ Audit Passed! No SEO errors found.");
}

if (report.warnings > 0) {
  console.log("\nWarnings found:");
  if (report.invalidJsonLd.length > 0) {
    console.log(`  - JSON-LD warnings: ${report.invalidJsonLd.length}`);
    report.invalidJsonLd.slice(0, 5).forEach(j => console.log(`    * ${j.file}: ${j.warning || j.error}`));
  }
  if (report.imagesWithoutAlt.length > 0) {
    console.log(`  - Images without alt tags: ${report.imagesWithoutAlt.length}`);
    report.imagesWithoutAlt.slice(0, 5).forEach(img => console.log(`    * ${img.file}: ${img.src}`));
  }
}

// Dump report to file
fs.writeFileSync(
  path.join(ROOT, "scripts", "seo-audit-report.json"), 
  JSON.stringify(report, null, 2)
);
console.log(`\nFull JSON report written to scripts/seo-audit-report.json`);

process.exit(report.errors > 0 ? 1 : 0);
