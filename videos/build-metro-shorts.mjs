#!/usr/bin/env node
// Build one 9:16 HyperFrames project per metro from videos/weekend-picks.json.
//
// The design is the same card grammar as videos/famhop-short-bay, but every
// string comes from the picker - including the hook, which adapts to what the
// data can actually support:
//   all six free + weekend window -> "6 FREE THINGS TO DO ... THIS WEEKEND"
//   mixed cost                    -> "6 THINGS TO DO ..."  + real cost per card
//   thin weekend                  -> "... THIS WEEK" + the real weekday per card
//
//   ELEVENLABS_API_KEY=... node videos/build-metro-shorts.mjs
//   node videos/build-metro-shorts.mjs --no-vo     # skip narration

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PICKS = JSON.parse(readFileSync(join(HERE, "weekend-picks.json"), "utf8"));
const TEMPLATE = join(HERE, "famhop-short-bay");
const OUT_ROOT = join(HERE, "shorts-" + PICKS.weekend.saturday);
const SHARED_VO = join(HERE, "vo-shared");
const WANT_VO = !process.argv.includes("--no-vo");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- type fitting
// Bricolage Grotesque 800 caps average ~0.55em. Search downward for the largest
// size at which the text fits the column in <= maxLines, so a long metro name or
// a long event title shrinks instead of overflowing.
const CHAR_W = 0.55;
const BOX = 936;

function fit(text, sizes, maxLines) {
  for (const size of sizes) {
    const perLine = Math.floor(BOX / (size * CHAR_W));
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

// "Mon + Tue + Wed + Thu + Fri + Sat" will not fit a slab; compress a long run
// to a range so the badge stays one short line.
function dayLabel(days) {
  const parts = String(days).split(" + ");
  return parts.length > 3 ? `${parts[0]}–${parts[parts.length - 1]}` : parts.join(" + ");
}

// ---------------------------------------------------------------- narration
const VO_LINES = {
  "hook-free-weekend": "No plan for Saturday? These are all free.",
  "hook-weekend": "Still nothing planned for the weekend?",
  "hook-week": "Still nothing planned this week?",
  "checked": "Every one is real, and checked against the venue's own calendar.",
  "screenshot": "Screenshot the ones you want.",
  "gap": "And that is five of them. Here is everything else on this week.",
  "payoff-filter": "Narrow it by your kid's age, by cost, by time of day.",
  "payoff-plan": "Pick two, and it maps the whole day for you.",
};

// A dot per event, sized to fill the box. 895 dots read as a wall; Austin's 26
// read as a short list - both are the truth about that metro.
function gridSpec(n, boxW = 936, boxH = 540) {
  const cols = Math.max(1, Math.round(Math.sqrt((n * boxW) / boxH)));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(boxW / cols, boxH / rows);
  return { cols, rows, cell: Math.floor(cell), dot: Math.max(5, Math.floor(cell * 0.58)) };
}

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
  console.log("   tts " + outPath.replace(HERE + "/", "") + "  " + text);
}

const secondsOf = (p) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim());

// ---------------------------------------------------------------- composition
function buildHtml(metro, audio) {
  // Five cards, not six. The video's job is to be useful enough to earn the
  // watch, then prove it is showing a fraction - the sixth pick lives in the
  // description, so the click over-delivers.
  const picks = metro.picks.slice(0, 5);
  const n = picks.length;
  const CARD = 3.4, HOOK = 2.8, GAP = 4.0, PAYOFF = 4.6, CTA = 4.6;
  const cardAt = (i) => HOOK + i * CARD;
  const gapAt = +(HOOK + n * CARD).toFixed(2);
  const payoffAt = +(gapAt + GAP).toFixed(2);
  const ctaAt = +(payoffAt + PAYOFF).toFixed(2);
  const total = +(ctaAt + CTA).toFixed(2);
  const weekendish = metro.window === "weekend";
  const allFree = picks.every((p) => p.free);

  const hookH1 = allFree ? `${n} free` : `${n} things`;
  const hookLines = allFree
    ? ["things to do", "with the kids", `in ${metro.name}`]
    : ["to do with kids", `in ${metro.name}`];
  const hookFit = fit(hookLines.reduce((a, b) => (a.length > b.length ? a : b)), [100, 92, 84, 76, 68], 1);
  const slabText = weekendish ? "this weekend" : "this week";
  const dateText = weekendish
    ? `Sat Aug ${Number(PICKS.weekend.saturday.slice(8))} → Sun Aug ${Number(PICKS.weekend.sunday.slice(8))}`
    : `Mon Jul 27 → Sun Aug 2`;

  const tickW = Math.floor((BOX - (n - 1) * 14) / n);

  const cards = picks.map((p, i) => {
    const t = fit(p.title, [104, 96, 88, 80, 72, 64, 58], 4);
    const v = fit(p.venue, [46, 42, 38, 34], 2);
    const inv = i % 2 === 1;
    const ticks = picks.map((_, k) =>
      k < i ? `<span class="tick done" style="width:${tickW}px"><span></span></span>`
        : k === i ? `<span class="tick" style="width:${tickW}px"><span id="c${i + 1}-k"></span></span>`
          : `<span class="tick todo" style="width:${tickW}px"><span></span></span>`
    ).join("\n          ");
    return `      <div id="c${i + 1}" class="scene clip${inv ? " inv" : ""}" data-start="${cardAt(i)}" data-duration="${CARD}" data-track-index="1">
        <div class="pnl" id="c${i + 1}-pnl"></div>
        <div class="chrome mono"><span class="mark"><i></i>famhop</span><span class="r">${esc(metro.name.toLowerCase())}</span></div>
        <div class="disp num" id="c${i + 1}-num">${String(i + 1).padStart(2, "0")}</div>
        <div class="tag" id="c${i + 1}-tag"><span class="cat">${esc(p.category)}</span><span class="pill">${esc(p.cost)}</span></div>
        <div class="ofn" id="c${i + 1}-of">${i + 1} of ${metro.weekTotal} this week</div>
        ${p.ages ? `<div class="ages" id="c${i + 1}-ages">${esc(p.ages)}</div>` : `<div class="ages" id="c${i + 1}-ages"></div>`}
        <div class="disp title" data-layout-allow-overlap style="font-size:${t.size}px">
${t.lines.map((l, k) => `          <span class="tl"><span class="tc" id="c${i + 1}-t${k + 1}">${esc(l)}</span></span>`).join("\n")}
        </div>
        <div class="rule" id="c${i + 1}-rule"></div>
        <div class="venue" id="c${i + 1}-v" style="font-size:${v.size}px">${esc(p.venue)}</div>
        <div class="city" id="c${i + 1}-c">${esc(p.city)}</div>
        <div class="slabwrap" id="c${i + 1}-slabwrap"><span class="slab" id="c${i + 1}-slab"></span><span class="slabtx" id="c${i + 1}-slabtx">${esc(dayLabel(p.days))} &middot; ${esc(p.time.toLowerCase())}</span></div>
        <div class="ticks">
          ${ticks}
        </div>
        <div class="foot">famhop.com/${metro.id}/this-weekend</div>
      </div>`;
  }).join("\n\n");

  // ---- the gap beat: five lit dots inside a wall of everything else --------
  const g = gridSpec(metro.weekTotal);
  const dots = Array.from({ length: metro.weekTotal }, (_, k) =>
    k < n ? `<span class="dot lit" id="g${k + 1}"></span>` : `<span class="dot"></span>`
  ).join("");
  const gapLine = fit(`${metro.name} has ${metro.weekTotal} this week`, [78, 70, 64, 58, 52], 2);

  // ---- the payoff beat: a real narrowing, or the plan when volume is thin --
  const casc = metro.filterDemo.cascade;
  const chips = casc.slice(1).map((s) => s.chip);
  const planLines = ["pick two.", "it maps the day.", "share it, everyone votes."];

  const ctaUrl = `famhop.com/${metro.id}/this-weekend`;
  const urlSize = ctaUrl.length > 30 ? 34 : 42;

  const chunkTl = picks.map((p, i) => {
    const t = fit(p.title, [104, 96, 88, 80, 72, 64, 58], 4);
    return `          { at: ${cardAt(i)}, id: 'c${i + 1}', chunks: ${t.lines.length} }`;
  }).join(",\n");

  return `<!doctype html>
<html lang="en" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }

      @font-face{font-family:'Bricolage Grotesque';src:url('assets/fonts/bricolage-grotesque-400_800.woff2') format('woff2');font-weight:400 800;font-style:normal;font-display:block;}
      @font-face{font-family:'JetBrains Mono';src:url('assets/fonts/jetbrains-mono-400.woff2') format('woff2');font-weight:100 800;font-style:normal;font-display:block;}
      @font-face{font-family:'Plus Jakarta Sans';src:url('assets/fonts/plus-jakarta-sans-400.woff2') format('woff2');font-weight:200 800;font-style:normal;font-display:block;}

      #root{
        position:relative;width:1080px;height:1920px;overflow:hidden;
        --cream:#FAF5EB; --ink:#1B1916; --accent:#DD6A1A; --sun:#E8B547; --muted:#4A453F; --mutedi:#C9C2B6;
        font-family:'Plus Jakarta Sans',sans-serif;color:#1B1916;
      }

      .scene{position:absolute;inset:0;width:1080px;height:1920px;overflow:hidden;}
      /* A cream base under every scene: the panel wipes are 0.3s of scaleY, and
         without a floor beneath them the frame shows through to black. */
      .basefill{position:absolute;inset:0;background:var(--cream);}
      .pnl{position:absolute;inset:0;background:var(--cream);transform-origin:50% 100%;}
      .inv .pnl{background:var(--ink);}
      .inv{color:var(--cream);}

      .mono{font-family:'JetBrains Mono',monospace;font-weight:400;letter-spacing:.10em;text-transform:uppercase;}
      .disp{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:-.015em;line-height:.94;}

      .chrome{position:absolute;left:72px;right:72px;top:150px;display:flex;justify-content:space-between;align-items:center;font-size:28px;}
      .chrome .r{color:var(--muted);}
      .inv .chrome .r{color:var(--mutedi);}
      .mark{display:inline-flex;align-items:center;gap:14px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:38px;letter-spacing:-.02em;text-transform:lowercase;}
      .mark i{display:block;width:26px;height:26px;background:var(--accent);border-radius:7px;}

      .num{position:absolute;left:72px;top:250px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:180px;line-height:.8;color:var(--accent);letter-spacing:-.04em;}
      .tag{position:absolute;right:72px;top:280px;display:flex;align-items:center;gap:20px;}
      .pill{background:var(--sun);border:5px solid var(--ink);border-radius:999px;padding:8px 30px 12px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:40px;text-transform:uppercase;color:var(--ink);letter-spacing:-.01em;white-space:nowrap;}
      .cat{font-family:'JetBrains Mono',monospace;font-size:26px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap;}
      .inv .cat{color:var(--mutedi);}

      .title{position:absolute;left:72px;right:72px;top:500px;}
      /* Block-level on purpose: the display line-height is below 1, and an
         inline-block under negative leading escapes its own line box. */
      .tl{display:block;}
      .tc{display:block;}

      .rule{position:absolute;left:72px;top:1010px;width:936px;height:6px;background:var(--ink);transform-origin:0% 50%;}
      .inv .rule{background:var(--cream);}

      .venue{position:absolute;left:72px;right:72px;top:1064px;font-weight:800;line-height:1.15;}
      .city{position:absolute;left:72px;right:72px;top:1170px;font-family:'JetBrains Mono',monospace;font-size:32px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
      .inv .city{color:var(--mutedi);}

      .slabwrap{position:absolute;left:72px;top:1250px;display:inline-block;}
      .slab{position:absolute;inset:0;background:var(--ink);transform-origin:0% 50%;}
      .inv .slab{background:var(--sun);}
      .slabtx{position:relative;display:block;padding:14px 34px 22px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:54px;text-transform:uppercase;letter-spacing:-.01em;color:var(--cream);white-space:nowrap;}
      .inv .slabtx{color:var(--ink);}

      .ticks{position:absolute;left:72px;top:1560px;display:flex;gap:14px;}
      .tick{height:12px;background:rgba(27,25,22,.18);position:relative;overflow:hidden;}
      .inv .tick{background:rgba(250,245,235,.24);}
      .tick span{position:absolute;inset:0;background:var(--accent);transform-origin:0% 50%;}
      .tick.done span{transform:scaleX(1);}
      .tick.todo span{transform:scaleX(0);}

      .foot{position:absolute;left:72px;top:1626px;font-family:'JetBrains Mono',monospace;font-size:28px;letter-spacing:.06em;color:var(--muted);}
      .inv .foot{color:var(--mutedi);}

      .hookstack{position:absolute;left:72px;right:72px;top:440px;}
      .h1{font-size:212px;line-height:.82;color:var(--accent);}
      .h2{margin-top:30px;}
      .hookslab{position:absolute;left:72px;top:1200px;display:inline-block;}
      .hookdate{position:absolute;left:72px;top:1440px;font-family:'JetBrains Mono',monospace;font-size:36px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}

      /* card: the running "n of N" is the whole persuasion engine - by card
         five the viewer has felt that they are seeing about one percent. */
      .ofn{position:absolute;left:72px;top:446px;font-family:'JetBrains Mono',monospace;font-size:30px;letter-spacing:.10em;text-transform:uppercase;color:var(--accent);}
      .ages{position:absolute;right:72px;top:446px;font-family:'JetBrains Mono',monospace;font-size:30px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
      .inv .ages{color:var(--mutedi);}

      /* gap beat */
      .gaphead{position:absolute;left:72px;top:300px;font-size:104px;}
      /* Each dot occupies exactly one cell: width + 2x margin = cell, and the
         wrapper is cols*cell wide, so flex-wrap lands cols per row. */
      .gridwrap{position:absolute;left:72px;top:452px;display:flex;flex-wrap:wrap;align-content:flex-start;}
      .dot{display:block;border-radius:50%;background:rgba(250,245,235,.22);width:var(--dotw);height:var(--dotw);margin:var(--dotm);flex:0 0 auto;}
      .dot.lit{background:var(--accent);}
      .gapline{position:absolute;left:72px;right:72px;top:1120px;}

      /* payoff beat */
      .payhead{position:absolute;left:72px;top:300px;font-family:'JetBrains Mono',monospace;font-size:34px;letter-spacing:.10em;text-transform:uppercase;color:var(--muted);}
      .paynum{position:absolute;left:72px;top:390px;font-size:250px;line-height:.84;color:var(--accent);}
      .chiprow{position:absolute;left:72px;right:72px;top:730px;display:flex;flex-wrap:wrap;gap:18px;}
      .chip{background:var(--sun);border:5px solid var(--ink);border-radius:999px;padding:8px 28px 14px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:44px;text-transform:uppercase;color:var(--ink);letter-spacing:-.01em;white-space:nowrap;}
      .payplan{position:absolute;left:72px;right:72px;top:380px;font-size:112px;}
      .paytail{position:absolute;left:72px;right:72px;top:940px;font-weight:800;font-size:46px;line-height:1.2;color:var(--muted);}

      .ctakick{position:absolute;left:72px;right:72px;top:380px;font-size:132px;}
      .ctanews{position:absolute;left:72px;right:72px;top:1500px;font-family:'JetBrains Mono',monospace;font-size:32px;letter-spacing:.06em;color:var(--mutedi);}
      .big{color:var(--accent);}
      .hlwrap{position:relative;display:inline-block;}
      .hlbar{position:absolute;left:-16px;right:-16px;top:-4px;bottom:4px;background:var(--sun);transform-origin:0% 50%;}
      .hltx{position:relative;color:var(--ink);}
      .ctafree{position:absolute;left:72px;top:880px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:-.01em;}
      .ctamark{position:absolute;left:72px;top:1110px;display:inline-flex;align-items:center;gap:24px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:136px;letter-spacing:-.03em;text-transform:lowercase;color:var(--cream);}
      .ctamark i{display:block;width:66px;height:66px;background:var(--accent);border-radius:16px;}
      .ctaurl{position:absolute;left:72px;top:1320px;display:inline-block;}
      .ctaurltx{position:relative;display:block;padding:20px 30px 24px;font-family:'JetBrains Mono',monospace;font-size:${urlSize}px;letter-spacing:.01em;color:var(--ink);}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1080" data-height="1920" data-fps="30">

      <div id="base" class="scene clip" data-start="0" data-duration="${total}" data-track-index="0">
        <div class="basefill"></div>
      </div>

      <div id="s0" class="scene clip" data-start="0" data-duration="${HOOK}" data-track-index="1">
        <div class="pnl" id="s0-pnl"></div>
        <div class="chrome mono"><span class="mark"><i></i>famhop</span><span class="r">${esc(metro.name.toLowerCase())}</span></div>
        <div class="hookstack" data-layout-allow-overlap>
          <div class="disp h1" id="s0-h1">${esc(hookH1)}</div>
${hookLines.map((l, k) => `          <div class="disp h2" style="font-size:${hookFit.size}px"><span class="tc" id="s0-l${k + 1}">${esc(l.toLowerCase())}</span></div>`).join("\n")}
        </div>
        <div class="hookslab slabwrap" id="s0-slabwrap">
          <span class="slab" id="s0-slab"></span>
          <span class="slabtx" id="s0-slabtx">${slabText}</span>
        </div>
        <div class="hookdate" id="s0-date">${dateText}</div>
      </div>

${cards}

      <!-- GAP: the reason to click. Five dots are lit; the rest of the wall is
           what a 30-second video structurally cannot show you. -->
      <div id="gap" class="scene clip inv" data-start="${gapAt}" data-duration="${GAP}" data-track-index="1">
        <div class="pnl" id="gap-pnl"></div>
        <div class="chrome mono"><span class="mark"><i></i>famhop</span><span class="r">${esc(metro.name.toLowerCase())}</span></div>
        <div class="disp gaphead" id="gap-head">you&rsquo;ve seen ${n}.</div>
        <div class="gridwrap" id="gap-grid" style="width:${g.cols * g.cell}px;--dotw:${g.dot}px;--dotm:${Math.max(1, Math.floor((g.cell - g.dot) / 2))}px">${dots}</div>
        <div class="disp gapline" data-layout-allow-overlap style="font-size:${gapLine.size}px">
${gapLine.lines.map((l, k) => `          <span class="tl"><span class="tc" id="gap-l${k + 1}">${esc(l.toLowerCase())}</span></span>`).join("\n")}
        </div>
      </div>

      <!-- PAYOFF: what the site does that a list cannot. -->
      <div id="pay" class="scene clip" data-start="${payoffAt}" data-duration="${PAYOFF}" data-track-index="1">
        <div class="pnl" id="pay-pnl"></div>
        <div class="chrome mono"><span class="mark"><i></i>famhop</span><span class="r">${metro.payoff === "filter" ? "narrow it down" : "make it a day"}</span></div>
${metro.payoff === "filter" ? `        <div class="payhead mono" id="pay-head">${metro.weekTotal} is too many. so:</div>
        <div class="disp paynum" id="pay-num">${casc[0].n}</div>
        <div class="chiprow">
${chips.map((c, k) => `          <span class="chip" id="pay-chip${k + 1}">${esc(c)}</span>`).join("\n")}
        </div>
        <div class="paytail" id="pay-tail">Filter by age, cost and time of day &mdash; on the site.</div>`
      : `        <div class="disp payplan" data-layout-allow-overlap>
${planLines.map((l, k) => `          <span class="tl"><span class="tc" id="pay-p${k + 1}">${esc(l)}</span></span>`).join("\n")}
        </div>
        <div class="paytail" id="pay-tail">Ready-made plans, mapped into one route.</div>`}
      </div>

      <div id="cta" class="scene clip inv" data-start="${ctaAt}" data-duration="${CTA}" data-track-index="1">
        <div class="pnl" id="cta-pnl"></div>
        <div class="chrome mono"><span class="mark"><i></i>famhop</span><span class="r">16 metros &middot; free</span></div>
        <div class="disp ctakick" data-layout-allow-overlap>
          <span class="tl"><span class="tc" id="cta-k1">see the</span></span>
          <span class="tl"><span class="tc big" id="cta-k2">other ${metro.weekTotal - n}</span></span>
        </div>
        <div class="ctamark" id="cta-mark"><i></i>famhop</div>
        <div class="slabwrap ctaurl" id="cta-urlwrap">
          <span class="slab" id="cta-url"></span>
          <span class="ctaurltx" id="cta-urltx">${ctaUrl}</span>
        </div>
        <div class="ctanews" id="cta-news">Or get 5 by email every Friday. Free.</div>
      </div>

${audio.tags}
    </div>

    <script>
      (function () {
        var tl = gsap.timeline({ paused: true });

        tl.fromTo('#s0-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.34, ease: 'power3.out' }, 0);
        tl.fromTo('#s0-h1', { opacity: 0, y: 70, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'power4.out' }, 0.16);
${hookLines.map((_, k) => `        tl.fromTo('#s0-l${k + 1}', { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 0.40, ease: 'expo.out' }, ${(0.52 + k * 0.14).toFixed(2)});`).join("\n")}
        tl.fromTo('#s0-slab', { scaleX: 0 }, { scaleX: 1, duration: 0.38, ease: 'power3.out' }, 1.10);
        tl.fromTo('#s0-slabtx', { opacity: 0 }, { opacity: 1, duration: 0.01 }, 1.40);
        tl.fromTo('#s0-date', { opacity: 0, x: -36 }, { opacity: 1, x: 0, duration: 0.44, ease: 'power3.out' }, 1.56);

        /* One beat map replayed per card - identical rhythm card to card is
           what makes a list Short readable at scroll speed. */
        var CARDS = [
${chunkTl}
        ];
        CARDS.forEach(function (c) {
          var t = c.at, p = '#' + c.id;
          tl.fromTo(p + '-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.30, ease: 'power3.out' }, t);
          tl.fromTo(p + '-num', { opacity: 0, y: 64, scale: 0.78 }, { opacity: 1, y: 0, scale: 1, duration: 0.26, ease: 'power4.out' }, t + 0.14);
          tl.fromTo(p + '-tag', { opacity: 0, scale: 0.72 }, { opacity: 1, scale: 1, duration: 0.30, ease: 'back.out(2.2)' }, t + 0.22);
          for (var i = 0; i < c.chunks; i++) {
            tl.fromTo(p + '-t' + (i + 1), { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.42, ease: 'expo.out' }, t + 0.32 + i * 0.13);
          }
          tl.fromTo(p + '-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.40, ease: 'power3.out' }, t + 0.80);
          tl.fromTo(p + '-v', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out' }, t + 0.92);
          tl.fromTo(p + '-c', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out' }, t + 1.02);
          tl.fromTo(p + '-slab', { scaleX: 0 }, { scaleX: 1, duration: 0.34, ease: 'power3.out' }, t + 1.18);
          tl.fromTo(p + '-slabtx', { opacity: 0 }, { opacity: 1, duration: 0.01 }, t + 1.46);
          tl.fromTo(p + '-of', { opacity: 0, x: -28 }, { opacity: 1, x: 0, duration: 0.32, ease: 'power3.out' }, t + 0.30);
          tl.fromTo(p + '-ages', { opacity: 0, x: 28 }, { opacity: 1, x: 0, duration: 0.32, ease: 'power3.out' }, t + 0.38);
          tl.fromTo(p + '-k', { scaleX: 0 }, { scaleX: 1, duration: 3.0, ease: 'none' }, t + 0.3);
        });

        /* GAP (${gapAt}) - the wall arrives first, then the five you just saw
           light up inside it. One tween for the wall, five for the dots: the
           other ${metro.weekTotal - n} are deliberately never animated. */
        var G = ${gapAt};
        tl.fromTo('#gap-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.32, ease: 'power3.out' }, G);
        tl.fromTo('#gap-head', { opacity: 0, y: 48 }, { opacity: 1, y: 0, duration: 0.40, ease: 'power4.out' }, G + 0.14);
        tl.fromTo('#gap-grid', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.62, ease: 'power2.out' }, G + 0.44);
${Array.from({ length: n }, (_, k) => `        tl.fromTo('#g${k + 1}', { scale: 0.3 }, { scale: 1, duration: 0.34, ease: 'back.out(3)' }, G + ${(0.92 + k * 0.09).toFixed(2)});`).join("\n")}
${gapLine.lines.map((_, k) => `        tl.fromTo('#gap-l${k + 1}', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.40, ease: 'expo.out' }, G + ${(1.52 + k * 0.13).toFixed(2)});`).join("\n")}

        /* PAYOFF (${payoffAt}) */
        var P = ${payoffAt};
        tl.fromTo('#pay-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.32, ease: 'power3.out' }, P);
${metro.payoff === "filter" ? `        tl.fromTo('#pay-head', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.34, ease: 'power3.out' }, P + 0.14);
        tl.fromTo('#pay-num', { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.34, ease: 'power4.out' }, P + 0.30);
        /* Each step is a real count, one filter deeper. Set-and-pop rather than
           a tween, so every rendered frame shows a number that is actually true. */
        var STEPS = [${casc.map((s) => s.n).join(", ")}];
        var numEl = document.getElementById('pay-num');
        [1, 2, 3].forEach(function (i) {
          var at = P + 0.86 + (i - 1) * 0.62;
          tl.call(function () { numEl.textContent = STEPS[i]; }, null, at);
          tl.fromTo('#pay-num', { scale: 0.86 }, { scale: 1, duration: 0.26, ease: 'back.out(2.4)' }, at);
          tl.fromTo('#pay-chip' + i, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.28, ease: 'back.out(2.6)' }, at);
        });
        /* Seeking backwards has to restore the first count too. */
        tl.call(function () { numEl.textContent = STEPS[0]; }, null, P);
        tl.fromTo('#pay-tail', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.38, ease: 'power3.out' }, P + 2.90);`
      : `${planLines.map((_, k) => `        tl.fromTo('#pay-p${k + 1}', { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 0.42, ease: 'expo.out' }, P + ${(0.20 + k * 0.42).toFixed(2)});`).join("\n")}
        tl.fromTo('#pay-tail', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.38, ease: 'power3.out' }, P + 2.20);`}

        var T = ${ctaAt};
        tl.fromTo('#cta-pnl', { scaleY: 0 }, { scaleY: 1, duration: 0.34, ease: 'power3.out' }, T);
        tl.fromTo('#cta-k1', { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.40, ease: 'expo.out' }, T + 0.16);
        tl.fromTo('#cta-k2', { opacity: 0, y: 60, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: 'power4.out' }, T + 0.32);
        tl.fromTo('#cta-mark', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.42, ease: 'power4.out' }, T + 0.86);
        tl.fromTo('#cta-url', { scaleX: 0 }, { scaleX: 1, duration: 0.40, ease: 'power3.out' }, T + 1.18);
        tl.fromTo('#cta-urltx', { opacity: 0 }, { opacity: 1, duration: 0.01 }, T + 1.50);
        tl.fromTo('#cta-news', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.38, ease: 'power3.out' }, T + 1.74);

        window.__timelines = window.__timelines || {};
        window.__timelines['main'] = tl;
      })();
    </script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------- main
mkdirSync(OUT_ROOT, { recursive: true });
mkdirSync(SHARED_VO, { recursive: true });

if (WANT_VO) {
  for (const [name, text] of Object.entries(VO_LINES)) {
    await tts(text, join(SHARED_VO, name + ".mp3"));
  }
}

const manifest = [];

for (const metro of PICKS.metros) {
  const dir = join(OUT_ROOT, metro.id);
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  mkdirSync(join(dir, "assets", "bgm"), { recursive: true });
  mkdirSync(join(dir, "assets", "voice"), { recursive: true });

  for (const f of ["bricolage-grotesque-400_800.woff2", "jetbrains-mono-400.woff2", "plus-jakarta-sans-400.woff2"])
    copyFileSync(join(TEMPLATE, "assets/fonts", f), join(dir, "assets/fonts", f));
  copyFileSync(join(TEMPLATE, "assets/bgm/famhop-underscore.mp3"), join(dir, "assets/bgm/famhop-underscore.mp3"));
  for (const f of ["hyperframes.json", "package.json"]) copyFileSync(join(TEMPLATE, f), join(dir, f));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: `famhop-short-${metro.id}`, name: `famhop-short-${metro.id}` }, null, 2));

  const n = Math.min(metro.picks.length, 5);
  const gapAt = +(2.8 + n * 3.4).toFixed(2);
  const payoffAt = +(gapAt + 4.0).toFixed(2);
  const ctaAt = +(payoffAt + 4.6).toFixed(2);
  const total = +(ctaAt + 4.6).toFixed(2);
  const audio = { tags: "" };

  if (WANT_VO) {
    const article = metro.name === "Bay Area" ? "the " : "";
    const ctaText = `${metro.weekTotal} family events in ${article}${metro.name.replace("–", " ")} this week. Famhop dot com.`;
    await tts(ctaText, join(dir, "assets/voice/cta.mp3"));

    const hookKey = metro.window !== "weekend" ? "hook-week" : metro.allFree ? "hook-free-weekend" : "hook-weekend";
    copyFileSync(join(SHARED_VO, hookKey + ".mp3"), join(dir, "assets/voice/01.mp3"));
    copyFileSync(join(SHARED_VO, "checked.mp3"), join(dir, "assets/voice/02.mp3"));
    copyFileSync(join(SHARED_VO, "gap.mp3"), join(dir, "assets/voice/03.mp3"));
    copyFileSync(join(SHARED_VO, `payoff-${metro.payoff}.mp3`), join(dir, "assets/voice/04.mp3"));

    // One line per beat; each lands inside its own scene so narration never
    // straddles a cut.
    const slots = [
      { src: "assets/voice/01.mp3", at: 0.1, file: join(dir, "assets/voice/01.mp3") },
      { src: "assets/voice/02.mp3", at: 3.0, file: join(dir, "assets/voice/02.mp3") },
      { src: "assets/voice/03.mp3", at: +(gapAt + 0.3).toFixed(2), file: join(dir, "assets/voice/03.mp3") },
      { src: "assets/voice/04.mp3", at: +(payoffAt + 0.35).toFixed(2), file: join(dir, "assets/voice/04.mp3") },
      { src: "assets/voice/cta.mp3", at: +(ctaAt + 0.35).toFixed(2), file: join(dir, "assets/voice/cta.mp3") },
    ];

    const lines = slots.map((s, i) => {
      const d = secondsOf(s.file).toFixed(2);
      return `      <audio id="vo${i + 1}" src="${s.src}" data-start="${s.at}" data-duration="${d}" data-track-index="10" data-volume="1"></audio>`;
    });
    lines.push(`      <audio id="bgm" src="assets/bgm/famhop-underscore.mp3" data-start="0" data-duration="${total.toFixed(2)}" data-track-index="11" data-volume="0.14"></audio>`);
    audio.tags = "      <!-- narration written to fit these windows; never re-time frames from voice length -->\n" + lines.join("\n");
  }

  writeFileSync(join(dir, "index.html"), buildHtml(metro, audio));

  manifest.push({
    id: metro.id, name: metro.name, window: metro.window, cards: n,
    allFree: metro.picks.slice(0, n).every((p) => p.free),
    freeCards: metro.picks.slice(0, n).filter((p) => p.free).length,
    duration: total,
    payoff: metro.payoff,
    cascade: metro.filterDemo.cascade,
    weekTotal: metro.weekTotal, weekFree: metro.weekFree,
    shown: metro.picks.slice(0, n),
    picks: metro.picks,
  });
  console.log(`built ${metro.id.padEnd(20)} ${n} cards · ${metro.window} · ${metro.payoff} · ${total.toFixed(1)}s`);
}

writeFileSync(join(OUT_ROOT, "manifest.json"), JSON.stringify({ weekend: PICKS.weekend, metros: manifest }, null, 2));
console.log("\n" + OUT_ROOT);
