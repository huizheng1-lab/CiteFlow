import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['browser/app.js', 'browser/document-worker.js'],
  bundle: true,
  outdir: 'dist',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  metafile: true,
  legalComments: 'eof',
}).then(async (r) => {
  const inputs = Object.keys(r.metafile.inputs);
  if (inputs.some((x) => /src\/(server|store|resolver|service)\.js$/.test(x)))
    throw new Error('Server module leaked into browser bundle');
  await writeFile(
    'dist/build-info.json',
    JSON.stringify(
      {
        version: '0.2.0',
        localDocumentProcessing: true,
        entrypoints: ['app.js', 'document-worker.js'],
      },
      null,
      2,
    ),
  );
});
for (const name of ['index.html', 'style.css']) await copyFile('browser/' + name, 'dist/' + name);
await copyFile('browser/_headers', 'dist/_headers');
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.txt');
console.log('Static browser application built in dist/');
