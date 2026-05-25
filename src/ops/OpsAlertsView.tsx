// Minimal triage table for per-metro operator alerts emitted by
// `scripts/event-ops-agent.mjs`. ADR 02 picked a standalone `#/ops/alerts`
// hash route in the existing app; `main.tsx` mounts this component when the
// hash matches.
//
// v1 scope (per ROADMAP "Operator-alerts triage UI" task 3):
//   - Columns: severity, metro, sourceName, issueType, recoveredBy, fetchedAt.
//   - Sort: severity desc (critical first), then fetchedAt desc.
//   - Static — no filtering, no snooze controls yet (later tasks).
//
// The component re-uses `loadAllAlerts` for the live fetch and `sortAlerts`
// for the deterministic order; both are pulled out so tests can cover them
// without a DOM.

import { useEffect, useMemo, useState } from "react";
import { METROS } from "../metros";
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

type Status = "loading" | "ready" | "error";

export default function OpsAlertsView() {
  const [status, setStatus] = useState<Status>("loading");
  const [merged, setMerged] = useState<MergedAlerts | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const sorted = useMemo(
    () => (merged ? sortAlerts(merged.alerts) : []),
    [merged],
  );

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
          <p className="ops-alerts-totals">
            {merged.total} alert{merged.total === 1 ? "" : "s"} across{" "}
            {METROS.length} metros · {merged.bySeverity.critical} critical ·{" "}
            {merged.bySeverity.warning} warning · {merged.bySeverity.info} info
          </p>

          {sorted.length === 0 ? (
            <p className="ops-alerts-state">No active alerts. Nice.</p>
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
                {sorted.map((alert, idx) => (
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
