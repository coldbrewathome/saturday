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
    const barSpot = {
      ...baseSpot,
      id: "bar",
      category: "Nightlife",
      mood: "After-dark energy",
    };

    expect(scoreSpotForVibe(activeSpot, "active")).toBeGreaterThan(
      scoreSpotForVibe(barSpot, "active"),
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
