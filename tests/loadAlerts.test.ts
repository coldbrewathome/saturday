import { describe, expect, it } from "vitest";
import {
  mergeAlertFiles,
  type OperatorAlert,
  type OperatorAlertFile,
} from "../src/ops/loadAlerts";
import { sortAlerts } from "../src/ops/OpsAlertsView";

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
