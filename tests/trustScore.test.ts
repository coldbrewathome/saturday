import { describe, expect, it } from "vitest";
import { trustBoost } from "../src/checkinApi";

describe("trustBoost", () => {
  it("is zero when there are no check-ins (null trust)", () => {
    expect(trustBoost(null)).toBe(0);
  });

  it("is zero at a 50% score", () => {
    expect(trustBoost(50)).toBe(0);
  });

  it("is positive above 50% and negative below", () => {
    expect(trustBoost(100)).toBe(10);
    expect(trustBoost(85)).toBe(7);
    expect(trustBoost(0)).toBe(-10);
    expect(trustBoost(40)).toBe(-2);
  });

  it("rounds to whole-point steps of five", () => {
    expect(trustBoost(93)).toBe(9); // (93-50)/5 = 8.6 → 9
    expect(trustBoost(62)).toBe(2); // (62-50)/5 = 2.4 → 2
  });
});
