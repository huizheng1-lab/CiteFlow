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
# Local agent validation

Version 0.4.0 adds a standalone bundle tested from a directory outside the source checkout, with no npm installation there. A real stdio MCP client discovers the seven typed tools and creates, inspects, cites, replaces, reformats, removes, and exports a manuscript. CLI integration tests verify no overwrite, stale guards, workspace boundaries and symlink escape rejection. Online lookup is opt-in; the default-disabled path is tested. Cloud agents can see tool output; this is not a guarantee of device-only privacy with a remote model.
# Agent discovery validation

Version 0.4.1: 45 Node tests and 3 Chromium tests passed. The standalone bundle's per-tool help exposes the same schemas as the published JSON, doctor confirms browser-free use, the downloadable example performs real citation insertion offline, and MCP serves workflow instructions. Network-policy failures now include an actionable offline metadata route; the DNS protection itself is unchanged.

Version 0.6.3: Mendeley Cite v3 content-control imports were verified with a private document containing two citation groups, four references, and one bibliography. Its prose, non-citation layout XML, unrelated package parts, and original bytes were preserved. Synthetic tests cover repeated references, Unicode, locators, style changes, download/reopen, removal/undo, and atomic rejection of unsupported inputs. All 9 Chromium workflows passed. On Windows, 68 of 70 Node tests passed; the two pre-existing failures require Unix /etc/hosts or privileged symlink creation. No private document or extracted reference metadata is included in the repository.

Version 0.6.4: six Mendeley import tests passed, including DOI/PubMed metadata separation, rejection of conflicting or unknown identifiers, and preservation of empty nested EndNote fields. The Mendeley browser workflow passed. A private document with 94 citation groups and 70 references was verified in the browser, with all 94 citation tokens displayed. Style changes, Undo, and reopen preserved links; unrelated package parts and original bytes were unchanged. One combined identifier field was split and four empty EndNote field remnants archived. No private document data was committed.

Version 0.6.5: completeness checks preserve unmatched and ambiguous bibliography entries with original citation displays. The private 104-entry document retains all 104 entries, 70 linked sources, 34 unmatched entries, and 94 citation groups. Its downloaded bibliography content XML exactly matched the original; reopening retained the review state. Tests cover prose changes, Undo/Redo, preventing bibliography/citation loss, collaborator conversion guards, and duplicate/ambiguous matching. Ten Chromium workflows passed. Node suite: 72 of 74 passed on Windows; the same two pre-existing Unix-path/symlink test failures remain. No private file content was committed.
