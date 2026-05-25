// Read/write helpers for `data/alert-snoozes.json`.
//
// ADR 02: snoozes are local-only. The triage UI never mutates this file;
// either the operator pastes a JSON snippet by hand, or runs
// `scripts/snooze-alert.mjs` (which calls into this module). The event
// pipeline reads the file when emitting alerts and tags each matching
// alert with `snoozedUntil` so the UI can grey it out. Expired snoozes
// are ignored on read.
//
// Schema v1:
//   {
//     "schemaVersion": 1,
//     "snoozes": [
//       { "sourceId": "...", "until": "<ISO>", "note": "..." }
//     ]
//   }
//
// All exports are pure-ish (read/parse/normalize) so they're easy to
// unit-test without touching disk.

import fs from "node:fs";
import path from "node:path";

export const SNOOZES_PATH_REL = path.join("data", "alert-snoozes.json");
export const SNOOZES_SCHEMA_VERSION = 1;

function emptyDoc() {
  return { schemaVersion: SNOOZES_SCHEMA_VERSION, snoozes: [] };
}

/**
 * Parse a snoozes JSON document. Tolerates a missing/empty file by
 * returning an empty doc; throws on syntactically invalid JSON.
 */
export function parseSnoozesDoc(raw) {
  if (raw == null || raw === "") return emptyDoc();
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const snoozes = Array.isArray(parsed?.snoozes) ? parsed.snoozes : [];
  return {
    schemaVersion: Number(parsed?.schemaVersion || SNOOZES_SCHEMA_VERSION),
    snoozes: snoozes
      .map((entry) => normalizeSnooze(entry))
      .filter((entry) => entry !== null),
  };
}

function normalizeSnooze(entry) {
  if (!entry || typeof entry !== "object") return null;
  const sourceId = String(entry.sourceId || "").trim();
  const until = String(entry.until || "").trim();
  if (!sourceId || !until) return null;
  // Sanity-check the timestamp — silently drop garbage so the pipeline
  // never crashes on a typo.
  if (!Number.isFinite(Date.parse(until))) return null;
  const note = entry.note != null ? String(entry.note) : undefined;
  return { sourceId, until, ...(note ? { note } : {}) };
}

/**
 * Read snoozes from disk. Missing file = empty list (not an error —
 * snoozing is optional). Caller passes an absolute or repo-relative
 * path; we resolve relative paths against the supplied `rootDir`.
 */
export function readSnoozesFile(rootDir, relPath = SNOOZES_PATH_REL) {
  const absolute = path.isAbsolute(relPath)
    ? relPath
    : path.resolve(rootDir, relPath);
  if (!fs.existsSync(absolute)) return emptyDoc();
  const raw = fs.readFileSync(absolute, "utf8");
  return parseSnoozesDoc(raw);
}

/**
 * Return a Map<sourceId, until> of snoozes that have not yet expired
 * relative to `now`. When multiple entries share a sourceId the latest
 * (highest `until`) wins.
 */
export function activeSnoozeMap(doc, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const map = new Map();
  for (const entry of doc?.snoozes || []) {
    const untilMs = Date.parse(entry.until);
    if (!Number.isFinite(untilMs) || untilMs <= nowMs) continue;
    const existing = map.get(entry.sourceId);
    if (!existing || Date.parse(existing) < untilMs) {
      map.set(entry.sourceId, entry.until);
    }
  }
  return map;
}

/**
 * Tag each alert with `snoozedUntil` (ISO string) when its `sourceId`
 * appears in the active snooze map. Non-snoozed alerts are returned
 * unchanged. Pure: does not mutate the input array or its alerts.
 */
export function annotateAlertsWithSnoozes(alerts, snoozeMap) {
  if (!snoozeMap || snoozeMap.size === 0) return alerts;
  return alerts.map((alert) => {
    const until = snoozeMap.get(alert.sourceId);
    return until ? { ...alert, snoozedUntil: until } : alert;
  });
}

/**
 * Add or update a snooze entry for `sourceId`. If a non-expired entry
 * already exists, it is replaced (so the operator can extend the
 * window). Returns the new doc — does not write to disk.
 */
export function upsertSnooze(doc, { sourceId, until, note }, now = new Date()) {
  const base = doc && Array.isArray(doc.snoozes) ? doc : emptyDoc();
  const cleaned = normalizeSnooze({ sourceId, until, note });
  if (!cleaned) throw new Error("upsertSnooze: invalid sourceId or until");
  // Drop expired and any existing entry for this sourceId.
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const kept = base.snoozes.filter((entry) => {
    if (entry.sourceId === cleaned.sourceId) return false;
    const ms = Date.parse(entry.until);
    return Number.isFinite(ms) && ms > nowMs;
  });
  return {
    schemaVersion: SNOOZES_SCHEMA_VERSION,
    snoozes: [...kept, cleaned].sort((a, b) =>
      a.sourceId.localeCompare(b.sourceId),
    ),
  };
}

/**
 * Serialize and write a snoozes doc to disk (trailing newline to
 * match the rest of the repo's JSON style).
 */
export function writeSnoozesFile(rootDir, doc, relPath = SNOOZES_PATH_REL) {
  const absolute = path.isAbsolute(relPath)
    ? relPath
    : path.resolve(rootDir, relPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(doc, null, 2)}\n`);
  return absolute;
}
