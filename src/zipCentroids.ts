// ZIP → approximate location, so the profile's ZIP personalizes proximity
// ranking even when the browser has no location permission. The table is the
// metro's slice of the Census 2020 ZCTA gazetteer (internal points), written
// by scripts/build-zip-centroids.mjs; it ships with the feed on famhop-data.
// A ZIP outside the metro's table resolves to null — never to another city.

export type ZipLocation = { lat: number; lon: number };

type ZipCentroidDoc = {
  zips?: Record<string, [number, number]>;
};

/** Five digits, accepting the ZIP+4 form the wizard's input may carry. */
export function normalizeZip(value: string | null | undefined): string | null {
  const match = /^(\d{5})(?:-\d{4})?$/.exec(String(value ?? "").trim());
  return match ? match[1] : null;
}

export function zipLocationFrom(
  doc: ZipCentroidDoc | null | undefined,
  zip: string,
): ZipLocation | null {
  const point = doc?.zips?.[zip];
  if (!Array.isArray(point) || point.length !== 2) return null;
  const [lat, lon] = point;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

// One fetch per URL per session: the profile can re-render often, the table
// never changes mid-session.
const tables = new Map<string, Promise<ZipCentroidDoc | null>>();

function loadTable(url: string): Promise<ZipCentroidDoc | null> {
  const cached = tables.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((response) => (response.ok ? (response.json() as Promise<ZipCentroidDoc>) : null))
    .catch(() => null);
  tables.set(url, pending);
  return pending;
}

/** Resolve a ZIP against the metro's centroid table, or null when unknown. */
export async function lookupZipLocation(
  zip: string | null | undefined,
  url: string,
): Promise<ZipLocation | null> {
  const normalized = normalizeZip(zip);
  if (!normalized) return null;
  return zipLocationFrom(await loadTable(url), normalized);
}
