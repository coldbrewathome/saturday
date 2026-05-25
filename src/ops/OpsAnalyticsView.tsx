// Operator analytics dashboard. ADR 03 picked a `#/ops/analytics` hash route
// mirroring `#/ops/alerts`; this file renders the v1 summary cards for the
// top funnel questions from the ADR plus a per-metro breakdown table for
// the headline metric (`app_open`).
//
// v1 scope: plain numeric cards (big number + label + 7-day delta) covering
// the headline counters from the top 3 ADR questions —
//   Q1 (traffic):    app_open
//   Q2 (share loop): plan_shared, poll_viewed, vote_cast
//   Q3 (hop-now):    hop_now_opened
// Plus the per-metro breakdown table for `app_open` (ADR Q5). No sparkline
// yet — that's the next roadmap task. Ratios (poll_viewed/plan_shared, etc.)
// are deliberately left for the next pass.
//
// Reuses `ops-alerts-*` CSS classes for the layout shell to match the
// visual density of the alerts summary panel per ADR 03.
//
// Pure helpers (`sumWindow`, `computeCardData`, `formatDelta`,
// `computeMetroRows`) are exported for unit testing; `OpsAnalyticsView` is
// the thin React wrapper.

import { useEffect, useState } from "react";
import { METROS } from "../metros";
import {
  type AnalyticsData,
  type LoadAnalyticsResult,
  type MetricName,
  loadAnalytics,
} from "./loadAnalytics";

/** The single metric the per-metro breakdown table sorts on (ADR Q5). */
export const METRO_TABLE_METRIC: MetricName = "app_open";

/** A single numeric card spec. */
export type CardSpec = {
  metric: MetricName;
  label: string;
};

/**
 * The headline counters rendered as cards. Order is intentional and tracks
 * the user-facing funnel: traffic → share loop → secondary feature.
 */
export const CARD_SPECS: readonly CardSpec[] = [
  { metric: "app_open", label: "App opens" },
  { metric: "plan_shared", label: "Plans shared" },
  { metric: "poll_viewed", label: "Plans viewed" },
  { metric: "vote_cast", label: "Votes cast" },
  { metric: "hop_now_opened", label: "Hop-me-now opens" },
];

/**
 * ISO date string (YYYY-MM-DD) for the day that is `offsetDays` before
 * `today` (offsetDays=0 → today). Pure so tests can fix `today` and not
 * depend on wall-clock time.
 */
export function isoDay(today: Date, offsetDays: number): string {
  const d = new Date(today.getTime() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Sum `metric` across the inclusive date range [from, to] (string compare
 * works because both are YYYY-MM-DD). Days absent from `byDay` contribute
 * 0. Total is `0` if every day is missing.
 */
export function sumWindow(
  byDay: AnalyticsData["byDay"],
  metric: MetricName,
  fromDate: string,
  toDate: string,
): number {
  let total = 0;
  for (const [date, counts] of Object.entries(byDay)) {
    if (date < fromDate || date > toDate) continue;
    const value = counts[metric];
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

export type CardValue = {
  metric: MetricName;
  label: string;
  /** Total for the most recent 7-day window ending yesterday. */
  current: number;
  /** Total for the 7-day window that immediately precedes `current`. */
  prior: number;
  /** `current - prior`. */
  delta: number;
};

/**
 * Compute the card values for the top funnel counters. The "current"
 * window is the 7 days ending **yesterday** (inclusive); the "prior" window
 * is the 7 days immediately before that. Today is excluded because partial
 * days would tilt the WoW comparison.
 *
 * `today` is injectable so tests can pin it.
 */
export function computeCardData(
  data: AnalyticsData,
  today: Date = new Date(),
): CardValue[] {
  const currentTo = isoDay(today, 1); // yesterday
  const currentFrom = isoDay(today, 7); // 7 days ago
  const priorTo = isoDay(today, 8);
  const priorFrom = isoDay(today, 14);
  return CARD_SPECS.map((spec) => {
    const current = sumWindow(data.byDay, spec.metric, currentFrom, currentTo);
    const prior = sumWindow(data.byDay, spec.metric, priorFrom, priorTo);
    return {
      metric: spec.metric,
      label: spec.label,
      current,
      prior,
      delta: current - prior,
    };
  });
}

/**
 * Format the WoW delta for display. Returns the sign + integer, or "—" when
 * we have no prior-week data (avoids a misleading "+N" jump from a cold
 * KV).
 */
export function formatDelta(card: Pick<CardValue, "delta" | "prior">): string {
  if (card.prior === 0 && card.delta === 0) return "—";
  if (card.delta > 0) return `+${card.delta}`;
  if (card.delta < 0) return `${card.delta}`;
  return "0";
}

/**
 * CSS modifier matching the sign of the delta. Used to color positive vs
 * negative WoW changes. Returns `""` for the "no prior data" case so the
 * default neutral color sticks.
 */
export function deltaClass(card: Pick<CardValue, "delta" | "prior">): string {
  if (card.prior === 0 && card.delta === 0) return "";
  if (card.delta > 0) return "ops-analytics-delta-up";
  if (card.delta < 0) return "ops-analytics-delta-down";
  return "";
}

export type MetroRow = {
  metroId: string;
  /** Display label (falls back to id for metros not in `METROS`). */
  label: string;
  /** `/atlanta` etc. `null` for unknown metros (no guide page to link to). */
  canonicalPath: string | null;
  /** Total for the headline metric across the loaded window. */
  total: number;
};

/**
 * Per-metro rows for the breakdown table, sorted by `total` desc. Falls
 * back to label asc for ties to keep the order stable across reloads.
 * Metros with a zero total are omitted — they add noise and the loader
 * already drops metros with no events.
 */
export function computeMetroRows(
  data: AnalyticsData,
  metric: MetricName = METRO_TABLE_METRIC,
): MetroRow[] {
  const rows: MetroRow[] = [];
  for (const [metroId, counts] of Object.entries(data.byMetro)) {
    const total = counts[metric];
    if (typeof total !== "number" || total <= 0) continue;
    const config = METROS.find((m) => m.id === metroId);
    rows.push({
      metroId,
      label: config?.label ?? metroId,
      canonicalPath: config?.canonicalPath ?? null,
      total,
    });
  }
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label);
  });
  return rows;
}

type Status = "loading" | "ok" | "unauthorized" | "error";

export default function OpsAnalyticsView() {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    // 14 days = current 7d window + prior 7d window for the WoW delta.
    loadAnalytics({ days: 14 })
      .then((result: LoadAnalyticsResult) => {
        if (!active) return;
        if (result.status === "ok") {
          setData(result.data);
          setStatus("ok");
        } else if (result.status === "unauthorized") {
          setStatus("unauthorized");
        } else {
          setErrorMessage(result.message);
          setStatus("error");
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load analytics.",
        );
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const cards = data ? computeCardData(data) : [];
  const metroRows = data ? computeMetroRows(data) : [];

  return (
    <div className="ops-alerts">
      <header className="ops-alerts-header">
        <h1>Operator analytics</h1>
        <p className="ops-alerts-sub">
          Funnel metrics for app opens, the share loop, Hop-me-now, and the
          sign-in nudge. Per ADR 03.
        </p>
      </header>

      {status === "loading" && (
        <p className="ops-alerts-state">Loading analytics…</p>
      )}

      {status === "unauthorized" && (
        <p className="ops-alerts-state">
          Sign in as an admin to view analytics.
        </p>
      )}

      {status === "error" && (
        <p className="ops-alerts-state ops-alerts-state-error">
          {errorMessage ?? "Failed to load analytics."}
        </p>
      )}

      {status === "ok" && data && (
        <>
          <dl className="ops-alerts-summary" aria-label="Funnel summary">
            {cards.map((card) => (
              <div
                key={card.metric}
                className="ops-alerts-summary-item ops-analytics-card"
              >
                <dt>{card.label}</dt>
                <dd>
                  {card.current.toLocaleString()}
                  <span
                    className={`ops-analytics-delta ${deltaClass(card)}`.trim()}
                    aria-label={`7-day delta: ${formatDelta(card)}`}
                  >
                    {formatDelta(card)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          <h2 className="ops-analytics-section-h">
            App opens by metro ({data.days}d)
          </h2>
          {metroRows.length === 0 ? (
            <p className="ops-alerts-state">
              No per-metro app opens recorded in the last {data.days} days.
            </p>
          ) : (
            <table className="ops-alerts-table">
              <thead>
                <tr>
                  <th scope="col">Metro</th>
                  <th scope="col">App opens</th>
                </tr>
              </thead>
              <tbody>
                {metroRows.map((row) => (
                  <tr key={row.metroId}>
                    <td>
                      {row.canonicalPath ? (
                        <a href={row.canonicalPath}>{row.label}</a>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td>{row.total.toLocaleString()}</td>
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
