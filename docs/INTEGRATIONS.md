# Editor integration setup and boundaries

## Headless Word file editor (automatically tested)

Use `docx.inspect` and `docx.edit` through the CLI or MCP. It reads a real DOCX ZIP package, modifies the main document XML, and embeds a JSON snapshot in a custom XML part under `https://digimatrix-labs.org/citeflow/v1`.

Inline rich-text content controls are tagged `citeflow:citation:OCCURRENCE_ID`. A block control tagged `citeflow:bibliography` can sit at the end or after a unique paragraph. Its placement survives later refreshes. The reference list preserves CSL italics/bold/superscript and common hanging indentation. Page layout, line spacing, and journal-specific typography need final visual review.

Unrelated ZIP entries, including images and styles, are retained. The editor refuses ambiguous text anchors or complex run structures it cannot safely split. It operates on the main body only, including ordinary table paragraphs. Use a new output path for every pass.

## Word task pane (preview, not live-tested)

1. Run CiteFlow behind a trusted HTTPS reverse proxy. For local sideloading, supply a locally trusted certificate; `npm start` itself serves HTTP, not HTTPS.
2. Set `CITEFLOW_ORIGIN` to the exact HTTPS origin; use a long `CITEFLOW_TOKEN` for a hosted deployment.
3. Edit `public/manifest.xml` so `SourceLocation` points to `https://YOUR-HOST/word.html`.
4. Sideload that manifest using your Word client's Office add-in development procedure.
5. Enter the service token. Find a source, confirm its title, and insert at the cursor. Existing document sources can be reused. Refresh or change style from the task pane, and insert a reference list at the cursor.

The preview requires the Word API and the Common API CustomXmlParts capability. Actual support must be checked on Windows, Mac, and Word Online before release. It has not been marketplace-packaged or sideloaded in this build environment. It uses the same custom XML namespace as the headless editor, and detects multiple metadata parts.

It currently inserts plain formatted citation/reference text; full bibliography typography is better supported by the headless DOCX path. Source/citation group editing is available in the core and headless API; the task pane currently emphasizes insert, reuse, style, and refresh. Do not call the pane a complete replacement for EndNote yet.

Office control changes and custom XML writes cannot be committed atomically by this preview. An interrupted write may require recovery from the original copy. No automatic background renumbering is claimed. Track Changes must be off and pending revisions resolved.

## Google Docs bound script (preview, not live-tested)

1. Deploy CiteFlow behind HTTPS with a bearer token and durable SQLite storage.
2. In a **copy** of a Google Doc, open Extensions → Apps Script.
3. Add `integrations/google-docs/Code.gs` and its `appsscript.json`. This is a bound script, not a marketplace add-on.
4. Reload the document. Use CiteFlow → Configure server and enter your service origin and token. These settings are per-user script properties.
5. Use the CiteFlow menu to add a URL citation, edit/remove the selected occurrence, change style, place a reference list, or refresh.

Each tab has its own reference snapshot, stored in chunked document properties, with a 120,000-character preview limit per snapshot (Google's total property storage quota still applies). Named ranges identify citations. Broken, duplicate, or split citation ranges are refused. Script locks coordinate script calls; they do not lock out simultaneous human edits. Pause collaborative editing during preview updates.

The script currently formats plain text and updates on explicit commands. Native suggestions, split/multiline ranges, clipboard behavior, and conversion to Word need live verification. It is not a lossless Word↔Docs bridge.

## Google Docs API (planner tested; live OAuth execution untested)

`src/google-docs.js` offers pure edit/refresh planners and optional authenticated execution. They traverse document tabs, use Google UTF-16 indices, recreate managed ranges after replacing their text, and attach `requiredRevisionId` to the batch. Reading and writing credentials stay with the caller.

The caller must persist the returned portable citation snapshot after successful application. The Google content transaction and snapshot storage are not atomic together. Native editor suggestions must be resolved before refreshing managed citations. The planner is main-body-focused; it does not claim support for footnote or text-box citations.

## Migration and sharing

- A DOCX produced by the headless editor remains readable without CiteFlow installed. The metadata remains embedded for later editing.
- Portable JSON retains citation source identities and metadata but does not contain manuscript prose or guarantee transferred anchors.
- Plain-text copying exports a static reference list. It intentionally has no live links back to the tool.
- The browser imports Mendeley Cite v3 content controls with embedded source data into a CiteFlow working copy. Legacy Mendeley fields, EndNote/Zotero migration, and automatic Word↔Google conversion remain future work. See [browser import details](BROWSER.md#open-a-mendeley-cite-document).
