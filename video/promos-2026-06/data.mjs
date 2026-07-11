import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..", "..");
export const assetsDir = path.join(here, "assets");
export const rawDir = path.join(here, "raw");
export const fixedNowIso = "2026-06-20T12:45:00-07:00";

const preferredEventIds = [
  "sfpl-workshop-father-s-day-card-making-a5b17f30a6",
  "sfpl-activity-chess-club-f4dffbbbaa",
  "east-bay-parks-butterfly-walks-0900c43fff",
  "omca-family-events-10001959",
];

const preferredSpotIds = [
  "osm-way-28824850",
  "osm-way-260146990",
  "osm-way-437595662",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function isUpcoming(event, nowMs) {
  const start = event.startDateTime ? Date.parse(event.startDateTime) : NaN;
  const end = event.endDateTime ? Date.parse(event.endDateTime) : NaN;
  if (Number.isFinite(end)) return end >= nowMs;
  return Number.isFinite(start) ? start >= nowMs : true;
}

function isWeekend(event) {
  const start = event.startDateTime ? new Date(event.startDateTime) : null;
  if (!start) return false;
  const day = start.getUTCDay();
  return day === 6 || day === 0;
}

function summarizeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    venue: event.venue,
    city: event.city,
    startDateTime: event.startDateTime,
    timeWindow: event.timeWindow,
    url: event.url,
    category: event.category,
    cost: event.cost,
  };
}

function summarizeSpot(spot) {
  return {
    id: spot.id,
    name: spot.name,
    neighborhood: spot.neighborhood,
    category: spot.category,
    imageUrl: spot.imageUrl,
    cost: spot.cost,
    transitMinutes: spot.transitMinutes,
    mood: spot.mood,
    groupSize: spot.groupSize,
    planning: spot.planning,
    openNow: spot.openNow,
    website: spot.website,
    sourceUrl: spot.sourceUrl,
    friendScore: spot.friendScore,
  };
}

export function promoModel() {
  const eventDoc = readJson("public/data/bay-area/events.json");
  const spotDoc = readJson("public/data/bay-area/spots.json");
  const events = Array.isArray(eventDoc.events) ? eventDoc.events : [];
  const spots = Array.isArray(spotDoc.spots) ? spotDoc.spots : [];
  const nowMs = Date.parse(fixedNowIso);
  const upcomingWeekend = events.filter((event) => isUpcoming(event, nowMs) && isWeekend(event));
  const freeWeekend = upcomingWeekend.filter((event) => /free/i.test(String(event.cost || "")));
  const selectedEvents = [
    ...preferredEventIds
      .map((id) => events.find((event) => event.id === id))
      .filter(Boolean),
    ...events
      .filter((event) => event.verified && isUpcoming(event, nowMs))
      .sort((a, b) => Date.parse(a.startDateTime || "") - Date.parse(b.startDateTime || "")),
  ].filter((event, index, list) => list.findIndex((other) => other.id === event.id) === index);
  const selectedSpots = [
    ...preferredSpotIds
      .map((id) => spots.find((spot) => spot.id === id))
      .filter(Boolean),
    ...spots,
  ].filter((spot, index, list) => list.findIndex((other) => other.id === spot.id) === index);

  const planEvents = selectedEvents.slice(0, 2);
  const planSpots = selectedSpots.slice(0, 2);
  const plan = {
    id: "promo-plan-bay-area-saturday",
    name: "Easy Saturday in SF",
    stopIds: planSpots.map((spot) => spot.id),
    eventIds: planEvents.map((event) => event.id),
    itemOrder: [
      { kind: "spot", id: planSpots[0]?.id },
      { kind: "event", id: planEvents[0]?.id },
      { kind: "spot", id: planSpots[1]?.id },
      { kind: "event", id: planEvents[1]?.id },
    ].filter((item) => item.id),
    createdAt: new Date(nowMs).toISOString(),
    source: "manual",
    summary: "A low-effort plan that mixes a landmark, food stop, and two free library events.",
    pollId: "promo-vote-link",
  };

  const tallies = {};
  for (const ref of plan.itemOrder) {
    tallies[ref.id] = { up: ref.kind === "event" ? 3 : 2, meh: ref.kind === "spot" ? 1 : 0, down: 0 };
  }

  return {
    fixedNowIso,
    stats: {
      metro: "Bay Area",
      eventCount: events.length,
      spotCount: spots.length,
      weekendCount: upcomingWeekend.length,
      freeWeekendCount: freeWeekend.length,
      generatedAt: eventDoc.generatedAt,
    },
    plan,
    poll: {
      pollId: plan.pollId,
      metroId: "bay-area",
      title: plan.name,
      stops: planSpots.map(summarizeSpot),
      events: planEvents.map(summarizeEvent),
      itemOrder: plan.itemOrder,
      tallies,
      voterCount: 3,
      createdAt: new Date(nowMs).toISOString(),
    },
    screenshots: {
      explore: "assets/explore.png",
      hopNow: "assets/hop-now.png",
      planShare: "assets/plan-share.png",
    },
  };
}

export function concepts() {
  const model = promoModel();
  const { stats, screenshots } = model;
  const hopNowSceneSeconds = [2.1, 4.2, 4.2, 4.2, 4.2, 2.1];
  return [
    {
      id: "weekend-map",
      title: "Weekend Map",
      totalSeconds: 16.8,
      file: path.join(here, "weekend-map.mp4"),
      scenes: [
        {
          image: screenshots.explore,
          eyebrow: "FamHop",
          headline: "This weekend is already mapped.",
          body: "Real event pins, free options, and kid-friendly places in one view.",
          metric: "Explore by map, day, interest, and price.",
        },
        {
          image: screenshots.explore,
          eyebrow: "Weekend Guide",
          headline: "Stop guessing where to take the kids.",
          body: "See nearby options with real event pins and quick filters.",
          metric: `${stats.eventCount.toLocaleString()} Bay Area events + ${stats.spotCount.toLocaleString()} places in the feed.`,
        },
        {
          image: screenshots.explore,
          eyebrow: "Try it",
          headline: "Find the best nearby win before Saturday disappears.",
          body: "Open FamHop, pick the plan that fits, and go.",
          metric: "famhop.com",
        },
      ],
    },
    {
      id: "hop-now",
      title: "Hop Now",
      totalSeconds: hopNowSceneSeconds.reduce((sum, seconds) => sum + seconds, 0),
      file: path.join(here, "hop-now.mp4"),
      scenes: [
        {
          beat: "brand-open",
          image: screenshots.hopNow,
          seconds: hopNowSceneSeconds[0],
          eyebrow: "FamHop Hop Now",
          headline: "Last-minute family plans, solved.",
          body: "For the moment when everyone is ready and nobody knows where to go.",
          metric: "Open now. Nearby. Starts soon.",
          brandMoment: {
            label: "Hop Now",
            tagline: "Open now. Nearby. Starts soon.",
            pills: ["No searching", "No stale ideas", "Just go"],
          },
        },
        {
          beat: "problem",
          image: screenshots.hopNow,
          seconds: hopNowSceneSeconds[1],
          eyebrow: "3:12 PM. No plan.",
          headline: "The kids are bored. You need an idea now.",
          body: "No search spiral. No maybe-later lists. Just something nearby that still works today.",
          metric: "Last-minute plan mode",
          callouts: ["I'm bored.", "What can we do?", "Is anything open?"],
        },
        {
          beat: "friend",
          image: screenshots.hopNow,
          seconds: hopNowSceneSeconds[2],
          eyebrow: "Friend tip",
          headline: "Open FamHop. Tap Hop me now.",
          body: "It filters the live map into nearby options you can still make.",
          metric: "From stuck to moving in seconds.",
          chat: [
            { type: "parent", text: "We need something to do today." },
            { type: "friend", text: "Try FamHop. Hit Hop me now." },
          ],
        },
        {
          beat: "instant",
          image: screenshots.hopNow,
          seconds: hopNowSceneSeconds[3],
          eyebrow: "Instant shortlist",
          headline: "Starts soon. Close by. Ready to go.",
          body: "Events and places are ranked for right now, not someday.",
          metric: "1 min away. Starts in 15 min.",
          resultChips: ["Open now", "Nearby", "Starts soon"],
        },
        {
          beat: "go",
          image: screenshots.hopNow,
          seconds: hopNowSceneSeconds[4],
          eyebrow: "Go mode",
          headline: "Pick one. Get moving.",
          body: "Tap Take me there, save it to a plan, or refresh for a new batch.",
          metric: "famhop.com",
          resultChips: ["Take me there", "Save to plan", "Try another"],
        },
        {
          beat: "brand-close",
          image: screenshots.hopNow,
          seconds: hopNowSceneSeconds[5],
          eyebrow: "FamHop",
          headline: "Your next nearby win is waiting.",
          body: "Open FamHop, tap Hop me now, and turn a stuck afternoon into a plan.",
          metric: "famhop.com",
          brandMoment: {
            label: "famhop.com",
            tagline: "Tap Hop me now.",
            pills: ["Open FamHop", "Pick one", "Get moving"],
          },
        },
      ],
    },
    {
      id: "share-vote",
      title: "Share And Vote",
      totalSeconds: 16.8,
      file: path.join(here, "share-vote.mp4"),
      scenes: [
        {
          image: screenshots.planShare,
          eyebrow: "Plan Together",
          headline: "Replace the group-chat spiral.",
          body: "Build one plan, send one vote link, and keep everyone aligned.",
          metric: "Messages, WhatsApp, email, or story card.",
        },
        {
          image: screenshots.planShare,
          eyebrow: "Votes Land Here",
          headline: "The decision gets visible.",
          body: "Friends vote on stops, and the plan owner sees the tally.",
          metric: "One shared source of truth for Saturday.",
        },
        {
          image: screenshots.planShare,
          eyebrow: "Try it",
          headline: "Plan it. Share it. Vote.",
          body: "FamHop keeps the outing moving.",
          metric: "famhop.com",
        },
      ],
    },
  ];
}
