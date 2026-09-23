/**
 * First-party analytics contract shared by the browser, Worker, and operator
 * dashboard. Keep this list deliberately small: metric names are part of the
 * persisted KV key space and must not contain user supplied values.
 */
export const METRIC_NAMES = [
  "app_open",
  "app_open_return",
  "hero_plan_created",
  "hop_now_opened",
  "plan_created",
  "plan_shared",
  "item_shared",
  "poll_viewed",
  "vote_cast",
  "weekend_guide_click",
  "signin_prompt_shown",
  "signin_prompt_clicked",
  "signin_success",
  "newsletter_subscribed",
  "digest_prompt_shown",
  "profile_completed",
  "checkin_answered",
  "plan_card_created",
  "plan_card_shared",
  "seo_landing",
  "organizer_click",
  "calendar_save",
  "event_saved",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export const METRIC_SOURCES = [
  "search",
  "referral",
  "direct",
  "internal",
] as const;

export type MetricSource = (typeof METRIC_SOURCES)[number];

export const METRIC_PAGE_TYPES = [
  "event",
  "weekend",
  "metro",
  "app",
  "other",
] as const;

export type MetricPageType = (typeof METRIC_PAGE_TYPES)[number];

/** Optional, privacy-preserving attribution dimensions. */
export type MetricAttribution = {
  source?: MetricSource;
  pageType?: MetricPageType;
};

export function isMetricName(value: unknown): value is MetricName {
  return typeof value === "string" && (METRIC_NAMES as readonly string[]).includes(value);
}

export function isMetricSource(value: unknown): value is MetricSource {
  return typeof value === "string" && (METRIC_SOURCES as readonly string[]).includes(value);
}

export function isMetricPageType(value: unknown): value is MetricPageType {
  return typeof value === "string" && (METRIC_PAGE_TYPES as readonly string[]).includes(value);
}

