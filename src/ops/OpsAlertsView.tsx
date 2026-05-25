// Minimal triage table for per-metro operator alerts emitted by
// `scripts/event-ops-agent.mjs`. ADR 02 picked a standalone `#/ops/alerts`
// hash route in the existing app; `main.tsx` mounts this component when the
// hash matches.
//
// v1 scope:
//   - Columns: severity, metro, sourceName, issueType, recoveredBy, fetchedAt.
//   - Sort: severity desc (critical first), then fetchedAt desc.
//   - Filters: severity (critical/warning/all) + metro multi-select, with
//     URL-querystring persistence so reloads keep the view.
//   - Snooze: ADR 02 keeps snoozes local-only — the UI does NOT mutate any
//     file or hit a worker. Per-row "Snooze" reveals a copy-to-clipboard
//     JSON payload + one-line CLI command (`scripts/snooze-alert.mjs`) that
//     the operator runs against the tracked `data/alert-snoozes.json`. The
//     event pipeline tags matching alerts with `snoozedUntil` on next ingest,
//     and the UI greys those rows out.
//
// The component re-uses `loadAllAlerts` for the live fetch and `sortAlerts`
// for the deterministic order; both are pulled out so tests can cover them
// without a DOM.

import { useEffect, useMemo, useState } from "react";
import { METROS, type MetroId } from "../metros";
import {
  type AlertSeverity,
  type MergedAlerts,
  type OperatorAlert,
  loadAllAlerts,
} from "./loadAlerts";

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
  unknown: 0,
};

/**
 * Stable sort: severity desc (critical first), then fetchedAt desc (most
 * recent first). Missing `fetchedAt` sorts last within its severity bucket.
 */
export function sortAlerts(alerts: OperatorAlert[]): OperatorAlert[] {
  return [...alerts].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    const aMs = a.fetchedAt ? Date.parse(a.fetchedAt) : -Infinity;
    const bMs = b.fetchedAt ? Date.parse(b.fetchedAt) : -Infinity;
    if (bMs !== aMs) return bMs - aMs;
    return 0;
  });
}

function metroLabel(metroId: string): string {
  return METROS.find((m) => m.id === metroId)?.label ?? metroId;
}

export type SeverityFilter = "all" | "critical" | "warning";

export type AlertsFilter = {
  severity: SeverityFilter;
  /** Selected metro ids. Empty array = all metros. */
  metros: MetroId[];
};

export const DEFAULT_FILTER: AlertsFilter = { severity: "all", metros: [] };

/**
 * Apply severity + metro filters. Severity "all" is a no-op; "critical" or
 * "warning" keeps only that bucket. Metros empty = no metro filter; otherwise
 * keep alerts whose `metroId` is in the set.
 */
export function filterAlerts(
  alerts: OperatorAlert[],
  filter: AlertsFilter,
): OperatorAlert[] {
  const metroSet =
    filter.metros.length > 0 ? new Set<MetroId>(filter.metros) : null;
  return alerts.filter((a) => {
    if (filter.severity !== "all" && a.severity !== filter.severity)
      return false;
    if (metroSet && !metroSet.has(a.metroId)) return false;
    return true;
  });
}

/**
 * Read filter state from a hash string like
 * `#/ops/alerts?severity=critical&metros=atlanta,boston`. Unknown values fall
 * back to defaults; the function never throws.
 */
export function parseFilterFromHash(hash: string): AlertsFilter {
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return { ...DEFAULT_FILTER };
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const sevRaw = (params.get("severity") || "all").toLowerCase();
  const severity: SeverityFilter =
    sevRaw === "critical" || sevRaw === "warning" ? sevRaw : "all";
  const metrosRaw = params.get("metros") || "";
  const knownMetroIds = new Set(METROS.map((m) => m.id));
  const metros = metrosRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && knownMetroIds.has(s));
  return { severity, metros };
}

/**
 * Serialize a filter back into a hash. Defaults are omitted so a "no filter"
 * state produces `#/ops/alerts` without trailing query noise.
 */
export function buildOpsAlertsHash(filter: AlertsFilter): string {
  const params = new URLSearchParams();
  if (filter.severity !== "all") params.set("severity", filter.severity);
  if (filter.metros.length > 0)
    params.set("metros", [...filter.metros].sort().join(","));
  const qs = params.toString();
  return qs ? `#/ops/alerts?${qs}` : "#/ops/alerts";
}

function formatFetchedAt(value?: string): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

/**
 * Is the alert currently snoozed relative to `now`? An alert is snoozed
 * iff `snoozedUntil` parses to a future timestamp.
 */
export function isSnoozedNow(
  alert: Pick<OperatorAlert, "snoozedUntil">,
  now: Date = new Date(),
): boolean {
  if (!alert.snoozedUntil) return false;
  const ms = Date.parse(alert.snoozedUntil);
  return Number.isFinite(ms) && ms > now.getTime();
}

/**
 * Build the JSON snippet the operator pastes into
 * `data/alert-snoozes.json` (under `snoozes`). Kept separate so tests can
 * assert the shape without a DOM.
 */
export function buildSnoozePayload(input: {
  sourceId: string;
  until: string;
  note?: string;
}): { sourceId: string; until: string; note?: string } {
  const payload: { sourceId: string; until: string; note?: string } = {
    sourceId: input.sourceId,
    until: input.until,
  };
  const note = input.note?.trim();
  if (note) payload.note = note;
  return payload;
}

/**
 * Build the one-line CLI invocation the operator can copy-paste. Quotes
 * the note for shell safety; escapes embedded single quotes.
 */
export function buildSnoozeCommand(input: {
  sourceId: string;
  days: number;
  note?: string;
}): string {
  const parts = [
    "node scripts/snooze-alert.mjs",
    JSON.stringify(input.sourceId),
    `--days=${input.days}`,
  ];
  const note = input.note?.trim();
  if (note) {
    // Single-quote and escape any embedded single quotes so the shell
    // sees the note verbatim.
    const escaped = note.replace(/'/g, "'\\''");
    parts.push(`--note='${escaped}'`);
  }
  return parts.join(" ");
}

/**
 * Convert `now + days` to an ISO timestamp. Centralized so the UI and
 * tests agree on the boundary.
 */
export function isoDaysFromNow(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + days * 86400 * 1000).toISOString();
}

type Status = "loading" | "ready" | "error";

type SnoozeDraft = { days: number; note: string };

const DEFAULT_SNOOZE_DRAFT: SnoozeDraft = { days: 7, note: "" };

export default function OpsAlertsView() {
  const [status, setStatus] = useState<Status>("loading");
  const [merged, setMerged] = useState<MergedAlerts | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertsFilter>(() =>
    typeof window === "undefined"
      ? { ...DEFAULT_FILTER }
      : parseFilterFromHash(window.location.hash),
  );
  // Which row currently has its snooze panel open, keyed by sourceId
  // (alerts dedup on sourceId across files so this is sufficient).
  const [openSnoozeSourceId, setOpenSnoozeSourceId] = useState<string | null>(
    null,
  );
  const [snoozeDraft, setSnoozeDraft] = useState<SnoozeDraft>(
    DEFAULT_SNOOZE_DRAFT,
  );
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    loadAllAlerts()
      .then((result) => {
        if (!active) return;
        setMerged(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load alerts.",
        );
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep filter in sync if the hash is changed externally (back/forward,
  // pasted URL). We only react to changes that still target this route.
  useEffect(() => {
    function handler() {
      if (!window.location.hash.startsWith("#/ops/alerts")) return;
      setFilter(parseFilterFromHash(window.location.hash));
    }
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Push filter changes back into the URL via replaceState (no history spam).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextHash = buildOpsAlertsHash(filter);
    if (window.location.hash === nextHash) return;
    if (!window.location.hash.startsWith("#/ops/alerts")) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }, [filter]);

  const sortedFiltered = useMemo(() => {
    if (!merged) return [];
    return sortAlerts(filterAlerts(merged.alerts, filter));
  }, [merged, filter]);

  function toggleMetro(metroId: MetroId) {
    setFilter((prev) => {
      const has = prev.metros.includes(metroId);
      const nextMetros = has
        ? prev.metros.filter((m) => m !== metroId)
        : [...prev.metros, metroId];
      return { ...prev, metros: nextMetros };
    });
  }

  function setSeverity(severity: SeverityFilter) {
    setFilter((prev) => ({ ...prev, severity }));
  }

  function clearMetros() {
    setFilter((prev) => ({ ...prev, metros: [] }));
  }

  function openSnooze(sourceId: string) {
    setOpenSnoozeSourceId((prev) => (prev === sourceId ? null : sourceId));
    setSnoozeDraft({ ...DEFAULT_SNOOZE_DRAFT });
    setCopiedTarget(null);
  }

  async function copyToClipboard(text: string, target: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === target ? null : prev));
      }, 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; surface the text
      // via a prompt so the operator can copy it manually.
      window.prompt("Copy this:", text);
    }
  }

  const metrosWithAlerts = useMemo(() => {
    if (!merged) return new Set<MetroId>();
    const set = new Set<MetroId>();
    for (const a of merged.alerts) set.add(a.metroId);
    return set;
  }, [merged]);

  return (
    <div className="ops-alerts">
      <header className="ops-alerts-header">
        <h1>Operator alerts</h1>
        <p className="ops-alerts-sub">
          Per-metro source health flagged by the event-ops + source-repair
          agents.
        </p>
      </header>

      {status === "loading" && (
        <p className="ops-alerts-state">Loading alerts…</p>
      )}

      {status === "error" && (
        <p className="ops-alerts-state ops-alerts-state-error">
          {errorMessage ?? "Failed to load alerts."}
        </p>
      )}

      {status === "ready" && merged && (
        <>
          <dl className="ops-alerts-summary" aria-label="Alert summary">
            <div className="ops-alerts-summary-item">
              <dt>Total</dt>
              <dd>{merged.total}</dd>
            </div>
            <div className="ops-alerts-summary-item ops-alerts-summary-critical">
              <dt>Critical</dt>
              <dd>
                {merged.bySeverity.critical > 0 ? (
                  <button
                    type="button"
                    className="ops-alerts-summary-link"
                    onClick={() => setSeverity("critical")}
                    aria-label={`Filter to ${merged.bySeverity.critical} critical alerts`}
                  >
                    {merged.bySeverity.critical}
                  </button>
                ) : (
                  merged.bySeverity.critical
                )}
              </dd>
            </div>
            <div className="ops-alerts-summary-item">
              <dt>Warning</dt>
              <dd>{merged.bySeverity.warning}</dd>
            </div>
            <div className="ops-alerts-summary-item">
              <dt>Info</dt>
              <dd>{merged.bySeverity.info}</dd>
            </div>
            <div className="ops-alerts-summary-item">
              <dt>Metros w/ critical</dt>
              <dd>
                {merged.metrosWithCritical} / {METROS.length}
              </dd>
            </div>
          </dl>

          <div className="ops-alerts-filters" role="group" aria-label="Filters">
            <div
              className="ops-alerts-filter-group"
              role="radiogroup"
              aria-label="Severity"
            >
              <span className="ops-alerts-filter-label">Severity</span>
              {(["all", "critical", "warning"] as SeverityFilter[]).map(
                (sev) => (
                  <button
                    key={sev}
                    type="button"
                    role="radio"
                    aria-checked={filter.severity === sev}
                    className={`ops-alerts-pill${
                      filter.severity === sev ? " ops-alerts-pill-active" : ""
                    }`}
                    onClick={() => setSeverity(sev)}
                  >
                    {sev}
                  </button>
                ),
              )}
            </div>

            <div
              className="ops-alerts-filter-group"
              role="group"
              aria-label="Metros"
            >
              <span className="ops-alerts-filter-label">
                Metros{" "}
                {filter.metros.length > 0 && (
                  <button
                    type="button"
                    className="ops-alerts-link-btn"
                    onClick={clearMetros}
                  >
                    clear ({filter.metros.length})
                  </button>
                )}
              </span>
              <div className="ops-alerts-metro-list">
                {METROS.map((metro) => {
                  const checked = filter.metros.includes(metro.id);
                  const hasAlerts = metrosWithAlerts.has(metro.id);
                  return (
                    <label
                      key={metro.id}
                      className={`ops-alerts-metro${
                        hasAlerts ? "" : " ops-alerts-metro-empty"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMetro(metro.id)}
                      />
                      <span>{metro.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {sortedFiltered.length === 0 ? (
            <p className="ops-alerts-state">
              {merged.total === 0
                ? "No active alerts. Nice."
                : "No alerts match the current filters."}
            </p>
          ) : (
            <table className="ops-alerts-table">
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Metro</th>
                  <th scope="col">Source</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Recovered by</th>
                  <th scope="col">Fetched</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((alert, idx) => (
                  <tr key={`${alert.metroId}:${alert.sourceId}:${idx}`}>
                    <td>
                      <span
                        className={`ops-alerts-sev ops-alerts-sev-${alert.severity}`}
                      >
                        {alert.severity}
                      </span>
                    </td>
                    <td>{metroLabel(alert.metroId)}</td>
                    <td>
                      <div className="ops-alerts-source">
                        <span>{alert.sourceName}</span>
                        {alert.url && (
                          <a
                            href={alert.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            open
                          </a>
                        )}
                      </div>
                    </td>
                    <td>{alert.issueType ?? "—"}</td>
                    <td>{alert.recoveredBy ?? "—"}</td>
                    <td>{formatFetchedAt(alert.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
