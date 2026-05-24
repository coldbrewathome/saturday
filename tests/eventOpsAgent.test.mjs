import test from "node:test";
import assert from "node:assert/strict";
import {
  alertSeverityCounts,
  buildOpsDecision,
  buildAlertTriage,
  classifyOperatorAlert,
  parseEventOpsArgs,
  renderOpsMarkdown,
  summarizeEventReport,
} from "../scripts/event-ops-agent.mjs";

test("parseEventOpsArgs keeps remote actions explicit", () => {
  const options = parseEventOpsArgs([
    "--metro=bay-area",
    "--skip-ingest",
    "--publish-worker",
    "--auto-repair-sources",
    "--source-repair-candidates=/tmp/candidates.json",
    "--fail-on-alerts=warning",
    "--report=output/custom.json",
  ]);

  assert.equal(options.metroArg, "bay-area");
  assert.equal(options.skipIngest, true);
  assert.equal(options.publishWorker, true);
  assert.equal(options.autoRepairSources, true);
  assert.equal(options.sourceRepairCandidateFile, "/tmp/candidates.json");
  assert.equal(options.deployData, false);
  assert.equal(options.failOnAlerts, "warning");
  assert.equal(options.reportPath, "output/custom.json");
});

test("alertSeverityCounts groups known and unknown alert levels", () => {
  assert.deepEqual(
    alertSeverityCounts([
      { severity: "critical" },
      { severity: "warning" },
      { severity: "warning" },
      { severity: "notice" },
      {},
    ]),
    { critical: 1, warning: 2, info: 0, unknown: 2 },
  );
});

test("summarizeEventReport exposes source health and top alerts", () => {
  const summary = summarizeEventReport(
    {
      metroId: "bay-area",
      generatedAt: "2026-05-23T12:00:00.000Z",
      eventCount: 120,
      adultsEventCount: 44,
      sourceCount: 3,
      liveEventCount: 100,
      lastKnownGoodEventCount: 4,
      fallbackEventCount: 16,
      errors: [],
      sources: [
        {
          id: "sfpl",
          name: "San Francisco Public Library",
          status: "ok",
          liveEvents: 20,
          fallbackEvents: 0,
          lastKnownGoodEvents: 0,
        },
        {
          id: "museum",
          name: "Museum",
          status: "ok",
          liveEvents: 0,
          fallbackEvents: 8,
          lastKnownGoodEvents: 0,
          reason: "No dated rows",
        },
        {
          id: "zoo",
          name: "Zoo",
          status: "fetch-error",
          liveEvents: 0,
          fallbackEvents: 0,
          lastKnownGoodEvents: 4,
          reason: "HTTP 503",
        },
      ],
    },
    {
      alerts: [
        {
          severity: "warning",
          sourceId: "zoo",
          sourceName: "Zoo",
          issueType: "fetch-failed",
          reason: "HTTP 503",
          recoveredBy: "last-known-good",
          recoveredEvents: 4,
        },
      ],
    },
  );

  assert.equal(summary.metroId, "bay-area");
  assert.equal(summary.eventCount, 120);
  assert.equal(summary.alertSeverityCounts.warning, 1);
  assert.equal(summary.topAlerts[0].sourceId, "zoo");
  assert.deepEqual(
    summary.failingSources.map((source) => source.id),
    ["museum", "zoo"],
  );
  assert.equal(summary.triage.buckets["recovered-watch"], 1);
});

test("classifyOperatorAlert returns action-oriented buckets", () => {
  assert.deepEqual(
    classifyOperatorAlert({
      severity: "critical",
      issueType: "zero-extracted",
      recoveredEvents: 0,
    }),
    {
      bucket: "parser-follow-up",
      priority: "P0",
      action: "Inspect fetched payload and update the parser or source adapter.",
    },
  );

  assert.equal(
    classifyOperatorAlert({
      severity: "warning",
      status: "http-error",
      fetches: [{ httpStatus: 403 }],
      recoveredEvents: 4,
    }).bucket,
    "source-access-or-dead-url",
  );

  assert.equal(
    classifyOperatorAlert({
      severity: "warning",
      issueType: "zero-extracted",
      recoveredBy: "recurring-template",
      recoveredEvents: 4,
    }).bucket,
    "parser-follow-up",
  );
});

test("buildAlertTriage and renderOpsMarkdown produce operator queue", () => {
  const triage = buildAlertTriage([
    {
      severity: "warning",
      metroId: "bay-area",
      sourceId: "sfpl",
      sourceName: "SFPL",
      issueType: "fetch-failed",
      status: "http-error",
      recoveredBy: "last-known-good",
      recoveredEvents: 5,
      fetches: [{ httpStatus: 500 }],
    },
    {
      severity: "critical",
      metroId: "bay-area",
      sourceId: "museum",
      sourceName: "Museum",
      issueType: "zero-extracted",
      recoveredEvents: 0,
    },
  ]);

  assert.equal(triage.buckets["upstream-outage"], 1);
  assert.equal(triage.buckets["parser-follow-up"], 1);
  assert.equal(triage.priorityItems[0].sourceId, "museum");

  const markdown = renderOpsMarkdown({
    generatedAt: "2026-05-23T12:00:00.000Z",
    decision: { status: "blocked", blockers: [] },
    options: { failOnAlerts: "critical" },
    steps: [],
    metros: [
      {
        metroId: "bay-area",
        eventCount: 10,
        liveEventCount: 8,
        lastKnownGoodEventCount: 1,
        fallbackEventCount: 1,
        operatorAlertCount: 2,
        alertSeverityCounts: { critical: 1, warning: 1 },
        triage,
      },
    ],
  });

  assert.match(markdown, /Event Ops Agent Report/);
  assert.match(markdown, /parser-follow-up/);
  assert.match(markdown, /Museum/);
});

test("buildOpsDecision blocks on configured alert severity", () => {
  const summaries = [
    {
      metroId: "bay-area",
      validationErrorCount: 0,
      operatorAlertCount: 2,
      alertSeverityCounts: { critical: 0, warning: 2, info: 0, unknown: 0 },
    },
  ];

  assert.equal(
    buildOpsDecision(summaries, { failOnAlerts: "critical" }).status,
    "pass",
  );
  assert.equal(
    buildOpsDecision(summaries, { failOnAlerts: "warning" }).status,
    "blocked",
  );
  assert.equal(
    buildOpsDecision(
      [
        {
          ...summaries[0],
          validationErrorCount: 1,
          alertSeverityCounts: { critical: 0, warning: 0, info: 0, unknown: 0 },
          operatorAlertCount: 0,
        },
      ],
      { failOnAlerts: "none" },
    ).blockers[0].reason,
    "validation-errors",
  );
});
