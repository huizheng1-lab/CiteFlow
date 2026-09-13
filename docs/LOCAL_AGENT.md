# CiteFlow without a browser

## Start here

This is a real CLI/MCP interface, not browser automation. Download the agent below, then run:

```sh
node citeflow-agent.cjs --root /path/to/manuscripts doctor
node citeflow-agent.cjs --help docx_inspect
node citeflow-agent.cjs --help docx_cite
```

`--help TOOL` and `--schema TOOL` return the complete JSON input schema without reading stdin. `--schema` returns all tools. The same schemas are available at https://www.rerioa.com/CiteFlow/agent-tools.json without running Node.

**Runnable offline example:** download https://www.rerioa.com/CiteFlow/agent-example.mjs into the same directory as `citeflow-agent.cjs`, then run `node agent-example.mjs`. It creates a new temporary workspace, creates a document, inserts a citation using synthetic metadata, and verifies it through the CLI. It prints the resulting file path and never overwrites existing manuscripts. Use this to establish that the runtime works before testing real references.

**If URL lookup fails:** a sandbox may resolve public hostnames to addresses rejected by CiteFlow's private-network guard. This affects `sources_resolve`, not citation editing. Obtain bibliographic metadata using another available trusted research tool, review it, then pass the CSL source object to `docx_cite`. Keep the network protection enabled. A lookup failure is not evidence that browser manipulation is required.

MCP clients can read `citeflow://workflow` for this workflow and discover parameter schemas with `tools/list`.

Download [citeflow-agent.cjs](https://www.rerioa.com/CiteFlow/citeflow-agent.cjs) and its [SHA-256 checksum](https://www.rerioa.com/CiteFlow/citeflow-agent.sha256). Run it with Node.js 22.13 or newer. No npm install, Word add-in, browser automation, SQLite database or HTTP server is needed for this standalone bundle. From source, use `npm ci` followed by `npm run build:agent`.

## Connect an MCP agent

Configure a stdio MCP server in your agent client, replacing paths with absolute paths on your computer:

```json
{
  "mcpServers": {
    "citeflow": {
      "command": "node",
      "args": ["/absolute/path/citeflow-agent.cjs", "--root", "/absolute/path/manuscripts", "mcp"]
    }
  }
}
```

On Windows, JSON paths can use `C:/Users/yourname/manuscripts`. The workspace directory must already exist. File operations are limited to that directory, including resolved symlink destinations. Outputs must be new filenames; existing files are never overwritten. This boundary limits accidental access, not a sandbox against a process that can concurrently alter the filesystem.

The default is offline. Add `--allow-online` to enable the separate `sources_resolve` tool for explicit DOI, URL or PMID lookup. It sends source identifiers, not manuscript files. The stateless agent has no persistent citation library beyond source metadata embedded in each DOCX. Browser local-storage libraries are not automatically shared with the agent.

**Privacy:** the agent runs wherever its client launches it. An agent on a remote server processes files there. A cloud LLM can receive tool results, including source metadata and any requested manuscript paragraphs. For documents to remain exclusively on your device, use a local agent/model. `docx_inspect` omits paragraphs by default; request `includeParagraphs: true` only when needed.

## Tools

| Tool | Purpose |
| --- | --- |
| `docx_create` | Create a Word document from paragraphs and an optional style |
| `docx_inspect` | Return stable source/citation IDs, issues, hash and revision; optionally paragraph text |
| `sources_resolve` | Resolve one public source URL/DOI/PMID; review metadata before using it |
| `docx_cite` | Add/reuse one reviewed source and cite at an exact position in one call |
| `docx_replace_source` | Replace a cited source globally or within one citation group |
| `docx_edit` | Typed batch operations for groups, removal, metadata, styles and bibliography placement |
| `docx_export` | Experimental EndNote/Mendeley handoff ZIP |

MCP exposes parameter schemas directly. CLI uses the same names and JSON arguments. `node citeflow-agent.cjs --help` lists tool descriptions. Successful CLI responses are JSON on stdout; errors are JSON on stderr with a nonzero exit status.

## Example CLI workflow

```sh
node citeflow-agent.cjs --root ./manuscripts docx_create < create.json
node citeflow-agent.cjs --root ./manuscripts docx_inspect < inspect.json
node citeflow-agent.cjs --root ./manuscripts --allow-online sources_resolve < source-url.json
node citeflow-agent.cjs --root ./manuscripts docx_cite < cite.json
```

`create.json`:

```json
{"output":"draft.docx","paragraphs":["A sample paper","A finding worth discussing."],"style":"apa"}
```

`inspect.json`:

```json
{"input":"draft.docx","includeParagraphs":true}
```

`source-url.json`:

```json
{"input":"https://doi.org/10.1126/science.1225829"}
```

For `cite.json`, use the returned source object after review and the latest inspected hash and revision:

```json
{
  "input":"draft.docx",
  "output":"draft-cited.docx",
  "expectedFileHash":"REPLACE_WITH_INSPECTED_SHA256",
  "expectedRevision":1,
  "source":{"type":"article-journal","title":"Reviewed source title","author":[{"family":"Smith","given":"Jane"}],"issued":{"date-parts":[[2024]]},"container-title":"Journal"},
  "anchor":{"exactText":"A finding worth discussing."},
  "bibliography":true
}
```

The sample metadata is illustrative, not a real source. Never invent missing bibliographic details. Metadata lookup does not establish that the source supports a claim.

All modifying/export tools require `input`, new `output`, `expectedFileHash` and `expectedRevision`. Reinspect after conflicts; never replace a guard without reviewing the current document. Use the returned output as the next input. High-level `docx_cite` and `docx_replace_source` may advance internal revision more than once; always retain the returned revision. Calls are not idempotent overwrites: if an output exists after a transport interruption, inspect it rather than retrying over it.

`docx_replace_source` also takes `fromSourceId`, new `source`, optional `citationId` and `preserveLocators`. By default old page/section locators are cleared. Prose that names the old paper is not rewritten. Warnings call out both issues.

`docx_edit.operations` supports `source.upsert`, `source.update`, `source.replace`, `citation.insert`, `citation.update`, `citation.remove`, `style.set`, `bibliography.set`, and `bibliography.place`. Insert anchors can use unique `exactText`, or the inspected `paragraphIndex`, full `paragraphText`, and UTF-16 `endOffset`. Group items use stable source `id` values and optional `locator`, `label`, `prefix`, `suffix`. Use `citation.remove` for an empty group. Low-level `source.replace` retains locators; the safer high-level replacement tool clears them by default.

`docx_export` takes `target: "endnote"` or `"mendeley"`. Export compatibility remains experimental; actual Word add-in acceptance has not been verified. The package includes recipient instructions and the original document.

Existing citations from other managers and ordinary typed reference text are not automatically converted. The new agent interface exposes the existing citation engine; it does not bypass its conflict, tracked-change or anchor checks.

## Import reference files (offline)

Use `sources_import` to read RIS (`.ris`), BibTeX (`.bib`, `.bibtex`), EndNote XML, PubMed article XML, CSL JSON arrays, or CiteFlow JSON backups. No browser or online lookup is required.

```sh
node citeflow-agent.cjs --root /your/workspace sources_import < import-request.json
```

Create `import-request.json` containing `{"input":"references.ris"}`.

The result contains `format`, `sources` (normalized CSL JSON), `parsed`, and `duplicates`. Review the sources, then pass a source to `docx_cite`, or use `source.upsert` operations in `docx_edit`. Importing does not insert citations or modify the manuscript. Optional `format`: `auto` (default), `ris`, `bibtex`, `xml`, or `json`. Maximum 5 MB / 5,000 records; malformed or unsupported records fail the whole import. XML supports EndNote and PubMed article exports; other XML schemas and PubMed book records are rejected. Citation metadata import does not verify the source or its support for a claim.

## Remove or merge duplicate document sources

Use `docx_edit` with its usual hash/revision guards and a new output file:

- `{"type":"source.remove","sourceId":"UNUSED_ID"}` deletes an unused source. Cited sources are rejected.
- `{"type":"source.merge","from":"DUPLICATE_ID","to":"KEEP_ID"}` redirects all citations to the retained source and removes the duplicate. The retained metadata is unchanged. Locators, prefixes and suffixes are preserved; identical items within a citation group are collapsed, while distinct locators are retained.

Inspect and review metadata before merging: choosing two records asserts that they represent the same publication. Multiple merges may be supplied in one atomic edit.
