import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEventMetros, filterEndedEventUrls } from "../functions/_sitemap-filter.mjs";
import { ENDED_GRACE_MS } from "../functions/_detail-guard.mjs";

const NOW = Date.UTC(2026, 6, 18); // 2026-07-18

function urlBlock(loc, lastmod = "2026-07-01") {
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n`;
}

function sitemap(...blocks) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${blocks.join("")}</urlset>\n`;
}

const catalog = (overrides = {}) => ({
  liveSet: new Set(),
  liveEnds: {},
  endedSet: new Set(),
  upcoming: [],
  ...overrides,
});

// --- collectEventMetros ------------------------------------------------------

test("collects only metros that have event URLs", () => {
  const xml = sitemap(
    urlBlock("https://famhop.com/bay-area/event/storytime-2026-07-25/"),
    urlBlock("https://famhop.com/seattle/event/zoo-day-2026-07-20/"),
    urlBlock("https://famhop.com/chicago/spot/field-museum/"),
    urlBlock("https://famhop.com/bay-area/this-weekend/"),
  );
  assert.deepEqual([...collectEventMetros(xml)].sort(), ["bay-area", "seattle"]);
});

// --- filterEndedEventUrls ----------------------------------------------------

test("drops an event past liveEnds + grace, keeps live and in-grace ones", () => {
  const gone = "https://famhop.com/bay-area/event/baby-bounce-dixon-library/";
  const graced = "https://famhop.com/bay-area/event/toddler-art-lab/";
  const live = "https://famhop.com/bay-area/event/storytime-suisun/";
  const xml = sitemap(urlBlock(gone), urlBlock(graced), urlBlock(live));
  const catalogs = new Map([
    [
      "bay-area",
      catalog({
        liveSet: new Set(["baby-bounce-dixon-library", "toddler-art-lab", "storytime-suisun"]),
        liveEnds: {
          "baby-bounce-dixon-library": NOW - ENDED_GRACE_MS - 1000,
          // Ended, but inside the 14-day grace window: the page still serves
          // 200, so the URL must stay listed (famhop-3 — sitemap and page
          // status can never disagree).
          "toddler-art-lab": NOW - 1000,
          "storytime-suisun": NOW + 1000,
        },
      }),
    ],
  ]);
  const out = filterEndedEventUrls(xml, NOW, catalogs);
  assert.ok(!out.includes(gone));
  assert.ok(out.includes(graced));
  assert.ok(out.includes(live));
});

test("drops an event in the ended set", () => {
  const xml = sitemap(urlBlock("https://famhop.com/bay-area/event/reptile-roundup/"));
  const catalogs = new Map([["bay-area", catalog({ endedSet: new Set(["reptile-roundup"]) })]]);
  const out = filterEndedEventUrls(xml, NOW, catalogs);
  assert.ok(!out.includes("reptile-roundup"));
});

test("no catalog: falls back to the slug-date heuristic (with post-end grace)", () => {
  const longPast = "https://famhop.com/miami/event/parade-2026-06-10/";
  const recentPast = "https://famhop.com/miami/event/parade-2026-07-10/";
  const future = "https://famhop.com/miami/event/parade-2026-07-30/";
  const undated = "https://famhop.com/miami/event/weekly-storytime/";
  const xml = sitemap(urlBlock(longPast), urlBlock(recentPast), urlBlock(future), urlBlock(undated));
  const out = filterEndedEventUrls(xml, NOW, new Map());
  // Jun 10 + 2d start-day window + 14d grace elapsed well before Jul 18.
  assert.ok(!out.includes(longPast));
  // Jul 10 + 2d puts the end at Jul 12 — Jul 18 is inside the grace window,
  // so the URL stays listed while the page still serves 200.
  assert.ok(out.includes(recentPast));
  assert.ok(out.includes(future));
  assert.ok(out.includes(undated));
});

test("non-event entries pass through byte-identical", () => {
  const xml = sitemap(
    urlBlock("https://famhop.com/"),
    urlBlock("https://famhop.com/bay-area/spot/exploratorium/"),
    urlBlock("https://famhop.com/bay-area/city/oakland/"),
  );
  assert.equal(filterEndedEventUrls(xml, NOW, new Map()), xml);
});

test("valid XML shape survives filtering (no dangling fragments)", () => {
  const xml = sitemap(
    urlBlock("https://famhop.com/bay-area/event/gone-2026-01-01/"),
    urlBlock("https://famhop.com/bay-area/spot/exploratorium/"),
  );
  const out = filterEndedEventUrls(xml, NOW, new Map());
  assert.equal((out.match(/<url>/g) || []).length, 1);
  assert.equal((out.match(/<\/url>/g) || []).length, 1);
  assert.ok(out.startsWith('<?xml version="1.0"'));
  assert.ok(out.trimEnd().endsWith("</urlset>"));
});
