// Build a real static map (OpenStreetMap raster tiles) centered on a lat/lon.
// Stitches the covering tiles with ImageMagick and crops to a square window.
// Tiles are cached in the OS temp dir. Returns a PNG buffer; dataUri() wraps it.
//
// OSM tile usage policy: a valid User-Agent + light, cached use only.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const UA = "FamHop-weekend-video/1.0 (https://famhop.com)";
const CACHE = path.join(os.tmpdir(), "osm-tiles");
mkdirSync(CACHE, { recursive: true });

async function tile(z, x, y) {
  const f = path.join(CACHE, `${z}_${x}_${y}.png`);
  if (existsSync(f) && statSync(f).size > 500) return f;
  const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`tile ${z}/${x}/${y} → ${r.status}`);
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}

export async function staticMap(lat, lon, { size = 600, zoom = 14 } = {}) {
  const n = 2 ** zoom;
  const cx = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const cy = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  const left = cx * 256 - size / 2, top = cy * 256 - size / 2;
  const tx0 = Math.floor(left / 256), tx1 = Math.floor((left + size - 1) / 256);
  const ty0 = Math.floor(top / 256), ty1 = Math.floor((top + size - 1) / 256);

  const files = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const xx = ((tx % n) + n) % n, yy = Math.max(0, Math.min(n - 1, ty));
      files.push(await tile(zoom, xx, yy));
    }
  }
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "sm-"));
  const grid = path.join(tmp, "grid.png"), out = path.join(tmp, "out.png");
  execFileSync("magick", ["montage", ...files, "-tile", `${cols}x${rows}`, "-geometry", "256x256+0+0", "-background", "#e9e1cc", grid]);
  const offX = Math.round(left - tx0 * 256), offY = Math.round(top - ty0 * 256);
  // crop to the window, then soften: lower saturation + a warm cream wash so the
  // real map blends with the FamHop UI instead of clashing.
  execFileSync("magick", [grid, "-crop", `${size}x${size}+${offX}+${offY}`, "+repage",
    "-modulate", "104,66", "-fill", "#fbf3e3", "-colorize", "10%", out]);
  const buf = readFileSync(out);
  rmSync(tmp, { recursive: true, force: true });
  return buf;
}

export const dataUri = (buf) => "data:image/png;base64," + buf.toString("base64");
