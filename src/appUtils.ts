// Small shared display/util helpers, extracted from App.tsx (2026-08).
import type { Category, Spot } from "./types";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hostname for the "Verified · {host}" trust line on event stops. Returns
// null when the URL can't be parsed (callers then skip the verified framing).
export function sourceHostname(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function formatGeneratedAt(value?: string) {
  if (!value) {
    return "Fallback data";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function latestGeneratedAt(...values: Array<string | undefined>) {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

// Round-robin by category so no single category dominates a mixed list.
export function interleaveByCategory(spots: Spot[], categories: Category[]) {
  const buckets = new Map<Category, Spot[]>();
  for (const item of categories) {
    buckets.set(item, []);
  }

  for (const spot of spots) {
    buckets.get(spot.category)?.push(spot);
  }

  const result: Spot[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const item of categories) {
      const next = buckets.get(item)?.shift();
      if (next) {
        result.push(next);
        added = true;
      }
    }
  }

  return result;
}
