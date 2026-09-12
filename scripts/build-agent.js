import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
console.log('Standalone local agent built in dist/');
