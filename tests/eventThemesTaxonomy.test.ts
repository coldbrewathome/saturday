import { describe, expect, it } from "vitest";
import { EVENT_THEMES, isValidThemeId } from "../src/eventThemes";
// The classifier (.mjs) is the canonical taxonomy; the .ts module is a
// display-only mirror the app uses because it can't import the .mjs under
// allowJs:false. This guards the two from silently drifting apart.
import { THEMES } from "../scripts/eventThemes.mjs";

describe("theme taxonomy parity (eventThemes.ts ↔ eventThemes.mjs)", () => {
  it("has identical ids in identical order", () => {
    const tsIds = EVENT_THEMES.map((t) => t.id);
    const mjsIds = (THEMES as Array<{ id: string }>).map((t) => t.id);
    expect(tsIds).toEqual(mjsIds);
  });

  it("uses identical labels", () => {
    const tsLabels = Object.fromEntries(EVENT_THEMES.map((t) => [t.id, t.label]));
    for (const theme of THEMES as Array<{ id: string; label: string }>) {
      expect(tsLabels[theme.id]).toBe(theme.label);
    }
  });

  it("isValidThemeId accepts every canonical id and rejects unknowns", () => {
    for (const theme of THEMES as Array<{ id: string }>) {
      expect(isValidThemeId(theme.id)).toBe(true);
    }
    expect(isValidThemeId("definitely-not-a-theme")).toBe(false);
  });
});
