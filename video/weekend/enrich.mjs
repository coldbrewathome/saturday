// Enrich events with a real static map (OSM, centered on the event) and the
// event page's og:image (the promo photo it sets for sharing). Both degrade
// gracefully to null — the template falls back to the stylized map / a map-only
// card. Live screenshots are intentionally NOT used: event pages routinely
// bot-block headless browsers ("Access Denied"); og:image is reliable.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { staticMap, dataUri } from "./staticmap.mjs";

const UA = "Mozilla/5.0 (compatible; FamHopBot/1.0; +https://famhop.com)";

export async function fetchEventImage(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);
    if (!m) return null;
    const imgUrl = new URL(m[1].replace(/&amp;/g, "&"), url).href;
    const ir = await fetch(imgUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!ir.ok || !/image\//.test(ir.headers.get("content-type") || "")) return null;
    const raw = Buffer.from(await ir.arrayBuffer());
    if (raw.length < 2000) return null;
    const tmp = mkdtempSync(path.join(os.tmpdir(), "og-"));
    const inF = path.join(tmp, "in"), outF = path.join(tmp, "out.jpg");
    writeFileSync(inF, raw);
    execFileSync("magick", [`${inF}[0]`, "-resize", "680x382^", "-gravity", "center", "-extent", "680x382", "-quality", "82", outF]);
    const out = readFileSync(outF);
    rmSync(tmp, { recursive: true, force: true });
    return "data:image/jpeg;base64," + out.toString("base64");
  } catch { return null; }
}

// Maps are built sequentially (tiles cache + overlap within a metro); og:images
// are fetched concurrently. Returns counts for logging.
export async function enrichEvents(events, { maps = true, shots = true } = {}) {
  if (maps) {
    for (const e of events) {
      try { e.mapImage = dataUri(await staticMap(e.lat, e.lon, { size: 600, zoom: 14 })); } catch { e.mapImage = null; }
    }
  }
  if (shots) {
    await Promise.all(events.map(async (e) => { e.shot = await fetchEventImage(e.url); }));
  }
  return {
    maps: events.filter((e) => e.mapImage).length,
    shots: events.filter((e) => e.shot).length,
  };
}
