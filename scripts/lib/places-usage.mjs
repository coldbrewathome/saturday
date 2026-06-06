// Local usage meter for the Google Places API so venue-ratings enrichment never
// leaves the free tier. Google Maps Platform (since March 2025) gives per-SKU
// monthly free caps that reset each calendar month. For our enrichment:
//   - Text Search        → "Pro" SKU        → 5,000 free / month
//   - Place Details      → "Enterprise" SKU → 1,000 free / month  (BINDING:
//       rating + userRatingCount are Enterprise-tier fields)
//   - Place Photos       → "Enterprise" SKU → 1,000 free / month  (skipped via
//       --no-photos)
//
// Every billable call is recorded to data/places-usage.json (keyed by month)
// and the meter throws BudgetError before any call that would exceed the cap —
// so a bug or a too-large run can never spend real money.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const LEDGER_PATH = path.join(process.cwd(), "data", "places-usage.json");

export const FREE_CAPS = { textSearch: 5000, placeDetails: 1000, photos: 1000 };

export const SKU_LABEL = {
  textSearch: "Text Search (Pro)",
  placeDetails: "Place Details (Enterprise)",
  photos: "Place Photos (Enterprise)",
};

export function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
}

export function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return { schemaVersion: 1, months: {} };
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    return { schemaVersion: 1, months: {} };
  }
}

function saveLedger(ledger) {
  mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

export class BudgetError extends Error {
  constructor(sku) {
    super(`Free-tier budget reached for ${SKU_LABEL[sku] || sku} — stopping.`);
    this.isBudget = true;
    this.sku = sku;
  }
}

// A meter bound to the current month. record(sku) increments and persists
// immediately, throwing BudgetError if the call would exceed the free cap
// (checked BEFORE the count is committed, so the cap is never crossed).
export function createUsageMeter({ caps = FREE_CAPS, month = currentMonth() } = {}) {
  const ledger = loadLedger();
  ledger.months[month] = ledger.months[month] || {
    textSearch: 0,
    placeDetails: 0,
    photos: 0,
  };
  const m = ledger.months[month];
  return {
    month,
    caps,
    usage: () => ({ ...m }),
    remaining: (sku) => Math.max(0, (caps[sku] ?? Infinity) - (m[sku] ?? 0)),
    record(sku) {
      if ((m[sku] ?? 0) + 1 > (caps[sku] ?? Infinity)) throw new BudgetError(sku);
      m[sku] = (m[sku] ?? 0) + 1;
      ledger.generatedAt = new Date().toISOString();
      saveLedger(ledger);
    },
  };
}

export function printUsage(month = currentMonth()) {
  const ledger = loadLedger();
  const m = ledger.months[month] || { textSearch: 0, placeDetails: 0, photos: 0 };
  console.log(`\nGoogle Places API usage — ${month} (free caps reset monthly):`);
  for (const sku of ["textSearch", "placeDetails", "photos"]) {
    const used = m[sku] || 0;
    const cap = FREE_CAPS[sku];
    const flag = used > cap ? "  ⚠️  OVER FREE TIER" : used === cap ? "  (cap reached)" : "";
    console.log(`  ${SKU_LABEL[sku].padEnd(28)} ${used} / ${cap}${flag}`);
  }
  const dets = m.placeDetails || 0;
  console.log(
    `  → ${FREE_CAPS.placeDetails - dets} more venue ratings free this month.\n`,
  );
}
