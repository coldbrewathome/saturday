// Swap the shared (FamHop) icons + manifest in dist/ for Mosey-branded ones.
// Runs after `vite build --mode adults` (which copies the FamHop public/ assets)
// so the adults app ships its own purple icons, app name, and OG image.
//
// Assets are pre-generated in assets/mosey/ (committed) so CI doesn't need an
// SVG rasterizer — regenerate with rsvg-convert when the mark changes.
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const SRC = path.join("assets", "mosey");
const DIST = "dist";
const files = [
  "favicon.svg",
  "favicon-16.png",
  "favicon-32.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "og-image.png",
  "og-image.svg",
  "manifest.webmanifest",
];

let applied = 0;
const missing = [];
for (const f of files) {
  const src = path.join(SRC, f);
  if (!existsSync(src)) {
    missing.push(f);
    continue;
  }
  copyFileSync(src, path.join(DIST, f));
  applied += 1;
}
console.log(`[mosey-icons] applied ${applied} Mosey-branded assets to ${DIST}/`);
if (missing.length) {
  console.warn(`[mosey-icons] missing in ${SRC}: ${missing.join(", ")}`);
}
