import { zodToJsonSchema } from 'zod-to-json-schema';
import { definitions } from './api.js';

export const workflow = `CiteFlow supports a local JSON CLI and stdio MCP. Browser manipulation is not required.
Start with doctor to check the runtime/workspace. Use --schema TOOL or --help TOOL for exact arguments.
For an existing file call docx_inspect with includeParagraphs=true only when manuscript text is needed.
Use the returned fileHash and document.revision as expectedFileHash and expectedRevision.
Resolve source metadata separately with sources_resolve (requires --allow-online), review it, then call docx_cite with the source and an exact anchor. Reviewed metadata can be supplied offline.
Always choose a new output filename. Use that output as the next input; do not reuse old guards.
Verify with docx_inspect after edits. Zero structural issues does not verify scientific claims.
If URL lookup is blocked by sandbox DNS/private-address checks, keep the protection enabled. Obtain metadata through an available trusted research tool, review it, and supply the source object to docx_cite.
Node.js 22.13+ is required. This is a local process, not a hosted HTTP API. Cloud agents can receive tool output; use a local model for device-only privacy.
Guide: https://www.rerioa.com/CiteFlow/AGENT_GUIDE.md
Runnable CLI example: https://www.rerioa.com/CiteFlow/agent-example.mjs`;

export function schemas(name) {
  if (name && !Object.hasOwn(definitions, name)) throw new Error('Unknown tool: ' + name);
  const tools = name ? [[name, definitions[name]]] : Object.entries(definitions);
  return Object.fromEntries(
    tools.map(([key, d]) => [
      key,
      {
        description: d.description,
        inputSchema: zodToJsonSchema(d.schema, { $refStrategy: 'none' }),
      },
    ]),
  );
}

export function explainError(e) {
  const result = { error: e.message, status: e.status || 400 };
  if (/Private, local, and reserved/.test(e.message)) {
    result.code = 'SOURCE_NETWORK_POLICY';
    result.nextStep =
      'The resolved address was rejected; sandbox DNS may be involved. Do not disable private-network protection. Obtain source metadata through another trusted research tool, review it, and pass the CSL source object directly to docx_cite. Offline citation editing still works.';
  } else if (/disabled.*allow-online|Online source lookup is disabled/.test(e.message)) {
    result.code = 'LOOKUP_DISABLED';
    result.nextStep =
      'Enable explicit source lookup with --allow-online, or supply reviewed source metadata offline.';
  } else if (/changed since inspection|revision conflict/.test(e.message)) {
    result.code = 'STALE_DOCUMENT';
    result.nextStep =
      'Inspect the current input again, review it, and use the new hash/revision. Never guess these values.';
  } else if (e.code === 'EEXIST') {
    result.code = 'OUTPUT_EXISTS';
    result.nextStep =
      'Inspect an existing output after an interrupted call, or choose a new filename. Existing files are never overwritten.';
  } else if (e.issues) {
    result.code = 'INVALID_ARGUMENTS';
    result.nextStep = 'Run --schema TOOL for the exact input contract.';
    result.issues = e.issues;
  }
  return result;
}
