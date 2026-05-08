import { describe, expect, it } from "vitest";
import {
  buildPlannerBrief,
  scoreSpotForVibe,
  type PlannerSpot,
} from "../src/planner";

const baseSpot: PlannerSpot = {
  id: "base",
  name: "Base Spot",
  neighborhood: "San Francisco",
  category: "Food",
  cost: "$",
  transitMinutes: 12,
  mood: "Shareable food",
  groupSize: "2-6 people",
  planning: "Walk-in",
  openNow: true,
  website: "https://example.com",
  friendScore: 80,
};

describe("planner scoring", () => {
  it("boosts active plans toward outdoors and wellness", () => {
    const activeSpot = {
      ...baseSpot,
      id: "park",
      category: "Outdoors",
      mood: "Outside hangout",
    };
    const indoorMallSpot = {
      ...baseSpot,
      id: "mall",
      category: "Shopping",
      mood: "Indoor browsing",
    };

    expect(scoreSpotForVibe(activeSpot, "active")).toBeGreaterThan(
      scoreSpotForVibe(indoorMallSpot, "active"),
    );
  });

  it("keeps passive shopping from becoming default school-age filler", () => {
    const comicsShop = {
      ...baseSpot,
      id: "comics",
      category: "Shopping",
      cost: "Unknown",
      mood: "Browse together",
      planning: "Walk-in",
      friendScore: 71,
    };
    const libraryProgram = {
      ...baseSpot,
      id: "library-program",
      category: "Culture",
      cost: "Free",
      mood: "Scheduled family program",
      friendScore: 76,
    };

    expect(scoreSpotForVibe(libraryProgram, "balanced", "school-age")).toBeGreaterThan(
      scoreSpotForVibe(comicsShop, "balanced", "school-age"),
    );
  });

  it("lifts scheduled family events above generic filler candidates", () => {
    const scheduledEvent = {
      ...baseSpot,
      id: "event",
      category: "Culture",
      cost: "Free",
      planning: "Sat, May 9, 10:30 AM. Confirm details with the library.",
      dataSource: "family-event",
      tags: ["event", "scheduled", "family", "library", "school-age"],
      friendScore: 78,
      kidsFriendly: true,
    };
    const genericShop = {
      ...baseSpot,
      id: "generic-shop",
      category: "Shopping",
      cost: "Unknown",
      friendScore: 78,
      kidsFriendly: true,
    };

    expect(scoreSpotForVibe(scheduledEvent, "balanced", "school-age")).toBeGreaterThan(
      scoreSpotForVibe(genericShop, "balanced", "school-age"),
    );
  });

  it("penalizes long travel for low effort plans", () => {
    const close = { ...baseSpot, transitMinutes: 8 };
    const far = { ...baseSpot, id: "far", transitMinutes: 65 };

    expect(scoreSpotForVibe(close, "low-effort")).toBeGreaterThan(
      scoreSpotForVibe(far, "low-effort"),
    );
  });
});

describe("planner brief", () => {
  it("uses saved spots before broad results", () => {
    const saved = { ...baseSpot, id: "saved", name: "Saved Cafe" };
    const broad = {
      ...baseSpot,
      id: "broad",
      name: "Broad Result",
      friendScore: 100,
    };

    const brief = buildPlannerBrief([broad], [saved], "balanced");

    expect(brief.primary?.id).toBe("saved");
    expect(brief.cautions).toContain("The planner is prioritizing your saved shortlist.");
  });

  it("returns a clear empty state", () => {
    const brief = buildPlannerBrief([], [], "balanced");

    expect(brief.title).toBe("No plan yet");
    expect(brief.cautions[0]).toContain("No source-backed spot");
  });
});
