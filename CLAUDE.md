# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Deploy

When the user says "deploy", it means **deploy to Cloudflare Pages directly via wrangler** — not "git push and let CI deploy". Use:

- `npm run deploy:kids` → FamHop (project `saturday-spots`)
- `npm run deploy:adults` → Mosey (project `nighthop`, serves trymosey.com)
- `npm run deploy:data` → famhop-data

If the user says "deploy" without specifying, default to both kids and adults (the shared `App.tsx` means a change usually ships to both). Run `npm run test` + `npm run validate:data` + `npm run validate:events` first to match what CI would check.

## Google Indexing API & Automation

To resolve sitemap crawl budget issues and automate search engine indexation:
- **Core Script**: `npm run publish:indexing` (runs [publish-indexing.mjs](file:///Users/kning/Projects/saturday/scripts/publish-indexing.mjs)) reads `dist/sitemap.xml`, prioritizes hub pages, filters for new/modified events, and submits up to 200 URLs/day (quota limit) to the Google Indexing API.
- **History**: Submission timestamps are saved in [indexing-history.json](file:///Users/kning/Projects/saturday/data/indexing-history.json) to maintain a rolling queue.
- **GitHub Actions (Cloud)**: The daily `refresh-data` workflow runs the publisher and automatically commits the updated history file back to `main`. Requires the `GOOGLE_INDEXING_CREDENTIALS` repository secret.
- **macOS Scheduler (Local)**: A launchd agent runs [local-indexing-cron.sh](file:///Users/kning/Projects/saturday/scripts/local-indexing-cron.sh) daily at 9:00 AM using local `gcloud` ADC credentials.
  - Setup: run [setup-local-cron.sh](file:///Users/kning/Projects/saturday/scripts/setup-local-cron.sh) to copy the plist configuration to `~/Library/LaunchAgents/` and load it.
  - Logs: written to [local-indexing.log](file:///Users/kning/Projects/saturday/tmp/local-indexing.log).

## Shared Skills

- For local event discovery, source repair, Bay Area feed repopulation, or missing-event audits, read and follow `skills/grounded-event-discovery/SKILL.md`. It defines the official-source search workflow and verification gates shared with Codex.
