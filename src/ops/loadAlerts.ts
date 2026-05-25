// Loader for operator-alert JSON files written by
// `scripts/event-ops-agent.mjs` and `scripts/source-repair-agent.mjs`.
//
// Each metro emits `public/data/{dataDir}/event-operator-alerts.json` with
// the schema:
//
//   { schemaVersion, metroId, generatedAt, alertCount, alerts: [...] }
//
// This module flattens those files into a single in-memory list (with
// `metroId` guaranteed on every alert) and provides total counts. It does
// not render anything — the triage UI lives in a separate component.
//
// `mergeAlertFiles` is the pure core (easy to unit-test). `loadAllAlerts`
// is the browser-side wrapper that fetches every metro in parallel.

import { METROS, type MetroConfig, type MetroId } from "../metros";

export type AlertSeverity = "critical" | "warning" | "info" | "unknown";

export type OperatorAlertFetch = {
  url?: string;
  status?: string;
  httpStatus?: number;
  contentType?: string;
};

export type OperatorAlert = {
  severity: AlertSeverity;
  metroId: MetroId;
  sourceId: string;
  sourceName: string;
  sourceType?: string;
  url?: string;
  status?: string;
  issueType?: string;
  reason?: string;
  recoveredBy?: string | null;
  recoveredEvents?: number;
  liveEvents?: number;
  fallbackEvents?: number;
  lastKnownGoodEvents?: number;
  fetchedAt?: string;
  fetches?: OperatorAlertFetch[];
  /** ISO timestamp from `data/alert-snoozes.json` if the source is snoozed. */
  snoozedUntil?: string;
};

export type OperatorAlertFile = {
  schemaVersion?: number;
  metroId: MetroId;
  generatedAt?: string;
  alertCount?: number;
  alerts?: Array<Partial<OperatorAlert> & { severity?: string }>;
};

export type AlertSeverityCounts = Record<AlertSeverity, number>;

export type MergedAlerts = {
  alerts: OperatorAlert[];
  total: number;
  bySeverity: AlertSeverityCounts;
  metrosWithCritical: number;
  generatedAt: Record<MetroId, string | undefined>;
};

const KNOWN_SEVERITIES: ReadonlySet<AlertSeverity> = new Set([
  "critical",
  "warning",
  "info",
  "unknown",
]);

function normalizeSeverity(value: unknown): AlertSeverity {
  const lower = String(value || "unknown").toLowerCase();
  return (KNOWN_SEVERITIES.has(lower as AlertSeverity)
    ? lower
    : "unknown") as AlertSeverity;
}

function emptyCounts(): AlertSeverityCounts {
  return { critical: 0, warning: 0, info: 0, unknown: 0 };
}

/**
 * Flatten per-metro alert files into a single list. `metroId` on each alert
 * is forced to the file's `metroId` so a stray/missing value can't confuse
 * downstream filters.
 */
export function mergeAlertFiles(files: OperatorAlertFile[]): MergedAlerts {
  const alerts: OperatorAlert[] = [];
  const bySeverity = emptyCounts();
  const metrosWithCriticalSet = new Set<MetroId>();
  const generatedAt: Record<MetroId, string | undefined> = {};

  for (const file of files) {
    if (!file || !file.metroId) continue;
    generatedAt[file.metroId] = file.generatedAt;
    const rawAlerts = Array.isArray(file.alerts) ? file.alerts : [];
    for (const raw of rawAlerts) {
      const severity = normalizeSeverity(raw?.severity);
      const alert: OperatorAlert = {
        ...(raw as OperatorAlert),
        severity,
        metroId: file.metroId,
        sourceId: String(raw?.sourceId || ""),
        sourceName: String(raw?.sourceName || raw?.sourceId || "Unknown source"),
      };
      alerts.push(alert);
      bySeverity[severity] += 1;
      if (severity === "critical") metrosWithCriticalSet.add(file.metroId);
    }
  }

  return {
    alerts,
    total: alerts.length,
    bySeverity,
    metrosWithCritical: metrosWithCriticalSet.size,
    generatedAt,
  };
}

export type LoadAllAlertsOptions = {
  /** Metros to load. Defaults to all configured METROS. */
  metros?: MetroConfig[];
  /** Base URL for data fetches. Defaults to "/data". */
  baseUrl?: string;
  /** Override fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * Fetch every metro's `event-operator-alerts.json` in parallel and merge.
 * A missing/404 file for any metro is silently treated as zero alerts —
 * we don't want one stale CDN file to break the whole dashboard.
 */
export async function loadAllAlerts(
  opts: LoadAllAlertsOptions = {},
): Promise<MergedAlerts> {
  const metros = opts.metros ?? METROS;
  const baseUrl = (opts.baseUrl ?? "/data").replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;

  const files = await Promise.all(
    metros.map(async (metro): Promise<OperatorAlertFile | null> => {
      const url = `${baseUrl}/${metro.dataDir}/event-operator-alerts.json`;
      try {
        const response = await fetchImpl(url);
        if (!response.ok) return null;
        const body = (await response.json()) as OperatorAlertFile;
        // Force the file's metroId to match the metro config — defends
        // against a misnamed file on disk.
        return { ...body, metroId: metro.id };
      } catch {
        return null;
      }
    }),
  );

  return mergeAlertFiles(files.filter((f): f is OperatorAlertFile => f !== null));
}
