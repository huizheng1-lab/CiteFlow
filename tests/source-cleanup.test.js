import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, newDocument, sourceKey } from '../src/model.js';
import { LocalWorkspace } from '../browser/workspace.js';
import { createDocx } from '../src/docx.js';
import { definitions } from '../agent/api.js';
const paper = {
  type: 'article-journal',
  title: 'Same publication',
  author: [{ family: 'Smith', given: 'Jane' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Test Journal',
};
test('re-adding a source without identifiers reuses its stored ID, regardless of property order', () => {
  const doc = newDocument();
  const first = apply(doc, { type: 'source.upsert', source: paper });
  const reordered = Object.fromEntries(Object.entries(paper).reverse());
  assert.equal(sourceKey(doc.sources[first.sourceId]), sourceKey(reordered));
  for (let i = 0; i < 5; i++)
    assert.deepEqual(apply(doc, { type: 'source.upsert', source: reordered }), {
      sourceId: first.sourceId,
      reused: true,
    });
  assert.equal(Object.keys(doc.sources).length, 1);
  assert.notEqual(sourceKey(paper), sourceKey({ ...paper, issued: { 'date-parts': [[2025]] } }));
});
test('delete rejects cited sources; merge keeps annotations and removes only identical group items', () => {
  const d = newDocument();
  const keep = apply(d, { type: 'source.upsert', source: paper }).sourceId;
  const duplicate = apply(d, { type: 'source.upsert', source: { ...paper, page: '1-9' } }).sourceId;
  apply(d, {
    type: 'citation.insert',
    items: [
      { id: keep },
      { id: duplicate },
      { id: duplicate, locator: '12', label: 'page', prefix: 'see ', suffix: ' also' },
    ],
  });
  assert.throws(() => apply(d, { type: 'source.remove', sourceId: duplicate }), /source is cited/);
  const metadata = structuredClone(d.sources[keep]);
  apply(d, { type: 'source.merge', from: duplicate, to: keep });
  assert.deepEqual(d.sources[keep], metadata);
  assert.equal(d.sources[duplicate], undefined);
  assert.deepEqual(d.citations[0].items, [
    { id: keep },
    { id: keep, locator: '12', prefix: 'see ', suffix: ' also', label: 'page' },
  ]);
  assert.throws(() => apply(d, { type: 'source.merge', from: keep, to: keep }), /different/);
  const unused = apply(d, {
    type: 'source.upsert',
    source: { ...paper, title: 'Unused' },
  }).sourceId;
  apply(d, { type: 'source.remove', sourceId: unused });
  assert.equal(d.sources[unused], undefined);
});
test('DOCX merge updates citations and bibliography; Undo restores both sources; failed batch is atomic', async () => {
  const w = new LocalWorkspace();
  await w.open(await createDocx(['One.', 'Two.']), 'test.docx');
  const r = await w.edit([
    { type: 'source.upsert', source: paper },
    { type: 'source.upsert', source: { ...paper, page: '1-9' } },
  ]);
  const [a, b] = r.results.map((x) => x.sourceId);
  await w.edit([
    { type: 'citation.insert', items: [{ id: a }], anchor: { exactText: 'One.' } },
    { type: 'citation.insert', items: [{ id: b, locator: '12' }], anchor: { exactText: 'Two.' } },
    { type: 'bibliography.place' },
  ]);
  const before = w.download();
  await assert.rejects(
    w.edit([
      { type: 'source.merge', from: b, to: a },
      { type: 'source.remove', sourceId: a },
    ]),
    /source is cited/,
  );
  assert.deepEqual(w.download(), before);
  const merged = await w.edit([{ type: 'source.merge', from: b, to: a }]);
  assert.equal(Object.keys(merged.document.sources).length, 1);
  assert.equal(merged.rendered.bibliography.length, 1);
  assert.equal(merged.document.citations[1].items[0].locator, '12');
  assert.equal(merged.document.citations[1].items[0].id, a);
  assert.equal(merged.issues.length, 0);
  await w.undo();
  assert.deepEqual(w.download(), before);
});
test('agent schema exposes remove and merge operations', () => {
  const parsed = definitions.docx_edit.schema.parse({
    input: 'a.docx',
    output: 'b.docx',
    expectedFileHash: 'a'.repeat(64),
    expectedRevision: 0,
    operations: [
      { type: 'source.remove', sourceId: 'unused' },
      { type: 'source.merge', from: 'dup', to: 'keep' },
    ],
  });
  assert.equal(parsed.operations.length, 2);
});

test('cite directly from library is atomic, reuses sources and has one-step Undo', async () => {
  const w = new LocalWorkspace();
  await w.open(await createDocx(['One.', 'Two.']), 'direct.docx');
  const before = w.download();
  await assert.rejects(w.citeSource(paper, { exactText: 'Missing.' }));
  assert.deepEqual(w.download(), before);
  await w.citeSource(paper, { exactText: 'One.' });
  assert.equal(w.history.length, 1);
  const first = w.download();
  const second = await w.citeSource(paper, { exactText: 'Two.' });
  assert.equal(Object.keys(second.document.sources).length, 1);
  assert.equal(second.document.citations.length, 2);
  await w.undo();
  assert.deepEqual(w.download(), first);
  await w.undo();
  assert.deepEqual(w.download(), before);
});
