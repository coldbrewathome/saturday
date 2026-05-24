# Source Repair Agent

The source repair agent turns zero-extracted event-source alerts into a grounded repair queue.

It does not add events from search snippets. Search grounding is used only to find candidate official URLs. Candidate pages must still be fetched and passed through the normal extractors before they are considered validated.

## Commands

Generate a repair queue for current Bay Area critical zero-extracted sources:

```bash
npm run ops:sources
```

Limit to one source:

```bash
npm run ops:sources -- --source=sonoma-county-library
```

Validate grounded candidate URLs:

```bash
npm run ops:sources -- \
  --candidate-file=/path/to/source-repair-candidates.json \
  --fetch-candidates
```

Apply only safe URL fixes after validation:

```bash
npm run ops:sources -- \
  --candidate-file=/path/to/source-repair-candidates.json \
  --fetch-candidates \
  --apply-safe-url-fixes
```

Safe URL fixes require all of these:

- the candidate is official or same-domain
- the candidate fetched successfully
- the existing extractor produced at least one event
- the source exists in a known registry file

The agent does not write events from snippets and does not apply parser-needed fixes automatically.

Write reports somewhere temporary:

```bash
npm run ops:sources -- \
  --report=/private/tmp/source-repair-report.json \
  --markdown=/private/tmp/source-repair-report.md
```

## Candidate File

```json
{
  "candidates": [
    {
      "sourceId": "sonoma-county-library",
      "url": "https://events.sonomalibrary.org/events/list?language=en",
      "title": "Event List | Sonoma County Library",
      "snippet": "Grounding note or search result summary",
      "official": true
    }
  ]
}
```

`official` can be omitted when the candidate is on the same registrable domain as the configured source URL. Set it to `true` only when the source is clearly official or operator-owned despite a different domain.

## Statuses

- `validated-events`: official candidate fetched and normal extraction produced events.
- `official-candidate-needs-parser`: official candidate fetched but the current extractor produced zero events.
- `official-candidate-unvalidated`: official candidate has not been fetched because `--fetch-candidates` was not used.
- `rejected-non-official`: candidate is not trusted enough to validate automatically.
- `fetch-failed` / `fetch-error`: candidate could not be fetched.

The durable fix is usually either updating a source URL/source type, or adding a parser for the official page format.
