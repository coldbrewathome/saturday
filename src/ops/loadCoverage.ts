// Loads the cross-metro event-coverage snapshot (built by
// scripts/build-coverage-summary.mjs) for the /ops dashboard. Public data,
// served same-origin from the app's bundled /data — no auth needed (unlike the
// funnel metrics, which hit the worker).

export type CoverageStatus = "below" | "fragile" | "ok";

export type MetroCoverage = {
  id: string;
  label: string;
  eventCount: number;
  liveEventCount: number;
  minEvents: number;
  sourceCount: number;
  healthySources: number;
  brokenSources: number;
  operatorAlertCount: number;
  generatedAt: string | null;
  concentrated: boolean;
  status: CoverageStatus;
};

export type CoverageSummary = {
  schemaVersion: number;
  generatedAt: string;
  metros: MetroCoverage[];
};

export async function loadCoverage(
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<CoverageSummary | null> {
  const base = (
    opts.baseUrl ?? `${import.meta.env.BASE_URL}data`
  ).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${base}/event-coverage.json`);
    if (!response.ok) return null;
    const body = (await response.json()) as CoverageSummary;
    if (!Array.isArray(body?.metros)) return null;
    return body;
  } catch {
    return null;
  }
}
