import { describe, expect, it } from "vitest";
import {
  resolvePopularEvents,
  type PopularEventsDataset,
} from "../src/popularEvents";

// Weekend of Sat Aug 15 / Sun Aug 16 2026 (local time).
const SAT = new Date("2026-08-15T12:00:00");
const SUN = new Date("2026-08-16T12:00:00");
const NOW = new Date("2026-08-14T09:00:00");

const ev = (id: string, start: string) => ({ id, startDateTime: start });

function dataset(picks: PopularEventsDataset["picks"]): PopularEventsDataset {
  return {
    schemaVersion: 1,
    metroId: "bay-area",
    audience: "kids",
    weekendStart: "2026-08-15",
    weekendEnd: "2026-08-16",
    picks,
  };
}

const EVENT_POOL = [
  ev("a", "2026-08-15T10:00:00-07:00"),
  ev("b", "2026-08-15T14:00:00-07:00"),
  ev("c", "2026-08-16T11:00:00-07:00"),
  ev("d", "2026-08-14T18:00:00-07:00"), // Friday — outside the window
];

describe("resolvePopularEvents", () => {
  it("returns [] for null/empty dataset", () => {
    expect(resolvePopularEvents({ dataset: null, events: EVENT_POOL, sat: SAT, sun: SUN })).toEqual([]);
    expect(resolvePopularEvents({ dataset: undefined, events: EVENT_POOL, sat: SAT, sun: SUN })).toEqual([]);
    expect(
      resolvePopularEvents({ dataset: dataset([]), events: EVENT_POOL, sat: SAT, sun: SUN }),
    ).toEqual([]);
  });

  it("returns [] when the dataset names a different weekend", () => {
    const stale = { ...dataset([{ eventId: "a", rank: 1 }]), weekendStart: "2026-08-08" };
    expect(resolvePopularEvents({ dataset: stale, events: EVENT_POOL, sat: SAT, sun: SUN })).toEqual([]);
  });

  it("returns picks in rank order, not file order", () => {
    const out = resolvePopularEvents({
      dataset: dataset([
        { eventId: "c", rank: 1 },
        { eventId: "a", rank: 2 },
        { eventId: "b", rank: 3 },
      ]),
      events: EVENT_POOL,
      sat: SAT,
      sun: SUN,
          now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts a missing/invalid rank last, stably", () => {
    const out = resolvePopularEvents({
      dataset: dataset([
        { eventId: "a", rank: 2 },
        { eventId: "c", rank: Number.NaN },
        { eventId: "b", rank: 1 },
      ]),
      events: EVENT_POOL,
      sat: SAT,
      sun: SUN,
          now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("excludes events from a past day (same-day grace window keeps Sunday's)", () => {
    const out = resolvePopularEvents({
      dataset: dataset([
        { eventId: "a", rank: 1 },
        { eventId: "c", rank: 2 },
      ]),
      events: EVENT_POOL,
      sat: SAT,
      sun: SUN,
      now: new Date("2026-08-16T12:00:00"),
    });
    expect(out.map((e) => e.id)).toEqual(["c"]);
  });

  it("skips unknown event ids", () => {
    const out = resolvePopularEvents({
      dataset: dataset([
        { eventId: "ghost", rank: 1 },
        { eventId: "a", rank: 2 },
      ]),
      events: EVENT_POOL,
      sat: SAT,
      sun: SUN,
          now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("includes Sunday events and excludes ones outside the window", () => {
    const out = resolvePopularEvents({
      dataset: dataset([
        { eventId: "d", rank: 1 },
        { eventId: "c", rank: 2 },
      ]),
      events: EVENT_POOL,
      sat: SAT,
      sun: SUN,
          now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["c"]);
  });

  it("dedupes repeated event ids, keeping the best rank", () => {
    const out = resolvePopularEvents({
      dataset: dataset([
        { eventId: "a", rank: 1 },
        { eventId: "a", rank: 2 },
        { eventId: "b", rank: 3 },
      ]),
      events: EVENT_POOL,
      sat: SAT,
      sun: SUN,
          now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("skips events with no startDateTime", () => {
    const noStart = [{ id: "x" }, ...EVENT_POOL];
    const out = resolvePopularEvents({
      dataset: dataset([{ eventId: "x", rank: 1 }]),
      events: noStart,
      sat: SAT,
      sun: SUN,
    });
    expect(out).toEqual([]);
  });

  it("resolves a pick whose id hash drifted via the slug stem", () => {
    // The feed id hash includes startDateTime, so a date edit rotates it and
    // the weekly file goes stale by id while naming the same event.
    const drifted = [
      { id: "zoo-miami-wild-fork-festival-8faec97dc1", startDateTime: "2026-08-15T10:00:00-07:00" },
      ...EVENT_POOL,
    ];
    const out = resolvePopularEvents({
      dataset: dataset([{ eventId: "zoo-miami-wild-fork-festival-10ec77b65e", rank: 1 }]),
      events: drifted,
      sat: SAT,
      sun: SUN,
      now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["zoo-miami-wild-fork-festival-8faec97dc1"]);
  });

  it("prefers the exact id over a stem match", () => {
    const both = [
      { id: "show-aaaaaaaaaa", startDateTime: "2026-08-16T20:00:00-07:00" },
      { id: "show-bbbbbbbbbb", startDateTime: "2026-08-15T20:00:00-07:00" },
    ];
    const out = resolvePopularEvents({
      dataset: dataset([{ eventId: "show-aaaaaaaaaa", rank: 1 }]),
      events: both,
      sat: SAT,
      sun: SUN,
      now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["show-aaaaaaaaaa"]);
  });

  it("picks the earliest in-window session when several share a stem", () => {
    const sessions = [
      { id: "storytime-cccccccccc", startDateTime: "2026-08-16T15:00:00-07:00" },
      { id: "storytime-dddddddddd", startDateTime: "2026-08-15T09:00:00-07:00" },
    ];
    const out = resolvePopularEvents({
      dataset: dataset([{ eventId: "storytime-eeeeeeeeee", rank: 1 }]),
      events: sessions,
      sat: SAT,
      sun: SUN,
      now: NOW,
    });
    expect(out.map((e) => e.id)).toEqual(["storytime-dddddddddd"]);
  });

  it("skips a stem sibling from a past day instead of losing the pick", () => {
    // Saturday's session is gone by Sunday noon; the pick must fall through to
    // Sunday's session rather than be consumed by the stale match.
    const sessions = [
      { id: "encore-aaaaaaaaaa", startDateTime: "2026-08-15T09:00:00-07:00" },
      { id: "encore-bbbbbbbbbb", startDateTime: "2026-08-16T15:00:00-07:00" },
    ];
    const out = resolvePopularEvents({
      dataset: dataset([{ eventId: "encore-cccccccccc", rank: 1 }]),
      events: sessions,
      sat: SAT,
      sun: SUN,
      now: new Date("2026-08-16T12:00:00"),
    });
    expect(out.map((e) => e.id)).toEqual(["encore-bbbbbbbbbb"]);
  });

  it("still drops a stem match outside the weekend window", () => {
    const friday = [{ id: "late-night-ffffffffff", startDateTime: "2026-08-14T18:00:00-07:00" }];
    const out = resolvePopularEvents({
      dataset: dataset([{ eventId: "late-night-0000000000", rank: 1 }]),
      events: friday,
      sat: SAT,
      sun: SUN,
      now: NOW,
    });
    expect(out).toEqual([]);
  });
});
