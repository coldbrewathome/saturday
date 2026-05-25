// Placeholder scaffold for the operator analytics dashboard. ADR 03 picked
// a `#/ops/analytics` hash route mirroring `#/ops/alerts`; this file is the
// minimal mount point so the router has somewhere to land. The loader,
// summary cards, per-metro table, and sparkline arrive in subsequent
// roadmap tasks.
//
// Reuses `ops-alerts-*` CSS classes for the header/empty-state shell to
// avoid CSS duplication — same visual density is intentional per ADR 03.

export default function OpsAnalyticsView() {
  return (
    <div className="ops-alerts">
      <header className="ops-alerts-header">
        <h1>Operator analytics</h1>
        <p className="ops-alerts-sub">
          Funnel metrics for app opens, the share loop, Hop-me-now, and the
          sign-in nudge. Per ADR 03.
        </p>
      </header>
      <p className="ops-alerts-state">No data yet — loader lands next.</p>
    </div>
  );
}
