#!/usr/bin/env node
// Emit the YouTube upload sheet + manifest for the built evergreen guides, so
// the description can never drift from what the video actually shows (recap
// lines are built from the same resolved scene data the video was built from).
//
//   node videos/build-guides-metadata.mjs [--guide <id>]   # all guides if omitted

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH_TERMS, HASHTAG } from "./seo-terms.mjs";
import { resolveRef, resolveScene, isFree, metroLabel } from "./build-guides.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const GUIDES = join(HERE, "guides");
const DELIVERY = join(HERE, "delivery-guides");

function argFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function loadSpec(id) {
  return JSON.parse(readFileSync(join(GUIDES, id, "spec.json"), "utf8"));
}

// One recap line per scene, numbered to match the video's card order.
function recapLines(spec) {
  const lines = [];
  let cardNo = 0;
  for (const raw of spec.scenes) {
    const s = resolveScene(raw);
    const d = s.data;
    if (s.layout === "card") {
      cardNo++;
      const bits = [d.title];
      if (d.venue) bits.push(d.venue + (d.city ? `, ${d.city}` : ""));
      if (d.slab) bits.push(d.slab);
      if (d.pill && isFree(d.pill)) bits.push("free");
      lines.push(`${String(cardNo).padStart(2, "0")} · ${bits.join(" — ")}`);
    } else if (s.layout === "list") {
      lines.push(`· ${s.head}: ${s.items.map((it) => it.text).join(", ")}`);
    } else if (s.layout === "stat") {
      lines.push(`· ${d.number} ${d.label} (${d.sub})`);
    } else if (s.layout === "section") {
      lines.push(`— ${s.title.join(" ")}`);
    }
  }
  return lines;
}

function buildDescription(spec, scenes) {
  const metro = spec.metros?.[0];
  const url = metro ? `https://famhop.com/${metro}` : "https://famhop.com";
  const annual = scenes.some((s) => String(s.ref || "").startsWith("annual-events") || String(s.ref || "").startsWith("evergreen-events"));
  const desc = [
    `${spec.descriptionLede || `A year-round guide, from the venues' own calendars. All of it: ${url}`}`,
    "",
  ];
  desc.push(...recapLines(spec));
  desc.push("");
  // Only quote a free stat where the guide actually shows one.
  const stat = scenes.find((s) => s.layout === "stat" && /free/i.test(s.data.label));
  if (stat) {
    desc.push(`${metroLabel(stat.ref?.split(":")[1] || metro)}: ${stat.data.number} ${stat.data.label} on the site right now.`);
  }
  desc.push(annual
    ? "No dates in this guide on purpose — these traditions come back every year. FamHop re-checks every event weekly."
    : "Every event here is checked against the venue's own calendar weekly.");
  desc.push("Filter by age, cost and time of day, then turn what you pick into one mapped day.");
  desc.push("Free to use across 16 U.S. metros: https://famhop.com");
  desc.push("Or get 5 picks by email every Friday morning, free.");
  desc.push("");
  const tags = spec.metros?.map((m) => HASHTAG[m]).filter(Boolean) || [];
  desc.push(`${tags.join(" ")} #thingstodowithkids #familyactivities`.trim());
  return desc.join("\n");
}

function buildTags(spec) {
  const tags = [...(spec.seoTerms || [])];
  for (const m of spec.metros || []) tags.push(...(SEARCH_TERMS[m] || []));
  tags.push("family events near me", "famhop");
  // YouTube cap: 500 chars total.
  const out = [];
  let len = 0;
  for (const t of tags) {
    if (len + t.length + 2 > 500) break;
    out.push(t);
    len += t.length + 2;
  }
  return out;
}

function thumbTime(spec) {
  // Thumbnail = the title scene fully revealed: sum of prior scenes + 2.5s.
  let t = 0;
  for (const [i, s] of spec.scenes.entries()) {
    if (i === (spec.thumbnailScene ?? 0)) return Math.max(0.5, t + 2.5);
    t += s.duration;
  }
  return 2.5;
}

async function main() {
  const only = argFlag("--guide");
  const ids = only ? [only] : readdirSync(GUIDES).filter((d) => existsSync(join(GUIDES, d, "spec.json")));

  const manifest = {
    file_tag: "guides",
    shared: {
      categoryId: "22", // Travel & Events
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
      playlist: "", // set from the first guide's spec
    },
    guides: [],
  };

  for (const id of ids) {
    const spec = loadSpec(id);
    const scenes = spec.scenes.map(resolveScene);
    const mp4 = join(DELIVERY, id, `${id}.mp4`);
    if (!existsSync(mp4)) { console.warn(`⚠ skipping ${id}: no rendered mp4 at delivery-guides/${id}/`); continue; }

    const thumb = join(DELIVERY, id, `${id}-thumb.jpg`);
    const ts = thumbTime(spec);
    execFileSync("ffmpeg", ["-y", "-ss", String(ts), "-i", mp4, "-frames:v", "1", "-q:v", "2", thumb], { stdio: "ignore" });

    const description = buildDescription(spec, scenes);
    const tags = buildTags(spec);
    if (!manifest.shared.playlist && spec.playlist) manifest.shared.playlist = spec.playlist;

    const out = [];
    out.push(`# FamHop Guide — ${spec.title}`);
    out.push("");
    out.push(`Files: \`videos/delivery-guides/${id}/${id}.mp4\` · 1920×1080 · H.264 · 30fps.`);
    out.push(`Source: \`videos/guides/${id}/\` — rebuild with`);
    out.push("`node videos/build-guides.mjs --guide " + id + "` (add `--render` to render).");
    out.push("");
    out.push("**Evergreen.** No dates, no years, no weekly counts in the title or");
    out.push("description — the guide's claims stay true all year. Snapshot numbers");
    out.push("are phrased \"on the site right now\".");
    out.push("");
    out.push("## Form settings");
    out.push("");
    out.push("| Field | Value |");
    out.push("|---|---|");
    out.push("| Visibility | **Private → flip to Public in Studio after review** (never re-run the uploader with --privacy public — that would duplicate) |");
    out.push("| Category | Travel & Events |");
    out.push("| Audience | **Not made for kids** — the audience is parents. |");
    out.push("| Altered content | No |");
    out.push("| Language | English |");
    out.push("| Comments | On, sort by top |");
    out.push("| Thumbnail | Title-card frame (auto-extracted) |");
    out.push(`| Playlist | ${spec.playlist || "(none)"} |`);
    out.push("");
    out.push(`**Title (${spec.title.length} chars)**`);
    out.push("```");
    out.push(spec.title);
    out.push("```");
    out.push("");
    out.push("**Description**");
    out.push("```");
    out.push(description);
    out.push("```");
    out.push("");
    out.push("**Tags**");
    out.push("```");
    out.push(tags.join(", "));
    out.push("```");
    out.push("");
    out.push("**Pinned comment**");
    out.push("```");
    out.push(spec.pinnedComment || "Every event here comes from the venue's own calendar — and it's re-checked every week: https://famhop.com");
    out.push("```");
    out.push("");
    writeFileSync(join(GUIDES, id, "YOUTUBE-METADATA.md"), out.join("\n"));

    manifest.guides.push({
      id,
      name: spec.title,
      file: `videos/delivery-guides/${id}/${id}.mp4`,
      thumb: `videos/delivery-guides/${id}/${id}-thumb.jpg`,
      title: spec.title,
      description,
      tags,
    });
    console.log(`wrote videos/guides/${id}/YOUTUBE-METADATA.md  (${spec.title.length}-char title, ${tags.length} tags)`);
  }

  mkdirSync(DELIVERY, { recursive: true });
  writeFileSync(join(DELIVERY, "upload-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`wrote videos/delivery-guides/upload-manifest.json (${manifest.guides.length} guides, playlist "${manifest.shared.playlist}")`);
}

main().catch((e) => { console.error("\n❌ " + e.message); process.exit(1); });
