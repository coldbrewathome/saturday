// Weekly digest template. Produces { subject, html, text } for one metro's
// Saturday + Sunday window from the same JSON shapes used by the React app
// (public/data/{metro}/featured-plans.json and events.json). Pure — no I/O.
// The send pipeline in worker/src/newsletter.ts fetches the JSON over HTTPS
// and passes it here; tests can pass fixtures directly.

export type DigestPlan = {
  id: string;
  name: string;
  summary?: string;
  city?: string;
  eventIds?: string[];
};

export type DigestEvent = {
  id: string;
  baseId?: string | null;
  title: string;
  venue?: string;
  city?: string;
  neighborhood?: string;
  category?: string;
  cost?: string;
  url?: string;
  startDateTime?: string;
};

export type DigestInput = {
  metroId: string;
  metroLabel: string;
  timezone: string;
  plans: DigestPlan[];
  events: DigestEvent[];
  now?: Date;
  // Site base used for plan deep-links; defaults to https://famhop.com.
  siteBaseUrl?: string;
  // Per-recipient unsubscribe link (built by the send pipeline). When set,
  // the footer renders a one-click unsubscribe link in both HTML and text.
  unsubscribeUrl?: string;
};

export type DigestOutput = {
  subject: string;
  html: string;
  text: string;
  // Exposed so the send pipeline can short-circuit on empty metros.
  planCount: number;
  eventCount: number;
};

const MAX_PLANS = 3;
const MAX_EVENTS = 5;
const DEFAULT_SITE = "https://famhop.com";

export function renderWeekendDigest(input: DigestInput): DigestOutput {
  const now = input.now ?? new Date();
  const siteBase = (input.siteBaseUrl || DEFAULT_SITE).replace(/\/$/, "");
  const weekend = getWeekendWindow(now, input.timezone);

  const plans = pickTopPlans(input.plans, MAX_PLANS);
  const events = pickTopEvents(input.events, weekend, MAX_EVENTS);

  const subject = `${input.metroLabel} weekend: ${weekend.label}`;
  const html = renderHtml({
    metroId: input.metroId,
    metroLabel: input.metroLabel,
    weekend,
    plans,
    events,
    siteBase,
    unsubscribeUrl: input.unsubscribeUrl,
  });
  const text = renderText({
    metroId: input.metroId,
    metroLabel: input.metroLabel,
    weekend,
    plans,
    events,
    siteBase,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  return {
    subject,
    html,
    text,
    planCount: plans.length,
    eventCount: events.length,
  };
}

// ── Selection ──────────────────────────────────────────────────────────

function pickTopPlans(plans: DigestPlan[], limit: number): DigestPlan[] {
  if (!Array.isArray(plans)) return [];
  // Prefer plans that include real events this weekend — those are the
  // freshest pick. Generated "day out in {city}" plans go after.
  const withEvents = plans.filter(
    (p) => Array.isArray(p.eventIds) && p.eventIds.length > 0,
  );
  const rest = plans.filter(
    (p) => !Array.isArray(p.eventIds) || p.eventIds.length === 0,
  );
  return [...withEvents, ...rest].slice(0, limit);
}

function pickTopEvents(
  events: DigestEvent[],
  weekend: WeekendWindow,
  limit: number,
): DigestEvent[] {
  if (!Array.isArray(events)) return [];
  const inWindow = events.filter((event) => {
    if (!event.startDateTime) return false;
    const key = zonedDateKey(new Date(event.startDateTime), weekend.timezone);
    return key === weekend.saturdayKey || key === weekend.sundayKey;
  });

  // Dedupe recurring series by baseId so "Yoga at the museum × 6 weeks"
  // doesn't fill the whole list.
  const seen = new Set<string>();
  const unique: DigestEvent[] = [];
  for (const event of inWindow) {
    const key = (event.baseId && String(event.baseId)) || event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }

  unique.sort((a, b) => {
    const aT = Date.parse(a.startDateTime || "") || 0;
    const bT = Date.parse(b.startDateTime || "") || 0;
    return aT - bT;
  });

  return unique.slice(0, limit);
}

// ── Date helpers (mirrors scripts/generate-seo-pages.mjs) ──────────────

type WeekendWindow = {
  saturdayKey: string;
  sundayKey: string;
  label: string;
  timezone: string;
};

function getWeekendWindow(now: Date, timezone: string): WeekendWindow {
  const today = zonedDateParts(now, timezone);
  const dow = weekdayNumber(today.weekday);
  const daysToSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
  const sat = addDaysToYmd(today, daysToSat);
  const sun = addDaysToYmd(sat, 1);
  return {
    saturdayKey: ymdKey(sat),
    sundayKey: ymdKey(sun),
    label: formatWeekendLabel(sat, sun),
    timezone,
  };
}

function zonedDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedDateParts(date, timeZone);
  return ymdKey(p);
}

function weekdayNumber(shortName: string): number {
  const n = String(shortName || "").slice(0, 3).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(n);
}

function addDaysToYmd(
  ymd: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function ymdKey(ymd: { year: number; month: number; day: number }): string {
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatWeekendLabel(
  sat: { year: number; month: number; day: number },
  sun: { year: number; month: number; day: number },
): string {
  if (sat.month === sun.month) {
    return `${MONTHS[sat.month - 1]} ${sat.day}–${sun.day}`;
  }
  return `${MONTHS[sat.month - 1]} ${sat.day} – ${MONTHS[sun.month - 1]} ${sun.day}`;
}

function formatEventTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";
  const weekday = get("weekday");
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  if (!weekday || !hour) return "";
  const time =
    minute && minute !== "00"
      ? `${hour}:${minute}${dayPeriod ? ` ${dayPeriod}` : ""}`
      : `${hour}${dayPeriod ? ` ${dayPeriod}` : ""}`;
  return `${weekday} ${time}`;
}

// ── Rendering ──────────────────────────────────────────────────────────

type RenderContext = {
  metroId: string;
  metroLabel: string;
  weekend: WeekendWindow;
  plans: DigestPlan[];
  events: DigestEvent[];
  siteBase: string;
  unsubscribeUrl?: string;
};

function renderHtml(ctx: RenderContext): string {
  const planLinks = ctx.plans.length
    ? `<ol style="padding-left:20px;margin:0 0 24px;">${ctx.plans
        .map((plan) => {
          const url = `${ctx.siteBase}/${ctx.metroId}/weekend#${encodeURIComponent(plan.id)}`;
          const summary = plan.summary
            ? `<div style="color:#555;font-size:14px;margin-top:4px;">${esc(plan.summary)}</div>`
            : "";
          const city = plan.city
            ? `<span style="color:#888;font-size:13px;">${esc(plan.city)} · </span>`
            : "";
          return `<li style="margin-bottom:14px;"><a href="${esc(url)}" style="color:#0a4d8c;text-decoration:none;font-weight:600;">${esc(plan.name)}</a><br/>${city}${summary}</li>`;
        })
        .join("")}</ol>`
    : `<p style="color:#666;margin:0 0 24px;">No featured plans yet for this weekend. <a href="${esc(ctx.siteBase)}/${ctx.metroId}" style="color:#0a4d8c;">Browse ${esc(ctx.metroLabel)} on FamHop &rarr;</a></p>`;

  const eventLinks = ctx.events.length
    ? `<ul style="padding-left:20px;margin:0 0 24px;">${ctx.events
        .map((event) => {
          const time = event.startDateTime
            ? formatEventTime(event.startDateTime, ctx.weekend.timezone)
            : "";
          const meta = [time, event.venue, event.city].filter(Boolean).join(" · ");
          const title = event.url
            ? `<a href="${esc(event.url)}" style="color:#0a4d8c;text-decoration:none;font-weight:600;">${esc(event.title)}</a>`
            : `<span style="font-weight:600;">${esc(event.title)}</span>`;
          const metaLine = meta
            ? `<div style="color:#555;font-size:14px;margin-top:4px;">${esc(meta)}</div>`
            : "";
          return `<li style="margin-bottom:14px;">${title}${metaLine}</li>`;
        })
        .join("")}</ul>`
    : `<p style="color:#666;margin:0 0 24px;">No new family events found for this weekend.</p>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>${esc(ctx.metroLabel)} weekend</title></head>
<body style="margin:0;padding:24px;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222;line-height:1.5;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
<tr><td>
<p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 4px;">FamHop weekly digest</p>
<h1 style="font-size:24px;margin:0 0 4px;">${esc(ctx.metroLabel)} this weekend</h1>
<p style="color:#666;margin:0 0 24px;">${esc(ctx.weekend.label)}</p>

<h2 style="font-size:18px;margin:0 0 12px;">Top 3 plans</h2>
${planLinks}

<h2 style="font-size:18px;margin:0 0 12px;">5 things happening</h2>
${eventLinks}

<p style="font-size:13px;color:#888;margin:24px 0 0;">You're on this list because you signed up at <a href="${esc(ctx.siteBase)}/${ctx.metroId}" style="color:#888;">famhop.com/${esc(ctx.metroId)}</a>. ${
    ctx.unsubscribeUrl
      ? `<a href="${esc(ctx.unsubscribeUrl)}" style="color:#888;">Unsubscribe with one click</a>.`
      : `Reply to this email if you want off — we'll take care of it.`
  }</p>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(ctx: RenderContext): string {
  const lines: string[] = [];
  lines.push(`${ctx.metroLabel} this weekend (${ctx.weekend.label})`);
  lines.push("");
  lines.push("TOP 3 PLANS");
  if (ctx.plans.length === 0) {
    lines.push(
      `  (none yet — browse: ${ctx.siteBase}/${ctx.metroId})`,
    );
  } else {
    ctx.plans.forEach((plan, i) => {
      const url = `${ctx.siteBase}/${ctx.metroId}/weekend#${encodeURIComponent(plan.id)}`;
      lines.push(`  ${i + 1}. ${plan.name}${plan.city ? ` — ${plan.city}` : ""}`);
      if (plan.summary) lines.push(`     ${plan.summary}`);
      lines.push(`     ${url}`);
    });
  }
  lines.push("");
  lines.push("5 THINGS HAPPENING");
  if (ctx.events.length === 0) {
    lines.push("  (no events found for this weekend)");
  } else {
    ctx.events.forEach((event, i) => {
      const time = event.startDateTime
        ? formatEventTime(event.startDateTime, ctx.weekend.timezone)
        : "";
      const meta = [time, event.venue, event.city].filter(Boolean).join(" · ");
      lines.push(`  ${i + 1}. ${event.title}`);
      if (meta) lines.push(`     ${meta}`);
      if (event.url) lines.push(`     ${event.url}`);
    });
  }
  lines.push("");
  lines.push(
    ctx.unsubscribeUrl
      ? `You're on this list because you signed up at ${ctx.siteBase}/${ctx.metroId}. Unsubscribe: ${ctx.unsubscribeUrl}`
      : `You're on this list because you signed up at ${ctx.siteBase}/${ctx.metroId}. Reply to opt out.`,
  );
  return lines.join("\n");
}

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
