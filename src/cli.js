#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';
import { Store } from './store.js';
import { dispatch } from './service.js';
import { inspectDocx, editDocx, createDocx } from './docx.js';
import { resolve } from 'node:path';
async function stdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s.trim() ? JSON.parse(s) : {};
}
try {
  const [command, input, output] = process.argv.slice(2);
  let result;
  if (command === 'docx.inspect') result = await inspectDocx(await readFile(input));
  else if (command === 'docx.edit') {
    if (!output || resolve(input) === resolve(output))
      throw new Error('Provide a different output filename to preserve the input');
    const edited = await editDocx(await readFile(input), await stdin());
    await writeFile(output + '.tmp', edited.bytes, { flag: 'wx' });
    await rename(output + '.tmp', output);
    result = { ...edited, bytes: undefined, output };
  } else if (command === 'docx.create') {
    if (!input) throw new Error('Output filename required');
    const args = await stdin();
    await writeFile(input, await createDocx(args.paragraphs), { flag: 'wx' });
    result = { output: input };
  } else if (command) {
    const store = new Store();
    try {
      result = await dispatch(store, command, await stdin());
    } finally {
      store.close();
    }
  } else
    result = {
      usage:
        'citeflow <method> < arguments.json; citeflow docx.inspect input.docx; citeflow docx.edit input.docx output.docx < edit.json',
      methods: [
        'documents.list',
        'documents.create',
        'documents.inspect',
        'sources.resolve',
        'documents.edit',
        'documents.format',
        'documents.restore',
        'documents.import',
        'library.list',
      ],
    };
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(JSON.stringify({ error: e.message, status: e.status || 400 }));
  process.exitCode = 1;
}
