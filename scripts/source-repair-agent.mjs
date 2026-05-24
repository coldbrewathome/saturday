#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractEventsFromPayload } from "./eventPipeline.mjs";
import {
  ROOT,
  adultSourceRegistryPath,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
  sourceRegistryPath,
} from "./metroConfig.mjs";

const DEFAULT_REPORT_PATH = path.join("output", "source-repair-agent", "latest.json");
const DEFAULT_MARKDOWN_PATH = path.join("output", "source-repair-agent", "latest.md");
const DEFAULT_TIMEOUT_MS = 12000;

function usage() {
  console.log(`Usage:
  node scripts/source-repair-agent.mjs [--metro=<id>] [options]

Purpose:
  Convert zero-extracted operator alerts into grounded source-repair work:
  search queries, official candidate URLs, extractor validation, and repair actions.

Options:
  --metro=<id>              Metro to inspect. Defaults to configured default metro.
  --severity=<level>        Alert severity to inspect. Default: critical.
  --issue=<type>            Alert issue type. Default: zero-extracted.
  --source=<id>             Limit to one source id. May be repeated.
  --limit=<n>               Limit number of alert sources. Default: no limit.
  --candidate-file=<path>   JSON search-grounding candidates to validate.
  --fetch-candidates        Fetch and validate candidate URLs.
  --apply-safe-url-fixes    Update registry URLs for official candidates that validate.
  --report=<path>           Write JSON report. Default: ${DEFAULT_REPORT_PATH}
  --markdown=<path>         Write Markdown report. Default: ${DEFAULT_MARKDOWN_PATH}
  --help                    Show this help.

Candidate file shape:
  {
    "candidates": [
      {
        "sourceId": "sonoma-county-library",
        "url": "https://events.sonomalibrary.org/events/list?language=en",
        "title": "Event List | Sonoma County Library",
        "snippet": "Search result snippet or grounding note",
        "official": true
      }
    ]
  }`);
}

export function parseSourceRepairArgs(argv = process.argv.slice(2)) {
  const options = {
    metroArg: null,
    severity: "critical",
    issue: "zero-extracted",
    sourceIds: [],
    limit: null,
    candidateFile: null,
    fetchCandidates: false,
    applySafeUrlFixes: false,
    reportPath: DEFAULT_REPORT_PATH,
    markdownPath: DEFAULT_MARKDOWN_PATH,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--metro=")) {
      options.metroArg = arg.slice("--metro=".length);
    } else if (arg.startsWith("--severity=")) {
      options.severity = arg.slice("--severity=".length);
    } else if (arg.startsWith("--issue=")) {
      options.issue = arg.slice("--issue=".length);
    } else if (arg.startsWith("--source=")) {
      options.sourceIds.push(arg.slice("--source=".length));
    } else if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(limit) || limit < 1) {
        throw new Error("--limit must be a positive number.");
      }
      options.limit = limit;
    } else if (arg.startsWith("--candidate-file=")) {
      options.candidateFile = arg.slice("--candidate-file=".length);
    } else if (arg === "--fetch-candidates") {
      options.fetchCandidates = true;
    } else if (arg === "--apply-safe-url-fixes") {
      options.applySafeUrlFixes = true;
    } else if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length);
    } else if (arg.startsWith("--markdown=")) {
      options.markdownPath = arg.slice("--markdown=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readJsonIfExists(filePath) {
  const absolutePath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function writeJson(reportPath, report) {
  const absolutePath = path.resolve(ROOT, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
  return path.relative(ROOT, absolutePath);
}

function writeText(reportPath, text) {
  const absolutePath = path.resolve(ROOT, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, text.endsWith("\n") ? text : `${text}\n`);
  return path.relative(ROOT, absolutePath);
}

function resolveRepoPath(filePath) {
  return path.resolve(ROOT, filePath);
}

function sourceRegistryFiles(metro) {
  return [
    { audience: "kids", path: sourceRegistryPath(metro) },
    { audience: "adults", path: adultSourceRegistryPath(metro) },
  ].filter((entry) => entry.path && fs.existsSync(path.resolve(ROOT, entry.path)));
}

function loadSourceIndex(metro) {
  const sources = [];
  for (const registryFile of sourceRegistryFiles(metro)) {
    const registry = readJsonIfExists(registryFile.path);
    for (const source of registry?.sources || []) {
      sources.push({
        ...source,
        audience: registryFile.audience,
        registryPath: registryFile.path,
        metroId: source.metroId || metro.id,
        timezoneOffset:
          source.timezoneOffset || registry?.defaults?.timezoneOffset || metro.timezoneOffset,
      });
    }
  }
  return new Map(sources.map((source) => [source.id, source]));
}

function normalizeHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function registrableDomain(value) {
  const host = normalizeHostname(value);
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

export function isLikelyOfficialCandidate(source = {}, candidate = {}) {
  if (candidate.official === true) return true;
  if (candidate.official === false) return false;
  const sourceDomain = registrableDomain(source.url || "");
  const candidateDomain = registrableDomain(candidate.url || "");
  return Boolean(sourceDomain && candidateDomain && sourceDomain === candidateDomain);
}

export function buildSearchQueries(alert = {}, source = {}) {
  const name = source.name || alert.sourceName || alert.sourceId || "";
  const city = source.city || "";
  const host = normalizeHostname(source.url || alert.url || "");
  const year = new Date().getFullYear();
  return [
    `${name} official events calendar ${city}`.trim(),
    host ? `site:${host} ${name} events calendar` : "",
    `${name} ${city} events ${year} official`.trim(),
  ]
    .filter(Boolean)
    .filter((query, index, list) => list.indexOf(query) === index);
}

function loadCandidates(candidateFile) {
  if (!candidateFile) return [];
  const doc = readJsonIfExists(candidateFile);
  if (!doc) throw new Error(`Candidate file not found: ${candidateFile}`);
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.candidates)) return doc.candidates;
  throw new Error("Candidate file must be an array or contain a candidates array.");
}

function candidatesBySource(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    if (!candidate.sourceId || !candidate.url) continue;
    if (!map.has(candidate.sourceId)) map.set(candidate.sourceId, []);
    map.get(candidate.sourceId).push(candidate);
  }
  return map;
}

function candidateTrust(source, candidate) {
  const official = isLikelyOfficialCandidate(source, candidate);
  return {
    official,
    sameDomain:
      registrableDomain(source.url || "") === registrableDomain(candidate.url || ""),
    sourceDomain: registrableDomain(source.url || ""),
    candidateDomain: registrableDomain(candidate.url || ""),
  };
}

async function fetchCandidate(candidate, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(candidate.url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (compatible; FamHopSourceRepair/1.0; +https://famhop.com)",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let json = null;
    if (/json/i.test(contentType)) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      text,
      json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateCandidate(source, candidate, options = {}) {
  const trust = candidateTrust(source, candidate);
  const validation = {
    ...candidate,
    trust,
    validationStatus: "not-fetched",
    eventCount: 0,
    sampleEvents: [],
    error: null,
  };

  if (!options.fetchCandidates) {
    validation.validationStatus = trust.official
      ? "official-candidate-unvalidated"
      : "non-official-candidate-unvalidated";
    return validation;
  }

  if (!trust.official) {
    validation.validationStatus = "rejected-non-official";
    validation.error = "Candidate is not same-domain or explicitly marked official.";
    return validation;
  }

  try {
    const payload = await fetchCandidate(candidate, options.timeoutMs);
    validation.httpStatus = payload.status;
    validation.contentType = payload.contentType;
    if (!payload.ok) {
      validation.validationStatus = "fetch-failed";
      validation.error = `HTTP ${payload.status}`;
      return validation;
    }
    const candidateSource = {
      ...source,
      url: candidate.url,
      sourceType: candidate.sourceType || source.sourceType,
    };
    const events = extractEventsFromPayload(
      {
        text: payload.text,
        json: payload.json,
        contentType: payload.contentType,
      },
      candidateSource,
      { now: new Date() },
    );
    validation.eventCount = events.length;
    validation.sampleEvents = events.slice(0, 5).map((event) => ({
      title: event.title,
      venue: event.venue,
      city: event.city,
      startDateTime: event.startDateTime,
      sourceUrl: event.sourceUrl || event.url,
      extractionMethod: event.extractionMethod,
    }));
    validation.validationStatus =
      events.length > 0 ? "validated-events" : "official-candidate-needs-parser";
    return validation;
  } catch (error) {
    validation.validationStatus = "fetch-error";
    validation.error = error.message;
    return validation;
  }
}

function recommendedAction(item) {
  const validations = item.candidates || [];
  if (validations.some((candidate) => candidate.validationStatus === "validated-events")) {
    return "Review validated candidate and update source URL/sourceType.";
  }
  if (
    validations.some(
      (candidate) =>
        candidate.validationStatus === "official-candidate-needs-parser" ||
        candidate.validationStatus === "official-candidate-unvalidated",
    )
  ) {
    return "Inspect official candidate payload and add or tune parser.";
  }
  if (validations.length > 0) {
    return "Search produced no trusted event-bearing candidate; broaden official search.";
  }
  return "Run search grounding and feed official candidate URLs via --candidate-file.";
}

export async function buildSourceRepairReport({
  metro,
  alertsDoc,
  sourceIndex,
  candidates = [],
  options = {},
}) {
  const candidateMap = candidatesBySource(candidates);
  const selectedSources = new Set(options.sourceIds || []);
  let alerts = (alertsDoc?.alerts || []).filter((alert) => {
    if (options.severity && alert.severity !== options.severity) return false;
    if (options.issue && alert.issueType !== options.issue) return false;
    if (selectedSources.size > 0 && !selectedSources.has(alert.sourceId)) return false;
    return true;
  });
  if (options.limit) alerts = alerts.slice(0, options.limit);

  const items = [];
  for (const alert of alerts) {
    const source = sourceIndex.get(alert.sourceId) || {
      id: alert.sourceId,
      name: alert.sourceName,
      url: alert.url,
      sourceType: alert.sourceType,
      city: null,
      category: null,
      registryPath: null,
    };
    const sourceCandidates = candidateMap.get(alert.sourceId) || [];
    const validations = [];
    for (const candidate of sourceCandidates) {
      validations.push(await validateCandidate(source, candidate, options));
    }
    const item = {
      sourceId: alert.sourceId,
      sourceName: alert.sourceName,
      sourceType: alert.sourceType,
      audience: source.audience || null,
      registryPath: source.registryPath || null,
      currentUrl: alert.url || source.url,
      city: source.city || null,
      category: source.category || null,
      issueType: alert.issueType,
      reason: alert.reason,
      recoveredEvents: Number(alert.recoveredEvents || 0),
      searchQueries: buildSearchQueries(alert, source),
      candidates: validations,
    };
    item.recommendedAction = recommendedAction(item);
    items.push(item);
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    metroId: metro.id,
    options: {
      severity: options.severity,
      issue: options.issue,
      sourceIds: options.sourceIds || [],
      limit: options.limit || null,
      fetchCandidates: Boolean(options.fetchCandidates),
      applySafeUrlFixes: Boolean(options.applySafeUrlFixes),
    },
    sourceCount: items.length,
    validatedCandidateCount: items.reduce(
      (sum, item) =>
        sum +
        item.candidates.filter(
          (candidate) => candidate.validationStatus === "validated-events",
        ).length,
      0,
    ),
    items,
  };
}

export function selectSafeUrlFixes(report) {
  const fixes = [];
  for (const item of report.items || []) {
    if (!item.registryPath || !item.sourceId) continue;
    const candidate = (item.candidates || []).find(
      (entry) =>
        entry.validationStatus === "validated-events" &&
        entry.trust?.official === true &&
        entry.eventCount > 0 &&
        entry.url &&
        entry.url !== item.currentUrl,
    );
    if (!candidate) continue;
    fixes.push({
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      registryPath: item.registryPath,
      oldUrl: item.currentUrl,
      newUrl: candidate.url,
      eventCount: candidate.eventCount,
      sourceType: candidate.sourceType || null,
    });
  }
  return fixes;
}

export function applySafeUrlFixes(report) {
  const selected = selectSafeUrlFixes(report);
  const byRegistry = new Map();
  const applied = [];
  const skipped = [];

  for (const fix of selected) {
    if (!byRegistry.has(fix.registryPath)) {
      const absolutePath = resolveRepoPath(fix.registryPath);
      byRegistry.set(fix.registryPath, {
        absolutePath,
        doc: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
        dirty: false,
      });
    }
    const registry = byRegistry.get(fix.registryPath);
    const source = registry.doc.sources?.find((entry) => entry.id === fix.sourceId);
    if (!source) {
      skipped.push({ ...fix, reason: "source-not-found" });
      continue;
    }
    if (source.url === fix.newUrl) {
      skipped.push({ ...fix, reason: "already-current" });
      continue;
    }
    const previousUrl = source.url;
    source.url = fix.newUrl;
    if (fix.sourceType && fix.sourceType !== source.sourceType) {
      source.sourceType = fix.sourceType;
    }
    registry.dirty = true;
    applied.push({ ...fix, oldUrl: previousUrl });
  }

  for (const registry of byRegistry.values()) {
    if (!registry.dirty) continue;
    fs.writeFileSync(registry.absolutePath, `${JSON.stringify(registry.doc, null, 2)}\n`);
  }

  return { selected, applied, skipped };
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderSourceRepairMarkdown(report) {
  const lines = [];
  lines.push("# Source Repair Agent Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Metro: ${report.metroId}`);
  lines.push(`Alert filter: ${report.options.severity}/${report.options.issue}`);
  lines.push(`Sources: ${report.sourceCount}`);
  lines.push(`Validated candidates: ${report.validatedCandidateCount}`);
  lines.push(`Safe URL fixes applied: ${report.safeUrlFixes?.applied?.length || 0}`);
  lines.push("");

  lines.push("## Repair Queue");
  lines.push("");
  lines.push("| Source | Current URL | Action | Search queries |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of report.items) {
    lines.push(
      `| ${mdCell(item.sourceName)} | ${mdCell(item.currentUrl)} | ${mdCell(item.recommendedAction)} | ${mdCell(item.searchQueries.join(" ; "))} |`,
    );
  }
  lines.push("");

  lines.push("## Candidate Validation");
  lines.push("");
  lines.push("| Source | Candidate | Trust | Status | Events | Grounding / Sample |");
  lines.push("| --- | --- | --- | --- | ---: | --- |");
  const candidates = report.items.flatMap((item) =>
    item.candidates.map((candidate) => ({ item, candidate })),
  );
  if (candidates.length === 0) {
    lines.push("| - | - | - | - | 0 | No candidate file provided. |");
  } else {
    for (const { item, candidate } of candidates) {
      const sample =
        candidate.sampleEvents?.[0]?.title ||
        candidate.title ||
        candidate.snippet ||
        candidate.error ||
        "";
      lines.push(
        `| ${mdCell(item.sourceName)} | ${mdCell(candidate.url)} | ${candidate.trust?.official ? "official" : "untrusted"} | ${mdCell(candidate.validationStatus)} | ${candidate.eventCount || 0} | ${mdCell(sample)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Applied Fixes");
  lines.push("");
  const applied = report.safeUrlFixes?.applied || [];
  if (applied.length === 0) {
    lines.push("- No registry URL changes applied.");
  } else {
    for (const fix of applied) {
      lines.push(
        `- ${fix.sourceId}: ${fix.oldUrl} -> ${fix.newUrl} (${fix.eventCount} validated events)`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const options = parseSourceRepairArgs();
  if (options.help) {
    usage();
    return;
  }

  const config = loadMetroConfig();
  const selection = selectedMetroFromArgs(
    options.metroArg ? [`--metro=${options.metroArg}`] : [],
    config,
  );
  if (selection.all) throw new Error("source-repair-agent expects one metro.");
  const metro = selection.metro;
  const alertsPath = metroDataFile(metro, "eventReport").replace(
    /event-build-report\.json$/,
    "event-operator-alerts.json",
  );
  const alertsDoc = readJsonIfExists(alertsPath);
  if (!alertsDoc) throw new Error(`Missing operator alerts: ${alertsPath}`);

  const sourceIndex = loadSourceIndex(metro);
  const candidates = loadCandidates(options.candidateFile);
  const report = await buildSourceRepairReport({
    metro,
    alertsDoc,
    sourceIndex,
    candidates,
    options: {
      severity: options.severity,
      issue: options.issue,
      sourceIds: options.sourceIds,
      limit: options.limit,
      fetchCandidates: options.fetchCandidates,
      applySafeUrlFixes: options.applySafeUrlFixes,
    },
  });
  if (options.applySafeUrlFixes) {
    report.safeUrlFixes = applySafeUrlFixes(report);
  } else {
    report.safeUrlFixes = {
      selected: selectSafeUrlFixes(report),
      applied: [],
      skipped: [],
    };
  }
  const jsonPath = writeJson(options.reportPath, report);
  const markdownPath = writeText(options.markdownPath, renderSourceRepairMarkdown(report));
  console.log(`[source-repair] sources=${report.sourceCount}`);
  console.log(`[source-repair] validated candidates=${report.validatedCandidateCount}`);
  console.log(`[source-repair] applied safe URL fixes=${report.safeUrlFixes.applied.length}`);
  console.log(`[source-repair] wrote report to ${jsonPath}`);
  console.log(`[source-repair] wrote markdown to ${markdownPath}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
