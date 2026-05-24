import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applySafeUrlFixes,
  buildSearchQueries,
  buildSourceRepairReport,
  isLikelyOfficialCandidate,
  parseSourceRepairArgs,
  registrableDomain,
  renderSourceRepairMarkdown,
} from "../scripts/source-repair-agent.mjs";

test("parseSourceRepairArgs keeps candidate fetching explicit", () => {
  const options = parseSourceRepairArgs([
    "--metro=bay-area",
    "--source=randall-museum",
    "--candidate-file=/tmp/candidates.json",
    "--fetch-candidates",
    "--apply-safe-url-fixes",
    "--limit=3",
  ]);

  assert.equal(options.metroArg, "bay-area");
  assert.deepEqual(options.sourceIds, ["randall-museum"]);
  assert.equal(options.candidateFile, "/tmp/candidates.json");
  assert.equal(options.fetchCandidates, true);
  assert.equal(options.applySafeUrlFixes, true);
  assert.equal(options.limit, 3);
});

test("registrableDomain and official candidate checks prefer same-domain sources", () => {
  assert.equal(registrableDomain("https://events.sonomalibrary.org/events/list"), "sonomalibrary.org");
  assert.equal(
    isLikelyOfficialCandidate(
      { url: "https://sonomalibrary.org/index.php/events" },
      { url: "https://events.sonomalibrary.org/events/list" },
    ),
    true,
  );
  assert.equal(
    isLikelyOfficialCandidate(
      { url: "https://sonomalibrary.org/index.php/events" },
      { url: "https://example.com/sonoma-library-events" },
    ),
    false,
  );
});

test("buildSearchQueries generates official-source discovery queries", () => {
  const queries = buildSearchQueries(
    { sourceName: "Randall Museum", url: "https://randallmuseum.org/events-calendar/" },
    {
      name: "Randall Museum",
      city: "San Francisco",
      url: "https://randallmuseum.org/events-calendar/",
    },
  );

  assert.deepEqual(queries.slice(0, 2), [
    "Randall Museum official events calendar San Francisco",
    "site:randallmuseum.org Randall Museum events calendar",
  ]);
});

test("buildSourceRepairReport renders query-only repair plan without candidates", async () => {
  const report = await buildSourceRepairReport({
    metro: { id: "bay-area" },
    alertsDoc: {
      alerts: [
        {
          severity: "critical",
          issueType: "zero-extracted",
          sourceId: "randall-museum",
          sourceName: "Randall Museum",
          sourceType: "html",
          url: "https://randallmuseum.org/events-calendar/",
          reason: "Source returned a payload but no events were extracted.",
        },
      ],
    },
    sourceIndex: new Map([
      [
        "randall-museum",
        {
          id: "randall-museum",
          name: "Randall Museum",
          city: "San Francisco",
          url: "https://randallmuseum.org/events-calendar/",
          sourceType: "html",
          registryPath: "data/event-sources.json",
        },
      ],
    ]),
    candidates: [],
    options: { severity: "critical", issue: "zero-extracted" },
  });

  assert.equal(report.sourceCount, 1);
  assert.equal(
    report.items[0].recommendedAction,
    "Run search grounding and feed official candidate URLs via --candidate-file.",
  );
  assert.match(renderSourceRepairMarkdown(report), /Randall Museum official events calendar/);
});

test("buildSourceRepairReport classifies unvalidated official candidates", async () => {
  const report = await buildSourceRepairReport({
    metro: { id: "bay-area" },
    alertsDoc: {
      alerts: [
        {
          severity: "critical",
          issueType: "zero-extracted",
          sourceId: "sonoma-county-library",
          sourceName: "Sonoma County Library",
          sourceType: "html",
          url: "https://sonomalibrary.org/index.php/events",
          reason: "Source returned a payload but no events were extracted.",
        },
      ],
    },
    sourceIndex: new Map([
      [
        "sonoma-county-library",
        {
          id: "sonoma-county-library",
          name: "Sonoma County Library",
          url: "https://sonomalibrary.org/index.php/events",
          sourceType: "html",
        },
      ],
    ]),
    candidates: [
      {
        sourceId: "sonoma-county-library",
        url: "https://events.sonomalibrary.org/events/list?language=en",
        title: "Event List | Sonoma County Library",
      },
    ],
    options: {
      severity: "critical",
      issue: "zero-extracted",
      fetchCandidates: false,
    },
  });

  assert.equal(
    report.items[0].candidates[0].validationStatus,
    "official-candidate-unvalidated",
  );
  assert.equal(
    report.items[0].recommendedAction,
    "Inspect official candidate payload and add or tune parser.",
  );

  const markdown = renderSourceRepairMarkdown(report);
  assert.match(markdown, /Event List \\\| Sonoma County Library/);
});

test("applySafeUrlFixes only mutates validated official URL candidates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-repair-agent-"));
  const registryPath = path.join(dir, "event-sources.json");
  fs.writeFileSync(
    registryPath,
    `${JSON.stringify(
      {
        sources: [
          {
            id: "sonoma-county-library",
            name: "Sonoma County Library",
            url: "https://sonomalibrary.org/index.php/events",
            sourceType: "html",
          },
          {
            id: "randall-museum",
            name: "Randall Museum",
            url: "https://randallmuseum.org/events-calendar/",
            sourceType: "html",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const result = applySafeUrlFixes({
    items: [
      {
        sourceId: "sonoma-county-library",
        sourceName: "Sonoma County Library",
        registryPath,
        currentUrl: "https://sonomalibrary.org/index.php/events",
        candidates: [
          {
            url: "https://events.sonomalibrary.org/events/list?language=en",
            validationStatus: "validated-events",
            eventCount: 26,
            trust: { official: true },
          },
        ],
      },
      {
        sourceId: "randall-museum",
        sourceName: "Randall Museum",
        registryPath,
        currentUrl: "https://randallmuseum.org/events-calendar/",
        candidates: [
          {
            url: "https://example.com/randall",
            validationStatus: "validated-events",
            eventCount: 3,
            trust: { official: false },
          },
        ],
      },
    ],
  });

  const updated = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  assert.equal(result.applied.length, 1);
  assert.equal(
    updated.sources[0].url,
    "https://events.sonomalibrary.org/events/list?language=en",
  );
  assert.equal(updated.sources[1].url, "https://randallmuseum.org/events-calendar/");
});
