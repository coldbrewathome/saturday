import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupZipLocation,
  normalizeZip,
  zipLocationFrom,
} from "../src/zipCentroids";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeZip", () => {
  it("accepts a 5-digit ZIP and a ZIP+4, and nothing else", () => {
    expect(normalizeZip("94110")).toBe("94110");
    expect(normalizeZip(" 94110-1234 ")).toBe("94110");
    expect(normalizeZip("9411")).toBeNull();
    expect(normalizeZip("")).toBeNull();
    expect(normalizeZip(null)).toBeNull();
    expect(normalizeZip("SW1A 1AA")).toBeNull();
  });
});

describe("zipLocationFrom", () => {
  const doc = { zips: { "94110": [37.75, -122.4152] as [number, number] } };

  it("reads a centroid, and misses cleanly", () => {
    expect(zipLocationFrom(doc, "94110")).toEqual({ lat: 37.75, lon: -122.4152 });
    expect(zipLocationFrom(doc, "10001")).toBeNull();
    expect(zipLocationFrom(null, "94110")).toBeNull();
    expect(zipLocationFrom({ zips: { "94110": [1] as never } }, "94110")).toBeNull();
  });
});

describe("lookupZipLocation", () => {
  it("fetches the metro table once and resolves the ZIP", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ zips: { "94110": [37.75, -122.4152] } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupZipLocation("94110-1234", "https://data.example/bay-area.json")).toEqual({
      lat: 37.75,
      lon: -122.4152,
    });
    // Second lookup hits the module cache, not the network.
    await lookupZipLocation("94110", "https://data.example/bay-area.json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for a ZIP outside the metro's table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ zips: { "94110": [37.75, -122.4152] } }),
      })),
    );
    expect(await lookupZipLocation("10001", "https://data.example/seattle.json")).toBeNull();
  });

  it("survives a failed fetch and never asks for a malformed ZIP", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupZipLocation("94110", "https://data.example/austin.json")).toBeNull();
    expect(await lookupZipLocation("n/a", "https://data.example/austin.json")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
