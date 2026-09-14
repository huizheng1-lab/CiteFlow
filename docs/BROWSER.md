# Browser-local CiteFlow

The browser app opens and edits Word documents **on the user's device**. It serves static HTML, JavaScript, and styles. It has no document-upload endpoint, account service, cloud document storage, or cloud AI connection. Ordinary users need no add-in, Node installation, or personal server after the static site is hosted.

## Use

1. Visit the hosted app in a modern browser on HTTPS.
2. Choose or drop a `.docx` file (up to 100 MB). The File API reads it locally.
3. Add a reference manually, reuse a saved local reference, or explicitly look up a DOI/source URL.
4. Select manuscript text to insert after that selection, or click a paragraph to insert at its end. Choose **Cite here** on a source.
5. Edit citation groups and locators from the Citations tab. Switch among Vancouver, APA, and Harvard.
6. Place/move the reference list at the end or after the selected paragraph.
7. Download the updated Word file. The original file is not overwritten. Common reference emphasis and hanging indentation are preserved in DOCX output.

The preview shows paragraph text, not Word's exact pagination, images, or table layout. It is a citation editor, not a full word processor. Prose and unrelated Word package content are retained in the downloadable file. The existing DOCX safety checks still reject ambiguous anchors, unsupported complex runs, unresolved tracked changes, mixed citation managers, and damaged citation controls.

Document data and undo history are kept in a dedicated local Web Worker. Up to ten previous local versions, capped at 100 MB of retained input bytes, are available for undo. Document bytes are **not** saved to localStorage or sent to any service. Closing the file terminates that worker. Closing/reloading the page loses undownloaded edits.

The Local library tab saves only references you explicitly choose to remember, using browser localStorage. Export a JSON backup and import it on another device if needed. Clearing browser data clears this library. Anyone with access to your browser profile may be able to read those locally saved references.

## Privacy boundary

| Action                                                       | Network activity                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Visit the app                                                | Download static application assets; the host receives ordinary web connection information.                                               |
| Open a Word file                                             | None.                                                                                                                                    |
| Insert/remove/edit citations, change style, place references | None.                                                                                                                                    |
| Undo or download a Word file                                 | None.                                                                                                                                    |
| Save/import/export a local reference library                 | None.                                                                                                                                    |
| Click Find for a DOI                                         | Send only that identifier in a Crossref API URL, with cookies omitted and no referrer.                                                   |
| Click Find for a source URL                                  | Fetch that explicitly entered source URL if the source permits browser access.                                                           |
| Use an optional metadata relay                               | Send only `{input: sourceURL}` to the configured service. No filename, document bytes, paragraph text, or document snapshot is included. |

**Offline mode**, in Lookup settings, disables all online reference lookups. After the page and worker have loaded, local editing works without a network connection. Offline reload/installable-PWA support is not promised by this release.

No telemetry, cloud AI calls, external fonts, or analytics SDKs are included. The lookup module is separate from document processing and receives no document object. The worker imports no network resolver, SQLite store, HTTP service, or Node filesystem module. The build checks that these server modules are absent. Where the host supports `_headers`, the worker also gets `connect-src 'none'`; GitHub Pages does not apply that headers file. The application has an HTML CSP and the privacy tests assert no document-related requests during the actual browser workflow.

Local processing protects against this application's document uploads. It does not promise protection from browser extensions, malware, or a compromised hosting origin. A cloud AI agent would still receive any text a user separately chooses to send to it. Existing CLI/MCP tools remain available for trusted agents running on the same computer; the static page does not expose an unauthenticated remote-control interface.

## Host the static app

Developer build:

```bash
npm ci
npm run build:browser
```

Publish **only `dist/`** on a static HTTPS host. The deployed app needs no running Node service or SQLite database. Relative asset URLs support a GitHub project path such as `/CiteFlow/`. Do not deploy the legacy `public/` directory for this privacy-preserving workflow.

For local developer testing only:

```bash
npm run preview:browser
```

This serves static files on `http://127.0.0.1:4173` and has no upload routes. Opening the built HTML directly via `file://` is not supported because ES modules and Web Workers require an appropriate origin.

### GitHub Pages

The repository includes `.github/workflows/pages.yml`.

1. Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Actions → **Publish browser app** → **Run workflow**, on `main`.
3. Use the URL returned by the deployment (normally `https://huizheng1-lab.github.io/CiteFlow/`). Do not assume the URL is live before the workflow succeeds.

The workflow runs the unit and browser tests, builds static assets, and publishes only `dist/`. Tests also produce a `citeflow-static-app` artifact on ordinary pushes. The workflow is manually triggered so disabled Pages settings do not cause unrelated pushes to fail.

### Other static hosts

Use build command `npm run build:browser` and output directory `dist`. Cloudflare Pages-style hosts can apply the included `_headers` file. No cloud document-processing service is required.

## Optional edge metadata relay

Most DOI lookups can use Crossref directly. Arbitrary websites may block browser fetches through CORS. A small optional Cloudflare Worker is included under `edge/`; it retrieves public source metadata, never Word files.

From an authorized Cloudflare development environment:

```bash
npx wrangler deploy --config edge/wrangler.jsonc
```

Paste its HTTPS URL in the browser's Lookup settings. No relay is configured by default. A host operator can set `ALLOWED_SOURCE_HOSTS` to an explicit comma-separated list of trusted public publisher hosts. Redirect destinations must also be on that list. Avoid private/internal hostnames. The default list covers Crossref, PubMed/PMC, Nature, and PLOS; it is intentionally not an arbitrary URL-fetch service.

The relay accepts only one small JSON field, rejects file uploads and extra fields, limits metadata response size, and forwards no client cookies. Worker observability is disabled in the supplied configuration and the code writes no request logs, but infrastructure providers still handle connection information. Production operators should set appropriate request/rate limits on their account.

It has no persistent storage bindings. It returns only normalized citation metadata, not the fetched article body. Source existence is not claim verification: neither the browser nor relay asserts that an article supports manuscript statements.
# Collaborator exports

Use **Export for collaborators** to download a local ZIP containing an EndNote bulk-conversion document or experimental Mendeley Desktop-field bridge, the original CiteFlow file, cited source metadata, and recipient instructions. Export leaves the current document and undo history unchanged. Neither route has yet passed actual Word add-in acceptance testing. See [HANDOFF.md](HANDOFF.md).

### Open a Mendeley Cite document

Version 0.6.3 imports Mendeley Cite v3 citation content controls with embedded source metadata. Open the `.docx` normally: citation groups, reference data, page locators, prefixes/suffixes, and the existing bibliography become linked CiteFlow citations in the local working copy. The opening message reports the imported groups and references. Citations and the bibliography are reformatted in Vancouver; choose APA or Harvard afterward if preferred. Download the converted Word file to save it. The original file on disk is unchanged.

This converts management of those citations to CiteFlow; it is not simultaneous editing with Mendeley. Unknown versions, legacy fields, missing or conflicting metadata, manual citation overrides, tracked changes, mixed citation managers, and citations in footnotes/endnotes/headers/footers are rejected instead of silently importing plain text. Flattened citation text cannot be linked without embedded metadata. Mendeley export remains experimental and separate from this import support.

## Write and format documents (0.6)

Choose **New document** or open a `.docx`, then type directly in the document. Select text for bold, italic, or underline. Use the paragraph menu for headings, and toolbar buttons for alignment, lists, and tables. Table controls add or remove rows and columns at the cursor. Undo and Redo cover typing and applied document operations. **Apply text edits** commits text changes locally; citation actions and downloads also apply pending edits automatically. Download the Word file to save your work.

Citation tokens can be moved, copied, or removed while retaining managed source identities. The reference list updates with the citations. Protected images, fields, and complex Word structures retain their original XML and appear as placeholders. Documents with tracked changes are read-only. The browser view is an editing surface, not a paginated Word layout. Cloud autosave and simultaneous collaboration are not included.

Large Word files: the compressed file limit is 100 MB, with a separate 500 MB expanded-package limit. Opening and editing speed depends on your device and document complexity. Local revision history has a 100 MB memory budget, so larger documents retain fewer undo revisions.

Import one RIS file to load all its records into the Local library. Select individual references or Select all references, then Include selected in resources. Exact duplicates are reused automatically; near matches require choosing which references to keep. Batch inclusion supports Undo and does not insert citation occurrences.
