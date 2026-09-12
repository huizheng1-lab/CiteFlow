# Architecture and design decisions

CiteFlow separates **sources**, **citation occurrences**, and **reference-list views**. Display numbers are derived values. URLs locate sources; saved metadata preserves identity when a URL is unavailable.

`model.js` validates and applies operations; `store.js` persists revisioned snapshots and request results in SQLite. An edit batch uses `BEGIN IMMEDIATE`, so a failed operation rolls back its predecessors. A repeated request ID with the identical payload replays its result. Restoring history creates a new revision.

`resolver.js` collects bibliographic metadata, preserving retrieval provenance. DOI records are checked against the requested identifier. Page metadata may be reconciled with Crossref only when title identity also matches. Network failure does not cause invented metadata. Direct PDF extraction is explicitly unsupported. The resolver uses DNS checks and pins each connection to a public address; redirects undergo the same checks. Responses have time and size limits. It does not use authenticated browser cookies or fetch private-network URLs.

`format.js` drives citeproc-js with the document's complete citation sequence, applying updates to previously rendered citations when disambiguation changes. Bibliographies include only cited records. Citation.js supplies bundled, dependency-pinned styles/locales. Each result includes the style hash and processor version. The browser uses text nodes; the DOCX rich-text renderer has an explicit formatting vocabulary.

`service.js` is the shared dispatch layer for HTTP, CLI, and MCP. Word and Google Docs previews use stateless formatting operations with their own embedded/document-associated metadata. A self-hosted server is one trusted workspace, not a tenant-isolated service.

`docx.js` maps stable IDs to content controls in an OOXML package and embeds metadata in a custom XML part. Physical document order controls numbering. Deleting an occurrence's control removes its use, while retaining the source record. It refuses tracked-change documents and ambiguous anchors instead of guessing.

`google-docs.js` turns edits into a revision-guarded Google Docs API batch, using named ranges and UTF-16 positions. It reports the snapshot that the caller needs to persist. Its planner can be tested offline without a Google account. The Apps Script preview is a separate per-tab metadata workflow.

## Next release priorities

1. Live Windows/Mac/Word Online and Google Docs acceptance testing, with recovery tests for interrupted changes.
2. Complete manual editing in the Word task pane and richer bibliography typography in cloud adapters.
3. A shared, revisioned Google snapshot persistence layer so agents and the bound script can safely alternate.
4. Explicit Word↔Google transfer and conversion verification.
5. Additional journal styles, migration from existing citation managers, and CSL version snapshots embedded per document.
6. Optional evidence passages and claim-support review, kept separate from metadata verification.

Automatic background updating, marketplace distribution, a multi-user SaaS, and arbitrary source discovery are not silently assumed to be implemented.
