// Weekly digest template. Produces { subject, html, text } for one metro's
// Saturday + Sunday window from the same JSON shapes used by the React app
// (public/data/{metro}/featured-plans.json and events.json). Pure — no I/O.
// The send pipeline in worker/src/newsletter.ts fetches the JSON over HTTPS
// and passes it here; tests can pass fixtures directly.
//
// EDITORIAL CONTRACT (user directive 2026-08-01 — keep on every rewrite):
// the digest is exciting and engaging, never a dry listing. Concretely:
// events are ranked by interestingness (scoreEvent: marquee one-offs >
// free > routine library programming), the top scorer headlines the
// subject line and gets the spotlight block, FREE gets a badge, copy is
// warm and energetic with a small fixed emoji budget (subject balloon +
// section markers — do not add more; deliverability). A quiet weekend
// degrades to the plain list; never fake a headliner. Pinned by
// tests/newsletterTemplate.test.ts — update copy there deliberately,
// not by weakening assertions.

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
  // Present in the events.json payload (the pipeline emits them); declared
  // here so profile matching can use them.
  ageBands?: string[];
  themes?: string[];
};

// Optional per-subscriber family profile (from the in-app first-run wizard).
// When present, the digest's event picks are re-ranked for the family instead
// of the generic interestingness order.
export type SubscriberProfile = {
  ageBands?: string[];
  zipCode?: string;
  interests?: string[];
  budget?: string;
  setting?: string;
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
  // Per-recipient family profile: when present, event picks are re-ranked
  // for the family (age bands, interests, budget) instead of generic
  // interestingness.
  profile?: SubscriberProfile;
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
  const events = input.profile
    ? pickProfileEvents(input.events, weekend, MAX_EVENTS, now, input.profile)
    : pickTopEvents(input.events, weekend, MAX_EVENTS, now);

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

// Shared windowing + dedupe for both the generic and profile-ranked picks:
// events in this weekend's Sat/Sun window, earliest occurrence first, then
// collapsed per recurring series / day-suffix pair.
function windowEvents(
  events: DigestEvent[],
  weekend: WeekendWindow,
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
  return unique;
}

function pickTopEvents(
  events: DigestEvent[],
  weekend: WeekendWindow,
  limit: number,
  now: Date,
): DigestEvent[] {
  const unique = windowEvents(events, weekend, now);
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

// Profile boost on top of generic interestingness: age-band match is the
// strongest signal (+15), interests add +8 per overlapping theme, and a
// free-budget profile boosts free events.
function profileScore(event: DigestEvent, profile: SubscriberProfile): number {
  let score = 0;
  const ageBands = profile.ageBands ?? [];
  if (ageBands.length > 0) {
    const match = (event.ageBands ?? []).some((b) => ageBands.includes(b));
    if (match) score += 15;
    else if ((event.ageBands ?? []).length === 0) score += 5;
  }
  const interests = profile.interests ?? [];
  if (interests.length > 0) {
    const overlap = (event.themes ?? []).filter((t) => interests.includes(t)).length;
    score += Math.min(overlap, 2) * 8;
  }
  if (profile.budget === "free" && event.cost && /free/i.test(event.cost)) {
    score += 5;
  }
  return score;
}

export function pickProfileEvents(
  events: DigestEvent[],
  weekend: WeekendWindow,
  limit: number,
  now: Date,
  profile: SubscriberProfile,
): DigestEvent[] {
  const unique = windowEvents(events, weekend, now);
  unique.sort((a, b) => {
    const scoreDiff =
      scoreEvent(b) +
      profileScore(b, profile) -
      (scoreEvent(a) + profileScore(a, profile));
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

<p style="font-size:13px;color:#888;margin:0 0 24px;">Know another family that keeps asking &ldquo;what are we doing this weekend?&rdquo; Forward this along &mdash; they can sign up at <a href="${esc(ctx.siteBase)}/${esc(ctx.metroId)}" style="color:#888;">famhop.com/${esc(ctx.metroId)}</a>.</p>

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
  lines.push(
    "Have an amazing weekend out there! — The FamHop crew\n" +
      'Know another family that keeps asking "what are we doing this weekend?" ' +
      "Forward this along — they can sign up at " +
      `${ctx.siteBase}/${ctx.metroId}`,
  );
  lines.push("");
  lines.push(
    ctx.unsubscribeUrl
      ? `You're on this list because you signed up at ${ctx.siteBase}/${ctx.metroId}. Unsubscribe: ${ctx.unsubscribeUrl}`
      : `You're on this list because you signed up at ${ctx.siteBase}/${ctx.metroId}. Reply to opt out.`,
  );
  return lines.join("\n");
}

// ── Monday recap ──────────────────────────────────────────────────────────
// Post-weekend follow-up: check-in asks for saved events that just ended,
// trust scores from families who went, and profile-personalized picks for the
// weekend ahead. Same voice contract as the Friday digest.

export type MondayRecapInput = {
  metroId: string;
  metroLabel: string;
  timezone: string;
  /** Saved events from the just-ended weekend (check-in asks). */
  savedEvents: DigestEvent[];
  /** Trust aggregates for popular events from the just-ended weekend. */
  trusted: Array<{ title: string; trustScore: number; url?: string }>;
  /** Profile-personalized picks for the upcoming weekend (up to 4). */
  upcoming: DigestEvent[];
  now?: Date;
  siteBaseUrl?: string;
  unsubscribeUrl?: string;
};

export function renderMondayRecap(input: MondayRecapInput): DigestOutput {
  const siteBase = (input.siteBaseUrl || DEFAULT_SITE).replace(/\/$/, "");
  const now = input.now ?? new Date();
  const weekend = getWeekendWindow(now, input.timezone);
  const pastWeekend = lastWeekendWindow(now, input.timezone);
  const topTrusted = input.trusted.slice(0, 3);
  const upcoming = input.upcoming.slice(0, 4);

  const subject = `✨ How was your weekend? + this weekend in ${input.metroLabel}`;

  const checkinAsk = (event: DigestEvent) => {
    const meta = eventMetaLine(event, input.timezone);
    const link = `${siteBase}/${input.metroId}?checkin=1`;
    return `<li style="margin-bottom:14px;"><a href="${esc(link)}" style="color:#0a4d8c;text-decoration:none;font-weight:600;">Did you go to ${esc(event.title)}?</a><div style="color:#555;font-size:14px;margin-top:4px;">${esc(meta)}</div></li>`;
  };

  const savedBlock = input.savedEvents.length
    ? `<ul style="padding-left:20px;margin:0 0 24px;">${input.savedEvents.map(checkinAsk).join("")}</ul>`
    : `<p style="color:#666;margin:0 0 24px;">Nothing saved last weekend — tap the bookmark on anything that catches your eye and we'll check in on it after the weekend.</p>`;

  const trustedBlock = topTrusted.length
    ? `<ul style="padding-left:20px;margin:0 0 24px;">${topTrusted
        .map(
          (t) =>
            `<li style="margin-bottom:10px;"><span style="font-weight:700;color:#1a7f37;">${t.trustScore}%</span> of families said <span style="font-weight:600;">${esc(t.title)}</span> was worth it${t.url ? ` — <a href="${esc(t.url)}" style="color:#0a4d8c;">see it</a>` : ""}.</li>`,
        )
        .join("")}</ul>`
    : `<p style="color:#666;margin:0 0 24px;">Not enough families have checked in yet — be the first to rate an event after you go.</p>`;

  const upcomingBlock = upcoming.length
    ? `<ul style="padding-left:20px;margin:0 0 24px;">${upcoming
        .map((event) => {
          const meta = eventMetaLine(event, input.timezone);
          const title = event.url
            ? `<a href="${esc(event.url)}" style="color:#0a4d8c;text-decoration:none;font-weight:600;">${esc(event.title)}</a>`
            : `<span style="font-weight:600;">${esc(event.title)}</span>`;
          return `<li style="margin-bottom:12px;">${title}${meta ? `<div style="color:#555;font-size:14px;margin-top:4px;">${esc(meta)}</div>` : ""}</li>`;
        })
        .join("")}</ul>`
    : `<p style="color:#666;margin:0 0 24px;">It's a quiet one on the calendar — perfect excuse for a park morning.</p>`;

  const preheader = input.savedEvents.length
    ? `${input.savedEvents.length} event${input.savedEvents.length === 1 ? "" : "s"} to check in on, plus ${upcoming.length ? "what's coming up" : "a fresh look"} this weekend.`
    : `Check in on your saved events and see what's coming up in ${input.metroLabel}.`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><title>${esc(input.metroLabel)} weekend recap</title></head>
<body style="margin:0;padding:24px;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222;line-height:1.5;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
<tr><td>
<p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 4px;">FamHop weekend recap</p>
<h1 style="font-size:24px;margin:0 0 4px;">How was ${esc(input.metroLabel)}'s weekend? 🧡</h1>
<p style="color:#666;margin:0 0 20px;">${esc(pastWeekend.label)} is in the books — tell us how it went, see what other families loved, and get a head start on ${esc(weekend.label)}.</p>

<h2 style="font-size:18px;margin:0 0 12px;">📬 Did you go?</h2>
${savedBlock}

<h2 style="font-size:18px;margin:0 0 12px;">💬 What other families loved</h2>
${trustedBlock}

<h2 style="font-size:18px;margin:0 0 12px;">🎪 Coming up this weekend</h2>
${upcomingBlock}

<p style="margin:0 0 24px;"><a href="${esc(siteBase)}/${input.metroId}/this-weekend/" style="display:inline-block;background:#f59e0b;color:#ffffff;font-weight:700;text-decoration:none;border-radius:999px;padding:10px 20px;">Start planning ${esc(weekend.label)} &rarr;</a></p>

<p style="color:#444;margin:0 0 24px;">See you next weekend! 🧡<br/>— The FamHop crew</p>

<p style="font-size:13px;color:#888;margin:24px 0 0;">You're on this list because you signed up at <a href="${esc(siteBase)}/${input.metroId}" style="color:#888;">famhop.com/${esc(input.metroId)}</a>. ${
    input.unsubscribeUrl
      ? `<a href="${esc(input.unsubscribeUrl)}" style="color:#888;">Unsubscribe with one click</a>.`
      : `Reply to this email if you want off — we'll take care of it.`
  }</p>
</td></tr>
</table>
</body>
</html>`;

  const lines: string[] = [];
  lines.push(`How was ${input.metroLabel}'s weekend? (${pastWeekend.label})`);
  lines.push("Tell us how it went, see what other families loved, and get a head start on the weekend ahead.");
  lines.push("");
  lines.push("DID YOU GO?");
  if (input.savedEvents.length === 0) {
    lines.push("  (nothing saved last weekend — bookmark events to get these asks)");
  } else {
    input.savedEvents.forEach((event) => {
      const meta = eventMetaLine(event, input.timezone);
      lines.push(`  * Did you go to ${event.title}?`);
      if (meta) lines.push(`    ${meta}`);
      lines.push(`    Check in: ${siteBase}/${input.metroId}?checkin=1`);
    });
  }
  lines.push("");
  lines.push("WHAT OTHER FAMILIES LOVED");
  if (topTrusted.length === 0) {
    lines.push("  (not enough check-ins yet — be the first to rate an event)");
  } else {
    topTrusted.forEach((t) => {
      lines.push(`  * ${t.trustScore}% said ${t.title} was worth it${t.url ? ` — ${t.url}` : ""}`);
    });
  }
  lines.push("");
  lines.push(`COMING UP THIS WEEKEND (${weekend.label})`);
  if (upcoming.length === 0) {
    lines.push("  (a quiet weekend on the calendar — perfect for a park morning)");
  } else {
    upcoming.forEach((event, i) => {
      const meta = eventMetaLine(event, input.timezone);
      lines.push(`  ${i + 1}. ${event.title}${meta ? ` — ${meta}` : ""}`);
      if (event.url) lines.push(`     ${event.url}`);
    });
  }
  lines.push("");
  lines.push(`Start planning: ${siteBase}/${input.metroId}/this-weekend/`);
  lines.push("");
  lines.push("See you next weekend! — The FamHop crew");
  lines.push("");
  lines.push(
    input.unsubscribeUrl
      ? `You're on this list because you signed up at ${siteBase}/${input.metroId}. Unsubscribe: ${input.unsubscribeUrl}`
      : `You're on this list because you signed up at ${siteBase}/${input.metroId}. Reply to opt out.`,
  );

  return {
    subject,
    html,
    text: lines.join("\n"),
    planCount: 0,
    eventCount: input.savedEvents.length + upcoming.length,
  };
}

// The weekend window that just ended: [Sat, Sun] where Sun is the most recent
// Sunday at-or-before `now` (Monday send → yesterday + the day before).
export function lastWeekendWindow(now: Date, timezone: string): WeekendWindow {
  const today = zonedDateParts(now, timezone);
  const dow = weekdayNumber(today.weekday);
  const sun = addDaysToYmd(today, -dow);
  const sat = addDaysToYmd(sun, -1);
  return {
    saturdayKey: ymdKey(sat),
    sundayKey: ymdKey(sun),
    label: formatWeekendLabel(sat, sun),
    timezone,
  };
}

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
