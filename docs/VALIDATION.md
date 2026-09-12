# Validation record

Build date: 2026-09-12. Runtime: Node.js 24.19.0 on Linux.

## Verified locally

The automated suite contains **30 passing tests**, covering:

- Numeric ordering and renumbering; one bibliography entry for repeated citations.
- Removal of a final occurrence while retaining reusable source metadata.
- DOI normalization and identity reuse without silent metadata changes.
- APA same-author/same-year disambiguation and updates to earlier occurrences.
- Locators retained across style changes.
- Idempotent requests, stale revisions, failed-batch rollback, and historical restore.
- Portable snapshot import retaining source and occurrence identities.
- Missing metadata and rejection of unsafe source URL schemes.
- Highwire/JSON-LD extraction, author names, publication dates, pages, and source types.
- DOI-response identity checking and cached offline resolution.
- Explicit handling of unsupported PDF extraction.
- Private/reserved destination rejection, including IPv4-mapped IPv6.
- Actual DOCX ZIP round trips: insertion, style changes, deletion, embedded metadata, citation order, and unchanged unrelated binary entries.
- Refusal of ambiguous Word text anchors, stale file hashes, tracked changes, and unapproved manual citation text changes.
- Metadata discovery by XML namespace, independent of ZIP filename.
- APA bibliography journal italics and hanging indents in Word XML.
- Google Docs tab identity, revision guards, duplicate/manual-change checks, Unicode UTF-16 insertion offsets, and rejection of a failed remote update.
- A real MCP stdio client handshake, tool discovery, and document creation.
- HTTP bearer authentication, origin checks, and token nondisclosure in cloud mode.
- A DOM-level human workflow: source entry, citation insertion, locator editing, style change, and removal.

Run with `npm ci && npm test`. GitHub Actions is configured for Node 22 and 24; those remote CI jobs have not run until this repository is pushed.

Dependency audit: `npm audit --omit=dev` reported **0 vulnerabilities** during the initial build. This is a point-in-time dependency report, not a security certification.

## Not verified in this environment

- A live Crossref lookup failed at DNS resolution (`EAI_AGAIN api.crossref.org`). Resolver tests used deterministic metadata fixtures. No live publisher connectivity success is claimed.
- A Chromium rendering attempt could not run: the browser binary was absent, and browser download requests timed out/failed. The DOM interaction test passed, but no pixel-level browser QA was completed.
- The Word task pane was not sideloaded in Word for Windows, Mac, or the web.
- The Google Docs bound script and OAuth-backed API executor were not run against a live account. The API planner and rejection path were tested with fixtures.
- Automatic Word↔Google citation-preserving transfer, tracked-change reconciliation, source-manager migration, and native-editor rich typography remain outside this initial release.

## Repository handoff

The initial build was prepared locally because repository creation was unavailable. The owner subsequently created `huizheng1-lab/CiteFlow` and designated it as the publication target. Editor-integration limitations above remain unchanged by repository publication.

## Browser-local release 0.2

The updated suite has **37 passing unit/integration tests** plus **2 passing real Chromium end-to-end tests**. The browser build is approximately 1.2 MB of JavaScript before transfer compression and imports no server store, resolver, service, or filesystem module.

The browser tests open a synthetic private Word file, switch the browser offline, add a reference, insert/edit/remove citations and page locators, change style, place a bibliography, undo an edit, and download and re-inspect the resulting DOCX. The application issues **zero additional network requests** during the offline workflow. A separate online-lookup test inspects the relay request and confirms that it contains only the explicitly entered source URL. Offline mode prevents that request entirely.

Unit tests cover reference-library backup/import, invalid-file recovery, duplicate-paragraph selection, and reference-list movement when paragraph indices shift. Edge relay tests reject file uploads, extra request fields, unlisted/private hosts, and unlisted redirect destinations. Metadata lookup fixtures do not establish live publisher connectivity.

Chromium 153 was run locally against the compiled browser bundles. The generated desktop screenshot was visually inspected. This supersedes the earlier initial-build limitation on browser rendering; native Word/Google add-in limitations remain. GitHub CI additionally runs a Playwright-managed Chromium build.

The static app and edge relay are deployment-ready source, not a claim that a public URL or Cloudflare Worker is already live. GitHub Pages requires a one-time repository setting before its supplied publication workflow can deploy.
# Collaborator handoff validation

Version 0.3.0: 42 Node tests and 3 Chromium browser tests passed locally, including offline EndNote and Mendeley handoff ZIP downloads. Checks cover stable source labels, citation groups and page locators, embedded metadata, field boundaries, bibliography placement, detached CiteFlow metadata, original-byte preservation, unchanged workspace state, and explicit rejection of unsupported inputs.

**Not verified:** EndNote bulk formatting, Mendeley Cite legacy-field conversion, and editing/reformatting in either real Word add-in. Both exports are labeled experimental in the UI, package instructions and machine-readable report. No claim of seamless native interoperability is made. See [HANDOFF.md](HANDOFF.md) for required application acceptance tests.
