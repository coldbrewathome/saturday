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
  endDateTime?: string;
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
  const events = pickTopEvents(input.events, weekend, MAX_EVENTS, now);

  // The most interesting in-window event headlines the digest — but only
  // when it actually scores as marquee material; a weekend of storytimes
  // gets the plain list, not a fake "headliner".
  const headliner =
    events.length && scoreEvent(events[0]) >= HEADLINER_MIN_SCORE
      ? events[0]
      : undefined;
  const restEvents = headliner ? events.slice(1) : events;

  const subject = headliner
    ? `🎈 ${truncateForSubject(stripDaySuffix(headliner.title), 44)} + more this weekend in ${input.metroLabel}`
    : `🎈 ${input.metroLabel} this weekend: your family game plan (${weekend.label})`;
  const html = renderHtml({
    metroId: input.metroId,
    metroLabel: input.metroLabel,
    weekend,
    plans,
    headliner,
    events: restEvents,
    siteBase,
    unsubscribeUrl: input.unsubscribeUrl,
  });
  const text = renderText({
    metroId: input.metroId,
    metroLabel: input.metroLabel,
    weekend,
    plans,
    headliner,
    events: restEvents,
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
  now: Date,
): DigestEvent[] {
  if (!Array.isArray(events)) return [];
  const inWindow = events.filter((event) => {
    if (!event.startDateTime) return false;
    // A digest can be (re)rendered later in the day than its "send" time —
    // an event that started and already ended earlier the same Saturday
    // must not still be offered as attendable.
    if (event.endDateTime) {
      const endMs = Date.parse(event.endDateTime);
      if (Number.isFinite(endMs) && endMs < now.getTime()) return false;
    }
    const key = zonedDateKey(new Date(event.startDateTime), weekend.timezone);
    return key === weekend.saturdayKey || key === weekend.sundayKey;
  });

  // Chronological before dedupe so the merged survivor is the earliest
  // occurrence (Saturday beats Sunday for the same festival).
  inWindow.sort((a, b) => {
    const aT = Date.parse(a.startDateTime || "") || 0;
    const bT = Date.parse(b.startDateTime || "") || 0;
    return aT - bT;
  });

  // Dedupe recurring series by baseId so "Yoga at the museum × 6 weeks"
  // doesn't fill the whole list — and by day-suffix-normalized title+venue
  // so "Strawberry Festival (Saturday)" and "(Sunday)" don't take two slots.
  const seen = new Set<string>();
  const unique: DigestEvent[] = [];
  for (const event of inWindow) {
    const key =
      (event.baseId && String(event.baseId)) ||
      `${stripDaySuffix(event.title).toLowerCase()}|${(event.venue || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }

  // Most interesting first, chronological within a score tie — a Saturday
  // fireworks show must beat five Friday-scheduled storytimes to the top.
  unique.sort((a, b) => {
    const scoreDiff = scoreEvent(b) - scoreEvent(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aT = Date.parse(a.startDateTime || "") || 0;
    const bT = Date.parse(b.startDateTime || "") || 0;
    return aT - bT;
  });

  return unique.slice(0, limit);
}

// ── Interestingness scoring ────────────────────────────────────────────
// Heuristic mirror of pickWeekendHeadliners in generate-seo-pages.mjs
// (worker code can't import from scripts/): marquee one-offs outrank
// recurring library programming, free is a draw, junk never headlines.

const HEADLINER_MIN_SCORE = 4;

const MARQUEE_RE =
  /\b(festival|fest|parade|fireworks|carnival|fair|circus|rodeo|air ?show|balloon|drone show|block party|touch[- ]a[- ]truck|grand opening)\b/i;
const BIG_DRAW_RE =
  /\b(concert|live music|symphony|orchestra|movie night|outdoor movie|drive[- ]in|train ride|zoo|aquarium|museum day|splash|water play|pumpkin|holiday lights|ice skating|kite|dinosaur|pirate|princess|superhero|magic show|puppet)\b/i;
const ROUTINE_RE =
  /\b(storytime|story time|story hour|book club|lego club|toddler time|craft(ernoon)?|lap ?sit|read to a dog|homework help|teen advisory|knitting|chess club)\b/i;

function scoreEvent(event: DigestEvent): number {
  const title = String(event.title || "");
  let score = 0;
  if (MARQUEE_RE.test(title)) score += 5;
  if (BIG_DRAW_RE.test(title)) score += 3;
  if (event.category && /fest|fair|music|outdoor|seasonal/i.test(event.category)) {
    score += 2;
  }
  if (event.cost && /free/i.test(event.cost)) score += 2;
  if (ROUTINE_RE.test(title)) score -= 3;
  // A title that is mostly digits/punctuation (feed junk) never headlines.
  if (!/[a-z]{3,}/i.test(title)) score -= 10;
  return score;
}

// "Strawberry Festival (Saturday)" → "Strawberry Festival": the weekday
// marker is feed plumbing; the meta line already carries the day + time.
function stripDaySuffix(title: string): string {
  return String(title || "").replace(
    /\s*\((?:this\s+)?(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\)\s*$/i,
    "",
  );
}

function truncateForSubject(title: string, max: number): string {
  const clean = String(title || "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const atWord = cut.slice(0, cut.lastIndexOf(" "));
  return `${(atWord.length >= 20 ? atWord : clean.slice(0, max)).trim()}…`;
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
  headliner?: DigestEvent;
  events: DigestEvent[];
  siteBase: string;
  unsubscribeUrl?: string;
};

function eventMetaLine(event: DigestEvent, timezone: string): string {
  const time = event.startDateTime
    ? formatEventTime(event.startDateTime, timezone)
    : "";
  return [time, event.venue, event.city].filter(Boolean).join(" · ");
}

function isFree(event: DigestEvent): boolean {
  return Boolean(event.cost && /free/i.test(event.cost));
}

function renderHtml(ctx: RenderContext): string {
  const freeBadge = `<span style="display:inline-block;background:#e7f6ec;color:#1a7f37;font-size:12px;font-weight:700;border-radius:999px;padding:1px 8px;margin-left:6px;vertical-align:middle;">FREE</span>`;

  const headlinerBlock = ctx.headliner
    ? (() => {
        const event = ctx.headliner;
        const meta = eventMetaLine(event, ctx.weekend.timezone);
        const title = event.url
          ? `<a href="${esc(event.url)}" style="color:#0a4d8c;text-decoration:none;">${esc(event.title)}</a>`
          : esc(event.title);
        return `<div style="background:#fff7e6;border-radius:10px;padding:16px 18px;margin:0 0 24px;">
<p style="font-size:12px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px;">⭐ This weekend's headliner</p>
<p style="font-size:19px;font-weight:700;margin:0;">${title}${isFree(event) ? freeBadge : ""}</p>
${meta ? `<p style="color:#555;font-size:14px;margin:6px 0 0;">${esc(meta)}</p>` : ""}
</div>`;
      })()
    : "";

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
    : `<p style="color:#666;margin:0 0 24px;">Plans are still cooking for this weekend — <a href="${esc(ctx.siteBase)}/${ctx.metroId}" style="color:#0a4d8c;">browse everything in ${esc(ctx.metroLabel)} &rarr;</a></p>`;

  const eventLinks = ctx.events.length
    ? `<ul style="padding-left:20px;margin:0 0 24px;">${ctx.events
        .map((event) => {
          const meta = eventMetaLine(event, ctx.weekend.timezone);
          const title = event.url
            ? `<a href="${esc(event.url)}" style="color:#0a4d8c;text-decoration:none;font-weight:600;">${esc(event.title)}</a>`
            : `<span style="font-weight:600;">${esc(event.title)}</span>`;
          const metaLine = meta
            ? `<div style="color:#555;font-size:14px;margin-top:4px;">${esc(meta)}</div>`
            : "";
          return `<li style="margin-bottom:14px;">${title}${isFree(event) ? freeBadge : ""}${metaLine}</li>`;
        })
        .join("")}</ul>`
    : ctx.headliner
      ? ""
      : `<p style="color:#666;margin:0 0 24px;">It's a quiet one on the calendar — perfect excuse for a park morning. <a href="${esc(ctx.siteBase)}/${ctx.metroId}" style="color:#0a4d8c;">See what's open in ${esc(ctx.metroLabel)} &rarr;</a></p>`;

  const preheader = ctx.headliner
    ? `${ctx.headliner.title} — plus ready-made family plans for ${ctx.weekend.label}.`
    : `Your ${ctx.metroLabel} family game plan for ${ctx.weekend.label}.`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>${esc(ctx.metroLabel)} weekend</title></head>
<body style="margin:0;padding:24px;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222;line-height:1.5;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
<tr><td>
<p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 4px;">FamHop weekly digest</p>
<h1 style="font-size:24px;margin:0 0 4px;">Your ${esc(ctx.metroLabel)} weekend, sorted 🎉</h1>
<p style="color:#666;margin:0 0 20px;">${esc(ctx.weekend.label)} — the good stuff, picked for you. Grab the snacks, we did the planning.</p>

${headlinerBlock}

<h2 style="font-size:18px;margin:0 0 12px;">🎪 Don't miss these</h2>
${eventLinks}

<h2 style="font-size:18px;margin:0 0 12px;">🗺️ Three ready-made adventures</h2>
${planLinks}

<p style="margin:0 0 24px;"><a href="${esc(ctx.siteBase)}/${ctx.metroId}/this-weekend/" style="display:inline-block;background:#f59e0b;color:#ffffff;font-weight:700;text-decoration:none;border-radius:999px;padding:10px 20px;">See everything happening &rarr;</a></p>

<p style="color:#444;margin:0 0 24px;">Have an amazing weekend out there! 🧡<br/>— The FamHop crew</p>

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
  lines.push(`Your ${ctx.metroLabel} weekend, sorted (${ctx.weekend.label})`);
  lines.push("The good stuff, picked for you. Grab the snacks, we did the planning.");
  lines.push("");
  if (ctx.headliner) {
    const meta = eventMetaLine(ctx.headliner, ctx.weekend.timezone);
    lines.push("THIS WEEKEND'S HEADLINER");
    lines.push(`  * ${ctx.headliner.title}${isFree(ctx.headliner) ? " (FREE)" : ""}`);
    if (meta) lines.push(`    ${meta}`);
    if (ctx.headliner.url) lines.push(`    ${ctx.headliner.url}`);
    lines.push("");
  }
  lines.push("DON'T MISS THESE");
  if (ctx.events.length === 0 && !ctx.headliner) {
    lines.push("  (a quiet weekend on the calendar — perfect for a park morning)");
  } else if (ctx.events.length === 0) {
    lines.push("  (the headliner has the weekend covered)");
  } else {
    ctx.events.forEach((event, i) => {
      const meta = eventMetaLine(event, ctx.weekend.timezone);
      lines.push(`  ${i + 1}. ${event.title}${isFree(event) ? " (FREE)" : ""}`);
      if (meta) lines.push(`     ${meta}`);
      if (event.url) lines.push(`     ${event.url}`);
    });
  }
  lines.push("");
  lines.push("THREE READY-MADE ADVENTURES");
  if (ctx.plans.length === 0) {
    lines.push(
      `  (still cooking — browse: ${ctx.siteBase}/${ctx.metroId})`,
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
  lines.push(`See everything happening: ${ctx.siteBase}/${ctx.metroId}/this-weekend/`);
  lines.push("");
  lines.push("Have an amazing weekend out there! — The FamHop crew");
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
