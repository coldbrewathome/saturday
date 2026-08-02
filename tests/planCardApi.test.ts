// Tests for the plan card API client (src/planCardApi.ts): create + fetch a
// plan card snapshot, and the 404 error path.
import { afterEach, describe, expect, it, vi } from "vitest";

type PlanCardModule = typeof import("../src/planCardApi");

async function importPlanCardApi(): Promise<PlanCardModule> {
  vi.resetModules();
  vi.stubEnv("VITE_POLLS_API", "https://api.test");
  return import("../src/planCardApi");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const stops = [
  {
    id: "spot-1",
    name: "Golden Gate Park",
    neighborhood: "Richmond",
    category: "Outdoors",
    imageUrl: "https://images.unsplash.com/photo-1?w=1200",
  },
  {
    id: "spot-2",
    name: "Exploratorium",
    neighborhood: "Embarcadero",
    category: "Museum",
    imageUrl: undefined,
  },
];

describe("createPlanCard", () => {
  it("POSTs the card payload and returns the cardId", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 201,
        json: async () => ({ cardId: "abc12345" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = await importPlanCardApi();
    const result = await api.createPlanCard({
      title: "Saturday out",
      metroId: "bay-area",
      stops,
    });

    expect(result).toEqual({ cardId: "abc12345" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/plancards");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.title).toBe("Saturday out");
    expect(body.metroId).toBe("bay-area");
    expect(body.stops).toHaveLength(2);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 429 } as Response));
    const api = await importPlanCardApi();
    await expect(
      api.createPlanCard({ title: "T", metroId: "bay-area", stops }),
    ).rejects.toThrow("Create plan card failed (429)");
  });
});

describe("getPlanCard", () => {
  it("returns the stored record", async () => {
    const record = {
      cardId: "abc12345",
      metroId: "bay-area",
      title: "Saturday out",
      stops,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", async () => {
      return { ok: true, status: 200, json: async () => record } as Response;
    });

    const api = await importPlanCardApi();
    await expect(api.getPlanCard("abc12345")).resolves.toEqual(record);
  });

  it("throws PlanCardFetchError with the 404 status", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 } as Response));
    const api = await importPlanCardApi();
    await expect(api.getPlanCard("missing")).rejects.toMatchObject({ status: 404 });
  });
});
