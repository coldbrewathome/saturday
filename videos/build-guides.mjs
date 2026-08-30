#!/usr/bin/env node
// Build one 16:9 HyperFrames project per evergreen YouTube guide from an
// authored spec.json. The spec is the script: every scene declares a layout,
// a fixed window, and the VO line; card/stat scenes resolve their facts from
// the real data files (annual-events, featured-plans, events feeds) so the
// video can never drift from what the site shows.
//
//   ELEVENLABS_API_KEY=... node videos/build-guides.mjs --guide <id> [--render]
//   node videos/build-guides.mjs --guide <id> --no-vo     # validate + scaffold, no TTS
//
// Voice and settings are identical to the Shorts pipeline (same ElevenLabs
// voice) so the channel sounds like one person.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const GUIDES = join(HERE, "guides");
const TEMPLATE = join(GUIDES, "template");
const VO_CACHE = join(HERE, "vo-guides");
const DELIVERY = join(HERE, "delivery-guides");
const METROS = JSON.parse(readFileSync(join(ROOT, "data", "metros.json"), "utf8"));

const LAYOUTS = ["title", "section", "card", "list", "stat", "cta"];
const TYPES = ["city", "howto", "product", "bucket"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- type fitting
const CHAR_W = 0.55;
const BOX = 1776; // 1920 - 2*72
const CARD_BODY_BOX = 1920 - 72 - 700; // card body column (left 72, right 700)
const CARD_TITLE_BOX = 1920 - 72 - 1300; // title column when a photo occupies the right
const LIST_ROW_BOX = 1920 - 72 - 120 - 36; // rows minus the number column + gap

// Body copy must never exceed 3 lines in the card column. A feed description
// can be hundreds of chars — truncate at a word boundary with an ellipsis
// rather than falling back to the single-line overflow that fit() would emit.
function fitBodyText(text) {
  const perLine = Math.floor(CARD_BODY_BOX / (36 * 0.6));
  let t = String(text);
  if (t.length > perLine * 3) t = t.slice(0, perLine * 3 - 1).replace(/\s+\S*$/, "") + "…";
  return fit(t, [44, 40, 36], 3, 0.6, CARD_BODY_BOX);
}

function fit(text, sizes, maxLines, charW = CHAR_W, box = BOX) {
  for (const size of sizes) {
    const perLine = Math.floor(box / (size * charW));
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = "";
    let tooLong = false;
    for (const w of words) {
      if (w.length > perLine) { tooLong = true; break; }
      const next = cur ? cur + " " + w : w;
      if (next.length <= perLine) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (!tooLong && lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: [String(text)] };
}

// ---------------------------------------------------------------- data refs
// Ref forms:
//   annual-events:<metro>:<slug>     -> {title, venue, city, meta, slab, body}
//   evergreen-events:<metro>:<slug>  -> same, slab from lastHeld fallback
//   free-stats:<metro>[:<ageBand>]   -> {number, label, sub}
//   plan:<metro>:<planId>            -> {title, venue, city, meta, slab, body}
//   event:<metro>:<id|slug>          -> {title, venue, city, meta, pill, body}
const dataCache = {};
function loadJson(path) {
  if (!dataCache[path]) dataCache[path] = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  return dataCache[path];
}
const annualEvents = (m) => loadJson("data/annual-events.json").metros?.[m] ?? [];
const evergreenEvents = (m) => loadJson("data/evergreen-events.json").metros?.[m] ?? [];
const plans = (m) => loadJson(`public/data/${m}/featured-plans.json`).plans ?? [];
const metroEvents = (m) => loadJson(`public/data/${m}/events.json`).events ?? [];
const metroSpots = (m) => loadJson(`public/data/${m}/spots.json`).spots ?? [];
const metroLabel = (m) => METROS.metros?.find((x) => x.id === m)?.label ?? m;

const isFree = (cost) => String(cost).match(/^free/i) != null;

function resolveRef(ref) {
  const p = String(ref).split(":");
  const fail = () => { throw new Error(`unresolved ref: ${ref}`); };
  if (p[0] === "annual-events" || p[0] === "evergreen-events") {
    const [, metro, slug] = p;
    const entry = (p[0] === "annual-events" ? annualEvents : evergreenEvents)(metro).find((e) => e.slug === slug);
    if (!entry) fail();
    const slab = entry.month ? "every " + entry.month.toLowerCase()
      : entry.lastHeld ? "last held " + entry.lastHeld : null;
    return { title: entry.title, venue: entry.venue, city: entry.city,
      meta: "annual", slab, body: entry.description, months: entry.month };
  }
  if (p[0] === "free-stats") {
    const [, metro, ageBand] = p;
    const evs = metroEvents(metro);
    const free = evs.filter((e) => e.cost != null && isFree(e.cost));
    const band = ageBand ? free.filter((e) => Array.isArray(e.ageBands) && e.ageBands.includes(ageBand)) : free;
    return { number: band.length.toLocaleString("en-US"),
      label: ageBand ? `free ${ageBand} events` : "free events",
      sub: `of ${evs.length.toLocaleString("en-US")} · checked from venues' calendars` };
  }
  if (p[0] === "plan") {
    const [, metro, id] = p;
    const plan = plans(metro).find((x) => x.id === id);
    if (!plan) fail();
    const stops = plan.stopIds?.length || 0;
    // First spot whose name shares ≥2 significant tokens with the plan's text —
    // the stops live under curated ids, so match by name for a photo.
    const hay = new Set((plan.name + " " + plan.summary).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const spot = metroSpots(metro).find((s) => {
      if (!s.imageUrl) return false;
      const toks = s.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      return toks.filter((w) => hay.has(w)).length >= 2;
    });
    return { title: plan.name, venue: metroLabel(metro), city: "", meta: "ready-made plan",
      slab: stops > 0 ? `${stops} stops · one route` : "one route", body: plan.summary,
      image: spot?.imageUrl || null };
  }
  if (p[0] === "event") {
    const [, metro, idOrSlug] = p;
    const entry = metroEvents(metro).find((e) => e.id === idOrSlug || e.slug === idOrSlug);
    if (!entry) fail();
    return { title: entry.title, venue: entry.venue, city: entry.city,
      meta: entry.category, pill: isFree(entry.cost) ? "free" : entry.cost, body: entry.description,
      image: entry.imageUrl || null };
  }
  fail();
}

// Merge a scene's inline fields over its ref-resolved data.
function resolveScene(scene) {
  const data = scene.ref ? resolveRef(scene.ref) : {};
  return { ...scene, data: { ...data, ...(scene.inline || {}) } };
}

// ---------------------------------------------------------------- validation
const WORD_CAPS = { title: 30, section: 14, card: 16, list: 0, stat: 12, cta: 14 };

function validateSpec(spec) {
  const errs = [];
  const warns = [];
  if (!spec.id || !/^[a-z0-9-]+$/.test(spec.id)) errs.push("spec.id must be a kebab-case slug");
  if (!TYPES.includes(spec.type)) errs.push(`spec.type must be one of ${TYPES.join("|")} (got "${spec.type}")`);
  if (!spec.title) errs.push("spec.title is required");
  else if (spec.title.length > 100) warns.push(`title is ${spec.title.length} chars (>100)`);
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) errs.push("spec.scenes must be a non-empty array");

  const total = (spec.scenes || []).reduce((a, s) => a + (s.duration || 0), 0);
  if (total < 210 || total > 510) warns.push(`total ${total}s is outside the 3:30–8:30 band`);

  let cardNo = 0;
  spec.scenes?.forEach((s, i) => {
    if (!LAYOUTS.includes(s.layout)) { errs.push(`scene ${i + 1}: unknown layout "${s.layout}"`); return; }
    if (!(s.duration >= 3.5 && s.duration <= 20)) errs.push(`scene ${i + 1}: duration ${s.duration} must be 3.5–20s`);
    if (!s.vo) errs.push(`scene ${i + 1}: vo is required`);
    if (s.vo && /[*()]/.test(s.vo)) warns.push(`scene ${i + 1}: vo contains "*" or "()" — TTS reads them literally`);
    if (s.ref) { try { resolveRef(s.ref); } catch (e) { errs.push(`scene ${i + 1}: ${e.message}`); } }
    const words = (s.vo || "").trim().split(/\s+/).length;
    // Layout caps are density ceilings for a ~7s window; scale linearly with
    // the scene's actual window so longer scenes may carry more narration.
    const cap = Math.ceil((WORD_CAPS[s.layout] || Infinity) * (s.duration / 7));
    if (words > cap) warns.push(`scene ${i + 1} ${s.layout}: ${words} words — over the ${cap}-word budget for a ${s.duration}s window`);
    if (s.layout === "card") {
      cardNo++;
      const d = s.ref ? resolveRef(s.ref) : s.inline || {};
      if (!d.title) errs.push(`scene ${i + 1} (card ${cardNo}): no title — give it a ref or an inline.title`);
    }
    if (s.layout === "list" && (!Array.isArray(s.items) || !s.items.length)) errs.push(`scene ${i + 1}: list needs items[]`);
    if (s.layout === "list" && Array.isArray(s.items) && s.items.length > 6) errs.push(`scene ${i + 1}: at most 6 list items`);
    if (s.layout === "stat") {
      const d = s.ref ? resolveRef(s.ref) : s.inline || {};
      if (!d.number) errs.push(`scene ${i + 1}: stat needs a number (ref or inline)`);
    }
    if (s.layout === "title" && !Array.isArray(s.h1)) errs.push(`scene ${i + 1}: title needs h1[]`);
    if (s.layout === "section" && !Array.isArray(s.title)) errs.push(`scene ${i + 1}: section needs title[] (1–2 lines)`);
    if (s.layout === "cta" && (!Array.isArray(s.head) || !s.url)) errs.push(`scene ${i + 1}: cta needs head[] and url`);
  });
  return { errs, warns, total, cards: cardNo };
}

// ---------------------------------------------------------------- narration
async function tts(text, outPath) {
  if (existsSync(outPath)) return;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set (use --no-vo to skip narration)");
  const voice = process.env.ELEVENLABS_VOICE_ID || "Gubgw9l4dtIoQA9YZHgx";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  console.log("   tts " + outPath.replace(HERE + "/", "") + "  " + text.slice(0, 60));
}

const voFilename = (text) => createHash("sha1").update(text).digest("hex").slice(0, 16) + ".mp3";

// Download a card photo into the project (never render from a hot-linked URL —
// assets must be local). Returns the local path or null when the image is
// unreachable, not an image, or implausibly small.
async function downloadImage(url, dest) {
  if (existsSync(dest)) return dest;
  // Wikimedia throttles bursts — back off and retry on 429/5xx.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") || "";
      if (!type.startsWith("image/")) throw new Error(`not an image (${type})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 20_000) throw new Error(`implausibly small (${buf.length} bytes)`);
      writeFileSync(dest, buf);
      return dest;
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") { await new Promise((r) => setTimeout(r, 2000)); continue; }
      console.warn(`   ⚠ dropping image ${url.slice(0, 80)} — ${e.message}`);
      return null;
    }
  }
  console.warn(`   ⚠ dropping image ${url.slice(0, 80)} — rate-limited after 4 attempts`);
  return null;
}

const secondsOf = (p) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim());

// ---------------------------------------------------------------- scene HTML
// One shared chrome per scene: famhop mark + mono kicker top, url foot bottom.
function chromeHtml(kicker) {
  return `        <div class="chrome mono"><span class="mark"><i></i>famhop</span><span class="r">${esc(kicker)}</span></div>
        <div class="foot mono">famhop.com</div>`;
}

function linesHtml(ids, lines, fitRes, cls) {
  return lines.map((l, k) =>
    `          <span class="tl"><span class="tc ${cls || ""}" id="${ids[k]}" style="font-size:${fitRes[k].size}px">${esc(l)}</span></span>`
  ).join("\n");
}

function htmlTitle(scene, i) {
  const h1 = scene.h1;
  const a = scene.accent || [1];
  const fitH1 = fit(h1[0] || "", [150, 140, 128, 116, 104], 1);
  const h2fit = h1.slice(1).map((l) => fit(l, [120, 110, 100, 90, 80, 70], 1));
  return `        <div class="hookstack disp" data-layout-allow-overlap>
${h1.map((l, k) => `          <span class="tl"><span class="tc${a.includes(k + 1) ? " big" : ""}" id="s${i}-l${k + 1}" style="font-size:${k === 0 ? fitH1.size : h2fit[k - 1].size}px">${esc(l.toUpperCase())}</span></span>`).join("\n")}
        </div>
        ${scene.slab ? `<div class="slabwrap" id="s${i}-slabwrap"><span class="slab" id="s${i}-slab"></span><span class="slabtx" id="s${i}-slabtx">${esc(scene.slab)}</span></div>` : ""}
        ${scene.sub ? `<div class="title-sub mono" id="s${i}-sub">${esc(scene.sub)}</div>` : ""}`;
}

function htmlSection(scene, i) {
  const fitT = scene.title.map((l) => fit(l, [110, 100, 90, 80, 70], 1));
  return `        <div class="secnum disp" id="s${i}-num">${esc(scene.num || "")}</div>
        <div class="kick mono" id="s${i}-kick">${esc(scene.kicker || "")}</div>
        <div class="sectitle disp" data-layout-allow-overlap>
${linesHtml([`s${i}-t1`, `s${i}-t2`], scene.title.map((l) => l.toUpperCase()), fitT)}
        </div>`;
}

function htmlCard(scene, i, cardNo) {
  const d = scene.data;
  const photo = scene._photo;
  // With a photo on the right, the title column ends at the photo's left edge.
  const t = fit(d.title, photo ? [100, 92, 84, 76, 68, 60] : [110, 100, 90, 80, 70, 60],
    3, CHAR_W, photo ? CARD_TITLE_BOX : BOX);
  const body = d.body ? fitBodyText(d.body) : null;
  const v = d.venue ? fit(d.venue, [50, 46, 42, 38], 2) : null;
  return `        <div class="num disp" id="s${i}-num">${String(cardNo).padStart(2, "0")}</div>
        ${d.meta || d.pill ? `<div class="tag" id="s${i}-tag">${d.meta ? `<span class="cat mono" id="s${i}-cat">${esc(d.meta)}</span>` : ""}${d.pill ? `<span class="pill" id="s${i}-pill">${esc(d.pill)}</span>` : ""}</div>` : ""}
        ${photo ? `<img class="card-photo" id="s${i}-photo" src="assets/img/${i}.jpg" alt="" />` : ""}
        <div class="card-title disp${photo ? " img" : ""}" data-layout-allow-overlap>
${t.lines.map((l, k) => `          <span class="tl"><span class="tc" id="s${i}-t${k + 1}" style="font-size:${t.size}px">${esc(l)}</span></span>`).join("\n")}
        </div>
        <div class="rule" id="s${i}-rule"></div>
        ${v ? `<div class="venue" id="s${i}-v" style="font-size:${v.size}px">${esc(d.venue)}</div>` : ""}
        ${d.city ? `<div class="city mono" id="s${i}-c">${esc(d.city)}</div>` : ""}
        ${body ? `<div class="card-body">
${body.lines.map((l, k) => `          <span class="bl" id="s${i}-b${k + 1}" style="font-size:${body.size}px">${esc(l)}</span>`).join("\n")}
        </div>` : ""}
        ${d.slab ? `<div class="card-slab slabwrap" id="s${i}-slabwrap"><span class="slab" id="s${i}-slab"></span><span class="slabtx" id="s${i}-slabtx">${esc(d.slab)}</span></div>` : ""}`;
}

function htmlList(scene, i) {
  const head = fit(scene.head || "", [96, 88, 80, 72, 64], 1);
  const rows = scene.items.map((it, k) => {
    const tx = fit(it.text, [64, 58, 52, 46], 2, CHAR_W, LIST_ROW_BOX);
    return `          <div class="row" id="s${i}-r${k + 1}">
            <span class="rownum disp" id="s${i}-n${k + 1}">${String(k + 1).padStart(2, "0")}</span>
            <span class="rowtxt">
              <span class="rowtx disp" id="s${i}-x${k + 1}" style="font-size:${tx.size}px">${esc(it.text.toUpperCase())}</span>
              ${it.sub ? `<span class="rowsub mono" id="s${i}-u${k + 1}">${esc(it.sub)}</span>` : ""}
            </span>
          </div>`;
  }).join("\n");
  return `        <div class="disp list-head" data-layout-allow-overlap id="s${i}-head" style="font-size:${head.size}px">${esc((scene.head || "").toUpperCase())}</div>
        <div class="rows">
${rows}
        </div>`;
}

function htmlStat(scene, i) {
  const d = scene.data;
  const num = fit(String(d.number), [320, 280, 240, 200, 160], 1);
  return `        <div class="paynum disp" data-layout-allow-overlap id="s${i}-num" style="font-size:${num.size}px">${esc(d.number)}</div>
        <div class="paylabel disp" data-layout-allow-overlap id="s${i}-label">${esc(d.label.toUpperCase())}</div>
        ${d.sub ? `<div class="paysub mono" id="s${i}-sub">${esc(d.sub)}</div>` : ""}`;
}

function htmlCta(scene, i) {
  const head = scene.head;
  const fitK = head.map((l) => fit(l, [132, 120, 108, 96, 84], 1));
  const urlSize = scene.url.length > 40 ? 36 : 46;
  return `        <div class="ctakick disp" data-layout-allow-overlap>
${linesHtml([`s${i}-k1`, `s${i}-k2`], head.map((l) => l.toUpperCase()), fitK, "big")}
        </div>
        <div class="ctamark disp" id="s${i}-mark"><i></i>famhop</div>
        <div class="slabwrap ctaurl" id="s${i}-urlwrap">
          <span class="slab" id="s${i}-url"></span>
          <span class="ctaurltx" id="s${i}-urltx" style="font-size:${urlSize}px">${esc(scene.url)}</span>
        </div>
        ${scene.news ? `<div class="ctanews mono" id="s${i}-news">${esc(scene.news)}</div>` : ""}`;
}

const htmlScene = { title: htmlTitle, section: htmlSection, card: htmlCard, list: htmlList, stat: htmlStat, cta: htmlCta };

// ---------------------------------------------------------------- timeline
const T = (t) => t.toFixed(2);

function tlTitle(scene, i, t) {
  const n = scene.h1.length;
  const lines = [];
  lines.push(`        tl.fromTo('#s${i}-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.34, ease: 'power3.out' }, ${T(t)});`);
  lines.push(`        tl.fromTo('#s${i}-l1', { opacity: 0, y: 70, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'power4.out' }, ${T(t + 0.16)});`);
  for (let k = 1; k < n; k++) lines.push(`        tl.fromTo('#s${i}-l${k + 1}', { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 0.40, ease: 'expo.out' }, ${T(t + 0.52 + k * 0.14)});`);
  if (scene.slab) {
    lines.push(`        tl.fromTo('#s${i}-slab', { scaleX: 0 }, { scaleX: 1, duration: 0.38, ease: 'power3.out' }, ${T(t + 1.10)});`);
    lines.push(`        tl.fromTo('#s${i}-slabtx', { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${T(t + 1.40)});`);
  }
  if (scene.sub) lines.push(`        tl.fromTo('#s${i}-sub', { opacity: 0, x: -36 }, { opacity: 1, x: 0, duration: 0.44, ease: 'power3.out' }, ${T(t + 1.56)});`);
  return lines.join("\n");
}

function tlSection(scene, i, t) {
  const n = scene.title.length;
  const lines = [
    `        tl.fromTo('#s${i}-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.32, ease: 'power3.out' }, ${T(t)});`,
    `        tl.fromTo('#s${i}-num', { opacity: 0, y: 64, scale: 0.78 }, { opacity: 1, y: 0, scale: 1, duration: 0.34, ease: 'back.out(2.2)' }, ${T(t + 0.14)});`,
    `        tl.fromTo('#s${i}-kick', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out' }, ${T(t + 0.26)});`,
  ];
  for (let k = 0; k < n; k++) lines.push(`        tl.fromTo('#s${i}-t${k + 1}', { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.40, ease: 'expo.out' }, ${T(t + 0.44 + k * 0.13)});`);
  return lines.join("\n");
}

function tlCard(scene, i, t) {
  const d = scene.data;
  const tFit = fit(d.title, scene._photo ? [100, 92, 84, 76, 68, 60] : [110, 100, 90, 80, 70, 60], 3, CHAR_W, scene._photo ? CARD_TITLE_BOX : BOX);
  const chunks = tFit.lines.length;
  const lines = [
    `        tl.fromTo('#s${i}-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.30, ease: 'power3.out' }, ${T(t)});`,
    `        tl.fromTo('#s${i}-num', { opacity: 0, y: 64, scale: 0.78 }, { opacity: 1, y: 0, scale: 1, duration: 0.26, ease: 'power4.out' }, ${T(t + 0.14)});`,
  ];
  if (scene._photo) lines.push(`        tl.fromTo('#s${i}-photo', { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.50, ease: 'power3.out' }, ${T(t + 0.50)});`);
  if (d.meta || d.pill) lines.push(`        tl.fromTo('#s${i}-tag', { opacity: 0, scale: 0.72 }, { opacity: 1, scale: 1, duration: 0.30, ease: 'back.out(2.2)' }, ${T(t + 0.22)});`);
  for (let k = 0; k < chunks; k++) lines.push(`        tl.fromTo('#s${i}-t${k + 1}', { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.42, ease: 'expo.out' }, ${T(t + 0.32 + k * 0.13)});`);
  lines.push(`        tl.fromTo('#s${i}-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.40, ease: 'power3.out' }, ${T(t + 0.80)});`);
  if (d.venue) lines.push(`        tl.fromTo('#s${i}-v', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out' }, ${T(t + 0.92)});`);
  if (d.city) lines.push(`        tl.fromTo('#s${i}-c', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out' }, ${T(t + 1.02)});`);
  if (d.body) {
    const chunks2 = fitBodyText(d.body).lines.length;
    for (let k = 0; k < chunks2; k++) lines.push(`        tl.fromTo('#s${i}-b${k + 1}', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.38, ease: 'power3.out' }, ${T(t + 1.30 + k * 0.12)});`);
  }
  if (d.slab) {
    lines.push(`        tl.fromTo('#s${i}-slab', { scaleX: 0 }, { scaleX: 1, duration: 0.34, ease: 'power3.out' }, ${T(t + 1.18)});`);
    lines.push(`        tl.fromTo('#s${i}-slabtx', { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${T(t + 1.46)});`);
  }
  return lines.join("\n");
}

function tlList(scene, i, t) {
  const n = scene.items.length;
  const lines = [
    `        tl.fromTo('#s${i}-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.30, ease: 'power3.out' }, ${T(t)});`,
    `        tl.fromTo('#s${i}-head', { opacity: 0, y: 48 }, { opacity: 1, y: 0, duration: 0.40, ease: 'power4.out' }, ${T(t + 0.16)});`,
  ];
  for (let k = 0; k < n; k++) {
    const at = t + 0.45 + k * 0.9;
    lines.push(`        tl.fromTo('#s${i}-r${k + 1}', { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 0.30, ease: 'power2.out' }, ${T(at)});`);
    lines.push(`        tl.fromTo('#s${i}-n${k + 1}', { scale: 0.4 }, { scale: 1, duration: 0.32, ease: 'back.out(2.6)' }, ${T(at + 0.08)});`);
    lines.push(`        tl.fromTo('#s${i}-x${k + 1}', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.34, ease: 'expo.out' }, ${T(at + 0.18)});`);
    if (scene.items[k].sub) lines.push(`        tl.fromTo('#s${i}-u${k + 1}', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.32, ease: 'power3.out' }, ${T(at + 0.32)});`);
  }
  return lines.join("\n");
}

function tlStat(scene, i, t) {
  return [
    `        tl.fromTo('#s${i}-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.32, ease: 'power3.out' }, ${T(t)});`,
    `        tl.fromTo('#s${i}-num', { opacity: 0, y: 50, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.38, ease: 'back.out(2.4)' }, ${T(t + 0.18)});`,
    `        tl.fromTo('#s${i}-label', { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 0.36, ease: 'expo.out' }, ${T(t + 0.46)});`,
  ].concat(scene.data.sub
    ? [`        tl.fromTo('#s${i}-sub', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.38, ease: 'power3.out' }, ${T(t + 0.66)});`]
    : []).join("\n");
}

function tlCta(scene, i, t) {
  return [
    `        tl.fromTo('#s${i}-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.34, ease: 'power3.out' }, ${T(t)});`,
    `        tl.fromTo('#s${i}-k1', { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.40, ease: 'expo.out' }, ${T(t + 0.16)});`,
    `        tl.fromTo('#s${i}-k2', { opacity: 0, y: 60, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'power4.out' }, ${T(t + 0.32)});`,
    `        tl.fromTo('#s${i}-mark', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.42, ease: 'power4.out' }, ${T(t + 0.86)});`,
    `        tl.fromTo('#s${i}-url', { scaleX: 0 }, { scaleX: 1, duration: 0.40, ease: 'power3.out' }, ${T(t + 1.18)});`,
    `        tl.fromTo('#s${i}-urltx', { opacity: 0 }, { opacity: 1, duration: 0.01 }, ${T(t + 1.50)});`,
  ].concat(scene.news
    ? [`        tl.fromTo('#s${i}-news', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.38, ease: 'power3.out' }, ${T(t + 1.74)});`]
    : []).join("\n");
}

const tlScene = { title: tlTitle, section: tlSection, card: tlCard, list: tlList, stat: tlStat, cta: tlCta };

// ---------------------------------------------------------------- composition
const CSS = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: #000; }

      @font-face{font-family:'Bricolage Grotesque';src:url('assets/fonts/bricolage-grotesque-400_800.woff2') format('woff2');font-weight:400 800;font-style:normal;font-display:block;}
      @font-face{font-family:'JetBrains Mono';src:url('assets/fonts/jetbrains-mono-400.woff2') format('woff2');font-weight:100 800;font-style:normal;font-display:block;}
      @font-face{font-family:'Plus Jakarta Sans';src:url('assets/fonts/plus-jakarta-sans-400.woff2') format('woff2');font-weight:200 800;font-style:normal;font-display:block;}

      #root{
        position:relative;width:1920px;height:1080px;overflow:hidden;
        --cream:#FAF5EB; --ink:#1B1916; --accent:#DD6A1A; --sun:#E8B547; --muted:#4A453F; --mutedi:#C9C2B6;
        font-family:'Plus Jakarta Sans',sans-serif;color:#1B1916;
      }

      .scene{position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;}
      /* A cream base under every scene: the panel wipes are 0.3s of scaleY, and
         without a floor beneath them the frame shows through to black. */
      .basefill{position:absolute;inset:0;background:var(--cream);}
      .pnl{position:absolute;inset:0;background:var(--cream);transform-origin:50% 100%;}
      .inv .pnl{background:var(--ink);}
      .inv{color:var(--cream);}

      .mono{font-family:'JetBrains Mono',monospace;font-weight:400;letter-spacing:.10em;text-transform:uppercase;}
      .disp{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:-.015em;line-height:.94;}

      .chrome{position:absolute;left:72px;right:72px;top:56px;display:flex;justify-content:space-between;align-items:center;font-size:28px;}
      .chrome .r{color:var(--muted);}
      .inv .chrome .r{color:var(--mutedi);}
      .mark{display:inline-flex;align-items:center;gap:14px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:44px;letter-spacing:-.02em;text-transform:lowercase;}
      .mark i{display:block;width:30px;height:30px;background:var(--accent);border-radius:8px;}
      .foot{position:absolute;left:72px;bottom:44px;font-family:'JetBrains Mono',monospace;font-size:26px;letter-spacing:.06em;color:var(--muted);}
      .inv .foot{color:var(--mutedi);}

      .tl{display:block;}
      .tc{display:block;}

      /* title */
      .hookstack{position:absolute;left:72px;right:72px;top:290px;}
      .hookstack .tc{font-size:150px;line-height:.9;}
      .hookstack .tc.big{color:var(--accent);}
      .slabwrap{position:absolute;left:72px;top:660px;display:inline-block;}
      .slab{position:absolute;inset:0;background:var(--ink);transform-origin:0% 50%;}
      .inv .slab{background:var(--sun);}
      .slabtx{position:relative;display:block;padding:14px 34px 22px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:56px;text-transform:uppercase;letter-spacing:-.01em;color:var(--cream);white-space:nowrap;}
      .inv .slabtx{color:var(--ink);}
      .title-sub{position:absolute;left:72px;top:800px;font-size:32px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
      .inv .title-sub{color:var(--mutedi);}

      /* section */
      .secnum{position:absolute;left:72px;top:200px;font-size:260px;line-height:.8;color:var(--accent);letter-spacing:-.04em;}
      .kick{position:absolute;right:72px;top:290px;font-size:30px;color:var(--muted);text-align:right;}
      .inv .kick{color:var(--mutedi);}
      .sectitle{position:absolute;left:72px;right:72px;top:430px;font-size:110px;line-height:1.02;}

      /* card */
      .num{position:absolute;left:72px;top:130px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:150px;line-height:.8;color:var(--accent);letter-spacing:-.04em;}
      .tag{position:absolute;right:72px;top:200px;display:flex;align-items:center;gap:20px;}
      .pill{background:var(--sun);border:5px solid var(--ink);border-radius:999px;padding:8px 30px 12px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:34px;text-transform:uppercase;color:var(--ink);letter-spacing:-.01em;white-space:nowrap;}
      .inv .pill{border-color:var(--cream);}
      .cat{font-family:'JetBrains Mono',monospace;font-size:26px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap;}
      .inv .cat{color:var(--mutedi);}
      .card-title{position:absolute;left:72px;right:72px;top:340px;font-size:110px;}
      .card-title.img{right:1300px;}
      /* Photo panel: sits above the rule/body columns on the right. A dropped
         image (unreachable at build) means the scene renders text-only. */
      .card-photo{position:absolute;right:72px;top:300px;width:548px;height:420px;object-fit:cover;border-radius:28px;border:5px solid var(--ink);transform-origin:50% 100%;background:var(--sun);}
      .rule{position:absolute;left:72px;top:640px;width:900px;height:6px;background:var(--ink);transform-origin:0% 50%;}
      .inv .rule{background:var(--cream);}
      .venue{position:absolute;left:72px;top:684px;font-weight:800;font-size:50px;line-height:1.15;}
      .city{position:absolute;left:72px;top:790px;font-family:'JetBrains Mono',monospace;font-size:30px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
      .inv .city{color:var(--mutedi);}
      .card-body{position:absolute;left:72px;right:700px;top:830px;font-weight:500;font-size:44px;color:var(--muted);}
      .inv .card-body{color:var(--mutedi);}
      .card-body .bl{display:block;line-height:1.18;font-weight:500;}
      .card-slab{position:absolute;left:auto;right:72px;top:880px;display:inline-block;}

      /* list */
      .list-head{position:absolute;left:72px;right:72px;top:150px;}
      .rows{position:absolute;left:72px;right:72px;top:320px;display:flex;flex-direction:column;gap:12px;}
      .row{display:flex;align-items:flex-start;gap:36px;}
      .rownum{flex:0 0 120px;font-size:60px;line-height:.8;color:var(--accent);}
      .rowtxt{display:flex;flex-direction:column;}
      .rowtx{font-size:60px;line-height:.95;}
      .rowsub{margin-top:10px;display:block;font-family:'JetBrains Mono',monospace;font-size:24px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
      .inv .rowsub{color:var(--mutedi);}

      /* stat */
      .paynum{position:absolute;left:72px;top:240px;font-size:320px;line-height:.84;color:var(--accent);}
      .paylabel{position:absolute;left:72px;top:640px;font-size:110px;line-height:1;}
      .paysub{position:absolute;left:72px;top:820px;font-family:'JetBrains Mono',monospace;font-size:34px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
      .inv .paysub{color:var(--mutedi);}

      /* cta */
      .ctakick{position:absolute;left:72px;top:290px;font-size:132px;line-height:.9;}
      .ctamark{position:absolute;left:72px;top:560px;display:inline-flex;align-items:center;gap:24px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:120px;letter-spacing:-.03em;text-transform:lowercase;color:var(--cream);}
      .ctamark i{display:block;width:60px;height:60px;background:var(--accent);border-radius:16px;}
      .ctaurl{position:absolute;left:72px;top:760px;display:inline-block;}
      .ctaurltx{position:relative;display:block;padding:18px 30px 22px;font-family:'JetBrains Mono',monospace;font-size:46px;letter-spacing:.01em;color:var(--ink);}
      .ctanews{position:absolute;left:72px;bottom:120px;font-family:'JetBrains Mono',monospace;font-size:32px;letter-spacing:.06em;color:var(--mutedi);}
`;

function buildHtml(spec, scenes, timings, audio) {
  const total = timings.total;
  const body = scenes.map((s, i) => {
    const t = timings.at[i];
    const sceneHtml = htmlScene[s.layout](s, i, s._cardNo);
    return `      <div id="s${i}" class="scene clip${s.inv ? " inv" : ""}" data-start="${T(t)}" data-duration="${T(s.duration)}" data-track-index="1">
        <div class="pnl" id="s${i}-pnl"></div>
${chromeHtml(spec.kicker || "famhop guides")}
${sceneHtml}
      </div>`;
  }).join("\n\n");

  const tlJs = scenes.map((s, i) => {
    const lines = tlScene[s.layout](s, i, timings.at[i]);
    return `\n        /* scene ${i + 1} — ${s.layout} @ ${T(timings.at[i])} */\n${lines}`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>${CSS}    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${T(total)}" data-width="1920" data-height="1080" data-fps="30">

      <div id="base" class="scene clip" data-start="0" data-duration="${T(total)}" data-track-index="0">
        <div class="basefill"></div>
      </div>

${body}

${audio.tags}
    </div>

    <script>
      (function () {
        var tl = gsap.timeline({ paused: true });
        /* Full-span anchor so the master duration equals the composition total. */
        tl.to({}, { duration: ${T(total)} }, 0);
${tlJs}

        window.__timelines = window.__timelines || {};
        window.__timelines['main'] = tl;
      })();
    </script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------- project
function buildBgm(projectDir, total) {
  const out = join(projectDir, "assets", "bgm", `loop-${T(total)}.mp3`);
  if (existsSync(out)) return out;
  const src = join(TEMPLATE, "assets", "bgm", "famhop-underscore.mp3");
  const fadeOut = Math.max(0, total - 1.5);
  execFileSync("ffmpeg", ["-y", "-stream_loop", "99", "-i", src, "-t", String(total),
    "-af", `afade=t=in:st=0:d=0.3,afade=t=out:st=${fadeOut}:d=1.5`, "-q:a", "1", out],
  { stdio: "ignore" });
  return out;
}

async function buildProject(spec) {
  const dir = join(GUIDES, spec.id);
  mkdirSync(VO_CACHE, { recursive: true });
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  mkdirSync(join(dir, "assets", "bgm"), { recursive: true });
  mkdirSync(join(dir, "assets", "voice"), { recursive: true });
  mkdirSync(join(dir, "assets", "img"), { recursive: true });
  for (const f of ["bricolage-grotesque-400_800.woff2", "jetbrains-mono-400.woff2", "plus-jakarta-sans-400.woff2"])
    copyFileSync(join(TEMPLATE, "assets/fonts", f), join(dir, "assets/fonts", f));
  for (const f of ["hyperframes.json", "package.json"]) copyFileSync(join(TEMPLATE, f), join(dir, f));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: `famhop-guide-${spec.id}`, name: `famhop-guide-${spec.id}` }, null, 2));

  const scenes = spec.scenes.map(resolveScene);
  let cardNo = 0;
  scenes.forEach((s) => { if (s.layout === "card") s._cardNo = ++cardNo; });

  // Download card photos into the project (local assets only — never hot-link
  // at render). A failed download drops the photo and the card renders
  // text-only, so a rotting URL can never break a rebuild.
  for (const [i, s] of scenes.entries()) {
    if (s.layout === "card" && s.data.image) {
      s._photo = await downloadImage(s.data.image, join(dir, "assets", "img", `${i}.jpg`));
      await new Promise((r) => setTimeout(r, 1200)); // be gentle with remote hosts
    }
  }

  // cumulative timings
  let at = 0;
  const timings = { at: [], total: 0 };
  for (const s of scenes) { timings.at.push(at); at += s.duration; }
  timings.total = at;

  const audio = { tags: "" };
  if (WANT_VO) {
    const lines = [];
    for (const [i, s] of scenes.entries()) {
      const cache = join(VO_CACHE, voFilename(s.vo));
      await tts(s.vo, cache);
      const proj = join(dir, "assets", "voice", `${i + 1}.mp3`);
      copyFileSync(cache, proj);
      const d = secondsOf(proj).toFixed(2);
      lines.push(`      <audio id="vo${i + 1}" src="assets/voice/${i + 1}.mp3" data-start="${T(timings.at[i] + 0.35)}" data-duration="${d}" data-track-index="10" data-volume="1"></audio>`);
    }
    audio.tags = "      <!-- narration timed to fixed windows; never re-time frames from voice length -->\n" + lines.join("\n");
  }

  const bgm = buildBgm(dir, timings.total);
  audio.tags += `\n      <audio id="bgm" src="assets/bgm/${basename(bgm)}" data-start="0" data-duration="${T(timings.total)}" data-track-index="11" data-volume="0.14"></audio>`;

  writeFileSync(join(dir, "index.html"), buildHtml(spec, scenes, timings, audio));

  // VO-window gate + word-budget report
  const wps = 2.6;
  let gateOk = true;
  console.log(`\nword budget (≈${wps} wps, fit ≤ 85% of window)`);
  for (const [i, s] of scenes.entries()) {
    const words = (s.vo || "").trim().split(/\s+/).length;
    const est = words / wps;
    const fitPct = Math.round((est / s.duration) * 100);
    let flag = "";
    if (WANT_VO) {
      const voDur = Number(secondsOf(join(dir, "assets", "voice", `${i + 1}.mp3`)));
      const ok = voDur + 0.6 <= s.duration;
      if (!ok) { gateOk = false; flag = `  ✗ VO ${voDur.toFixed(2)}s + 0.6 > ${s.duration}s window`; }
      else if (fitPct > 85) flag = "  ⚠ over the 85% mark";
      console.log(`   ${String(i + 1).padStart(2)} ${s.layout.padEnd(7)} ${s.ref || ""}  ${String(words).padStart(3)} words ≈ ${est.toFixed(1)}s of ${s.duration}s  ${fitPct}%${flag}`);
    } else {
      // No TTS yet — gate on the word-rate estimate plus the fixed 0.6s tail.
      if (est + 0.6 > s.duration) { gateOk = false; flag = "  ✗ estimated VO + 0.6s exceeds the window"; }
      else if (fitPct > 85) flag = "  ⚠ over the 85% mark (estimate)";
      console.log(`   ${String(i + 1).padStart(2)} ${s.layout.padEnd(7)} ${s.ref || ""}  ${String(words).padStart(3)} words ≈ ${est.toFixed(1)}s of ${s.duration}s  ${fitPct}%${flag}`);
    }
  }
  const mm = Math.floor(timings.total / 60), ss = Math.round(timings.total % 60);
  console.log(`\nbuilt ${spec.id}  ${scenes.length} scenes · ${mm}:${String(ss).padStart(2, "0")} total`);
  if (!gateOk) { console.error("\n✗ VO window violations — shorten the vo or widen the scene (never re-time frames)."); process.exit(1); }
  return dir;
}

function renderProject(spec) {
  const dir = join(GUIDES, spec.id);
  const outDir = join(DELIVERY, spec.id);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${spec.id}.mp4`);
  const quality = argFlag("--quality") || "standard";
  console.log(`\nrendering ${spec.id} → delivery-guides/${spec.id}/ (${quality}) …`);
  execFileSync("npx", ["--yes", "hyperframes@0.7.74", "render", "--output", `../../delivery-guides/${spec.id}/${spec.id}.mp4`, "--quality", quality], { cwd: dir, stdio: "inherit" });
  return out;
}

// ---------------------------------------------------------------- main
const WANT_VO = !process.argv.includes("--no-vo");

function argFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const guide = argFlag("--guide");
  const spec = JSON.parse(readFileSync(join(GUIDES, guide, "spec.json"), "utf8"));
  if (spec.id !== guide) throw new Error(`spec.id "${spec.id}" does not match --guide ${guide}`);

  const v = validateSpec(spec);
  for (const w of v.warns) console.log("⚠ " + w);
  if (v.errs.length) { console.error(v.errs.map((e) => "✗ " + e).join("\n")); process.exit(1); }
  console.log(`validated ${spec.id} · ${spec.scenes.length} scenes · ${v.cards} cards · total ${v.total}s`);

  const dir = await buildProject(spec);
  console.log(dir.replace(HERE + "/", "") + "/index.html");

  if (process.argv.includes("--render")) renderProject(spec);
}

// Exported for build-guides-metadata.mjs (recap lines must match the video).
export { resolveRef, resolveScene, isFree, metroLabel };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("\n❌ " + e.message); process.exit(1); });
}
