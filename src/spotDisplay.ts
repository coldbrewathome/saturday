// Spot display helpers (images, hours, open/closed status), extracted from
// App.tsx (2026-08). Pure functions — no app state.
import type { Category, Spot, WeekSchedule } from "./types";

const unsplash = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

export const categoryImagePool: Record<Category, string[]> = {
  Food: [
    "1495474472287-4d71bcdd2085",
    "1555396273-367ea4eb4db5",
    "1517248135467-4c7edcad34c4",
    "1481833761820-0509d3217039",
    "1414235077428-338989a2e8c0",
    "1424847651672-bf20a4b0982b",
    "1610890716171-6b1bb98ffd09",
    "1504674900247-0877df9cc836",
    "1565299624946-b28f40a0ae38",
    "1559339352-11d035aa65de",
  ].map(unsplash),
  Outdoors: [
    "1500530855697-b586d89ba3ee",
    "1469474968028-56623f02e42e",
    "1501785888041-af3ef285b470",
    "1502082553048-f009c37129b9",
    "1464822759023-fed622ff2c3b",
    "1473773508845-188df298d2d1",
    "1441974231531-c6227db76b6e",
    "1506905925346-21bda4d32df4",
    "1418065460487-3e41a6c84dc5",
  ].map(unsplash),
  Culture: [
    "1518998053901-5348d3961a04",
    "1554907984-15263bfd63bd",
    "1564399579883-451a5d44ec08",
    "1583847268964-b28dc8f51f92",
    "1485738422979-f5c462d49f74",
    "1503095396549-807759245b35",
  ].map(unsplash),
  Wellness: [
    "1626224583764-f87db24ac4ea",
    "1518611012118-696072aa579a",
    "1571902943202-507ec2618e8f",
    "1599901860904-17e6ed7083a0",
    "1545205597-3d9d02c29597",
    "1571388208497-71bedc66e932",
    "1506629082955-511b1aa562c8",
    "1518609878373-06d740f60d8b",
  ].map(unsplash),
  Shopping: [
    "1441986300917-64674bd600d8",
    "1481437156560-3205f6a55735",
    "1555529669-e69e7aa0ba9a",
    "1567401893414-76b7b1e5a7a5",
    "1549298916-b41d501d3772",
    "1483985988355-763728e1935b",
    "1472851294608-062f824d29cc",
    "1555529771-7888783a18d3",
  ].map(unsplash),
  Nightlife: [
    "1514525253161-7a46d19cd819",
    "1566737236500-c8ac43014a67",
    "1470225620780-dba8ba36b745",
    "1516450360452-9258136e8735",
    "1574391884720-bbc3740c59d1",
    "1543007631-283050bb3e8c",
    "1571204829887-3b8d69e4094d",
    "1508997449629-303059a039c0",
  ].map(unsplash),
};

export function pickCategoryImage(category: Category, key: string): string {
  const pool = categoryImagePool[category];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

export const DAY_KEYS: Array<keyof WeekSchedule> = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatRatingCount(count: number): string {
  if (count >= 1000) {
    const k = count / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(count);
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// "9:30 AM" → "9:30am", "9:00 AM" → "9am", "12:00 PM" → "noon"
export function normalizeClock(token: string): string {
  const m = token.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return token.trim();
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3].toLowerCase();
  if (hour === 12 && minute === 0) return ampm === "pm" ? "noon" : "midnight";
  const h = hour % 12 === 0 ? 12 : hour;
  return minute === 0 ? `${h}${ampm}` : `${h}:${m[2]}${ampm}`;
}

export function normalizeHourSpan(span: string): string {
  // Some venues post split sessions ("11:30 AM – 2:30 PM, 4:30 – 8:00 PM").
  // Normalize each range independently, then rejoin.
  return span
    .split(/\s*,\s*/)
    .map((segment) => {
      const parts = segment.split(/\s*[–-]\s*| to /);
      if (parts.length !== 2) return segment.trim();
      return `${normalizeClock(parts[0])}–${normalizeClock(parts[1])}`;
    })
    .join(", ");
}

// "Monday: 9:30 AM – 6:00 PM; Tuesday: ... ; Sunday: ..." → "Daily 9:30am–6pm"
// or "Mon–Fri 9am–5pm · Sat–Sun 10am–4pm". Returns null if input doesn't look
// like the verbose Google weekdayDescriptions format.
export function compactHoursLabel(raw: string): string | null {
  if (!raw || !raw.includes(":") || !raw.includes(";")) return null;
  const segments = raw.split(/\s*;\s*/);
  if (segments.length !== 7) return null;
  const byDay = new Array<string>(7).fill("");
  for (const segment of segments) {
    const sep = segment.indexOf(":");
    if (sep < 0) return null;
    const day = segment.slice(0, sep).trim().toLowerCase();
    const hours = segment.slice(sep + 1).trim();
    const idx = DAY_INDEX[day];
    if (idx === undefined || !hours) return null;
    byDay[idx] = /closed/i.test(hours) ? "Closed" : normalizeHourSpan(hours);
  }
  // Reorder Mon–Sun for natural reading.
  const ordered = [1, 2, 3, 4, 5, 6, 0].map((i) => ({
    day: SHORT_DAYS[i],
    hours: byDay[i],
  }));
  // Group consecutive days with identical hours.
  const groups: Array<{ start: string; end: string; hours: string; span: number }> = [];
  for (const entry of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.hours === entry.hours) {
      last.end = entry.day;
      last.span += 1;
    } else {
      groups.push({ start: entry.day, end: entry.day, hours: entry.hours, span: 1 });
    }
  }
  if (groups.length === 1 && groups[0].span === 7) {
    return `Daily ${groups[0].hours}`;
  }
  return groups
    .map((g) => {
      const range = g.start === g.end ? g.start : `${g.start}–${g.end}`;
      return `${range} ${g.hours}`;
    })
    .join(" · ");
}

export function formatMinutes(mins: number): string {
  const total = mins % 1440;
  if (total === 0) return "midnight";
  if (total === 720) return "noon";
  let h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h}${suffix}` : `${h}:${String(m).padStart(2, "0")}${suffix}`;
}

export type OpenStatus =
  | { kind: "open"; closesAt: number; nextDayIdx?: number }
  | { kind: "closed"; nextOpenAt?: number; nextOpenDayIdx?: number }
  | { kind: "always" }
  | { kind: "unknown" };

export function describeStatus(spot: Spot, now: Date = new Date()): OpenStatus {
  const schedule = spot.schedule;
  if (!schedule) return { kind: "unknown" };
  if (schedule.is247) return { kind: "always" };

  const days = schedule.days;
  const dayIdx = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const todayKey = DAY_KEYS[dayIdx];
  const todaySlots = days[todayKey];

  for (const slot of todaySlots) {
    if (minutes >= slot.open && minutes < slot.close) {
      return { kind: "open", closesAt: slot.close };
    }
  }

  // Find next opening within the next 7 days.
  for (let offset = 0; offset < 7; offset += 1) {
    const lookIdx = (dayIdx + offset) % 7;
    const slots = days[DAY_KEYS[lookIdx]];
    for (const slot of slots) {
      if (offset === 0 && slot.open <= minutes) continue;
      return { kind: "closed", nextOpenAt: slot.open, nextOpenDayIdx: lookIdx };
    }
  }
  return { kind: "closed" };
}

export function statusLabel(status: OpenStatus, now: Date = new Date()): string {
  if (status.kind === "always") return "Open 24/7";
  if (status.kind === "open") {
    return `Open · until ${formatMinutes(status.closesAt)}`;
  }
  if (status.kind === "closed") {
    if (status.nextOpenAt === undefined || status.nextOpenDayIdx === undefined) {
      return "Closed";
    }
    const sameDay = status.nextOpenDayIdx === now.getDay();
    const dayLabel = sameDay ? "" : ` ${DAY_NAMES[status.nextOpenDayIdx]}`;
    return `Closed · opens ${formatMinutes(status.nextOpenAt)}${dayLabel}`;
  }
  return "Hours unknown";
}
