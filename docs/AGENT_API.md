# CiteFlow agent interface

For direct local Word files, prefer the new [standalone file agent](LOCAL_AGENT.md): seven typed CLI/MCP tools, a workspace boundary, no database, offline by default, and collaborator exports. The older database/HTTP interfaces below remain available. Tool names overlap, so configure one interface per MCP server name.

All document mutations refer to stable source and occurrence IDs. Never identify a source by a displayed number. Source lookup only verifies bibliographic metadata, not evidence support.

## Transports

- CLI: `node src/cli.js METHOD < arguments.json`. JSON to stdout; errors to stderr with a nonzero exit code.
- HTTP: `POST /api/call`, bearer authorization, `Content-Type: application/json`, body `{"method":"METHOD","args":{...}}`. Response `{"result":...}` or `{"error":"..."}`.
- MCP: `node src/mcp.js`. Method dots become underscores, e.g. `documents.inspect` → `documents_inspect`. `citeflow://operations` exposes this document.
- Discovery: `/llms.txt` and `/openapi.json`.

## Lifecycle example

1. `documents.create` with `{"title":"Example","style":"apa"}`. Retain its ID and revision.
2. `sources.resolve` with `{"input":"https://doi.org/10.1038/171737a0"}`. Inspect `source`, `provenance`, and `warnings`.
3. `documents.edit` with an operation `{"type":"source.upsert","source":<resolved source>}`. Retain the returned `results[0].sourceId`.
4. `documents.edit` again at the new revision with `{"type":"citation.insert","items":[{"id":"SOURCE_ID"}]}`.
5. `documents.inspect` returns the document snapshot, formatted output, and metadata issues.

Each edit envelope is:

```json
{
  "documentId": "DOCUMENT_ID",
  "expectedRevision": 2,
  "requestId": "a-unique-request-id",
  "operations": [
    {
      "type": "citation.insert",
      "id": "my-occurrence-id",
      "items": [{ "id": "SOURCE_ID", "locator": "12–14", "label": "page" }]
    }
  ]
}
```

Exact request retries replay the stored response. Reusing a request ID with changed arguments produces a conflict. A stale revision produces a conflict. Read fresh state before deciding how to retry; never blindly replace an expected revision.

## Operations

| Type               | Fields                              | Behavior                                                                                                                          |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `source.upsert`    | `source` (CSL JSON)                 | Add a source, or reuse an exact DOI/PMID/URL identity. Never silently overwrite an existing record.                               |
| `source.update`    | `sourceId`, `patch`                 | Correct metadata throughout this document. `null` or an empty string clears optional fields.                                      |
| `citation.insert`  | `items`, optional `id`, `beforeId`  | Insert an occurrence in citation order.                                                                                           |
| `citation.update`  | `citationId`, `items`               | Replace a group's members or locators.                                                                                            |
| `citation.remove`  | `citationId`                        | Remove one occurrence; the source remains reusable.                                                                               |
| `citation.reorder` | `ids`                               | Supply every occurrence ID exactly once, in the desired order.                                                                    |
| `source.replace`   | `from`, `to`, optional `citationId` | Replace a source everywhere or within one occurrence. Locators are retained; their validity must be reviewed if the work changed. |
| `style.set`        | `style`                             | `vancouver`, `apa`, or `harvard1`.                                                                                                |
| `bibliography.set` | `heading`                           | Change the reference-list heading.                                                                                                |

An item contains `id`, optional `locator`, `label`, `prefix`, and `suffix`. Locator labels: page, chapter, section, figure, table, paragraph, volume, issue. An empty group is rejected: use `citation.remove`.

## Other methods

- `documents.list {}`
- `documents.inspect {documentId}`
- `documents.format {documentId, output?}` (`text` or `html`)
- `documents.restore {documentId, expectedRevision, targetRevision}` creates a new revision from historical state. Unlike edit transactions, restore is not request-ID idempotent; inspect state after a transport interruption.
- `documents.import {document}` validates a portable snapshot, assigns a new document ID, and retains source/occurrence identities.
- `library.list {}` returns cached URL-resolution results.
- `sources.resolve {input, refresh?}` uses the local cache unless refresh is true.
- `documents.compute {document, expectedRevision, operations}` is a **stateless** adapter helper. It returns a new snapshot and formatted text; it does not persist or claim an editor transaction occurred. Available via CLI/HTTP, not needed in the normal MCP workflow.

Sources use CSL JSON fields: `type`, `title`, `author`, `issued`, `container-title`, `publisher`, `volume`, `issue`, `page`, `DOI`, `URL`, and so on. Authors are `{family,given}` or `{literal}` for corporate/unparsed names. Dates are `{"date-parts":[[2024,2,15]]}`. Do not invent unavailable values.

## Word without a browser

```bash
node src/cli.js docx.inspect input.docx
node src/cli.js docx.edit input.docx output.docx < edit.json
```

The edit payload:

```json
{
  "expectedFileHash": "HASH_FROM_INSPECTION",
  "expectedRevision": 1,
  "operations": [
    {
      "type": "citation.insert",
      "items": [{ "id": "EMBEDDED_SOURCE_ID" }],
      "anchor": { "exactText": "A unique sentence in the document." }
    },
    { "type": "bibliography.place", "anchor": { "exactParagraph": "Acknowledgments" } }
  ]
}
```

Omit the bibliography anchor to place the list at the end. It is placed after an exact paragraph anchor when supplied. On first use, import a source with `source.upsert` into a new output file, inspect the returned source ID, then insert it in a second edit. No separate desktop reference library is required; source records are embedded in the DOCX.

The adapter reconciles actual citation order and deleted anchors before formatting. Ambiguous anchors, duplicate copied controls, unresolved tracked changes, and manually changed citation display text cause errors. Only set `repair:true` after inspecting the mismatch and deciding to restore generated display text. Moving prose in Word determines order; `citation.reorder` is refused in file adapters.

MCP tools: `docx_inspect {input}` and `docx_edit {input,output,expectedFileHash,expectedRevision,operations,repair?}`. Output must not overwrite the input. Stdio tools use the host agent's filesystem authority.

## Google Docs for agents

`google.plan {googleDocument,document,operations,repair?}` produces a `documents.batchUpdate` request body and updated portable snapshot without writing. `googleDocument` must be a fresh Docs API response with `includeTabsContent=true` and its revision ID. `document` is the matching CiteFlow snapshot.

`google.edit {googleDocumentId,document,operations,repair?}` reads Google Docs, plans changes, and applies one revision-guarded API batch. Set `CITEFLOW_GOOGLE_TOKEN` in the process environment to a Google OAuth access token with document read/write authorization. CLI/HTTP can alternatively accept `accessToken` in arguments; tokens are never persisted, but prefer the environment for agents to avoid tool-history exposure.

Google insertion operations add `anchor:{exactText,tabId?}`. Bibliography placement also uses `anchor.exactText`. Every textual anchor must match exactly once. Do not pass `beforeId` or `citation.reorder` to control manuscript order; the physical Google document determines numbering.

Persist the returned `document` snapshot in your project only after a successful apply. Retain both the pre-operation and planned snapshots until the outcome is known. If the HTTP response is lost after Google commits, do not blindly retry: inspect Google's anchors and revision first. Google document content and an external snapshot are not a distributed atomic transaction.

The Apps Script preview stores tab-specific snapshots in document properties. It is a separate preview workflow: do not alternate it with an externally managed agent snapshot without explicit snapshot synchronization. Automatic Word↔Google transfer is not included.
