# Changelog

Older shipped items, trimmed from `ROADMAP.md`'s Done bucket. Most recent first.

## 2026-05

- 2026-05-22 · **Stable spot slugs + SEO audit in CI** — legacy URL aliases preserved.
- 2026-05-22 · **Interactive Event Finder** — on weekend guide pages.
- 2026-05-19 · **Privacy-safe funnel metrics** — first-party measurement, no third-party trackers.
- 2026-05-19 · **Rich share previews** — weekend-guide event rich results.
- 2026-05-17 · **Free-text search across spots + events** — already shipped; the roadmap item was stale. Case-insensitive substring search bound to a single `query`, persisted in URL state, filtering spots (`name`/`neighborhood`/`category`/`mood`/`note`/`tags`, `App.tsx:2293`) and events (`title`/`venue`/`city`/`neighborhood`/`category`/`description`, `App.tsx:2487`). Spot search dates to the initial app (`1ac143a`); events joined the haystack in `69a97b7`. Ranking / fuzzy matching / a unified results view remain as possible future polish, not tracked.
