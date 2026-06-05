// Operator analytics dashboard. ADR 03 picked a `#/ops/analytics` hash route
// mirroring `#/ops/alerts`; this file renders the v1 summary cards for the
// top funnel questions from the ADR plus a per-metro breakdown table for
// the headline metric (`app_open`) and a 30-day daily-bucket sparkline for
// the same headline metric.
//
// v1 scope: plain numeric cards (big number + label + 7-day delta) covering
// the headline counters from the top 3 ADR questions —
//   Q1 (traffic):    app_open
//   Q2 (share loop): plan_shared, poll_viewed, vote_cast
//   Q3 (hop-now):    hop_now_opened
// Plus the per-metro breakdown table for `app_open` (ADR Q5) and a single
// inline-SVG sparkline for the same headline metric (no chart-library
// dep). Ratios (poll_viewed/plan_shared, etc.) are deliberately left for
// the next pass.
//
// Reuses `ops-alerts-*` CSS classes for the layout shell to match the
// visual density of the alerts summary panel per ADR 03. The loader hits
// a sessionStorage cache before the network so reloads paint <500ms.
//
// Pure helpers (`sumWindow`, `computeCardData`, `formatDelta`,
// `computeMetroRows`, `buildSparklineSeries`, `buildSparklinePath`) are
// exported for unit testing; `OpsAnalyticsView` is the thin React wrapper.

import { useEffect, useState } from "react";
import { METROS } from "../metros";
import {
  type AnalyticsData,
  type LoadAnalyticsResult,
  type MetricName,
  loadAnalytics,
  readCachedAnalytics,
} from "./loadAnalytics";
import { type CoverageSummary, loadCoverage } from "./loadCoverage";

/** Headline metric the sparkline tracks (matches the top numeric card). */
export const SPARKLINE_METRIC: MetricName = "app_open";
/** Number of daily buckets the sparkline renders. */
export const SPARKLINE_DAYS = 30;

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
  { metric: "item_shared", label: "Events shared" },
  { metric: "plan_created", label: "Plans created" },
  { metric: "plan_shared", label: "Plans shared" },
  { metric: "poll_viewed", label: "Plans viewed" },
  { metric: "vote_cast", label: "Votes cast" },
  { metric: "signin_success", label: "Sign-ins" },
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

export type SparklinePoint = {
  /** YYYY-MM-DD bucket. */
  date: string;
  /** Count for the metric on that day; missing days are filled with 0. */
  value: number;
};

/**
 * Build a contiguous `[oldest, ..., yesterday]` series for `metric` covering
 * the last `days` buckets. Days absent from `byDay` are filled with 0 so
 * the sparkline path has no gaps. Today is excluded (partial-day data is
 * misleading at the right edge of a trend line); the rightmost point is
 * always yesterday. Pure on `today`.
 */
export function buildSparklineSeries(
  byDay: AnalyticsData["byDay"],
  metric: MetricName,
  days: number = SPARKLINE_DAYS,
  today: Date = new Date(),
): SparklinePoint[] {
  const out: SparklinePoint[] = [];
  // i=days → oldest; i=1 → yesterday.
  for (let i = days; i >= 1; i--) {
    const date = isoDay(today, i);
    const raw = byDay[date]?.[metric];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    out.push({ date, value });
  }
  return out;
}

/**
 * Build the SVG `d` attribute for a polyline through `series`. Coordinates
 * are scaled into `[0, width] × [0, height]`; the y-axis is inverted (SVG
 * origin is top-left) so taller bars draw higher. A series with all zeros
 * draws a flat line at the bottom; a single-point series draws a single
 * `M` command. Returns `""` for an empty series so the caller can branch
 * on truthiness.
 */
export function buildSparklinePath(
  series: SparklinePoint[],
  width: number,
  height: number,
): string {
  if (series.length === 0) return "";
  const max = series.reduce((acc, p) => (p.value > acc ? p.value : acc), 0);
  const denomX = series.length > 1 ? series.length - 1 : 1;
  const parts: string[] = [];
  for (let i = 0; i < series.length; i++) {
    const x = (i / denomX) * width;
    // Bottom-anchor zeros so a flat line sits at the baseline, not mid-chart.
    const y = max > 0 ? height - (series[i]!.value / max) * height : height;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(" ");
}

type Status = "loading" | "ok" | "unauthorized" | "error";

const SPARKLINE_WIDTH = 720;
const SPARKLINE_HEIGHT = 80;
const SPARKLINE_PAD = 6;

/**
 * Tiny inline-SVG line chart. No deps; full series flat-zero renders the
 * baseline + the "no activity" message instead of an empty SVG so the
 * operator can tell the difference between a loaded-but-empty state and a
 * broken render.
 */
function Sparkline({
  series,
  label,
}: {
  series: SparklinePoint[];
  label: string;
}) {
  const innerW = SPARKLINE_WIDTH - SPARKLINE_PAD * 2;
  const innerH = SPARKLINE_HEIGHT - SPARKLINE_PAD * 2;
  const d = buildSparklinePath(series, innerW, innerH);
  const total = series.reduce((acc, p) => acc + p.value, 0);
  if (series.length === 0 || total === 0) {
    return (
      <p className="ops-alerts-state ops-analytics-sparkline-empty">
        No daily activity recorded in this window yet.
      </p>
    );
  }
  const max = series.reduce((acc, p) => (p.value > acc ? p.value : acc), 0);
  const first = series[0]!;
  const last = series[series.length - 1]!;
  return (
    <figure className="ops-analytics-sparkline" aria-label={label}>
      <svg
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <g transform={`translate(${SPARKLINE_PAD} ${SPARKLINE_PAD})`}>
          <path
            d={d}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <figcaption className="ops-analytics-sparkline-caption">
        <span>{first.date}</span>
        <span>peak {max.toLocaleString()}</span>
        <span>{last.date}</span>
      </figcaption>
    </figure>
  );
}

function coverageStatusLabel(s: CoverageSummary["metros"][number]["status"]): string {
  return s === "below"
    ? "Below threshold"
    : s === "fragile"
      ? "Fragile"
      : "Healthy";
}

/**
 * Cross-metro event coverage health. Public data (no auth), so it renders
 * regardless of the analytics auth state — a starved metro (Honolulu below its
 * minEvents) or one running on ≤2 sources (Austin) is visible at a glance.
 */
function CoverageHealth({ coverage }: { coverage: CoverageSummary | null }) {
  if (!coverage) return null;
  const below = coverage.metros.filter((m) => m.status === "below").length;
  const fragile = coverage.metros.filter((m) => m.status === "fragile").length;
  return (
    <section className="ops-coverage" aria-label="Metro event coverage health">
      <h2 className="ops-analytics-section-h">Metro coverage health</h2>
      <p className="ops-alerts-sub">
        {below > 0 ? `${below} below threshold · ` : ""}
        {fragile > 0 ? `${fragile} fragile · ` : ""}
        events vs each metro&rsquo;s minimum, with source health. Worst first.
      </p>
      <table className="ops-alerts-table ops-coverage-table">
        <thead>
          <tr>
            <th scope="col">Metro</th>
            <th scope="col">Status</th>
            <th scope="col">Events</th>
            <th scope="col">Healthy sources</th>
          </tr>
        </thead>
        <tbody>
          {coverage.metros.map((m) => (
            <tr key={m.id} className={`ops-coverage-row is-${m.status}`}>
              <td>{m.label}</td>
              <td>
                <span className={`ops-coverage-badge is-${m.status}`}>
                  {coverageStatusLabel(m.status)}
                </span>
              </td>
              <td>
                {m.eventCount}
                <span className="ops-coverage-min"> / {m.minEvents} min</span>
              </td>
              <td>
                {m.healthySources}
                <span className="ops-coverage-min">
                  {" "}
                  / {m.healthySources + m.brokenSources}
                </span>
                {m.concentrated && (
                  <span
                    className="ops-coverage-flag"
                    title="Volume concentrated in ≤2 sources — one outage could gut this metro"
                  >
                    {" "}
                    ⚠ concentrated
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ops-coverage-generated">
        Snapshot: {coverage.generatedAt.slice(0, 10)}
      </p>
    </section>
  );
}

/**
 * Window the loader requests. 30 days = the sparkline window, which fully
 * subsumes the 14 days the WoW cards need.
 */
const LOAD_DAYS = SPARKLINE_DAYS;

export default function OpsAnalyticsView() {
  // Seed state from the sessionStorage cache so a recent visit paints in
  // <500ms without waiting on the network. The background fetch below then
  // overwrites with fresh data; status stays "ok" the whole time so the
  // user never sees a "Loading…" flash on a cache hit.
  const cached =
    typeof window !== "undefined" ? readCachedAnalytics(LOAD_DAYS) : null;
  const [status, setStatus] = useState<Status>(cached ? "ok" : "loading");
  const [data, setData] = useState<AnalyticsData | null>(cached);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);

  useEffect(() => {
    let active = true;
    loadCoverage().then((c) => {
      if (active) setCoverage(c);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadAnalytics({ days: LOAD_DAYS })
      .then((result: LoadAnalyticsResult) => {
        if (!active) return;
        if (result.status === "ok") {
          setData(result.data);
          setStatus("ok");
        } else if (result.status === "unauthorized") {
          // If we had cached data, drop it — the operator's session expired.
          setData(null);
          setStatus("unauthorized");
        } else {
          // Network/5xx error: keep any cached data on screen, only surface
          // the error state when we have nothing else to show.
          if (!data) {
            setErrorMessage(result.message);
            setStatus("error");
          }
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (!data) {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to load analytics.",
          );
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
    // Mount-only effect. `data` referenced inside the closure is the seed
    // snapshot from the cache, which is intentional: we want the "did we
    // have a cache on mount?" check, not a fresh read every re-render.
  }, []);

  const cards = data ? computeCardData(data) : [];
  const metroRows = data ? computeMetroRows(data) : [];
  const sparklineSeries = data
    ? buildSparklineSeries(data.byDay, SPARKLINE_METRIC, SPARKLINE_DAYS)
    : [];

  return (
    <div className="ops-alerts">
      <header className="ops-alerts-header">
        <h1>Operator analytics</h1>
        <p className="ops-alerts-sub">
          Funnel metrics for app opens, the share loop, Hop-me-now, and the
          sign-in nudge. Per ADR 03.
        </p>
      </header>

      <CoverageHealth coverage={coverage} />

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
            App opens, last {SPARKLINE_DAYS} days
          </h2>
          <Sparkline
            series={sparklineSeries}
            label={`Daily ${SPARKLINE_METRIC} for the ${SPARKLINE_DAYS} days ending yesterday`}
          />

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
