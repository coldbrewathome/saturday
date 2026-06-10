# Human-ops checklist (everything code can't do)

Things only the operator can do — accounts, DNS, dashboards, secrets. Work top
to bottom; each section is independent. Commands assume repo root.

_Status as of 2026-06-10. Check items off in place as you complete them._

---

## 1. Resend account + famhop.com sending domain (newsletter activation)

The newsletter is code-complete (`worker/src/newsletter.ts`, runbook in the
2026-05-24 roadmap entry) and ships as a no-op until `NEWSLETTER_ENABLED` is set.

- [ ] Create a Resend account at https://resend.com (use kaining.usc@gmail.com).
- [ ] In Resend → Domains → Add Domain → `famhop.com`. Resend shows 3–4 DNS
      records (DKIM TXT/CNAME records + an SPF include + optional DMARC).
- [ ] Add those records in the Cloudflare dashboard → famhop.com → DNS. Use
      "DNS only" (grey cloud) for the DKIM/SPF records — proxied records break
      verification.
- [ ] Back in Resend, click Verify and wait for the domain to show **Verified**.
- [ ] Create an API key in Resend → API Keys (sending access only is enough).
- [ ] Set the worker secrets (you'll be prompted for each value):

      ```sh
      cd worker
      npx wrangler secret put RESEND_API_KEY
      npx wrangler secret put NEWSLETTER_ADMIN_TOKEN   # mint your own: openssl rand -hex 32
      npx wrangler secret put UNSUBSCRIBE_SECRET       # mint your own: openssl rand -hex 32
      ```

- [ ] Edit `worker/wrangler.toml` `[vars]`: add `NEWSLETTER_ENABLED = "true"`.
      For the first send also add
      `NEWSLETTER_TEST_ALLOWLIST = "kaining.usc@gmail.com"` so nothing can go
      to the real list yet (anything not on the allowlist is filtered out).
- [ ] Deploy the worker: `npm --prefix worker run deploy`.
- [ ] Trigger a test send (POST `/newsletter/send` with
      `Authorization: Bearer <NEWSLETTER_ADMIN_TOKEN>`), then QA the digest in
      **Gmail and Apple Mail** (images, links, unsubscribe footer).
- [ ] Remove `NEWSLETTER_TEST_ALLOWLIST` from `[vars]` and redeploy the worker
      when you're ready for production list sends.

## 2. Purge KV test data (before any real send)

The subscriber list contains `@example.com` test entries. Keys live in the
`POLLS` KV namespace (id `dd49dd61e74b4823b9427a91df59eb3e`, from
`worker/wrangler.toml`) shaped `newsletter:<metroId>:<email>`.

- [ ] List newsletter keys:

      ```sh
      cd worker
      npx wrangler kv key list --namespace-id=dd49dd61e74b4823b9427a91df59eb3e \
        --prefix="newsletter:" > /tmp/newsletter-keys.json
      grep -o '"name": *"[^"]*example\.com[^"]*"' /tmp/newsletter-keys.json
      ```

- [ ] Delete each test key:

      ```sh
      npx wrangler kv key delete --namespace-id=dd49dd61e74b4823b9427a91df59eb3e "newsletter:<metro>:<email>"
      ```

- [ ] Re-run the list command and confirm zero `@example.com` matches remain.

## 3. Google Search Console — verify BOTH domains, submit sitemaps

trymosey.com has **0 pages indexed**; famhop.com needs sitemap + indexing
nudges. Do this for **famhop.com and trymosey.com separately**.

- [ ] https://search.google.com/search-console → Add property → **Domain**
      property (`famhop.com`, then `trymosey.com`).
- [ ] Verify via **DNS TXT**: GSC gives a `google-site-verification=...` value;
      add it as a TXT record on the apex in Cloudflare DNS. (Alternative: this
      batch adds `GSC_VERIFICATION_*` env hooks to the SEO page generator that
      emit the meta tag at build time — check `scripts/generate-seo-pages.mjs`
      for the exact variable names once the batch lands, set them in the deploy
      environment, and use a URL-prefix property instead. DNS TXT is simpler
      and covers both URL schemes; prefer it.)
- [ ] Submit sitemaps (Search Console → Sitemaps):
      - `https://famhop.com/sitemap.xml`
      - `https://trymosey.com/sitemap.xml`
- [ ] Request indexing (URL Inspection → Request indexing) on the highest-value
      pages — metro homes and this-weekend guides. Minimum set:
      - `https://famhop.com/bay-area/`
      - `https://famhop.com/bay-area/this-weekend/`
      - `https://famhop.com/los-angeles/this-weekend/`
      - `https://famhop.com/new-york-city/this-weekend/`
      - `https://trymosey.com/` and the Mosey Bay Area / this-weekend pages
        (SF-only beta scope — see ROADMAP).
      GSC rate-limits requests (~10/day per property); do the rest over the
      following days.

## 4. Friday CI deploy secrets — ALREADY PRESENT, nothing to set up

`gh secret list` (checked 2026-06-10) shows `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` (both set 2026-05-11). The Friday 13:00 UTC pre-weekend
rebuild was therefore added directly as a `schedule:` trigger on
`.github/workflows/deploy-pages.yml` — it deploys kids then adults sequentially
in one job (never parallel; shared `dist/`).

- [ ] Nothing to do unless the token is rotated. If it is:
      `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`
      (token needs Cloudflare Pages:Edit on the account).
- [ ] Optional sanity check after the first scheduled Friday run:
      `gh run list --workflow deploy-pages.yml --limit 3`.

## 5. Week-1 distribution (drafts ready, human posts)

- [ ] Post drafts: `docs/launch/WEEK1-POSTS.md` — **a human posts these,
      never automated**. Re-verify every event link the morning you post.
- [ ] Backlink outreach drafts: `docs/launch/OUTREACH.md` — fill in the real
      per-metro reach numbers from `/ops/analytics` before sending; do not
      inflate.
- [ ] Voice rules for anything public-facing: `docs/launch/CURATOR-VOICE.md`.
