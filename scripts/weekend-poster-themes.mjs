// Per-metro visual themes + HTML renderers for the weekend highlight posters.
// Two layout engines share the 1080x1350 canvas:
//   - "stickers": tilted sticker cards on a patterned field (playful, kid-first)
//   - "bill":     festival lineup bill with day rules and headliners
// Every metro gets its own palette, type pairing, motif, and copy so the
// poster reads as local, not templated. Rendering is deterministic from
// (theme, data) — no runtime JS in the page, fixed slots, clamped text.

export const POSTER_W = 1080;
export const POSTER_H = 1350;

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

const T = {};

T["bay-area"] = {
  layout: "stickers",
  placeShort: "the Bay",
  fonts: { display: "'Baloo 2'", body: "'Nunito'", import: "family=Baloo+2:wght@600;700;800&family=Nunito:ital,wght@0,600;0,800;1,600" },
  kicker: "famhop ✿ bay area",
  headline: "YOUR KIDS' BEST",
  headlineMode: "tiles",
  bg: "#FFDE4D", pattern: { type: "dots", color: "#F4B400" },
  ink: "#2B1B44", muted: "#5A4A7E",
  brandBg: "#2B1B44", brandInk: "#FFDE4D", chipBg: "#fff", chipInk: "#2B1B44",
  tiles: [
    { bg: "#FF6B57", ink: "#fff" }, { bg: "#2EC4B6", ink: "#2B1B44" }, { bg: "#FF8FAB", ink: "#2B1B44" },
    { bg: "#8AC926", ink: "#2B1B44" }, { bg: "#7C5CFF", ink: "#fff" }, { bg: "#FFB627", ink: "#2B1B44" },
    { bg: "#2EC4B6", ink: "#2B1B44" },
  ],
  cardBgs: ["#FFF3E6", "#E6FBF8", "#F3EDFF", "#FFEDF2", "#F0F9E0", "#FFF8DE"],
  day: { sat: { bg: "#FF6B57", ink: "#fff" }, sun: { bg: "#7C5CFF", ink: "#fff" }, both: { bg: "#2EC4B6", ink: "#2B1B44" } },
  burstBg: "#FFDE4D", burstInk: "#2B1B44",
  footerBg: "#2B1B44", footerInk: "#FFDE4D", footerAccent: "#2EC4B6",
  subEmoji: "☀️",
};

T["new-york-city"] = {
  layout: "stickers",
  placeShort: "NYC",
  fonts: { display: "'Archivo Black'", body: "'Inter'", import: "family=Archivo+Black&family=Inter:ital,wght@0,500;0,700;0,900;1,500" },
  kicker: "FAMHOP · NEW YORK CITY",
  headline: "NEXT STOP:",
  headlineMode: "block",
  blockText: "THIS WEEKEND",
  bg: "#F5F5F2", pattern: { type: "none" },
  ink: "#111111", muted: "#4D4D4D",
  brandBg: "#111111", brandInk: "#ffffff", chipBg: "#FCCC0A", chipInk: "#111111",
  blockBg: "#111111", blockInk: "#ffffff", blockStripe: "#FCCC0A",
  cardBgs: ["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff"],
  day: { sat: { bg: "#EE352E", ink: "#fff" }, sun: { bg: "#00933C", ink: "#fff" }, both: { bg: "#FF6319", ink: "#fff" } },
  dayShape: "circle",
  burstBg: "#FCCC0A", burstInk: "#111111",
  footerBg: "#111111", footerInk: "#ffffff", footerAccent: "#FCCC0A",
  subEmoji: "🗽",
  squareCorners: true,
};

T["seattle"] = {
  layout: "stickers",
  fonts: { display: "'Alfa Slab One'", body: "'Archivo'", import: "family=Alfa+Slab+One&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  kicker: "FAMHOP ⛰ SEATTLE",
  headline: "RAIN OR SHINE,",
  headlineMode: "tiles",
  tileWord: "WEEKEND",
  bg: "#1E4D3B", pattern: { type: "rain", color: "#2C6650" },
  ink: "#123227", inkOnBg: "#F2EFE6", muted: "#4E6E60",
  brandBg: "#F2EFE6", brandInk: "#1E4D3B", chipBg: "#E8B547", chipInk: "#123227",
  tiles: [
    { bg: "#8FD0BC", ink: "#123227" }, { bg: "#E8B547", ink: "#123227" }, { bg: "#F2EFE6", ink: "#1E4D3B" },
    { bg: "#5FA890", ink: "#123227" }, { bg: "#D97E4A", ink: "#123227" }, { bg: "#8FD0BC", ink: "#123227" },
    { bg: "#E8B547", ink: "#123227" },
  ],
  cardBgs: ["#F2EFE6", "#EAF3EC", "#F7EEDD", "#F2EFE6", "#EAF3EC", "#F7EEDD"],
  day: { sat: { bg: "#D97E4A", ink: "#123227" }, sun: { bg: "#5FA890", ink: "#123227" }, both: { bg: "#E8B547", ink: "#123227" } },
  burstBg: "#E8B547", burstInk: "#123227",
  footerBg: "#123227", footerInk: "#F2EFE6", footerAccent: "#8FD0BC",
  subEmoji: "🌲", motifRow: "🌲 ⛰ 🌲 ☔ 🌲 ⛰ 🌲",
};

T["houston"] = {
  layout: "stickers",
  fonts: { display: "'Fredoka'", body: "'Nunito'", import: "family=Fredoka:wght@500;600;700&family=Nunito:ital,wght@0,600;0,800;1,600" },
  kicker: "famhop 🚀 houston",
  headline: "LIFT-OFF FOR THE",
  headlineMode: "tiles",
  bg: "#0E1B3C", pattern: { type: "stars", color: "#3B4C79" },
  ink: "#101E40", inkOnBg: "#F4F1FF", muted: "#54608A",
  brandBg: "#F4F1FF", brandInk: "#0E1B3C", chipBg: "#FF7A5C", chipInk: "#101E40",
  tiles: [
    { bg: "#FF7A5C", ink: "#101E40" }, { bg: "#7FDBE8", ink: "#101E40" }, { bg: "#FFD166", ink: "#101E40" },
    { bg: "#C3A6FF", ink: "#101E40" }, { bg: "#F4F1FF", ink: "#0E1B3C" }, { bg: "#7FDBE8", ink: "#101E40" },
    { bg: "#FFD166", ink: "#101E40" },
  ],
  cardBgs: ["#F4F1FF", "#EAF7FA", "#FFF3DA", "#F1EAFF", "#F4F1FF", "#EAF7FA"],
  day: { sat: { bg: "#FF7A5C", ink: "#101E40" }, sun: { bg: "#7FDBE8", ink: "#101E40" }, both: { bg: "#FFD166", ink: "#101E40" } },
  burstBg: "#FFD166", burstInk: "#101E40",
  footerBg: "#060F26", footerInk: "#F4F1FF", footerAccent: "#7FDBE8",
  subEmoji: "🪐", motifRow: "🚀 ✦ 🪐 ✦ ⭐ ✦ 🛰 ✦ 🌙",
};

T["dallas-fort-worth"] = {
  layout: "stickers",
  placeShort: "the Metroplex",
  fonts: { display: "'Rye'", body: "'Archivo'", import: "family=Rye&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  kicker: "FAMHOP ✪ DFW",
  headline: "SADDLE UP FOR THE",
  headlineMode: "tiles",
  bg: "#F3E3C3", pattern: { type: "dots", color: "#DCC69A" },
  ink: "#4A2C17", muted: "#7C5B3A",
  brandBg: "#4A2C17", brandInk: "#F3E3C3", chipBg: "#C8402A", chipInk: "#FFF4E2",
  tiles: [
    { bg: "#C8402A", ink: "#FFF4E2" }, { bg: "#2EA8A0", ink: "#3A2410" }, { bg: "#E9A13B", ink: "#3A2410" },
    { bg: "#8A5A2B", ink: "#FFF4E2" }, { bg: "#C8402A", ink: "#FFF4E2" }, { bg: "#2EA8A0", ink: "#3A2410" },
    { bg: "#E9A13B", ink: "#3A2410" },
  ],
  cardBgs: ["#FFF4E2", "#F3EFE2", "#FBEBD3", "#FFF4E2", "#F3EFE2", "#FBEBD3"],
  day: { sat: { bg: "#C8402A", ink: "#FFF4E2" }, sun: { bg: "#2EA8A0", ink: "#3A2410" }, both: { bg: "#E9A13B", ink: "#3A2410" } },
  burstBg: "#E9A13B", burstInk: "#3A2410",
  footerBg: "#4A2C17", footerInk: "#F3E3C3", footerAccent: "#2EA8A0",
  subEmoji: "🤠", motifRow: "🤠 ★ 🐎 ★ 🌵 ★ 🐂 ★ 🤠",
};

T["atlanta"] = {
  layout: "stickers",
  fonts: { display: "'Lilita One'", body: "'Nunito'", import: "family=Lilita+One&family=Nunito:ital,wght@0,600;0,800;1,600" },
  kicker: "famhop 🍑 atlanta",
  headline: "SWEETEST PICKS OF THE",
  headlineMode: "tiles",
  bg: "#FFD9B0", pattern: { type: "dots", color: "#F2B87E" },
  ink: "#4B2E2B", muted: "#8A5A50",
  brandBg: "#4B2E2B", brandInk: "#FFD9B0", chipBg: "#fff", chipInk: "#4B2E2B",
  tiles: [
    { bg: "#FF7657", ink: "#fff" }, { bg: "#5B8C51", ink: "#fff" }, { bg: "#FFB627", ink: "#4B2E2B" },
    { bg: "#F48FB1", ink: "#4B2E2B" }, { bg: "#FF7657", ink: "#fff" }, { bg: "#5B8C51", ink: "#fff" },
    { bg: "#FFB627", ink: "#4B2E2B" },
  ],
  cardBgs: ["#FFF2E3", "#EFF5E7", "#FFEFD3", "#FDEAF0", "#FFF2E3", "#EFF5E7"],
  day: { sat: { bg: "#FF7657", ink: "#fff" }, sun: { bg: "#5B8C51", ink: "#fff" }, both: { bg: "#FFB627", ink: "#4B2E2B" } },
  burstBg: "#FFB627", burstInk: "#4B2E2B",
  footerBg: "#4B2E2B", footerInk: "#FFD9B0", footerAccent: "#FFB627",
  subEmoji: "🍑",
};

T["philadelphia"] = {
  layout: "stickers",
  placeShort: "Philly",
  fonts: { display: "'Bungee'", body: "'Archivo'", import: "family=Bungee&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  kicker: "FAMHOP ✦ PHILLY",
  headline: "BROTHERLY LOVE +",
  headlineMode: "tiles",
  bg: "#EFE7D8", pattern: { type: "dots", color: "#D9CDB4" },
  ink: "#21315C", muted: "#5A6488",
  brandBg: "#21315C", brandInk: "#EFE7D8", chipBg: "#C8102E", chipInk: "#fff",
  tiles: [
    { bg: "#C8102E", ink: "#fff" }, { bg: "#21315C", ink: "#fff" }, { bg: "#3E8E5A", ink: "#fff" },
    { bg: "#F2A900", ink: "#21315C" }, { bg: "#C8102E", ink: "#fff" }, { bg: "#21315C", ink: "#fff" },
    { bg: "#3E8E5A", ink: "#fff" },
  ],
  cardBgs: ["#FBF6EA", "#EEF1F8", "#EDF5EE", "#FDF3DC", "#FBF6EA", "#EEF1F8"],
  day: { sat: { bg: "#C8102E", ink: "#fff" }, sun: { bg: "#3E8E5A", ink: "#fff" }, both: { bg: "#F2A900", ink: "#21315C" } },
  burstBg: "#F2A900", burstInk: "#21315C",
  footerBg: "#21315C", footerInk: "#EFE7D8", footerAccent: "#F2A900",
  subEmoji: "🔔",
};

T["phoenix"] = {
  layout: "stickers",
  placeShort: "the Valley",
  fonts: { display: "'Chewy'", body: "'Nunito'", import: "family=Chewy&family=Nunito:ital,wght@0,600;0,800;1,600" },
  kicker: "famhop 🌵 phoenix",
  headline: "DESERT-COOL",
  headlineMode: "tiles",
  bg: "linear-gradient(180deg,#FFB36B 0%,#FF7B54 46%,#C1508B 100%)",
  pattern: { type: "none" },
  ink: "#4A1E33", muted: "#84455C",
  brandBg: "#4A1E33", brandInk: "#FFD9A0", chipBg: "#FFF3E0", chipInk: "#4A1E33",
  tiles: [
    { bg: "#FFF3E0", ink: "#4A1E33" }, { bg: "#3E7C59", ink: "#FFF3E0" }, { bg: "#FFD166", ink: "#4A1E33" },
    { bg: "#8E3B6B", ink: "#FFF3E0" }, { bg: "#FFF3E0", ink: "#4A1E33" }, { bg: "#3E7C59", ink: "#FFF3E0" },
    { bg: "#FFD166", ink: "#4A1E33" },
  ],
  cardBgs: ["#FFF3E0", "#FBE8D8", "#FFF0C9", "#F9E4EE", "#FFF3E0", "#FBE8D8"],
  day: { sat: { bg: "#8E3B6B", ink: "#FFF3E0" }, sun: { bg: "#3E7C59", ink: "#FFF3E0" }, both: { bg: "#FFD166", ink: "#4A1E33" } },
  burstBg: "#FFD166", burstInk: "#4A1E33",
  footerBg: "#4A1E33", footerInk: "#FFD9A0", footerAccent: "#FFD166",
  subEmoji: "🌵", motifRow: "🌵 ☀️ 🌵 🦎 🌵 ☀️ 🌵",
};

T["san-diego"] = {
  layout: "stickers",
  fonts: { display: "'Fredoka'", body: "'Nunito'", import: "family=Fredoka:wght@500;600;700&family=Nunito:ital,wght@0,600;0,800;1,600" },
  kicker: "famhop 🌊 san diego",
  headline: "SURF'S UP ON THE",
  headlineMode: "tiles",
  bg: "#BEE9F4", pattern: { type: "waves", color: "#8FD3E8" },
  ink: "#144A66", muted: "#4A7B94",
  brandBg: "#144A66", brandInk: "#BEE9F4", chipBg: "#fff", chipInk: "#144A66",
  tiles: [
    { bg: "#FF8A5C", ink: "#144A66" }, { bg: "#1B7FA6", ink: "#fff" }, { bg: "#FFD166", ink: "#144A66" },
    { bg: "#FFF6E5", ink: "#144A66" }, { bg: "#FF8A5C", ink: "#144A66" }, { bg: "#1B7FA6", ink: "#fff" },
    { bg: "#FFD166", ink: "#144A66" },
  ],
  cardBgs: ["#FFF6E5", "#EAF8FC", "#FFF0D6", "#F1FAF5", "#FFF6E5", "#EAF8FC"],
  day: { sat: { bg: "#FF8A5C", ink: "#144A66" }, sun: { bg: "#1B7FA6", ink: "#fff" }, both: { bg: "#FFD166", ink: "#144A66" } },
  burstBg: "#FFD166", burstInk: "#144A66",
  footerBg: "#144A66", footerInk: "#BEE9F4", footerAccent: "#FFD166",
  subEmoji: "🏄", motifRow: "🌊 🏄 🌊 🐚 🌊 ☀️ 🌊",
};

T["honolulu"] = {
  layout: "stickers",
  placeShort: "Oʻahu",
  fonts: { display: "'Baloo 2'", body: "'Nunito'", import: "family=Baloo+2:wght@600;700;800&family=Nunito:ital,wght@0,600;0,800;1,600" },
  kicker: "famhop 🌺 honolulu",
  headline: "ALOHA, IT'S THE",
  headlineMode: "tiles",
  bg: "#FFF3D6", pattern: { type: "dots", color: "#F5D98F" },
  ink: "#28524E", muted: "#5F8380",
  brandBg: "#28524E", brandInk: "#FFF3D6", chipBg: "#E4572E", chipInk: "#FFF3D6",
  tiles: [
    { bg: "#E4572E", ink: "#FFF3D6" }, { bg: "#17A398", ink: "#FFF3D6" }, { bg: "#FFC93C", ink: "#28524E" },
    { bg: "#EF7BAA", ink: "#28524E" }, { bg: "#6BAB58", ink: "#FFF3D6" }, { bg: "#17A398", ink: "#FFF3D6" },
    { bg: "#FFC93C", ink: "#28524E" },
  ],
  cardBgs: ["#FFF9EC", "#E9F6F2", "#FFF3D0", "#FCEDF3", "#EFF6E9", "#E9F6F2"],
  day: { sat: { bg: "#E4572E", ink: "#FFF3D6" }, sun: { bg: "#17A398", ink: "#FFF3D6" }, both: { bg: "#FFC93C", ink: "#28524E" } },
  burstBg: "#FFC93C", burstInk: "#28524E",
  footerBg: "#28524E", footerInk: "#FFF3D6", footerAccent: "#FFC93C",
  subEmoji: "🌺", motifRow: "🌺 🌴 🍍 🐠 🌺 🌴 🌊",
};

// --- bill layouts ---

T["chicago"] = {
  layout: "bill",
  fonts: { display: "'Archivo Black'", body: "'Archivo'", import: "family=Archivo+Black&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  paper: "#FFFDF7", ink: "#17202A", muted: "#5B6770",
  accent: "#E23A3A", accentInk: "#fff",
  band: { bg: "#9BD1E8", border: "#17202A" },
  kicker: "FAMHOP PRESENTS ★ FAMILY EDITION",
  datesBg: "#17202A", datesInk: "#9BD1E8",
  tagHighlight: "#9BD1E8",
  star: "★", starColor: "#E23A3A",
  starSvg: `<svg width="46" height="46" viewBox="0 0 54 54"><polygon fill="#E23A3A" points="27,1 33.6,17.1 50.9,15.6 37.7,26.9 44.4,43 27,35.5 9.6,43 16.3,26.9 3.1,15.6 20.4,17.1"/></svg>`,
  footerLeft: "EVERY EVENT VERIFIED FROM OFFICIAL SOURCES",
};

T["los-angeles"] = {
  layout: "bill",
  fonts: { display: "'Shrikhand'", body: "'Poppins'", import: "family=Shrikhand&family=Poppins:ital,wght@0,500;0,700;0,800;1,500" },
  paper: "#FFF6EC", ink: "#43254B", muted: "#8A6A7E",
  accent: "#FF6B6B", accentInk: "#fff",
  band: { bg: "linear-gradient(90deg,#FFB36B,#FF6B6B,#9B5DE5)", border: "#43254B" },
  kicker: "FAMHOP ✦ CITY OF ANGELS ✦ FAMILY EDITION",
  datesBg: "#43254B", datesInk: "#FFD9A8",
  tagHighlight: "#FFD9A8",
  star: "✦", starColor: "#FF6B6B",
  headlineBackdrop: "radial-gradient(circle at 50% 115%, #FFB36B 0%, #FF6B6B 34%, transparent 62%)",
  daymarkEmoji: { sat: "🌴", sun: "🌴" },
  displayCase: "none",
  footerLeft: "EVERY EVENT VERIFIED FROM OFFICIAL SOURCES",
};

T["austin"] = {
  layout: "bill",
  fonts: { display: "'Bungee'", body: "'Archivo'", import: "family=Bungee&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  paper: "#1B1035", ink: "#FFF8E7", muted: "#B9A8D9",
  accent: "#FF4D9D", accentInk: "#1B1035",
  band: { bg: "#FF8E3C", border: "#FFF8E7" },
  kicker: "FAMHOP ✶ LIVE MUSIC CAPITAL ✶ FAMILY EDITION",
  datesBg: "#FF4D9D", datesInk: "#1B1035",
  tagHighlight: "#FF8E3C", tagInk: "#1B1035",
  star: "✶", starColor: "#FF8E3C",
  ruleColor: "#FF4D9D",
  daymarkEmoji: { sat: "🎸", sun: "🎸" },
  footerLeft: "EVERY EVENT VERIFIED FROM OFFICIAL SOURCES",
};

T["washington-dc"] = {
  layout: "bill",
  fonts: { display: "'Playfair Display'", body: "'Archivo'", import: "family=Playfair+Display:wght@700;900&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  paper: "#FBF7F2", ink: "#1F2A44", muted: "#6B7285",
  accent: "#E77FA1", accentInk: "#1F2A44",
  band: { bg: "#1F2A44", border: "#1F2A44", ink: "#FBF7F2" },
  kicker: "FAMHOP · THE FAMILY WEEKEND PROGRAM",
  datesBg: "#E77FA1", datesInk: "#1F2A44",
  tagHighlight: "#F3D9E2",
  star: "❀", starColor: "#E77FA1",
  displayCase: "none",
  daymarkEmoji: { sat: "🌸", sun: "🌸" },
  footerLeft: "EVERY EVENT VERIFIED FROM OFFICIAL SOURCES",
};

T["miami"] = {
  layout: "bill",
  fonts: { display: "'Righteous'", body: "'Poppins'", import: "family=Righteous&family=Poppins:ital,wght@0,500;0,700;0,800;1,500" },
  paper: "#DFF6F0", ink: "#0E4F5C", muted: "#4E8490",
  accent: "#FF7BAC", accentInk: "#0E4F5C",
  band: { bg: "linear-gradient(90deg,#FF7BAC,#FFB36B,#7FDBE8)", border: "#0E4F5C" },
  kicker: "FAMHOP ✦ MAGIC CITY ✦ FAMILY EDITION",
  datesBg: "#0E4F5C", datesInk: "#7FDBE8",
  tagHighlight: "#FFD9E7",
  star: "✦", starColor: "#FF7BAC",
  daymarkEmoji: { sat: "🦩", sun: "🌴" },
  footerLeft: "EVERY EVENT VERIFIED FROM OFFICIAL SOURCES",
};

T["boston"] = {
  layout: "bill",
  fonts: { display: "'Abril Fatface'", body: "'Archivo'", import: "family=Abril+Fatface&family=Archivo:ital,wght@0,500;0,700;0,900;1,500" },
  paper: "#F7F1E3", ink: "#22314E", muted: "#6A6E60",
  accent: "#A63A2B", accentInk: "#F7F1E3",
  band: { bg: "#22314E", border: "#22314E", ink: "#F7F1E3" },
  kicker: "FAMHOP · THE FAMILY WEEKEND BILL",
  datesBg: "#A63A2B", datesInk: "#F7F1E3",
  tagHighlight: "#E7DDC4",
  star: "⚓", starColor: "#A63A2B",
  displayCase: "none",
  footerLeft: "EVERY EVENT VERIFIED FROM OFFICIAL SOURCES",
};

export const POSTER_THEMES = T;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function fontLink(theme) {
  return `<link href="https://fonts.googleapis.com/css2?${theme.fonts.import}&display=swap" rel="stylesheet">`;
}

function patternCss(pattern) {
  if (!pattern || pattern.type === "none") return "";
  const c = pattern.color;
  if (pattern.type === "dots")
    return `background-image:radial-gradient(${c} 3.5px, transparent 3.5px);background-size:64px 64px;opacity:.35;`;
  if (pattern.type === "stars")
    return `background-image:radial-gradient(${c} 2px, transparent 2px),radial-gradient(${c} 1.4px, transparent 1.4px);background-size:96px 96px,52px 52px;background-position:0 0,26px 34px;opacity:.5;`;
  if (pattern.type === "rain")
    return `background-image:linear-gradient(${c} 44%, transparent 44%);background-size:5px 90px;opacity:.22;`;
  if (pattern.type === "waves")
    return `background-image:radial-gradient(circle at 50% 0, transparent 18px, ${c} 18px, ${c} 22px, transparent 23px);background-size:64px 44px;opacity:.4;`;
  return "";
}

// ---------------------------------------------------------------------------
// Layout: stickers
// ---------------------------------------------------------------------------

function renderStickers(theme, data) {
  const inkOnBg = theme.inkOnBg || theme.ink;
  const radius = theme.squareCorners ? "6px" : "26px";
  const tileWord = (theme.tileWord || "WEEKEND").split("");
  const tilt = [-4, 3, -2, 4, -3, 2, -4];
  const cardTilt = [-1.2, 1, 0.8, -1, 1.1, -0.8];

  const headlineHtml =
    theme.headlineMode === "block"
      ? `<div class="hed"><div class="line1">${esc(theme.headline)}</div>
         <div class="block">${esc(theme.blockText || "THIS WEEKEND")}</div></div>`
      : `<div class="hed"><div class="line1">${esc(theme.headline)}</div>
         <div class="tiles">${tileWord
           .map((ch, i) => {
             const t = theme.tiles[i % theme.tiles.length];
             return `<span style="background:${t.bg};color:${t.ink};transform:rotate(${tilt[i % tilt.length]}deg)">${esc(ch)}</span>`;
           })
           .join("")}</div></div>`;

  const cardsHtml = data.cards
    .map((card, i) => {
      const day = theme.day[card.dayKey] || theme.day.sat;
      const burst = card.badge
        ? `<div class="burst${card.badge === "FREE" ? "" : " small"}">${esc(card.badge)}</div>`
        : "";
      return `<div class="card" style="background:${theme.cardBgs[i % theme.cardBgs.length]};transform:rotate(${cardTilt[i % cardTilt.length]}deg)">
        ${burst}
        <div class="meta"><span class="day" style="background:${day.bg};color:${day.ink}">${esc(card.dayLabel)}</span><span class="time">${esc(card.time)}</span></div>
        <h2>${esc(card.title)}</h2>
        <div class="where">${esc(card.where)}</div>
      </div>`;
    })
    .join("");

  const motifHtml = theme.motifRow
    ? `<div class="motif">${esc(theme.motifRow)}</div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8">${fontLink(theme)}<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${POSTER_W}px; height:${POSTER_H}px; }
  body { font-family:${theme.fonts.body},'Avenir Next',sans-serif; background:${theme.bg};
    color:${inkOnBg}; overflow:hidden; position:relative; }
  body::before { content:""; position:absolute; inset:0; ${patternCss(theme.pattern)} }
  .page { position:relative; padding:44px 64px 0; height:100%; display:flex; flex-direction:column; }
  .masthead { display:flex; align-items:center; justify-content:space-between; }
  .brand { font-family:${theme.fonts.display}; font-weight:800; font-size:33px; letter-spacing:.5px;
    background:${theme.brandBg}; color:${theme.brandInk}; padding:6px 22px 10px; border-radius:${theme.squareCorners ? "8px" : "999px"}; }
  .datechip { font-family:${theme.fonts.display}; font-weight:700; font-size:29px;
    background:${theme.chipBg}; color:${theme.chipInk}; border:4px solid ${theme.ink}; border-radius:${theme.squareCorners ? "8px" : "999px"};
    padding:4px 24px 8px; box-shadow:6px 6px 0 ${theme.ink}; white-space:nowrap; }
  .hed { margin-top:26px; line-height:.98; }
  .hed .line1 { font-family:${theme.fonts.display}; font-weight:800; font-size:52px; letter-spacing:2px; color:${inkOnBg}; }
  .tiles { display:flex; gap:10px; margin-top:10px; }
  .tiles span { font-family:${theme.fonts.display}; font-weight:800; font-size:80px; line-height:1;
    padding:2px 16px 10px; border-radius:${theme.squareCorners ? "8px" : "20px"}; border:5px solid ${theme.ink};
    box-shadow:7px 7px 0 ${theme.ink}; display:inline-block; }
  .block { display:inline-block; margin-top:12px; font-family:${theme.fonts.display}; font-size:76px; line-height:1;
    background:${theme.blockBg || theme.ink}; color:${theme.blockInk || "#fff"}; padding:14px 26px 18px;
    border-radius:${theme.squareCorners ? "6px" : "18px"}; box-shadow:8px 8px 0 ${theme.blockStripe || theme.muted};
    border-bottom:12px solid ${theme.blockStripe || theme.muted}; }
  .sub { margin-top:22px; font-size:28px; font-weight:800; color:${inkOnBg}; }
  .sub b { background:${theme.brandBg}; color:${theme.brandInk}; border-radius:10px; padding:2px 12px 4px; }
  .grid { margin-top:28px; display:grid; grid-template-columns:1fr 1fr; gap:${data.cards.length <= 4 ? "30px" : "22px"}; }
  .card { border:5px solid ${theme.ink}; border-radius:${radius}; box-shadow:8px 8px 0 ${theme.ink};
    padding:18px 22px 16px; position:relative; height:${data.cards.length <= 4 ? "252px" : "206px"}; overflow:visible; color:${theme.ink}; }
  .meta { display:flex; gap:12px; align-items:center; }
  .day { font-family:${theme.fonts.display}; font-weight:800; font-size:${theme.dayShape === "circle" ? "22px" : "25px"}; letter-spacing:1px;
    padding:${theme.dayShape === "circle" ? "0" : "2px 16px 6px"}; border-radius:${theme.dayShape === "circle" ? "50%" : "12px"};
    border:3px solid ${theme.ink}; white-space:nowrap;
    ${theme.dayShape === "circle" ? "width:58px;height:58px;display:inline-flex;align-items:center;justify-content:center;font-size:19px;" : ""} }
  .time { font-weight:800; font-size:25px; color:${theme.muted}; }
  .card h2 { font-family:${theme.fonts.display}; font-weight:700; font-size:32px; line-height:1.06; margin-top:8px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .where { margin-top:6px; font-size:22px; font-weight:600; color:${theme.muted}; font-style:italic;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .burst { position:absolute; top:-20px; right:-14px; width:100px; height:100px; z-index:2;
    display:flex; align-items:center; justify-content:center; text-align:center;
    font-family:${theme.fonts.display}; font-weight:800; font-size:26px; line-height:.95; color:${theme.burstInk};
    background:${theme.burstBg}; border:4px solid ${theme.ink}; border-radius:50%;
    transform:rotate(10deg); box-shadow:4px 4px 0 ${theme.ink}; padding:6px; }
  .burst.small { font-size:20px; }
  .motif { text-align:center; font-size:${data.cards.length <= 4 ? "44px" : "34px"}; letter-spacing:18px; opacity:.85; margin:auto 0; padding:16px 0; }
  .footer { margin-top:auto; margin-left:-64px; margin-right:-64px; position:relative;
    background:${theme.footerBg}; color:${theme.footerInk}; padding:22px 64px 26px;
    display:flex; justify-content:space-between; align-items:center; }
  .footer .count { font-family:${theme.fonts.display}; font-weight:800; font-size:28px; white-space:nowrap; }
  .footer .url { font-family:${theme.fonts.display}; font-weight:800; font-size:28px; white-space:nowrap; }
  .footer .url span { color:${theme.footerAccent}; }
</style></head><body><div class="page">
  <div class="masthead"><div class="brand">${esc(theme.kicker)}</div><div class="datechip">${esc(data.dateChipShort)}</div></div>
  ${headlineHtml}
  <div class="sub">${esc(theme.subEmoji)} &nbsp;<b>${data.count} family events</b> ${esc(data.subTail)}</div>
  <div class="grid">${cardsHtml}</div>
  ${motifHtml}
  <div class="footer">
    <div class="count">${esc(data.footerLeft)}</div>
    <div class="url">all details → <span>famhop.com</span></div>
  </div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Layout: bill
// ---------------------------------------------------------------------------

function renderBill(theme, data) {
  const bandInk = theme.band.ink || theme.ink;
  const ruleColor = theme.ruleColor || theme.ink;
  const displayCase = theme.displayCase || "uppercase";
  const starOf = (emoji) =>
    theme.starSvg || `<span style="color:${theme.starColor};font-size:40px;line-height:1">${esc(emoji || theme.star)}</span>`;

  const daysHtml = data.days
    .map((day) => {
      const emo = theme.daymarkEmoji?.[day.key] || "";
      const under = day.undercard.length
        ? `<div class="undercard">${day.undercard
            .map((name) => `<span class="ev">${esc(name)}</span>`)
            .join(` <span class="dot">${esc(theme.star)}</span> `)}</div>`
        : "";
      const note = day.note ? `<div class="undernote">${esc(day.note)}</div>` : "";
      const hLen = day.headliner.title.length + (day.headliner.free ? 5 : 0);
      const hSize = hLen <= 17 ? 56 : hLen <= 23 ? 48 : 42;
      return `<div class="dayblock">
      <div class="daymark"><div class="rule"></div><div class="label">${emo ? esc(emo) + " " : ""}${esc(day.label)}${emo ? " " + esc(emo) : ""}</div><div class="rule"></div></div>
      <div class="headliner" style="font-size:${hSize}px">${esc(day.headliner.title)}${day.headliner.free ? `<span class="free">FREE</span>` : ""}</div>
      <div class="venueline">${esc(day.headliner.venueLine)}</div>
      ${under}${note}</div>`;
    })
    .join("");
  const citySize = data.cityLine.length > 12 ? 84 : data.cityLine.length > 8 ? 100 : 118;

  return `<!doctype html><html><head><meta charset="utf-8">${fontLink(theme)}<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${POSTER_W}px; height:${POSTER_H}px; }
  body { font-family:${theme.fonts.body},'Helvetica Neue',sans-serif; background:${theme.paper}; color:${theme.ink};
    overflow:hidden; position:relative; display:flex; flex-direction:column; }
  .band { background:${theme.band.bg}; height:64px; flex:none; position:relative; }
  .band.top { border-bottom:5px solid ${theme.band.border}; }
  .band.bottom { border-top:5px solid ${theme.band.border}; margin-top:auto;
    display:flex; align-items:center; justify-content:space-between; padding:0 64px;
    font-family:${theme.fonts.display}; font-size:23px; color:${bandInk}; white-space:nowrap; }
  .band.bottom .url { background:${theme.accent}; color:${theme.accentInk}; padding:6px 20px 8px; transform:rotate(-1.5deg);
    box-shadow:5px 5px 0 ${theme.ink}; }
  .inner { padding:40px 64px 0; flex:1; display:flex; flex-direction:column; min-height:0; position:relative; }
  ${theme.headlineBackdrop ? `.inner::before { content:""; position:absolute; top:-40px; left:-64px; right:-64px; height:520px; background:${theme.headlineBackdrop}; opacity:.35; pointer-events:none; }` : ""}
  .masthead { display:flex; justify-content:space-between; align-items:baseline; gap:16px; position:relative; }
  .kicker { font-weight:900; font-size:19px; letter-spacing:3px; white-space:nowrap; }
  .dates { font-weight:900; font-size:19px; letter-spacing:1px; background:${theme.datesBg}; color:${theme.datesInk}; padding:4px 14px 6px; white-space:nowrap; flex:none; }
  h1 { font-size:10px; margin-top:16px; position:relative; }
  h1 .l1 { display:block; font-family:${theme.fonts.display}; font-size:${citySize}px; line-height:1; letter-spacing:-2px;
    text-transform:${displayCase}; white-space:nowrap; }
  h1 .l2 { display:block; font-family:${theme.fonts.display}; font-size:82px; line-height:1.12; letter-spacing:-1px;
    color:${theme.accent === theme.paper ? theme.ink : theme.accent}; text-transform:${displayCase}; }
  .stars { display:flex; gap:22px; margin:28px 0 0; align-items:center; position:relative; }
  .stars .tag { font-weight:900; font-size:26px; letter-spacing:1px; white-space:nowrap; }
  .stars .tag em { font-style:normal; background:${theme.tagHighlight}; color:${theme.tagInk || theme.ink}; padding:2px 12px 4px; box-shadow:4px 4px 0 ${theme.ink}; }
  .bill { margin-top:10px; text-align:center; position:relative; flex:1; display:flex; flex-direction:column;
    justify-content:space-evenly; padding-bottom:26px; }
  .daymark { display:flex; align-items:center; gap:22px; margin:0 0 18px; }
  .daymark .rule { flex:1; height:5px; background:${ruleColor}; }
  .daymark .label { font-family:${theme.fonts.display}; font-size:30px; letter-spacing:7px; }
  .headliner { font-family:${theme.fonts.display}; font-size:54px; line-height:1.04; text-transform:${displayCase};
    white-space:nowrap; overflow:hidden; }
  .headliner .free { display:inline-block; vertical-align:middle; margin-left:16px; background:${theme.accent}; color:${theme.accentInk};
    font-family:${theme.fonts.display}; font-size:23px; padding:4px 14px 6px; transform:rotate(3deg); letter-spacing:1px;
    box-shadow:4px 4px 0 ${theme.ink}; }
  .venueline { font-weight:700; font-size:23px; letter-spacing:1px; margin-top:8px; color:${theme.muted}; text-transform:uppercase;
    white-space:nowrap; overflow:hidden; }
  .undercard { font-family:${theme.fonts.display}; font-size:31px; line-height:1.42; text-transform:${displayCase};
    margin-top:16px; max-height:136px; overflow:hidden; }
  .undercard .dot { color:${theme.starColor}; padding:0 12px; }
  .undercard .ev { white-space:nowrap; }
  .undernote { font-weight:500; font-style:italic; font-size:23px; color:${theme.muted}; margin-top:8px;
    white-space:nowrap; overflow:hidden; }
</style></head><body>
  <div class="band top"></div>
  <div class="inner">
    <div class="masthead"><div class="kicker">${esc(theme.kicker)}</div><div class="dates">${esc(data.dateChipLong)}</div></div>
    <h1><span class="l1">${esc(data.cityLine)}</span><span class="l2">THIS WEEKEND</span></h1>
    <div class="stars">${starOf()}${starOf()}<div class="tag">${data.count} kid-friendly picks &nbsp;·&nbsp; <em>${esc(data.tagLine)}</em></div></div>
    <div class="bill">${daysHtml}</div>
  </div>
  <div class="band bottom"><div>${esc(theme.footerLeft)}</div><div class="url">famhop.com</div></div>
</body></html>`;
}

// ---------------------------------------------------------------------------

export function buildPosterHtml(theme, data) {
  return theme.layout === "bill" ? renderBill(theme, data) : renderStickers(theme, data);
}
