# CiteFlow without a browser

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
