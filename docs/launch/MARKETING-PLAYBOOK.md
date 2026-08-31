# FamHop Marketing Playbook — what the winners do, and our equivalents

_Compiled 2026-08-30 from the successful local/family-event playbooks: Macaroni
KID (800+ hyperlocal editions), Funcheap SF (one of the biggest local-event
email lists), Time Out (city guides + city email), Red Tricycle (family
activities editorial + sponsorships), plus the local-SEO pattern already
proven in famhop's own GSC data (dated event pages rank in ~13 days).

## The one-line strategy

The winners don't win on any single channel — they win by being **the weekly
habit**: a parent's Friday inbox (email), their local Facebook group or city
subreddit (community), and the search results when the season turns (SEO).
FamHop now has the supply (verified events), the SEO (7.5k seasonal/event
pages), and the voice (Sam). **What's missing is cadence** — the weekly email
and the weekly community posts. Both are built and ready; they need the
human steps below.

## What the winners actually do (grounded)

### 1. Macaroni KID — the hyperlocal newsletter machine
- One local editor per metro who *is* the brand ("our publisher is a local
  mom"), posting weekly "Things to do this week" newsletters + Facebook group
  presence + partnerships with schools/PTAs/libraries.
- Growth loop: newsletter capture on every page → weekly engagement →
  referrals to other parents (they explicitly market "forward this to a
  friend").
- [About Macaroni KID](https://nwcolumbus.macaronikid.comwestpalmbeach.macaronikid.com/about-us#1) — the franchise pitch is literally "local editor +
  weekly email + community".

### 2. Funcheap SF — the email list is the business
- Grew SF's biggest cheap-fun email list with a daily/weekly "things to do"
  cadence and a strong free-content ethos; monetized with ads + an Eventbrite
  partnership. Social (Facebook/Twitter) amplifies, but **the list is the
  asset**.
- [Funcheap on Eventbrite](https://www.eventbrite.com/o/474182202) ·
  [region pages](https://sf.funcheap.com/region/pittsburg/) — the region-page
  pattern is exactly famhop's this-weekend guides.

### 3. Time Out — city guides + city email + SEO "best of" content
- City-by-city editorial, heavily SEO'd listicles, per-city email
  newsletters. Local-scale brand with a global franchise model.
- [TMO trading update showing audience +12% YoY on the same model](https://www.lse.co.uk/rns/TMO/trading-update-for-the-year-ended-31-december-2019-rec12jjsmu4l1ap.html?page=2#2).

### 4. Red Tricycle — editorial + sponsored family content
- Family-activities editorial with advertising/sponsorship partnerships
  (brands pay to reach parents). The content quality (not volume) is the
  moat. (Monetization note: famhop is pre-monetization; this is the eventual
  sponsor path.)

### 5. The local-SEO season play (famhop's own data)
- Dated event pages rank in ~13 days with zero backlinks; seasonal pages
  ("pumpkin patch", "trick or treat", "santa") are the traffic spikes.
- Already executed: sitemap 6,425 → 7,541 URLs, seasonal waves live,
  evergreen annual pages holding rank between seasons.

## FamHop equivalents — status map

| Winning mechanic | FamHop equivalent | Status |
|---|---|---|
| Weekly email digest | `worker/src/newsletter.ts` — verified rendering current data (subject leads with the headliner; Lemos, festivals included) | **Code done; activation = human ops** (Resend account + DNS + 3 secrets + flag; HUMAN-OPS.md checklist) |
| Local-editor voice | Sam voice (`CURATOR-VOICE.md`) + `WEEK1-POSTS.md` | Voice done; **posts regenerated for Sep 5–6, human posts them** |
| Weekly community presence | r/bayarea, r/LosAngeles, FB parent groups, Nextdoor drafts | Drafts ready; human posts Thu/Fri |
| Seasonal SEO | Event pages + annual pages + request-index candidates | **Live** |
| Pinterest | `generate_pins.py` (33 pins/day, 16 city boards) + dispatch skill | Queues regenerated Aug 31–Sep 2; human dispatch posts |
| Earned backlinks | `BACKLINK-OUTREACH.md` (12 targets, libraries first) | Human outreach |
| Referral loop | share→vote plans, weekend share links | Built; needs traffic to prime |
| "Forward to a friend" | Newsletter template has a share link? — **add an explicit "know another family? forward this" line** when activated | Tiny template edit at activation |

## The activation checklist (all human, all documented)

1. **Newsletter** — follow `docs/launch/HUMAN-OPS.md` §1: Resend account →
   famhop.com DKIM/SPF in Cloudflare → API key → 3 worker secrets →
   `NEWSLETTER_ENABLED = "true"` + test allowlist → `newsletter-send.mjs
   --send` → QA in Gmail/Apple Mail → remove allowlist. Digest already
   verified rendering the Sep 5–6 weekend correctly.
2. **Community posts** — paste `docs/launch/WEEK1-POSTS.md` drafts Thu
   evening/Fri morning (Sam voice, disclosure line included).
3. **Pinterest** — post `pins-queue/2026-08-31.json` → `2026-09-02.json` via
   the dispatch skill; regenerate weekly (`python3 generate_pins.py`).
4. **Backlinks** — first 3 outreach emails from `BACKLINK-OUTREACH.md`
   (SFPL first — they have an explicit local-links page).
5. **GSC request-indexing** — `REQUEST-INDEX-CANDIDATES.md` (~220 URLs),
   ~10 min, repeat weekly after each deploy.

## Metrics to watch (2-week cadence)

- GSC: clicks/impressions (baseline Jul 30–Aug 28: **2 clicks / 1,070 impr**)
- Newsletter: subscribers, open rate (target >40%), digest link clicks
- Community: upvotes/comments on the weekly posts; referral URL visits
  (utm tags on posted links — add `?utm_source=reddit&utm_medium=post` etc.)
- Pinterest: outbound clicks from pins

## Do NOT (policy)

- No automated posting anywhere (social is human, per WEEK1-POSTS/CURATOR-VOICE).
- No bought links, no link networks, no PBNs (SEO policy).
- No aggregateRating in JSON-LD, no FAQPage schema.
- Don't promise a newsletter date until activation lands.
