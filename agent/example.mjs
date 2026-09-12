// Executable smoke test. Uses only CiteFlow CLI to create, cite and inspect DOCX.
// Download beside citeflow-agent.cjs, then run: node agent-example.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const binary = fileURLToPath(new URL('./citeflow-agent.cjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'citeflow-example-'));
function call(tool, args) {
  const r = spawnSync(process.execPath, [binary, '--root', root, tool], {
    input: JSON.stringify(args),
    encoding: 'utf8',
    maxBuffer: 4_000_000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `Tool exited ${r.status}`);
  return JSON.parse(r.stdout);
}
const created = call('docx_create', {
  output: 'draft.docx',
  paragraphs: ['Synthetic citation workflow test.'],
  style: 'apa',
});
const cited = call('docx_cite', {
  input: 'draft.docx',
  output: 'cited.docx',
  expectedFileHash: created.fileHash,
  expectedRevision: created.document.revision,
  source: {
    type: 'article-journal',
    title: 'Synthetic reference for software testing only',
    author: [{ family: 'Example', given: 'A' }],
    issued: { 'date-parts': [[2024]] },
    'container-title': 'Test Journal',
  },
  anchor: { exactText: 'Synthetic citation workflow test.' },
  bibliography: true,
});
const result = call('docx_inspect', { input: 'cited.docx', includeParagraphs: true });
if (
  result.document.citations.length !== 1 ||
  result.issues.length ||
  !result.paragraphs.some((p) => p.text.includes('(Example, 2024)'))
)
  throw new Error('Citation verification failed');
console.log(
  JSON.stringify(
    {
      success: true,
      output: cited.output,
      citationCount: 1,
      issues: result.issues,
      note: 'Synthetic test reference, not a real publication. No browser or network used.',
    },
    null,
    2,
  ),
);
