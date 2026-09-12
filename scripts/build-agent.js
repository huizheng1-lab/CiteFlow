import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { schemas } from '../agent/discovery.js';
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['agent/main.js'],
  outfile: 'dist/citeflow-agent.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  metafile: true,
});
if (Object.keys(result.metafile.inputs).some((p) => /src\/(store|server|service)\.js$/.test(p)))
  throw new Error('Agent bundle must not include the database or web server');
const bytes = await readFile('dist/citeflow-agent.cjs');
await writeFile(
  'dist/citeflow-agent.sha256',
  createHash('sha256').update(bytes).digest('hex') + '  citeflow-agent.cjs\n',
);
await copyFile('docs/LOCAL_AGENT.md', 'dist/AGENT_GUIDE.md');
await copyFile('agent/manifest.json', 'dist/agent-manifest.json');
await copyFile('agent/AGENTS.md', 'dist/AGENTS.md');
await copyFile('agent/AGENTS.md', 'dist/llms.txt');
await copyFile('agent/example.mjs', 'dist/agent-example.mjs');
await writeFile('dist/agent-tools.json', JSON.stringify(schemas(), null, 2));
console.log('Standalone local agent built in dist/');
