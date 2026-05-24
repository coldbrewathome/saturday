#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const DEFAULT_REPORT_PATH = path.join("output", "event-ops-agent", "latest.json");
const DEFAULT_TRIAGE_REPORT_PATH = path.join(
  "output",
  "event-ops-agent",
  "latest.md",
);
const VALID_FAIL_ON = new Set(["none", "critical", "warning", "any"]);

function usage() {
  console.log(`Usage:
  node scripts/event-ops-agent.mjs [--metro=<id>|--all] [options]

Default workflow:
  ingest events -> validate events -> build shared data-site -> summarize source health

Options:
  --all                       Run every configured metro.
  --metro=<id>                Run one metro. Defaults to the configured default metro.
  --skip-ingest               Do not run ingest/generate plan steps.
  --skip-validate             Do not run event validation.
  --skip-data-site            Do not build data-site/dist.
  --auto-repair-sources       Run source repair and apply validated official URL fixes.
  --source-repair-candidates=<path>
                              Candidate URL JSON for source repair validation.
  --publish-worker            Publish events to the Worker KV override after local gates pass.
  --deploy-data               Deploy the shared data Pages site after local gates pass.
  --fail-on-alerts=<level>    none, critical, warning, or any. Default: critical.
  --report=<path>             Write JSON ops report. Default: ${DEFAULT_REPORT_PATH}
  --triage-report=<path>      Write Markdown operator triage. Default: ${DEFAULT_TRIAGE_REPORT_PATH}
  --help                      Show this help.

Remote actions are never implicit. Use --publish-worker and/or --deploy-data only when
the required credentials and environment are present.`);
}

export function parseEventOpsArgs(argv = process.argv.slice(2)) {
  const options = {
    all: false,
    metroArg: null,
    skipIngest: false,
    skipValidate: false,
    skipDataSite: false,
    autoRepairSources: false,
    sourceRepairCandidateFile: null,
    publishWorker: false,
    deployData: false,
    failOnAlerts: "critical",
    reportPath: DEFAULT_REPORT_PATH,
    triageReportPath: DEFAULT_TRIAGE_REPORT_PATH,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg.startsWith("--metro=")) {
      options.metroArg = arg.slice("--metro=".length);
    } else if (arg === "--skip-ingest") {
      options.skipIngest = true;
    } else if (arg === "--skip-validate") {
      options.skipValidate = true;
    } else if (arg === "--skip-data-site") {
      options.skipDataSite = true;
    } else if (arg === "--auto-repair-sources") {
      options.autoRepairSources = true;
    } else if (arg.startsWith("--source-repair-candidates=")) {
      options.sourceRepairCandidateFile = arg.slice("--source-repair-candidates=".length);
    } else if (arg === "--publish-worker") {
      options.publishWorker = true;
    } else if (arg === "--deploy-data") {
      options.deployData = true;
    } else if (arg.startsWith("--fail-on-alerts=")) {
      options.failOnAlerts = arg.slice("--fail-on-alerts=".length);
    } else if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length);
    } else if (arg.startsWith("--triage-report=")) {
      options.triageReportPath = arg.slice("--triage-report=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.all && options.metroArg) {
    throw new Error("Use either --all or --metro=<id>, not both.");
  }
  if (!VALID_FAIL_ON.has(options.failOnAlerts)) {
    throw new Error("--fail-on-alerts must be one of: none, critical, warning, any.");
  }

  return options;
}

export function alertSeverityCounts(alerts = []) {
  const counts = { critical: 0, warning: 0, info: 0, unknown: 0 };
  for (const alert of alerts) {
    const severity = String(alert?.severity || "unknown").toLowerCase();
    if (Object.hasOwn(counts, severity)) counts[severity] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function firstFetch(alert = {}) {
  return Array.isArray(alert.fetches) && alert.fetches.length > 0
    ? alert.fetches[0]
    : {};
}

export function classifyOperatorAlert(alert = {}) {
  const fetch = firstFetch(alert);
  const httpStatus = Number(fetch.httpStatus || alert.httpStatus || 0);
  const severity = String(alert.severity || "unknown").toLowerCase();
  const issueType = String(alert.issueType || "");
  const status = String(alert.status || fetch.status || "");
  const recoveredEvents = Number(alert.recoveredEvents || 0);
  const recoveredBy = alert.recoveredBy || null;
  const unrecoveredCritical = recoveredEvents === 0 && severity === "critical";

  if ([403, 404, 410].includes(httpStatus)) {
    return {
      bucket: "source-access-or-dead-url",
      priority: unrecoveredCritical ? "P0" : severity === "critical" ? "P1" : "P2",
      action: "Check source URL, access policy, or replace the source.",
    };
  }

  if (status.includes("error") || httpStatus >= 500) {
    return {
      bucket: "upstream-outage",
      priority: unrecoveredCritical ? "P0" : severity === "critical" ? "P1" : "P2",
      action: "Retry later and keep recovery active unless failures persist.",
    };
  }

  if (issueType === "zero-extracted") {
    return {
      bucket: "parser-follow-up",
      priority: unrecoveredCritical ? "P0" : severity === "critical" ? "P1" : "P2",
      action: "Inspect fetched payload and update the parser or source adapter.",
    };
  }

  if (unrecoveredCritical) {
    return {
      bucket: "no-recovery",
      priority: "P0",
      action: "Fix source or parser before publishing.",
    };
  }

  if (recoveredBy === "last-known-good") {
    return {
      bucket: "recovered-watch",
      priority: "P2",
      action: "Monitor recovery age and verify live source on next run.",
    };
  }

  if (recoveredBy === "recurring-template") {
    return {
      bucket: "template-fallback",
      priority: "P3",
      action: "Improve live extraction when this source matters for coverage.",
    };
  }

  return {
    bucket: "needs-review",
    priority: severity === "critical" ? "P1" : "P2",
    action: "Review source report details.",
  };
}

export function buildAlertTriage(alerts = [], limit = 20) {
  const buckets = {};
  const items = alerts.map((alert) => {
    const classification = classifyOperatorAlert(alert);
    buckets[classification.bucket] = (buckets[classification.bucket] || 0) + 1;
    return {
      ...classification,
      severity: alert.severity || "unknown",
      metroId: alert.metroId || null,
      sourceId: alert.sourceId || null,
      sourceName: alert.sourceName || alert.source || null,
      sourceType: alert.sourceType || null,
      issueType: alert.issueType || null,
      status: alert.status || null,
      reason: alert.reason || "",
      url: alert.url || null,
      recoveredBy: alert.recoveredBy || null,
      recoveredEvents: Number(alert.recoveredEvents || 0),
      liveEvents: Number(alert.liveEvents || 0),
      fallbackEvents: Number(alert.fallbackEvents || 0),
      lastKnownGoodEvents: Number(alert.lastKnownGoodEvents || 0),
    };
  });

  const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const priorityItems = [...items]
    .sort((a, b) => {
      const priorityDelta =
        (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (priorityDelta !== 0) return priorityDelta;
      const severityDelta =
        (b.severity === "critical" ? 1 : 0) - (a.severity === "critical" ? 1 : 0);
      if (severityDelta !== 0) return severityDelta;
      return String(a.sourceName || "").localeCompare(String(b.sourceName || ""));
    })
    .slice(0, limit);

  return {
    total: alerts.length,
    buckets,
    priorityItems,
  };
}

export function summarizeEventReport(report = {}, alertsDoc = {}) {
  const alerts = Array.isArray(alertsDoc.alerts)
    ? alertsDoc.alerts
    : Array.isArray(report.operatorAlerts)
      ? report.operatorAlerts
      : [];
  const severityCounts = alertSeverityCounts(alerts);
  const sourceReports = Array.isArray(report.sources) ? report.sources : [];
  const failingSources = sourceReports
    .filter(
      (source) =>
        source.status !== "ok" ||
        Number(source.liveEvents || 0) === 0 ||
        Number(source.lastKnownGoodEvents || 0) > 0,
    )
    .map((source) => ({
      id: source.id,
      name: source.name,
      status: source.status,
      reason: source.reason || "",
      liveEvents: Number(source.liveEvents || 0),
      fallbackEvents: Number(source.fallbackEvents || 0),
      lastKnownGoodEvents: Number(source.lastKnownGoodEvents || 0),
    }))
    .slice(0, 20);

  return {
    metroId: report.metroId || alertsDoc.metroId || null,
    generatedAt: report.generatedAt || alertsDoc.generatedAt || null,
    eventCount: Number(report.eventCount || 0),
    adultsEventCount: Number(report.adultsEventCount || 0),
    sourceCount: Number(report.sourceCount || sourceReports.length || 0),
    liveEventCount: Number(report.liveEventCount || 0),
    lastKnownGoodEventCount: Number(report.lastKnownGoodEventCount || 0),
    fallbackEventCount: Number(report.fallbackEventCount || 0),
    operatorAlertCount: Number(report.operatorAlertCount ?? alerts.length),
    validationErrorCount: Array.isArray(report.errors) ? report.errors.length : 0,
    alertSeverityCounts: severityCounts,
    topAlerts: alerts
      .map((alert) => ({
        severity: alert.severity || "unknown",
        sourceId: alert.sourceId || null,
        sourceName: alert.sourceName || alert.source || null,
        issueType: alert.issueType || null,
        reason: alert.reason || "",
        recoveredBy: alert.recoveredBy || null,
        recoveredEvents: Number(alert.recoveredEvents || 0),
      }))
      .slice(0, 20),
    triage: buildAlertTriage(alerts),
    failingSources,
  };
}

export function buildOpsDecision(metroSummaries = [], options = {}) {
  const failOnAlerts = options.failOnAlerts || "critical";
  const blockers = [];

  for (const summary of metroSummaries) {
    if (summary.validationErrorCount > 0) {
      blockers.push({
        metroId: summary.metroId,
        reason: "validation-errors",
        count: summary.validationErrorCount,
      });
    }
    if (failOnAlerts === "any" && summary.operatorAlertCount > 0) {
      blockers.push({
        metroId: summary.metroId,
        reason: "operator-alerts",
        count: summary.operatorAlertCount,
      });
    }
    if (
      ["critical", "warning"].includes(failOnAlerts) &&
      summary.alertSeverityCounts.critical > 0
    ) {
      blockers.push({
        metroId: summary.metroId,
        reason: "critical-operator-alerts",
        count: summary.alertSeverityCounts.critical,
      });
    }
    if (failOnAlerts === "warning" && summary.alertSeverityCounts.warning > 0) {
      blockers.push({
        metroId: summary.metroId,
        reason: "warning-operator-alerts",
        count: summary.alertSeverityCounts.warning,
      });
    }
  }

  return {
    status: blockers.length > 0 ? "blocked" : "pass",
    safeToPublishWorker: blockers.length === 0,
    safeToDeployData: blockers.length === 0,
    blockers,
  };
}

function resolveMetros(options, config) {
  if (options.all) return config.metros;
  const selectionArgs = options.metroArg ? [`--metro=${options.metroArg}`] : [];
  const selection = selectedMetroFromArgs(selectionArgs, config);
  return [selection.metro];
}

function readJsonIfExists(filePath) {
  const absolutePath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function eventAlertsPath(metro) {
  return metroDataFile(metro, "eventReport").replace(
    /event-build-report\.json$/,
    "event-operator-alerts.json",
  );
}

function summarizeMetros(metros) {
  return metros.map((metro) => {
    const reportPath = metroDataFile(metro, "eventReport");
    const alertsPath = eventAlertsPath(metro);
    const report = readJsonIfExists(reportPath);
    const alertsDoc = readJsonIfExists(alertsPath);
    if (!report && !alertsDoc) {
      return {
        metroId: metro.id,
        generatedAt: null,
        eventCount: 0,
        adultsEventCount: 0,
        sourceCount: 0,
        liveEventCount: 0,
        lastKnownGoodEventCount: 0,
        fallbackEventCount: 0,
        operatorAlertCount: 0,
        validationErrorCount: 1,
        alertSeverityCounts: { critical: 0, warning: 0, info: 0, unknown: 0 },
        topAlerts: [],
        failingSources: [],
        missingReport: true,
        reportPath,
        alertsPath,
      };
    }
    return {
      ...summarizeEventReport(report || {}, alertsDoc || {}),
      metroId: metro.id,
      label: metro.label,
      reportPath,
      alertsPath,
    };
  });
}

function runCommand(stepName, command, args, options = {}) {
  const startedAt = new Date();
  console.log(`[event-ops] ${stepName}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: options.stdio || "inherit",
  });
  const finishedAt = new Date();
  const exitCode = result.status ?? (result.error ? 1 : 0);
  return {
    name: stepName,
    command,
    args,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    error: result.error?.message,
  };
}

function workerEventsUrl(apiBase, metroId) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  return `${base}/events?metro=${encodeURIComponent(metroId)}`;
}

async function verifyWorkerEvents(metros) {
  const startedAt = new Date();
  const apiBase = process.env.SATURDAY_API;
  const checks = [];
  if (!apiBase) {
    return {
      name: "verify-worker-events",
      command: "fetch",
      args: ["$SATURDAY_API/events"],
      status: "failed",
      exitCode: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      error: "Missing SATURDAY_API env var.",
      checks,
    };
  }

  let failed = false;
  let error = "";
  for (const metro of metros) {
    const localEventsPath = metroDataFile(metro, "events");
    const localDataset = readJsonIfExists(localEventsPath);
    const localCount = Array.isArray(localDataset?.events)
      ? localDataset.events.length
      : null;
    const url = workerEventsUrl(apiBase, metro.id);
    console.log(`[event-ops] verify-worker-events: GET ${url}`);
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      const remoteCount = Array.isArray(body?.events) ? body.events.length : null;
      const ok =
        response.ok &&
        localCount !== null &&
        remoteCount !== null &&
        remoteCount === localCount;
      if (!ok) failed = true;
      checks.push({
        metroId: metro.id,
        url,
        httpStatus: response.status,
        localCount,
        remoteCount,
        source: body?.source || null,
        ok,
      });
    } catch (fetchError) {
      failed = true;
      error = fetchError.message;
      checks.push({
        metroId: metro.id,
        url,
        localCount,
        remoteCount: null,
        ok: false,
        error: fetchError.message,
      });
    }
  }

  const finishedAt = new Date();
  return {
    name: "verify-worker-events",
    command: "fetch",
    args: ["$SATURDAY_API/events"],
    status: failed ? "failed" : "passed",
    exitCode: failed ? 1 : 0,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    error: error || undefined,
    checks,
  };
}

function writeReport(reportPath, report) {
  const absolutePath = path.resolve(ROOT, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
  return path.relative(ROOT, absolutePath);
}

function writeTextReport(reportPath, text) {
  const absolutePath = path.resolve(ROOT, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, text.endsWith("\n") ? text : `${text}\n`);
  return path.relative(ROOT, absolutePath);
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderOpsMarkdown(report) {
  const lines = [];
  lines.push("# Event Ops Agent Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Decision: ${report.decision.status}`);
  lines.push(`Alert gate: ${report.options.failOnAlerts}`);
  lines.push("");

  lines.push("## Metro Summary");
  lines.push("");
  lines.push(
    "| Metro | Events | Live | Last-known-good | Fallback | Alerts | Critical | Warning |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const metro of report.metros) {
    lines.push(
      `| ${mdCell(metro.metroId)} | ${metro.eventCount} | ${metro.liveEventCount} | ${metro.lastKnownGoodEventCount} | ${metro.fallbackEventCount} | ${metro.operatorAlertCount} | ${metro.alertSeverityCounts.critical} | ${metro.alertSeverityCounts.warning} |`,
    );
  }
  lines.push("");

  if (report.decision.blockers.length > 0) {
    lines.push("## Publish Blockers");
    lines.push("");
    for (const blocker of report.decision.blockers) {
      lines.push(`- ${blocker.metroId}: ${blocker.reason} (${blocker.count})`);
    }
    lines.push("");
  }

  lines.push("## Action Buckets");
  lines.push("");
  const mergedBuckets = {};
  for (const metro of report.metros) {
    for (const [bucket, count] of Object.entries(metro.triage?.buckets || {})) {
      mergedBuckets[bucket] = (mergedBuckets[bucket] || 0) + count;
    }
  }
  if (Object.keys(mergedBuckets).length === 0) {
    lines.push("- No operator alerts in selected reports.");
  } else {
    for (const [bucket, count] of Object.entries(mergedBuckets).sort()) {
      lines.push(`- ${bucket}: ${count}`);
    }
  }
  lines.push("");

  lines.push("## Priority Queue");
  lines.push("");
  lines.push(
    "| Priority | Metro | Source | Bucket | Issue | Recovery | Action |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  const priorityItems = report.metros
    .flatMap((metro) => metro.triage?.priorityItems || [])
    .sort((a, b) => {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
      const delta = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
      if (delta !== 0) return delta;
      return String(a.sourceName || "").localeCompare(String(b.sourceName || ""));
    })
    .slice(0, 40);
  if (priorityItems.length === 0) {
    lines.push("| - | - | - | - | - | - | - |");
  } else {
    for (const item of priorityItems) {
      const recovery = item.recoveredBy
        ? `${item.recoveredBy} (${item.recoveredEvents})`
        : "none";
      lines.push(
        `| ${mdCell(item.priority)} | ${mdCell(item.metroId)} | ${mdCell(item.sourceName || item.sourceId)} | ${mdCell(item.bucket)} | ${mdCell(item.issueType || item.reason)} | ${mdCell(recovery)} | ${mdCell(item.action)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Steps");
  lines.push("");
  if (report.steps.length === 0) {
    lines.push("- No commands were run.");
  } else {
    for (const step of report.steps) {
      lines.push(
        `- ${step.name}: ${step.status} (${step.durationMs} ms, exit ${step.exitCode})`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

function printSummary(report) {
  console.log("\n[event-ops] summary");
  for (const metro of report.metros) {
    console.log(
      `[event-ops] ${metro.metroId}: events=${metro.eventCount}, live=${metro.liveEventCount}, lkg=${metro.lastKnownGoodEventCount}, fallback=${metro.fallbackEventCount}, alerts=${metro.operatorAlertCount} (critical=${metro.alertSeverityCounts.critical}, warning=${metro.alertSeverityCounts.warning})`,
    );
  }
  if (report.decision.status === "blocked") {
    console.log(
      `[event-ops] blocked: ${report.decision.blockers
        .map((blocker) => `${blocker.metroId}:${blocker.reason}=${blocker.count}`)
        .join(", ")}`,
    );
  } else {
    console.log("[event-ops] local gates passed.");
  }
}

async function main() {
  const options = parseEventOpsArgs();
  if (options.help) {
    usage();
    return;
  }

  const config = loadMetroConfig();
  const metros = resolveMetros(options, config);
  const steps = [];
  let failedStep = null;

  function runStep(name, command, args) {
    if (failedStep) return;
    const step = runCommand(name, command, args);
    steps.push(step);
    if (step.status !== "passed") failedStep = step;
  }

  function runLocalPipeline(label = "") {
    const suffix = label ? `:${label}` : "";
    if (!options.skipIngest) {
      if (options.all) {
        runStep(`ingest-events-all${suffix}`, "npm", ["run", "ingest:events:all"]);
      } else {
        const metro = metros[0];
        runStep(`ingest-events${suffix}`, process.execPath, [
          "scripts/ingest-events.mjs",
          `--metro=${metro.id}`,
        ]);
        runStep(`generate-featured-plans${suffix}`, process.execPath, [
          "scripts/generate-featured-plans.mjs",
          `--metro=${metro.id}`,
        ]);
      }
    }

    if (!options.skipValidate) {
      runStep(`validate-events${suffix}`, "npm", [
        "run",
        options.all ? "validate:events:all" : "validate:events",
        ...(options.all ? [] : ["--", `--metro=${metros[0].id}`]),
      ]);
    }

    if (!options.skipDataSite) {
      runStep(`build-data-site${suffix}`, "npm", ["run", "build:data-site"]);
    }
  }

  function runAutoSourceRepair() {
    let appliedCount = 0;
    for (const metro of metros) {
      const reportPath = path.join(
        "output",
        "source-repair-agent",
        `${metro.id}.json`,
      );
      const markdownPath = path.join(
        "output",
        "source-repair-agent",
        `${metro.id}.md`,
      );
      const args = [
        "scripts/source-repair-agent.mjs",
        `--metro=${metro.id}`,
        `--report=${reportPath}`,
        `--markdown=${markdownPath}`,
      ];
      if (options.sourceRepairCandidateFile) {
        args.push(`--candidate-file=${options.sourceRepairCandidateFile}`);
        args.push("--fetch-candidates");
        args.push("--apply-safe-url-fixes");
      }
      runStep(`source-repair:${metro.id}`, process.execPath, args);
      const repairReport = readJsonIfExists(reportPath);
      appliedCount += repairReport?.safeUrlFixes?.applied?.length || 0;
    }
    return appliedCount;
  }

  runLocalPipeline();

  let metroSummaries = summarizeMetros(metros);
  let decision = buildOpsDecision(metroSummaries, options);

  if (!failedStep && decision.status !== "pass" && options.autoRepairSources) {
    const appliedCount = runAutoSourceRepair();
    if (!failedStep && appliedCount > 0 && !options.skipIngest) {
      runLocalPipeline("after-source-repair");
      metroSummaries = summarizeMetros(metros);
      decision = buildOpsDecision(metroSummaries, options);
    }
  }

  if (!failedStep && decision.status === "pass" && options.publishWorker) {
    runStep("publish-worker", "npm", [
      "run",
      options.all ? "publish:events:all" : "publish:events",
      ...(options.all ? [] : ["--", `--metro=${metros[0].id}`]),
    ]);
    if (!failedStep) {
      const step = await verifyWorkerEvents(metros);
      steps.push(step);
      if (step.status !== "passed") failedStep = step;
    }
  }

  if (!failedStep && decision.status === "pass" && options.deployData) {
    runStep("deploy-data", "npm", ["run", "deploy:data"]);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    options: {
      all: options.all,
      metros: metros.map((metro) => metro.id),
      skipIngest: options.skipIngest,
      skipValidate: options.skipValidate,
      skipDataSite: options.skipDataSite,
      autoRepairSources: options.autoRepairSources,
      sourceRepairCandidateFile: options.sourceRepairCandidateFile,
      publishWorker: options.publishWorker,
      deployData: options.deployData,
      failOnAlerts: options.failOnAlerts,
      triageReportPath: options.triageReportPath,
    },
    steps,
    decision,
    metros: metroSummaries,
  };
  const writtenReportPath = writeReport(options.reportPath, report);
  const writtenTriagePath = writeTextReport(
    options.triageReportPath,
    renderOpsMarkdown(report),
  );
  printSummary(report);
  console.log(`[event-ops] wrote report to ${writtenReportPath}`);
  console.log(`[event-ops] wrote triage report to ${writtenTriagePath}`);

  if (failedStep) {
    process.exit(failedStep.exitCode || 1);
  }
  if (decision.status !== "pass") {
    process.exit(2);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
