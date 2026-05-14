import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import L, { type LayerGroup, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Spot, FamilyEvent } from "./App";

export type MapSelection =
  | { kind: "spot"; id: string }
  | { kind: "event"; id: string }
  | { kind: "event-group"; ids: string[]; lat: number; lon: number };

export type PlanMapItem =
  | { kind: "spot"; lat: number; lon: number; label: string; sublabel: string }
  | { kind: "event"; lat: number; lon: number; label: string; sublabel: string };

const DEFAULT_MAP_CENTER: [number, number] = [37.7749, -122.4194];
const DEFAULT_MAP_VIEW_STORAGE_KEY = "saturday.mapView";

// Touch screens need bigger tap targets — Apple HIG calls for 44 px and a
// 5-radius circle (10 px diameter) is unreachable. Bump radii on coarse
// pointer devices so phones get fingerable dots without making the desktop
// view feel cartoonish.
const isCoarsePointer =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
const SPOT_RADIUS = isCoarsePointer
  ? { default: 8, outdoor: 9, selected: 11 }
  : { default: 5, outdoor: 6, selected: 8 };
const EVENT_RADIUS = isCoarsePointer
  ? { default: 11, highlighted: 13, selected: 15 }
  : { default: 7, highlighted: 10, selected: 12 };

const SPOT_CAT_COLOR: Record<string, string> = {
  Outdoors: "#2d5043",
  Wellness: "#2d5043",
  Culture: "#5a7896",
  Food: "#e8b547",
  Shopping: "#b25368",
};

const EVENT_CAT_COLOR: Record<string, string> = {
  Library: "#5a7896",
  Museum: "#b25368",
  Park: "#2d5043",
  Festival: "#dd6a1a",
  Zoo: "#2d5043",
  Farm: "#2d5043",
  Community: "#e8b547",
};

function loadStoredMapView(
  storageKey = DEFAULT_MAP_VIEW_STORAGE_KEY,
): { lat: number; lon: number; zoom: number } | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lat === "number" &&
      typeof parsed?.lon === "number" &&
      typeof parsed?.zoom === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export type SpotMapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lon: number, zoom?: number) => void;
};

export const SpotMap = forwardRef<SpotMapHandle, {
  spots: Spot[];
  events?: FamilyEvent[];
  highlightedEventIds?: Set<string>;
  selected?: MapSelection | null;
  onSelect?: (sel: MapSelection) => void;
  userLocation?: { lat: number; lon: number } | null;
  geoState?: "idle" | "requesting" | "denied";
  onRequestLocation?: () => void;
  onViewChange?: (center: { lat: number; lon: number }) => void;
  defaultCenter?: [number, number];
  mapViewStorageKey?: string;
  ariaLabel?: string;
}>(function SpotMap({
  spots,
  events,
  highlightedEventIds,
  selected,
  onSelect,
  userLocation,
  geoState,
  onRequestLocation,
  onViewChange,
  defaultCenter = DEFAULT_MAP_CENTER,
  mapViewStorageKey = DEFAULT_MAP_VIEW_STORAGE_KEY,
  ariaLabel = "Map of spots and events",
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const userLayerRef = useRef<LayerGroup | null>(null);
  // `undefined` until the first userLocation effect runs. After that, holds
  // either null or the coords seen at mount, so subsequent updates know they
  // are user-initiated and should recenter.
  const seenInitialLocationRef = useRef<
    { lat: number; lon: number } | null | undefined
  >(undefined);
  // Stable ref so the map's moveend handler always calls the latest
  // onViewChange — without rebuilding the entire map effect when the parent
  // re-renders.
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  }, [onViewChange]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    flyTo: (lat: number, lon: number, zoom = 12) =>
      mapRef.current?.flyTo([lat, lon], zoom, { duration: 0.8 }),
  }));
  // Stable reference to the latest onSelect — re-binding avoids stale closures
  // without forcing the marker layer to rebuild every time the parent re-renders.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // Once the user has a stored view (or pans/zooms), the auto-fit step stops
  // overriding it. Without this, every data-set change would yank them back
  // to the all-points framing.
  const hasUserViewRef = useRef<boolean>(false);
  const initialFitDoneRef = useRef<boolean>(false);

  const plottedSpots = useMemo(
    () =>
      spots.filter(
        (spot) =>
          typeof spot.lat === "number" &&
          typeof spot.lon === "number" &&
          Number.isFinite(spot.lat) &&
          Number.isFinite(spot.lon),
      ),
    [spots],
  );
  const plottedEvents = useMemo(
    () =>
      (events ?? []).filter(
        (event) =>
          typeof event.lat === "number" &&
          typeof event.lon === "number" &&
          Number.isFinite(event.lat) &&
          Number.isFinite(event.lon),
      ),
    [events],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    let disposed = false;

    const stored = loadStoredMapView(mapViewStorageKey);
    const map = L.map(containerRef.current, {
      center: stored ? [stored.lat, stored.lon] : defaultCenter,
      zoom: stored ? stored.zoom : 10,
      scrollWheelZoom: true,
      attributionControl: false,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    const userLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    userLayerRef.current = userLayer;

    const handleMoveEnd = () => {
      const c = map.getCenter();
      try {
        window.localStorage.setItem(
          mapViewStorageKey,
          JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }),
        );
      } catch {
        // ignore quota / privacy errors
      }
      if (initialFitDoneRef.current) hasUserViewRef.current = true;
      onViewChangeRef.current?.({ lat: c.lat, lon: c.lng });
    };
    map.on("moveend", handleMoveEnd);
    // Fire once on mount so the consumer can re-rank from the initial view
    // without waiting for the user to pan.
    const initialFrame = requestAnimationFrame(() => {
      if (disposed || mapRef.current !== map) return;
      const c = map.getCenter();
      onViewChangeRef.current?.({ lat: c.lat, lon: c.lng });
    });

    // Leaflet captures container size at init. If the .map-shell parent finishes
    // laying out (flex stretch) after the map mounts, the canvas stays at the
    // initial small size unless we tell Leaflet to recompute. Invalidate once
    // on next frame and observe further resizes.
    const resizeFrame = requestAnimationFrame(() => {
      if (!disposed && mapRef.current === map) map.invalidateSize();
    });
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      map.off("moveend", handleMoveEnd);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      userLayerRef.current = null;
    };
  }, [defaultCenter, mapViewStorageKey]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = userLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const isFirstRun = seenInitialLocationRef.current === undefined;

    if (!userLocation) {
      if (isFirstRun) seenInitialLocationRef.current = null;
      return;
    }

    L.circleMarker([userLocation.lat, userLocation.lon], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 0.95,
    }).addTo(layer);
    L.circle([userLocation.lat, userLocation.lon], {
      radius: 90,
      color: "#2563eb",
      weight: 1,
      fillColor: "#2563eb",
      fillOpacity: 0.12,
    }).addTo(layer);

    if (isFirstRun) {
      // Returning visitor with a stored location: draw the marker but don't
      // yank their saved view.
      seenInitialLocationRef.current = userLocation;
      return;
    }

    // Any subsequent userLocation update is user-initiated (locate button),
    // so recenter and zoom in.
    map.setView([userLocation.lat, userLocation.lon], 13, { animate: true });
  }, [userLocation]);

  // Render markers. Re-runs on selection so the active pin gets restyled, but
  // never recenters/refits the map — that would yank a user who has panned.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const spot of plottedSpots) {
      const lat = spot.lat as number;
      const lon = spot.lon as number;
      const catColor = SPOT_CAT_COLOR[spot.category] ?? "#8a8278";
      const isOutdoor =
        spot.category === "Outdoors" || spot.category === "Wellness";
      const isSelected =
        selected?.kind === "spot" && selected.id === spot.id;
      L.circleMarker([lat, lon], {
        radius: isSelected
          ? SPOT_RADIUS.selected
          : isOutdoor
            ? SPOT_RADIUS.outdoor
            : SPOT_RADIUS.default,
        color: isSelected ? "#ffffff" : catColor,
        weight: isSelected ? 2 : 1,
        fillColor: catColor,
        fillOpacity: 0.8,
      })
        .on("click", () =>
          onSelectRef.current?.({ kind: "spot", id: spot.id }),
        )
        .addTo(layer);
    }

    // Group events by exact lat/lon (5-decimal precision ≈ 1 m). Locations
    // with multiple events render as one count-badge marker; tapping opens
    // a swipeable carousel of all events at that point ordered by time.
    const eventGroups = new Map<string, FamilyEvent[]>();
    for (const event of plottedEvents) {
      const key = `${event.lat.toFixed(5)},${event.lon.toFixed(5)}`;
      const bucket = eventGroups.get(key);
      if (bucket) bucket.push(event);
      else eventGroups.set(key, [event]);
    }

    for (const bucket of eventGroups.values()) {
      const lat = bucket[0].lat;
      const lon = bucket[0].lon;

      if (bucket.length === 1) {
        const event = bucket[0];
        const highlighted = highlightedEventIds?.has(event.id) ?? false;
        const isSelected =
          selected?.kind === "event" && selected.id === event.id;
        const fillColor = EVENT_CAT_COLOR[event.category] ?? (highlighted ? "#dd6a1a" : "#e8b547");
        L.circleMarker([lat, lon], {
          radius: isSelected
            ? EVENT_RADIUS.selected
            : highlighted
              ? EVENT_RADIUS.highlighted
              : EVENT_RADIUS.default,
          color: "#ffffff",
          weight: 2,
          fillColor,
          fillOpacity: 0.95,
        })
          .on("click", () =>
            onSelectRef.current?.({ kind: "event", id: event.id }),
          )
          .addTo(layer);
        continue;
      }

      // Multi-event location → count-badge marker.
      const ids = bucket.map((e) => e.id);
      const count = bucket.length;
      const libraryCount = bucket.filter(
        (e) => e.category === "Library",
      ).length;
      const highlightedCount = bucket.filter(
        (e) => highlightedEventIds?.has(e.id) ?? false,
      ).length;
      const tone =
        libraryCount >= count / 2
          ? "library"
          : highlightedCount >= count / 2
            ? "event-hot"
            : "event";
      const size = count >= 100 ? "lg" : count >= 25 ? "md" : "sm";
      const isSelected =
        selected?.kind === "event-group" &&
        selected.ids.length === ids.length &&
        selected.ids.every((id, i) => ids[i] === id);
      const icon = L.divIcon({
        html: `<div class="famhop-cluster-inner"><span>${count}</span></div>`,
        className: `famhop-cluster famhop-cluster-${tone} famhop-cluster-${size}${isSelected ? " is-selected" : ""}`,
        iconSize: L.point(40, 40),
      });
      L.marker([lat, lon], { icon })
        .on("click", () =>
          onSelectRef.current?.({ kind: "event-group", ids, lat, lon }),
        )
        .addTo(layer);
    }
  }, [plottedSpots, plottedEvents, highlightedEventIds, selected]);

  // Frame the map once when the underlying point set changes — but never on
  // selection alone, and never if the user already has a saved/manual view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hasUserViewRef.current) return;

    const points: Array<[number, number]> = [];
    for (const spot of plottedSpots) {
      points.push([spot.lat as number, spot.lon as number]);
    }
    for (const event of plottedEvents) {
      points.push([event.lat, event.lon]);
    }

    if (points.length === 0) {
      map.setView(defaultCenter, 9, { animate: false });
    } else if (points.length === 1) {
      map.setView(points[0], 13, { animate: false });
    } else {
      map.fitBounds(L.latLngBounds(points), {
        maxZoom: 13,
        padding: [28, 28],
        animate: false,
      });
    }
    requestAnimationFrame(() => { initialFitDoneRef.current = true; });
  }, [defaultCenter, plottedSpots, plottedEvents]);

  function handleLocateClick() {
    if (!onRequestLocation) return;
    onRequestLocation();
  }

  return (
    <div className="map-canvas-wrap">
      <div
        className="map-canvas map-canvas-fill"
        ref={containerRef}
        aria-label={ariaLabel}
      />
      {onRequestLocation && (
        <button
          type="button"
          className={`map-locate-button${userLocation ? " has-location" : ""}`}
          onClick={handleLocateClick}
          disabled={geoState === "requesting"}
          title={
            geoState === "denied"
              ? "Location blocked — enable in browser settings"
              : userLocation
                ? "Re-center on your location"
                : "Center map on your location"
          }
          aria-label={
            userLocation
              ? "Re-center map on your location"
              : "Center map on your location"
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </button>
      )}
    </div>
  );
});

export function PlanMap({
  stops,
  events,
  items,
  defaultCenter = DEFAULT_MAP_CENTER,
}: {
  stops: Spot[];
  events?: FamilyEvent[];
  items?: PlanMapItem[];
  defaultCenter?: [number, number];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  // Build a single ordered visit sequence. Callers may pass a pre-ordered
  // `items` array (drives by Plan.itemOrder); otherwise we fall back to
  // "stops in stopIds order, then events sorted by start time".
  const sequence = useMemo<PlanMapItem[]>(() => {
    if (items && items.length > 0) {
      return items.filter(
        (it) =>
          typeof it.lat === "number" &&
          typeof it.lon === "number" &&
          Number.isFinite(it.lat) &&
          Number.isFinite(it.lon),
      );
    }
    const fallback: PlanMapItem[] = [];
    for (const spot of stops) {
      if (
        typeof spot.lat === "number" &&
        typeof spot.lon === "number" &&
        Number.isFinite(spot.lat) &&
        Number.isFinite(spot.lon)
      ) {
        fallback.push({
          kind: "spot",
          lat: spot.lat,
          lon: spot.lon,
          label: spot.name,
          sublabel: `${spot.neighborhood} · ${spot.category}`,
        });
      }
    }
    const orderedEvents = (events ?? [])
      .filter(
        (e) =>
          typeof e.lat === "number" &&
          typeof e.lon === "number" &&
          Number.isFinite(e.lat) &&
          Number.isFinite(e.lon),
      )
      .sort((a, b) => {
        const aT = a.startDateTime
          ? new Date(a.startDateTime).getTime()
          : Infinity;
        const bT = b.startDateTime
          ? new Date(b.startDateTime).getTime()
          : Infinity;
        return aT - bT;
      });
    for (const event of orderedEvents) {
      const date = event.startDateTime ? new Date(event.startDateTime) : null;
      const when = date
        ? date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : event.timeWindow;
      fallback.push({
        kind: "event",
        lat: event.lat,
        lon: event.lon,
        label: event.title,
        sublabel: `${when} · ${event.venue}`,
      });
    }
    return fallback;
  }, [stops, events, items]);
  const hasSequence = sequence.length > 0;

  useEffect(() => {
    if (!hasSequence || !containerRef.current || mapRef.current) return;
    let disposed = false;
    const map = L.map(containerRef.current, {
      center: defaultCenter,
      zoom: 11,
      scrollWheelZoom: false,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    // When the user navigates back from PollView, the plan-detail layout may
    // not be measured yet at mount time, so Leaflet caches a 0×0 canvas and
    // the map renders blank. Invalidate on next frame and observe further
    // resizes so the canvas stays in sync with the container.
    const resizeFrame = requestAnimationFrame(() => {
      if (!disposed && mapRef.current === map) map.invalidateSize();
    });
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);
    return () => {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [defaultCenter, hasSequence]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    // Re-running for new data is also a good time to nudge Leaflet — covers
    // the case where the parent container was 0×0 at mount (e.g. when the
    // plan detail re-renders after coming back from /p/<pollId>).
    requestAnimationFrame(() => {
      if (mapRef.current === map) map.invalidateSize();
    });
    if (sequence.length === 0) {
      map.setView(defaultCenter, 10, { animate: false });
      return;
    }
    const points: Array<[number, number]> = [];
    sequence.forEach((item, idx) => {
      points.push([item.lat, item.lon]);
      const icon = L.divIcon({
        className: `plan-pin plan-pin-${item.kind}`,
        html: `<span>${idx + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([item.lat, item.lon], { icon })
        .bindPopup(
          `<strong>${idx + 1}. ${item.label}</strong><br/>${item.sublabel}`,
        )
        .addTo(layer);
    });
    if (points.length > 1) {
      L.polyline(points, {
        color: "#276749",
        weight: 3,
        opacity: 0.65,
        dashArray: "6 8",
      }).addTo(layer);
    }
    if (points.length === 1) {
      map.setView(points[0], 14, { animate: false });
    } else {
      map.fitBounds(L.latLngBounds(points), {
        maxZoom: 14,
        padding: [40, 40],
        animate: false,
      });
    }
  }, [defaultCenter, sequence]);

  if (!hasSequence) return null;

  return (
    <div
      className="plan-map"
      role="img"
      aria-label="Map of plan stops and events in visit order"
      ref={containerRef}
    />
  );
}
