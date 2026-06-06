// Cloudflare Pages Function: serves per-plan Open Graph metadata for shared
// poll links so they unfurl with the plan's details (not the generic site
// preview) in iMessage/WhatsApp/Facebook group chats. Humans are redirected
// to the SPA's hash route; crawlers read the OG tags.
//
// Scoped to /p/* via dist/_routes.json so all other routes serve static.

const WORKER_API = "https://saturday-polls.santaclararental2016.workers.dev";

// This Function deploys to both the kids (FamHop) and adults (Mosey) Pages
// projects, so brand from the request host rather than hardcoding. The adults
// project serves trymosey.com (and still nighthop.pages.dev as its fallback).
function brandForHost(host) {
  return /trymosey|mosey|nighthop/i.test(host || "") ? "Mosey" : "FamHop";
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function onRequestGet(context) {
  const { params, request } = context;
  const pollId = String(params.pollId || "")
    .replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 64);
  const reqUrl = new URL(request.url);
  const origin = reqUrl.origin;
  const BRAND = brandForHost(reqUrl.hostname);
  const appUrl = `${origin}/#/p/${pollId}`;
  const ogImage = `${origin}/og-image.png`;

  let title = `${BRAND} — vote on the plan`;
  let description = "Vote on this family weekend plan.";

  try {
    if (pollId) {
      const res = await fetch(`${WORKER_API}/polls/${pollId}`, {
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      if (res.ok) {
        const poll = await res.json();
        const stopCount = Array.isArray(poll.stops) ? poll.stops.length : 0;
        const eventCount = Array.isArray(poll.events) ? poll.events.length : 0;
        const names = [
          ...(Array.isArray(poll.stops) ? poll.stops.map((s) => s && s.name) : []),
          ...(Array.isArray(poll.events) ? poll.events.map((e) => e && e.title) : []),
        ]
          .filter(Boolean)
          .slice(0, 3);
        if (poll.title) title = `${poll.title} — vote on the plan`;
        const counts = [];
        if (stopCount) counts.push(`${stopCount} place${stopCount === 1 ? "" : "s"}`);
        if (eventCount) counts.push(`${eventCount} event${eventCount === 1 ? "" : "s"}`);
        const countStr = counts.join(" · ");
        description = names.length
          ? `${countStr ? countStr + " — " : ""}${names.join(", ")}. Tap to vote with your crew on ${BRAND}.`
          : `Vote on this family weekend plan with ${BRAND}.`;
      }
    }
  } catch {
    // fall through to defaults
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(appUrl)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="canonical" href="${esc(appUrl)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body>
<p>Opening the plan… <a href="${esc(appUrl)}">Tap here if it doesn't load.</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}
