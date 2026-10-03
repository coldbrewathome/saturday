// Weekend forecast (open-meteo), KV-cached for an hour. Extracted from the
// /weather route so the Thursday digest can ask for the same data in-process
// — the cache key is shared, so a digest run and a page load never double-fetch.

export type WeatherDay = {
  date: string;
  weatherCode: number;
  label: string;
  tempMaxF: number;
  tempMinF: number;
  precipChance: number;
};

export type WeekendWeather = {
  saturday: WeatherDay | null;
  sunday: WeatherDay | null;
  fetchedAt: string;
};

// Narrow structural view of the KV binding so tests can pass a plain object.
export type WeatherKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type FetchLike = typeof fetch;

export function weatherCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Mostly sunny";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzly";
  if (code >= 61 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 86) return "Snowy";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Stormy";
  return "Mixed";
}

function cacheKey(lat: number, lon: number): string {
  const round = (n: number) => Math.round(n * 100) / 100;
  return `weather:${round(lat)},${round(lon)}`;
}

// Returns null when the upstream lookup fails or the payload is unexpected —
// callers decide whether that is a 502 (the route) or a forecast-less digest.
export async function fetchWeekendWeather(
  kv: WeatherKv,
  lat: number,
  lon: number,
  fetchImpl: FetchLike = fetch,
): Promise<{ weather: WeekendWeather; cached: boolean } | null> {
  const key = cacheKey(lat, lon);
  const cached = await kv.get(key);
  if (cached) {
    try {
      return { weather: JSON.parse(cached) as WeekendWeather, cached: true };
    } catch {
      // fall through to a fresh fetch on a corrupt cache entry
    }
  }

  const apiUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=10&temperature_unit=fahrenheit`;
  let response: Response;
  try {
    response = await fetchImpl(apiUrl, { headers: { "User-Agent": "famhop/0.1" } });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const data = (await response.json()) as {
    daily?: {
      time?: string[];
      weathercode?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const daily = data.daily;
  if (!daily || !Array.isArray(daily.time)) return null;

  let saturday: WeatherDay | null = null;
  let sunday: WeatherDay | null = null;
  for (let i = 0; i < daily.time.length; i += 1) {
    const date = new Date(`${daily.time[i]}T12:00:00`);
    const dow = date.getDay();
    const code = daily.weathercode?.[i] ?? -1;
    const entry: WeatherDay = {
      date: daily.time[i],
      weatherCode: code,
      label: weatherCodeLabel(code),
      tempMaxF: Math.round(daily.temperature_2m_max?.[i] ?? 0),
      tempMinF: Math.round(daily.temperature_2m_min?.[i] ?? 0),
      precipChance: daily.precipitation_probability_max?.[i] ?? 0,
    };
    if (dow === 6 && !saturday) saturday = entry;
    if (dow === 0 && !sunday) sunday = entry;
    if (saturday && sunday) break;
  }

  const weather: WeekendWeather = {
    saturday,
    sunday,
    fetchedAt: new Date().toISOString(),
  };
  await kv.put(key, JSON.stringify(weather), { expirationTtl: 60 * 60 });
  return { weather, cached: false };
}
