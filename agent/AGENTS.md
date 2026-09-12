# CiteFlow agent entry point

CiteFlow has a standalone CLI and stdio MCP interface. Do not infer browser-only access from the human-facing app. `docx_inspect` and `docx_cite` are commands inside the downloaded program, not separate web pages or automatically installed tools.

1. Download https://www.rerioa.com/CiteFlow/citeflow-agent.cjs
2. Read https://www.rerioa.com/CiteFlow/AGENT_GUIDE.md
3. Run `node citeflow-agent.cjs --root /your/workspace doctor`.
4. Run `node citeflow-agent.cjs --help docx_cite` for its description and complete input schema.
5. For an executable offline example, download https://www.rerioa.com/CiteFlow/agent-example.mjs beside the bundle and run `node agent-example.mjs`. It creates a new temporary directory, uses synthetic metadata, inserts a citation through the CLI, and inspects the result.

For the real manuscript, inspect first; use the returned hash/revision in each mutation, exact text/paragraph anchors and a new output filename. Source lookup is optional and separate so metadata can be reviewed before insertion. If sandbox DNS blocks lookup, independently obtain and review metadata and supply it to `docx_cite`. Do not disable private-network protection, fabricate sources, or claim that citation editing is unavailable because lookup failed.

Machine-readable tools: https://www.rerioa.com/CiteFlow/agent-tools.json
Manifest: https://www.rerioa.com/CiteFlow/agent-manifest.json
MCP launch: `node citeflow-agent.cjs --root /your/workspace mcp`

No hosted HTTP document API is provided. An agent needs permission to execute Node.js 22.13+ or connect to this local stdio MCP process. An agent limited to web browsing cannot run it. Use a local model when manuscript data must remain exclusively on the device; cloud models can receive tool outputs.
