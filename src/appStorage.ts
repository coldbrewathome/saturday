// localStorage persistence helpers, extracted from App.tsx (2026-08).
// All reads/writes are try/catch-wrapped (private-mode safe); tests swap in
// an in-memory mock (tests/setup.ts).
import { isValidThemeId } from "./eventThemes";
import type { AgeBand } from "./planner";

// Saved interest themes for the "For you" view (Phase 2). Cross-metro and
// per-origin, so a plain global key rather than metroStorageKey.
export const INTERESTS_STORAGE_KEY = "famhop:interests";

export function readStoredInterests(): Set<string> {
  try {
    const raw = window.localStorage.getItem(INTERESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed.filter(isValidThemeId));
    }
  } catch {
    // fall through to empty
  }
  return new Set<string>();
}

// Kids only: persist the age-group filter across sessions — a family's kid
// ages don't change between visits, so losing the choice on reload throws
// away the highest-signal personalization input. Global key like interests
// (ages aren't metro-specific).
export const AGE_BAND_STORAGE_KEY = "famhop:ageBand";

export const AGE_PROMPT_DISMISSED_KEY = "famhop:agePromptDismissed";

export function readStoredAgeBand(): AgeBand | "any" {
  try {
    const raw = window.localStorage.getItem(AGE_BAND_STORAGE_KEY);
    if (
      raw === "toddler" ||
      raw === "preschool" ||
      raw === "school-age" ||
      raw === "tween"
    ) {
      return raw;
    }
  } catch {
    // fall through to default
  }
  return "any";
}

// Adults (Mosey) only: persist "who you're heading out as" across sessions, like
// interests — it's a personal preference, not metro-specific, so it uses a global key.
export const GOING_OUT_STORAGE_KEY = "famhop:goingOutMode";

export function readStoredGoingOutMode(): "solo" | "friends" | "date" {
  try {
    const raw = window.localStorage.getItem(GOING_OUT_STORAGE_KEY);
    if (raw === "solo" || raw === "friends" || raw === "date") return raw;
  } catch {
    // fall through to default
  }
  return "friends";
}

// Post-weekend check-ins ("did you go?"). Local map of eventId → answer,
// which gates the prompt queue; the aggregate + cross-device history live on
// the worker (submitCheckin / fetchUserCheckins).
export const CHECKINS_STORAGE_KEY = "famhop:checkins";

export function readStoredCheckins(): Record<string, { date: string; worthIt: boolean }> {
  try {
    const raw = window.localStorage.getItem(CHECKINS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, { date?: string; worthIt?: unknown }>;
      const out: Record<string, { date: string; worthIt: boolean }> = {};
      for (const [id, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.worthIt === "boolean") {
          out[id] = { date: entry.date ?? "", worthIt: entry.worthIt };
        }
      }
      return out;
    }
  } catch {
    // fall through to empty
  }
  return {};
}

export function writeStoredCheckins(
  record: Record<string, { date: string; worthIt: boolean }>,
): void {
  try {
    window.localStorage.setItem(CHECKINS_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore
  }
}

export function readStoredArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : fallback;
  } catch {
    return fallback;
  }
}

// Generic guarded writer: JSON-stringifies non-strings and swallows quota /
// private-mode errors. Callers keep typed per-key read helpers above.
export function writeStored(key: string, value: unknown): void {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    window.localStorage.setItem(key, raw);
  } catch {
    // ignore — best-effort persistence
  }
}
