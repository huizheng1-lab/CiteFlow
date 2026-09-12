import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace } from '../browser/workspace.js';
import { LocalLibrary } from '../browser/library.js';
import { lookupSource } from '../browser/lookup.js';
import { createDocx, inspectDocx } from '../src/docx.js';
import edge from '../edge/worker.js';
const paper = {
  type: 'article-journal',
  title: 'Test source',
  author: [{ family: 'Smith', given: 'Jane' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Journal',
};
test('local DOCX open/edit/undo/download never calls fetch and leaves the input intact', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw Error('Network forbidden');
  };
  try {
    const bytes = await createDocx(['Private paragraph.', 'Private paragraph.']),
      w = new LocalWorkspace();
    await w.open(bytes, 'private.docx');
    let result = await w.edit([{ type: 'source.upsert', source: paper }]);
    const sid = result.results[0].sourceId;
    result = await w.edit([
      {
        type: 'citation.insert',
        items: [{ id: sid }],
        anchor: { paragraphIndex: 1, paragraphText: 'Private paragraph.', endOffset: 18 },
      },
    ]);
    assert.equal(result.paragraphs[0].text, 'Private paragraph.');
    assert.equal(result.paragraphs[1].text, 'Private paragraph.(1)');
    assert.equal((await inspectDocx(bytes)).document.citations.length, 0);
    await w.undo();
    assert.equal((await inspectDocx(w.download())).document.citations.length, 0);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('failed local open preserves the current working file', async () => {
  const w = new LocalWorkspace();
  await w.open(await createDocx(['Keep me.']), 'keep.docx');
  await assert.rejects(w.open(new Uint8Array([1, 2, 3]), 'broken.docx'));
  assert.equal((await w.inspect()).paragraphs[0].text, 'Keep me.');
});
test('saved library imports atomically and never needs a network', () => {
  const items = new Map(),
    storage = {
      getItem: (k) => items.get(k),
      setItem: (k, v) => items.set(k, v),
      removeItem: (k) => items.delete(k),
    },
    l = new LocalLibrary(storage);
  l.save(paper);
  l.save(paper);
  assert.equal(l.read().length, 1);
  const backup = l.export();
  assert.throws(() =>
    l.import(JSON.stringify({ schemaVersion: 1, sources: [paper, { type: 'webpage' }] })),
  );
  assert.equal(l.export(), backup);
  l.clear();
  l.import(backup);
  assert.equal(l.read()[0].title, 'Test source');
});
test('lookup transmits only an explicit identifier with cookies and referrer disabled', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        message: { type: 'journal-article', DOI: '10.1234/test', title: ['A source'] },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  await lookupSource('10.1234/test', { fetcher });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.crossref.org/works/10.1234%2Ftest');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].options.body, undefined);
});
test('optional relay receives only input URL and validates DOI identity', async () => {
  let args;
  const fetcher = async (url, options) => {
    args = options;
    return new Response(
      JSON.stringify({ source: { ...paper, DOI: '10.1234/test' }, provider: 'Fixture' }),
    );
  };
  await lookupSource('10.1234/test', { relay: 'https://relay.example', fetcher });
  assert.deepEqual(Object.keys(JSON.parse(args.body)), ['input']);
  assert.match(JSON.parse(args.body).input, /api.crossref.org/);
});
test('edge relay refuses document uploads, extra fields, private hosts and off-list redirects', async () => {
  const post = (body) =>
    new Request('https://relay.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await edge.fetch(
        post({ input: 'https://api.crossref.org/works/test', document: 'private prose' }),
      )
    ).status,
    400,
  );
  assert.equal((await edge.fetch(post({ input: 'https://127.0.0.1/' }))).status, 400);
  assert.equal(
    (
      await edge.fetch(
        new Request('https://relay.example', { method: 'POST', body: new Uint8Array([1, 2, 3]) }),
      )
    ).status,
    415,
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/' } });
  };
  try {
    assert.equal(
      (await edge.fetch(post({ input: 'https://api.crossref.org/works/test' }))).status,
      400,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('a movable reference list retains its selected paragraph when old list removal shifts indices', async () => {
  const w = new LocalWorkspace();
  await w.open(await createDocx(['First.', 'Last.']), 'x.docx');
  await w.edit([
    { type: 'bibliography.place', anchor: { paragraphIndex: 0, exactParagraph: 'First.' } },
  ]);
  const current = await w.inspect(),
    last = current.paragraphs.find((p) => p.text === 'Last.');
  const moved = await w.edit([
    { type: 'bibliography.place', anchor: { paragraphIndex: last.index, exactParagraph: 'Last.' } },
  ]);
  assert.deepEqual(
    moved.paragraphs.map((p) => p.text),
    ['First.', 'Last.', 'References'],
  );
});
