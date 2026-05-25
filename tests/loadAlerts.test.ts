import { describe, expect, it } from "vitest";
import {
  mergeAlertFiles,
  type OperatorAlert,
  type OperatorAlertFile,
} from "../src/ops/loadAlerts";
import {
  buildOpsAlertsHash,
  buildSnoozeCommand,
  buildSnoozePayload,
  filterAlerts,
  isSnoozedNow,
  parseFilterFromHash,
  sortAlerts,
} from "../src/ops/OpsAlertsView";

function file(
  metroId: string,
  alerts: Array<{ severity?: string; sourceId?: string; sourceName?: string }>,
  generatedAt = "2026-05-23T21:25:43.967Z",
): OperatorAlertFile {
  return {
    schemaVersion: 1,
    metroId,
    generatedAt,
    alertCount: alerts.length,
    alerts,
  };
}

describe("mergeAlertFiles", () => {
  it("flattens alerts from multiple metro files and totals them", () => {
    const merged = mergeAlertFiles([
      file("atlanta", [
        { severity: "critical", sourceId: "a1", sourceName: "A1" },
        { severity: "warning", sourceId: "a2", sourceName: "A2" },
      ]),
      file("boston", [
        { severity: "critical", sourceId: "b1", sourceName: "B1" },
      ]),
    ]);

    expect(merged.total).toBe(3);
    expect(merged.alerts.map((a) => a.sourceId)).toEqual(["a1", "a2", "b1"]);
  });

  it("attaches metroId from the file to every alert (overrides any stray value)", () => {
    const merged = mergeAlertFiles([
      file("atlanta", [
        // Deliberately wrong metroId on the alert — file's wins.
        {
          severity: "critical",
          sourceId: "a1",
          sourceName: "A1",
          // @ts-expect-error — extra field accepted by the loose alert type
          metroId: "boston",
        },
      ]),
    ]);

    expect(merged.alerts[0]?.metroId).toBe("atlanta");
  });

  it("counts severities and unique metros with at least one critical", () => {
    const merged = mergeAlertFiles([
      file("atlanta", [
        { severity: "critical", sourceId: "a1", sourceName: "A1" },
        { severity: "critical", sourceId: "a2", sourceName: "A2" },
        { severity: "warning", sourceId: "a3", sourceName: "A3" },
      ]),
      file("boston", [
        { severity: "warning", sourceId: "b1", sourceName: "B1" },
      ]),
      file("chicago", [
        { severity: "critical", sourceId: "c1", sourceName: "C1" },
        { severity: "info", sourceId: "c2", sourceName: "C2" },
      ]),
    ]);

    expect(merged.bySeverity).toEqual({
      critical: 3,
      warning: 2,
      info: 1,
      unknown: 0,
    });
    expect(merged.metrosWithCritical).toBe(2); // atlanta + chicago
  });

  it("normalizes unknown severities and tolerates empty/missing files", () => {
    const merged = mergeAlertFiles([
      file("atlanta", [
        // severity bucket the schema doesn't know about
        { severity: "weird", sourceId: "a1", sourceName: "A1" },
        // severity omitted entirely
        { sourceId: "a2", sourceName: "A2" },
      ]),
      file("boston", []),
      // Missing metroId — silently skipped, not crashed.
      { schemaVersion: 1, metroId: "", alerts: [{ severity: "critical" }] },
    ]);

    expect(merged.total).toBe(2);
    expect(merged.bySeverity.unknown).toBe(2);
    expect(merged.bySeverity.critical).toBe(0);
    expect(merged.metrosWithCritical).toBe(0);
  });

  it("records generatedAt per metro for staleness display", () => {
    const merged = mergeAlertFiles([
      file("atlanta", [], "2026-05-23T21:25:43.967Z"),
      file("boston", [], "2026-05-23T21:30:00.000Z"),
    ]);

    expect(merged.generatedAt).toEqual({
      atlanta: "2026-05-23T21:25:43.967Z",
      boston: "2026-05-23T21:30:00.000Z",
    });
  });
});

function alert(
  partial: Partial<OperatorAlert> & {
    severity: OperatorAlert["severity"];
    sourceId: string;
  },
): OperatorAlert {
  return {
    metroId: "atlanta",
    sourceName: partial.sourceId,
    ...partial,
  } as OperatorAlert;
}

describe("sortAlerts", () => {
  it("orders by severity desc, then fetchedAt desc within a bucket", () => {
    const input: OperatorAlert[] = [
      alert({ severity: "warning", sourceId: "w-old", fetchedAt: "2026-05-20T00:00:00Z" }),
      alert({ severity: "critical", sourceId: "c-old", fetchedAt: "2026-05-20T00:00:00Z" }),
      alert({ severity: "info", sourceId: "i-new", fetchedAt: "2026-05-23T00:00:00Z" }),
      alert({ severity: "critical", sourceId: "c-new", fetchedAt: "2026-05-23T00:00:00Z" }),
      alert({ severity: "warning", sourceId: "w-new", fetchedAt: "2026-05-23T00:00:00Z" }),
    ];

    expect(sortAlerts(input).map((a) => a.sourceId)).toEqual([
      "c-new",
      "c-old",
      "w-new",
      "w-old",
      "i-new",
    ]);
  });

  it("places alerts with missing fetchedAt at the bottom of their severity bucket", () => {
    const input: OperatorAlert[] = [
      alert({ severity: "critical", sourceId: "c-missing" }),
      alert({ severity: "critical", sourceId: "c-dated", fetchedAt: "2026-05-23T00:00:00Z" }),
    ];

    expect(sortAlerts(input).map((a) => a.sourceId)).toEqual([
      "c-dated",
      "c-missing",
    ]);
  });

  it("does not mutate the input array", () => {
    const input: OperatorAlert[] = [
      alert({ severity: "info", sourceId: "i" }),
      alert({ severity: "critical", sourceId: "c" }),
    ];
    const order = input.map((a) => a.sourceId);
    sortAlerts(input);
    expect(input.map((a) => a.sourceId)).toEqual(order);
  });
});

describe("filterAlerts", () => {
  const sample: OperatorAlert[] = [
    alert({ severity: "critical", sourceId: "a1", metroId: "atlanta" }),
    alert({ severity: "warning", sourceId: "a2", metroId: "atlanta" }),
    alert({ severity: "info", sourceId: "a3", metroId: "atlanta" }),
    alert({ severity: "critical", sourceId: "b1", metroId: "boston" }),
    alert({ severity: "warning", sourceId: "c1", metroId: "chicago" }),
  ];

  it("severity=all + no metros returns all alerts", () => {
    expect(
      filterAlerts(sample, { severity: "all", metros: [] }).map((a) => a.sourceId),
    ).toEqual(["a1", "a2", "a3", "b1", "c1"]);
  });

  it("severity=critical keeps only critical alerts", () => {
    expect(
      filterAlerts(sample, { severity: "critical", metros: [] }).map(
        (a) => a.sourceId,
      ),
    ).toEqual(["a1", "b1"]);
  });

  it("metro multi-select keeps only matching metros", () => {
    expect(
      filterAlerts(sample, {
        severity: "all",
        metros: ["atlanta", "chicago"],
      }).map((a) => a.sourceId),
    ).toEqual(["a1", "a2", "a3", "c1"]);
  });

  it("severity + metro filters combine (AND)", () => {
    expect(
      filterAlerts(sample, {
        severity: "warning",
        metros: ["atlanta"],
      }).map((a) => a.sourceId),
    ).toEqual(["a2"]);
  });
});

describe("parseFilterFromHash / buildOpsAlertsHash", () => {
  it("returns defaults for a bare hash", () => {
    expect(parseFilterFromHash("#/ops/alerts")).toEqual({
      severity: "all",
      metros: [],
    });
  });

  it("parses severity + metros and drops unknown metro ids", () => {
    const parsed = parseFilterFromHash(
      "#/ops/alerts?severity=critical&metros=atlanta,not-a-metro,boston",
    );
    expect(parsed.severity).toBe("critical");
    expect(parsed.metros.sort()).toEqual(["atlanta", "boston"]);
  });

  it("falls back to 'all' for unknown severity values", () => {
    expect(
      parseFilterFromHash("#/ops/alerts?severity=spicy").severity,
    ).toBe("all");
  });

  it("builds a bare hash when filter is at defaults", () => {
    expect(
      buildOpsAlertsHash({ severity: "all", metros: [] }),
    ).toBe("#/ops/alerts");
  });

  it("round-trips a non-default filter", () => {
    const filter = { severity: "warning" as const, metros: ["boston", "atlanta"] };
    const hash = buildOpsAlertsHash(filter);
    expect(hash).toBe("#/ops/alerts?severity=warning&metros=atlanta%2Cboston");
    const parsed = parseFilterFromHash(hash);
    expect(parsed.severity).toBe("warning");
    expect(parsed.metros.sort()).toEqual(["atlanta", "boston"]);
  });
});

describe("isSnoozedNow", () => {
  const now = new Date("2026-05-25T12:00:00Z");

  it("returns false when snoozedUntil is missing", () => {
    expect(isSnoozedNow({ snoozedUntil: undefined }, now)).toBe(false);
  });

  it("returns true for a timestamp strictly in the future", () => {
    expect(
      isSnoozedNow({ snoozedUntil: "2026-05-26T00:00:00Z" }, now),
    ).toBe(true);
  });

  it("treats the exact `now` boundary as expired (not snoozed)", () => {
    expect(
      isSnoozedNow({ snoozedUntil: "2026-05-25T12:00:00Z" }, now),
    ).toBe(false);
  });

  it("returns false for past timestamps", () => {
    expect(
      isSnoozedNow({ snoozedUntil: "2026-05-24T00:00:00Z" }, now),
    ).toBe(false);
  });

  it("returns false for garbage timestamps", () => {
    expect(isSnoozedNow({ snoozedUntil: "not-a-date" }, now)).toBe(false);
  });
});

describe("buildSnoozePayload", () => {
  it("returns sourceId + until without a note when none is provided", () => {
    expect(
      buildSnoozePayload({
        sourceId: "zoo",
        until: "2026-06-01T00:00:00Z",
      }),
    ).toEqual({ sourceId: "zoo", until: "2026-06-01T00:00:00Z" });
  });

  it("includes a trimmed note when provided", () => {
    expect(
      buildSnoozePayload({
        sourceId: "zoo",
        until: "2026-06-01T00:00:00Z",
        note: "  parser broken  ",
      }),
    ).toEqual({
      sourceId: "zoo",
      until: "2026-06-01T00:00:00Z",
      note: "parser broken",
    });
  });

  it("drops whitespace-only notes", () => {
    const payload = buildSnoozePayload({
      sourceId: "zoo",
      until: "2026-06-01T00:00:00Z",
      note: "   ",
    });
    expect(payload).toEqual({
      sourceId: "zoo",
      until: "2026-06-01T00:00:00Z",
    });
    expect("note" in payload).toBe(false);
  });
});

describe("buildSnoozeCommand", () => {
  it("quotes the sourceId and renders the days flag", () => {
    expect(
      buildSnoozeCommand({ sourceId: "zoo-rss", days: 7 }),
    ).toBe('node scripts/snooze-alert.mjs "zoo-rss" --days=7');
  });

  it("appends a single-quoted note when provided", () => {
    expect(
      buildSnoozeCommand({
        sourceId: "zoo",
        days: 14,
        note: "parser broken",
      }),
    ).toBe(
      "node scripts/snooze-alert.mjs \"zoo\" --days=14 --note='parser broken'",
    );
  });

  it("escapes embedded single quotes in the note", () => {
    expect(
      buildSnoozeCommand({
        sourceId: "zoo",
        days: 7,
        note: "it's busted",
      }),
    ).toBe(
      "node scripts/snooze-alert.mjs \"zoo\" --days=7 --note='it'\\''s busted'",
    );
  });

  it("omits the note flag when the note is whitespace-only", () => {
    expect(
      buildSnoozeCommand({ sourceId: "zoo", days: 7, note: "   " }),
    ).toBe('node scripts/snooze-alert.mjs "zoo" --days=7');
  });

  it("JSON-escapes special characters in sourceId", () => {
    expect(
      buildSnoozeCommand({ sourceId: 'has"quote', days: 3 }),
    ).toBe('node scripts/snooze-alert.mjs "has\\"quote" --days=3');
  });
});
