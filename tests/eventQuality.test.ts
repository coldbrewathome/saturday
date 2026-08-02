import { describe, expect, it } from "vitest";
import { isFeedJunkEvent } from "../src/eventQuality";
import type { FamilyEvent } from "../src/App";

function makeEvent(overrides: Partial<FamilyEvent> & { id: string }): FamilyEvent {
  return {
    title: "Storytime at the Library",
    description: "A weekly read-aloud for little ones.",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.7749,
    lon: -122.4194,
    category: "Community",
    daysOfWeek: [6],
    timeWindow: "Morning",
    ageBands: ["toddler"],
    cost: "Free",
    url: "https://example.com/storytime",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

describe("isFeedJunkEvent", () => {
  it("drops teen advisory council meetings", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "1",
          title: "Teen Advisory Council",
          description: "Monthly meeting to plan teen programs.",
        }),
      ),
    ).toBe(true);
  });

  it("keeps teen movie night", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "2",
          title: "Teen Movie Night",
          description: "Free screening of a family favorite.",
        }),
      ),
    ).toBe(false);
  });

  it("drops homework help", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "3",
          title: "Homework Help",
          description: "After-school tutoring for grades K-8.",
        }),
      ),
    ).toBe(true);
  });

  it("keeps storytime", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "4",
          title: "Storytime at the Library",
          description: "Songs and read-alouds for toddlers.",
        }),
      ),
    ).toBe(false);
  });

  it("drops friends of the library meetings", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "5",
          title: "Friends of the Library Meeting",
          description: "Volunteer group business meeting.",
          venue: "Library Community Room",
        }),
      ),
    ).toBe(true);
  });

  it("keeps family festivals", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "6",
          title: "Family Festival",
          description: "Games, crafts, and food trucks all day.",
        }),
      ),
    ).toBe(false);
  });

  it("drops board meetings", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "7",
          title: "Museum Board Meeting",
          description: "Quarterly trustees board meeting.",
        }),
      ),
    ).toBe(true);
  });

  it("keeps craft clubs", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "8",
          title: "Craft Club",
          description: "Weekly drop-in art making for kids.",
        }),
      ),
    ).toBe(false);
  });

  it("drops tutoring even when advertised for kids", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({
          id: "9",
          title: "Math Tutoring Program for Kids",
          description: "One-on-one tutoring sessions.",
        }),
      ),
    ).toBe(true);
  });

  it("drops test-prep and citizenship classes", () => {
    expect(
      isFeedJunkEvent(makeEvent({ id: "10", title: "SAT Test Prep" })),
    ).toBe(true);
    expect(
      isFeedJunkEvent(makeEvent({ id: "11", title: "Citizenship Class" })),
    ).toBe(true);
    expect(
      isFeedJunkEvent(makeEvent({ id: "12", title: "Civics Test Study Group" })),
    ).toBe(true);
  });

  it("drops youth council and committee titles", () => {
    expect(
      isFeedJunkEvent(
        makeEvent({ id: "13", title: "Youth Commission" }),
      ),
    ).toBe(true);
    expect(
      isFeedJunkEvent(
        makeEvent({ id: "14", title: "Library Committee Meeting" }),
      ),
    ).toBe(true);
  });
});
