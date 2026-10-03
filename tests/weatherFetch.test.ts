import { describe, expect, it } from "vitest";
import { fetchWeekendWeather, type WeatherKv } from "../worker/src/weather";

function makeKv(seed: Record<string, string> = {}): WeatherKv & { puts: string[] } {
  const store = { ...seed };
  const puts: string[] = [];
  return {
    puts,
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      puts.push(key);
      store[key] = value;
    },
  };
}

const upstream = (precipSat: number) =>
  new Response(
    JSON.stringify({
      daily: {
        time: ["2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24"],
        weathercode: [3, 3, precipSat >= 40 ? 61 : 0, 1],
        temperature_2m_max: [70, 70, 66, 75],
        temperature_2m_min: [55, 55, 54, 56],
        precipitation_probability_max: [10, 20, precipSat, 5],
      },
    }),
    { status: 200 },
  );

describe("fetchWeekendWeather", () => {
  it("picks Saturday and Sunday out of the daily list and caches them", async () => {
    const kv = makeKv();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return upstream(80);
    }) as typeof fetch;

    const first = await fetchWeekendWeather(kv, 33.749, -84.388, fetchImpl);
    expect(first?.cached).toBe(false);
    expect(first?.weather.saturday?.date).toBe("2026-05-23");
    expect(first?.weather.saturday?.precipChance).toBe(80);
    expect(first?.weather.sunday?.date).toBe("2026-05-24");
    expect(kv.puts).toEqual(["weather:33.75,-84.39"]);

    // Second call inside the TTL is served from KV, not the network.
    const second = await fetchWeekendWeather(kv, 33.749, -84.388, fetchImpl);
    expect(second?.cached).toBe(true);
    expect(second?.weather.saturday?.precipChance).toBe(80);
    expect(calls).toBe(1);
  });

  it("returns null on an upstream failure or an unexpected payload", async () => {
    const kv = makeKv();
    const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    expect(await fetchWeekendWeather(kv, 25.76, -80.19, failing)).toBeNull();

    const malformed = (async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 })) as typeof fetch;
    expect(await fetchWeekendWeather(kv, 25.76, -80.19, malformed)).toBeNull();
  });
});
