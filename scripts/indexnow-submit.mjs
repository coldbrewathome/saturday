#!/usr/bin/env node
// Submit a brand's live sitemap URLs to IndexNow (Bing, DuckDuckGo, Yandex,
// Seznam, Naver). Google ignores IndexNow, but everything downstream of Bing
// indexes submitted URLs within hours instead of whenever the crawler feels
// like it. Reads the URL list straight from the host's live sitemap so it
// can't drift from what's actually deployed. The key file is served at
// https://<host>/<key>.txt (public/<key>.txt, shipped to both brands).
//
// Non-fatal by design: any failure prints a warning and exits 0 so it never
// breaks a deploy chain.
//
// Usage: node scripts/indexnow-submit.mjs <host>
//   e.g. node scripts/indexnow-submit.mjs famhop.com
//        node scripts/indexnow-submit.mjs trymosey.com

const KEY = "35b30f928fa24498849575cb61d50eb3";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10000;

async function sitemapUrls(host) {
  const res = await fetch(`https://${host}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap fetch failed: HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  const host = process.argv[2];
  if (!host) {
    console.warn("IndexNow: no host given, e.g. `node scripts/indexnow-submit.mjs famhop.com` — skipping");
    return;
  }

  try {
    const urls = (await sitemapUrls(host)).slice(0, MAX_URLS);
    const body = {
      host,
      key: KEY,
      keyLocation: `https://${host}/${KEY}.txt`,
      urlList: urls,
    };
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    console.log(`IndexNow: HTTP ${res.status} — submitted ${urls.length} URLs for ${host}`);
  } catch (err) {
    console.warn(`IndexNow: submission failed, continuing anyway — ${err.message}`);
  }
}

main();
