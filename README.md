# CiteFlow

**Agents without a browser:** download the standalone [local agent](https://www.rerioa.com/CiteFlow/citeflow-agent.cjs), then connect through stdio MCP or JSON CLI. Seven typed tools cover creation, inspection, citation insertion/replacement, batch edits, URL lookup and collaborator export. No web server or npm install is needed for the bundle. See [setup and privacy](docs/LOCAL_AGENT.md).

**Collaborator handoff:** the browser now offers experimental EndNote bulk conversion and a Mendeley Desktop-field bridge. Export a separate Word copy with source records and recipient instructions. Actual Word add-in acceptance is not yet verified; see [handoff details and limits](docs/HANDOFF.md).

**Document-centered citations for humans and AI agents.** A DigiMatrix Labs project.

Paste a source URL, DOI, or PMID, review its metadata, and save a reusable reference. Insert and edit citation occurrences independently of their display numbers. Generate a standard reference list, switch style, and keep source identity intact.

This is an **initial working release**, not a production-certified Word or Google Docs add-in. The local citation engine, HTTP API, CLI, MCP transport, and headless DOCX editor have automated tests. Native editor integrations are previews and need live client testing.

## Browser app: documents stay on your computer

**Version 0.2 adds a browser-local Word citation editor.** Open a `.docx` without uploading it, select citation positions, add/remove/edit citations, place a reference list, and download the updated file. Citation processing runs in a Web Worker on your device. Saved references stay in browser storage; document bytes stay in memory until downloaded or closed.

Online lookup sends only an explicitly entered DOI or source URL. An optional edge worker handles metadata-only lookups for sites that block direct browser access. Offline mode disables lookups entirely. There are no cloud AI calls.

See [browser usage, privacy, and hosting](docs/BROWSER.md). To build the static app:

```bash
npm ci
npm run build:browser
```

Host `dist/` on HTTPS. Visitors need **no Word add-in and no personal server**. The included **Publish browser app** GitHub Actions workflow deploys to Pages after Pages has been enabled in repository settings. The app is not automatically online merely because its source is on GitHub.

The commands below describe the retained **local agent/server workspace**, which is separate from the new browser-local app.

## Optional local agent/server workspace

Requires Node.js **22.13+** (Node 24 recommended).

```bash
npm ci
npm test
npm start
```

Open **http://127.0.0.1:3210**. Create a manuscript, paste a source URL, and save the resolved reference. Choose **Cite** on a source. Edit grouped citations, remove occurrences, reorder them, or switch style. The reference list updates from the cited sources only.

Data is stored in `data/citeflow.sqlite`. To choose another location, set `CITEFLOW_DB`. Back up the SQLite database with SQLite backup tooling; export a portable JSON snapshot for manuscript exchange. Resolving a URL caches metadata for subsequent offline use. Offline formatting needs no network.

The legacy server workspace at port 3210 manages reference metadata and citation order. The new static browser app opens local Word files and inserts citations into them. Neither app is a full prose editor.

## Included

- URL capture: Crossref DOI records, PubMed page metadata, Highwire/DC/OpenGraph/JSON-LD metadata, and a URL serving one CSL JSON record.
- Local persistent reference cache and document-specific source snapshots.
- Stable source/occurrence IDs; DOI duplicate detection without silent metadata replacement.
- Source corrections, citation groups, per-occurrence locators, replacement, removal, and ordering.
- CSL formatting using pinned Citation.js style assets and citeproc-js: **Vancouver**, **APA**, **Harvard1**.
- Revision-checked, idempotent SQLite edit transactions and historical restore.
- Browser workspace with source forms and citation group controls.
- Headless DOCX inspection/editing, embedded metadata, movable bibliography controls, and preservation of unrelated ZIP content.
- MCP over stdio, JSON CLI, authenticated HTTP API, and machine-readable discovery.
- Word task-pane preview and a Google Docs bound Apps Script preview.
- Google Docs API edit planner and OAuth-backed execution, with revision guards and tab-aware UTF-16 locations.

## Agent use

```bash
node src/cli.js documents.create <<'JSON'
{"title":"My manuscript","style":"vancouver"}
JSON

node src/cli.js sources.resolve <<'JSON'
{"input":"10.1038/171737a0"}
JSON
```

For edits, read the document, retain its revision, and provide a unique request ID. See [the agent API](docs/AGENT_API.md) for complete examples.

An MCP client configuration:

```json
{
  "mcpServers": {
    "citeflow": {
      "command": "node",
      "args": ["/absolute/path/to/citeflow/src/mcp.js"],
      "env": { "CITEFLOW_DB": "/absolute/path/to/citeflow-data.sqlite" }
    }
  }
}
```

MCP file operations run with the host agent's filesystem permissions. The HTTP interface never exposes arbitrary filesystem paths.

## Word and Google Docs

See [integration setup](docs/INTEGRATIONS.md).

For Word files, an agent can inspect and modify a `.docx` without Word installed. Every edit requires the input file hash and citation revision, and writes a **new output file**. Insertion anchors must match exactly once. Edits with unresolved tracked changes are refused. The editor preserves unrelated package entries and modifies citation controls and metadata only.

The Word task pane requires sideloading and HTTPS hosting. Google Docs requires a bound script and an HTTPS-hosted CiteFlow service. Neither add-in is published in an app marketplace.

## Deliberate limitations

- Only the three bundled styles are selectable in this release. No claim of support for all journals. Dependency lockfile pins the shipped formatting assets; the formatter reports a style hash.
- DOI lookup currently uses Crossref. Some DataCite DOIs will require manual CSL import or a source webpage.
- No title search service, RIS/BibTeX migration, ISBN-only lookup, PDF metadata extraction, narrative citation mode, section-specific bibliographies, or automatic evidence checking yet.
- Successful metadata lookup does **not** mean a source supports a claim. Provenance says `metadata-only` and `supportsClaim: not-assessed`.
- The headless DOCX editor is main-body-only, including ordinary table paragraphs. Footnotes, endnotes, text boxes, mixed citation managers, and complex tracked-change workflows are not supported for managed citations.
- DOCX bibliography typography preserves common CSL inline emphasis and hanging indents; complete journal layout fidelity requires visual validation. The native editor previews and Google API adapter currently insert plain citation/reference text, so typography there is limited.
- Word and Google Docs preview updates occur on explicit commands. They do not continuously monitor every edit.
- Word/Apps Script changes and metadata persistence are not one atomic transaction. Work on a copy and inspect an interrupted update before retrying.
- Automatic Word↔Google Docs transfer with citation anchors is **not implemented**. JSON carries metadata, but ordinary paste/export must not be assumed to preserve links. Headless DOCX and the Word preview share the same metadata namespace; Google Apps Script uses tab-specific document properties.
- The cloud service is a **single trusted workspace**, protected by a bearer token. It is not a multi-tenant SaaS or a public unauthenticated resolver.

## Hosting

Set a long random `CITEFLOW_TOKEN` and put the service behind HTTPS. Set `CITEFLOW_ORIGIN` to the exact public origin. Keep the SQLite directory on a durable volume. Do not expose a deployment without authentication.

```bash
docker build -t citeflow .
docker run --rm -p 127.0.0.1:3210:3210 \
  -e CITEFLOW_TOKEN -e CITEFLOW_ORIGIN \
  -v citeflow-data:/app/data citeflow
```

A non-local bind refuses to start without a token of at least 32 characters. There is no public token-discovery endpoint in cloud mode. Each cloud user enters the deployment token; do not share a deployment among mutually untrusted users.

## Development and verification

```bash
npm test
npm audit --omit=dev
```

See [validation evidence](docs/VALIDATION.md), [architecture](docs/ARCHITECTURE.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Repository

Source: [huizheng1-lab/CiteFlow](https://github.com/huizheng1-lab/CiteFlow).

```bash
git clone https://github.com/huizheng1-lab/CiteFlow.git
cd CiteFlow
npm ci
npm test
npm start
```

For maintainers, `scripts/publish-github.sh` verifies the existing repository and pushes committed changes to `main` using an authenticated GitHub CLI. It never creates a repository or stores a token in the source.

### Import saved references

In **Saved library**, choose **Import references** and select a RIS, BibTeX, EndNote XML, PubMed XML, or JSON file. Processing stays local. Existing references are kept and duplicate identifiers are skipped; invalid imports leave the library unchanged. Files may contain up to 5,000 references and must be at most 5 MB. JSON backups remain supported. XML support covers EndNote exports and PubMed article records, not arbitrary XML schemas.

Browser-free agents can use `sources_import` through the standalone CLI or stdio MCP; see [the local agent guide](docs/LOCAL_AGENT.md#import-reference-files-offline).
