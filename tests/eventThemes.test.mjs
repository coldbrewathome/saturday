import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEMES,
  classifyEventThemes,
  isKnownTheme,
} from "../scripts/eventThemes.mjs";

function classify(partial) {
  return classifyEventThemes({ category: "", title: "", description: "", ...partial });
}

test("maps obvious events to the expected theme", () => {
  assert.deepEqual(classify({ title: "Toddler Story Time" }), ["story-time"]);
  assert.deepEqual(classify({ title: "Robotics & LEGO workshop" }), ["stem"]);
  assert.deepEqual(classify({ title: "Watercolor painting drop-in" }), ["arts-crafts"]);
  assert.deepEqual(classify({ title: "Wednesday Night Market" }), ["food-markets"]);
});

test("catches morphological variants (word-start stems)", () => {
  // \bword\b boundaries used to miss these; word-start stems should catch them.
  assert.ok(classify({ title: "Musical Jamboree" }).includes("music-performance"));
  assert.ok(classify({ title: "Birding at Big Break" }).includes("animals-nature"));
  assert.ok(classify({ title: "Story painting party" }).includes("arts-crafts"));
});

test("catches the early-childhood play/rhyme cluster", () => {
  assert.ok(classify({ title: "Baby Bounce and Rhyme Time" }).includes("story-time"));
  assert.ok(classify({ title: "Stay & Play" }).includes("active-outdoors"));
});

test("returns an empty array when nothing matches", () => {
  assert.deepEqual(classify({ title: "Library Advisory Board Meeting" }), []);
  assert.deepEqual(classify({ category: "Library", title: "Notary Services" }), []);
});

test("can return multiple themes", () => {
  const themes = classify({ title: "Music & art festival" });
  assert.ok(themes.includes("music-performance"));
  assert.ok(themes.includes("arts-crafts"));
  assert.ok(themes.includes("festivals-community"));
});

test("returns ids in THEMES display order", () => {
  const order = THEMES.map((t) => t.id);
  const themes = classify({ title: "Festival with music and a craft table" });
  const sorted = [...themes].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  assert.deepEqual(themes, sorted);
});

test("isKnownTheme guards ids", () => {
  assert.ok(isKnownTheme("stem"));
  assert.ok(!isKnownTheme("not-a-theme"));
});

test("every theme has the required display fields", () => {
  for (const theme of THEMES) {
    assert.ok(theme.id && typeof theme.id === "string");
    assert.ok(theme.label && typeof theme.label === "string");
    assert.ok(theme.blurb && typeof theme.blurb === "string");
    assert.ok(theme.pattern instanceof RegExp);
  }
});
