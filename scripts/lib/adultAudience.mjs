// Decides whether an event belongs in the Mosey (adults) feed. The adults
// feed was polluted by children's-museum programs, library storytimes,
// university-admin calendar noise, and virtual/Zoom events that flowed
// through on audiences:["all"]. Rules, in order:
//   1. kids-tagged events never qualify.
//   2. virtual/online events never qualify (Mosey is in-person hangouts).
//   3. explicitly adults-tagged events qualify (curated adult sources).
//   4. kids-venue/kids-program content never qualifies.
//   5. university-admin calendar noise never qualifies.
//   6. everything else (audiences:["all"] or untagged) qualifies only with
//      an adult-positive signal (nightlife/music/bar/brewery/comedy/food/
//      festival/market/art-walk and similar).

const VIRTUAL_RE = /\b(zoom|virtual|online|webinar|livestream|live\s?stream|google meet|microsoft teams)\b/i;

const UNIVERSITY_NOISE_RE = /\b(office hours|info(?:rmation)? session|program overview|admissions?|new student|orientation|advising|drop-in hours|enrollment|finals week)\b/i;

const KIDS_CONTENT_RE = /\b(children(?:'s)?|kids?|family|families|toddlers?|preschool(?:ers)?|pre-k|storytime|story time|lapsit|lap sit|babies|baby|infants?|tweens?|teens?|youth|school-?age|grades?\s?(?:k|[0-9])|stroller|puppet|sensory[- ]friendly|scouts?|all ages)\b/i;

const ADULT_POSITIVE_RE = /(?:\b21\s?\+|\b(?:adults? only|adults? night|nightlife|night out|night market|dj|concert|live music|gig|open mic|karaoke|trivia|comedy|stand-?up|improv|burlesque|drag (?:show|brunch|night)|bar crawl|bars?|pub|brewery|brewpub|brewing|taproom|tap room|beer|cider|wine|winery|vineyard|distillery|cocktails?|happy hour|speakeasy|food (?:truck|hall|crawl|festival|tour)|supper club|tasting|brunch|restaurant week|farmers'? market|flea market|makers market|market|festival|fest|street fair|fair|county fair|parade|block party|art walk|art-walk|gallery (?:night|crawl|opening)|first friday|museum after dark|late night|after hours|paint (?:&|and) sip|sip|singles (?:night|mixer|event)|date night|run club)\b)/i;

const ADULT_POSITIVE_CATEGORIES = new Set([
  "Brewery",
  "Comedy",
  "Festival",
  "Music",
  "Nightlife",
]);

function eventAudiences(event) {
  const audiences = Array.isArray(event?.audiences) ? event.audiences : [];
  return audiences.map((a) => String(a || "").toLowerCase().trim());
}

function text(...parts) {
  return parts
    .map((part) => (typeof part === "string" ? part : ""))
    .join(" ");
}

// Virtual/online events have no place in either in-person feed; exported so
// coverage reporting can count in-person events only.
export function isVirtualEvent(event) {
  return VIRTUAL_RE.test(text(event?.title, event?.venue));
}

export function hasAdultPositiveSignal(event) {
  if (ADULT_POSITIVE_CATEGORIES.has(event?.category)) return true;
  return ADULT_POSITIVE_RE.test(text(event?.title, event?.description, event?.venue));
}

export function qualifiesForAdultFeed(event) {
  if (!event) return false;
  const audiences = eventAudiences(event);
  if (audiences.includes("kids") && !audiences.includes("adults")) return false;
  if (isVirtualEvent(event)) return false;
  if (audiences.includes("adults")) return true;
  if (KIDS_CONTENT_RE.test(text(event.title, event.venue, event.sourceName))) return false;
  if (UNIVERSITY_NOISE_RE.test(text(event.title, event.venue))) return false;
  return hasAdultPositiveSignal(event);
}
