# PWA QA Checklist

Manual QA for the PWA install + offline cache (ADR 05). The service worker
and runtime caching only activate in **production builds** (registration is
gated behind `import.meta.env.PROD` in `src/main.tsx`), so test against a
production build, not `npm run dev`:

```sh
npm run build && npm run preview   # serves dist/ on http://localhost:4173
```

For real install/A2HS testing you need HTTPS — use the deployed
famhop.com (or nighthop.pages.dev), since `localhost` is treated as a
secure context by Chrome but iOS Safari A2HS is best verified on the live
origin.

## Automated coverage

- `npm run build` runs `tsc -b` and emits `dist/sw.js` with the three
  runtime caches (`famhop-events-v1`, `famhop-spots-v1`,
  `famhop-images-v1`) + the `NavigationRoute` shell fallback.
- `npm run test` (213 tests) covers planner + pipeline logic. The SW and
  install banner have **no** unit tests — they're DOM/SW-runtime behavior,
  validated by the manual passes below.

The install-banner gating was verified in a mobile preview (banner shows
when eligible, "Not now" persists a 30-day dismissal, the Hop-now FAB
lifts above the banner). The cross-platform install/offline flows below
still need a human + real devices.

## 1. Installability (desktop Chrome)

- [ ] Open the prod build. DevTools → Application → Manifest: no errors,
      icon preview renders (192 + 512 PNG).
- [ ] Application → Service Workers: `sw.js` is **activated and running**.
- [ ] Lighthouse → PWA category passes "Installable".
- [ ] Address-bar install icon appears. Install → app opens in its own
      standalone window with the FamHop icon.

## 2. Install banner (Android Chrome + desktop Chrome)

The banner gates on: ≥2 sessions, not standalone, not dismissed in 30d,
not installed, and `beforeinstallprompt` fired. To reach the gate fast,
load the site twice (or set `localStorage['famhop:visits'] = '2'`).

- [ ] On the 2nd+ visit, the bottom banner appears with "Add FamHop to your
      home screen…" + **Install** / **Not now**.
- [ ] **Install** fires the native prompt. Accepting installs the app and
      the banner does not return (`famhop:install:installed = 1`).
- [ ] **Not now** hides the banner and sets `famhop:install:dismissedAt`.
      Reloading within 30 days does **not** re-show it.
- [ ] Banner does **not** appear on `/ops/*` routes.
- [ ] Banner does **not** appear once running in standalone (installed) mode.

## 3. iOS Safari (Add to Home Screen)

iOS does not fire `beforeinstallprompt`, so the banner shows on UA = iOS
Safari (after the ≥2-visit gate) and the CTA is **Show me how**.

- [ ] Banner appears with **Show me how** (not "Install").
- [ ] Tapping it opens the modal: Share → Add to Home Screen → Add.
- [ ] Following the steps adds a FamHop icon to the home screen; launching
      it opens full-screen (no Safari chrome) per the manifest.
- [ ] Banner does **not** appear in Chrome/Firefox on iOS (CriOS/FxiOS).

## 4. Offline cache (any platform, after SW is active)

- [ ] Online: open a metro guide so its `events.json` + `featured-plans.json`
      are fetched (DevTools → Network shows 200s from
      `famhop-data.pages.dev`).
- [ ] DevTools → Network → **Offline**, then hard-reload. The page still
      renders from the precached shell + cached JSON (Application → Cache
      Storage shows `famhop-events-v1` / `famhop-spots-v1` populated).
- [ ] Map tiles + spot imagery for already-viewed areas still render offline
      (`famhop-images-v1`).
- [ ] A metro you have **not** visited offline shows the app's normal
      "couldn't load events" inline state (no dedicated offline.html — that's
      a deferred follow-up; see ADR 05 §d case 2).

## 5. Update / staleness

- [ ] After a new deploy, reloading an open tab picks up the new build
      (`registerType: 'autoUpdate'`); old precache entries are cleaned
      (`cleanupOutdatedCaches`).
- [ ] `events.json` refreshes within ~6h (StaleWhileRevalidate): the first
      view may be cached, but a background fetch repairs it for the next view.

## Known gaps / follow-ups

- No dedicated `public/offline.html` for unvisited metros (ADR 05 §d case 2).
- NightHop (adults) reuses FamHop-branded PNG icons until purpose-built
  ones land (ADR 05 §e).
