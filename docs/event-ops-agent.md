# Event Ops Agent

The event ops agent wraps the existing event pipeline in one command:

1. ingest events
2. validate event data
3. build the shared data-site artifact
4. summarize source health, last-known-good recovery, fallback events, and operator alerts
5. classify source alerts into operator action buckets
6. optionally publish to the Worker and verify the Worker readback count
7. optionally deploy the shared data site

Remote actions are explicit. A normal run does not publish to Cloudflare.

## Common Commands

Run the default metro locally:

```bash
npm run ops:events
```

Run every configured metro locally:

```bash
npm run ops:events:all
```

Summarize current reports without regenerating data:

```bash
npm run ops:events:all -- --skip-ingest --skip-validate --skip-data-site --fail-on-alerts=none
```

Publish the Worker event override only after local gates pass:

```bash
SATURDAY_API=https://saturday-polls.santaclararental2016.workers.dev \
SATURDAY_SESSION_TOKEN=<token> \
npm run ops:events -- --publish-worker
```

Deploy the shared data Pages site only after local gates pass:

```bash
npm run ops:events:all -- --deploy-data
```

Run ingestion, attempt safe source URL repair, rerun ingestion if fixes apply, and stop before publishing unless gates pass:

```bash
npm run ops:events -- \
  --auto-repair-sources \
  --source-repair-candidates=/path/to/source-repair-candidates.json
```

`--auto-repair-sources` is conservative. It only updates source registry URLs when `source-repair-agent` has fetched an official candidate URL and the existing extractor produced events from that candidate. Parser-needed sources remain in the source-repair report.

## Alert Gates

The default gate is `--fail-on-alerts=critical`. That means validation errors or critical source alerts block remote publishing. Other options:

- `none`: do not block on operator alerts
- `critical`: block on critical alerts
- `warning`: block on critical or warning alerts
- `any`: block on any operator alert

Each run writes a JSON report to `output/event-ops-agent/latest.json` unless `--report=<path>` is provided. It also writes a Markdown triage report to `output/event-ops-agent/latest.md` unless `--triage-report=<path>` is provided.

## Triage Buckets

- `no-recovery`: critical source failure with no restored events and no more specific issue class; fix before publishing.
- `source-access-or-dead-url`: HTTP 403, 404, or 410; check source access, URL, or replacement source.
- `upstream-outage`: transient-looking fetch/server failure; keep recovery active and retry later.
- `parser-follow-up`: source returned content but extracted zero live events; inspect payload and update parser.
- `recovered-watch`: last-known-good recovery is active; monitor recovery age and next live ingest.
- `template-fallback`: recurring template filled the gap; improve live extraction if the source matters.
