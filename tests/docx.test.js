import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createDocx, editDocx, inspectDocx, fileHash } from '../src/docx.js';
const source = {
  type: 'article-journal',
  title: 'Study',
  author: [{ family: 'Smith', given: 'J' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Journal',
};
async function apply(bytes, operations, extra = {}) {
  const inspection = await inspectDocx(bytes);
  return editDocx(bytes, {
    expectedFileHash: inspection.fileHash,
    expectedRevision: inspection.document.revision,
    operations,
    ...extra,
  });
}
test('DOCX insert/edit/delete round trip embeds metadata and preserves unrelated ZIP entries', async () => {
  let bytes = await createDocx(['Important finding. More prose.', 'References go below.']);
  const zip = await JSZip.loadAsync(bytes);
  zip.file('word/media/sentinel.bin', Buffer.from([0, 1, 2, 3]));
  bytes = await zip.generateAsync({ type: 'nodebuffer' });
  let r = await apply(bytes, [{ type: 'source.upsert', source }]);
  const sid = r.results[0].sourceId;
  r = await apply(r.bytes, [
    {
      type: 'citation.insert',
      id: 'one',
      items: [{ id: sid }],
      anchor: { exactText: 'Important finding.' },
    },
    { type: 'bibliography.place', anchor: { exactParagraph: 'References go below.' } },
  ]);
  assert.deepEqual((await inspectDocx(r.bytes)).physicalOrder, ['one']);
  const z = await JSZip.loadAsync(r.bytes);
  assert.deepEqual(
    await z.file('word/media/sentinel.bin').async('nodebuffer'),
    Buffer.from([0, 1, 2, 3]),
  );
  assert.match(await z.file('word/document.xml').async('string'), /More prose\./);
  assert.equal((await inspectDocx(r.bytes)).document.sources[sid].title, 'Study');
  r = await apply(r.bytes, [{ type: 'style.set', style: 'apa' }]);
  assert.match(r.rendered.citations.one, /Smith, 2024/);
  r = await apply(r.bytes, [{ type: 'citation.remove', citationId: 'one' }]);
  assert.equal(r.rendered.bibliography.length, 0);
  assert.equal((await inspectDocx(r.bytes)).physicalOrder.length, 0);
});
test('DOCX refuses stale hashes, ambiguous anchors and tracked changes', async () => {
  let bytes = await createDocx(['Same. Same.']);
  let r = await apply(bytes, [{ type: 'source.upsert', source }]);
  await assert.rejects(
    editDocx(r.bytes, { expectedFileHash: 'wrong', expectedRevision: 1, operations: [] }),
    /changed/,
  );
  await assert.rejects(
    apply(r.bytes, [
      {
        type: 'citation.insert',
        items: [{ id: r.results[0].sourceId }],
        anchor: { exactText: 'Same.' },
      },
    ]),
    /exactly once/,
  );
  const z = await JSZip.loadAsync(bytes);
  z.file(
    'word/document.xml',
    (await z.file('word/document.xml').async('string')).replace(
      'Same. Same.',
      'Same.</w:t></w:r><w:ins><w:r><w:t>New</w:t></w:r></w:ins><w:r><w:t>Same.',
    ),
  );
  bytes = await z.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(apply(bytes, []), /Tracked changes/);
});
test('manually altered citation text is detected and only restored explicitly', async () => {
  let r = await apply(await createDocx(['Sentence.']), [{ type: 'source.upsert', source }]);
  r = await apply(r.bytes, [
    {
      type: 'citation.insert',
      id: 'c',
      items: [{ id: r.results[0].sourceId }],
      anchor: { exactText: 'Sentence.' },
    },
  ]);
  const z = await JSZip.loadAsync(r.bytes);
  z.file(
    'word/document.xml',
    (await z.file('word/document.xml').async('string')).replace('(1)', '(99)'),
  );
  const changed = await z.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(apply(changed, []), /manually changed/);
  const fixed = await apply(changed, [], { repair: true });
  assert.equal(fixed.rendered.citations.c, '(1)');
});
test('citation numbering reflects actual insertion location', async () => {
  let r = await apply(await createDocx(['First. Second.']), [
    { type: 'source.upsert', source },
    { type: 'source.upsert', source: { ...source, title: 'Another' } },
  ]);
  const [a, b] = r.results.map((x) => x.sourceId);
  r = await apply(r.bytes, [
    { type: 'citation.insert', id: 'second', items: [{ id: b }], anchor: { exactText: 'Second.' } },
    { type: 'citation.insert', id: 'first', items: [{ id: a }], anchor: { exactText: 'First.' } },
  ]);
  assert.equal(r.rendered.citations.first, '(1)');
  assert.equal(r.rendered.citations.second, '(2)');
});
test('Word metadata part uses namespace identity, not a fixed ZIP filename', async () => {
  let r = await apply(await createDocx(['Text.']), [{ type: 'source.upsert', source }]);
  const z = await JSZip.loadAsync(r.bytes);
  z.file('customXml/item9.xml', await z.file('customXml/citeflow.xml').async('string'));
  z.remove('customXml/citeflow.xml');
  z.file(
    'word/_rels/document.xml.rels',
    (await z.file('word/_rels/document.xml.rels').async('string')).replace(
      'customXml/citeflow.xml',
      'customXml/item9.xml',
    ),
  );
  const renamed = await z.generateAsync({ type: 'nodebuffer' });
  const inspected = await inspectDocx(renamed);
  assert.equal(Object.keys(inspected.document.sources).length, 1);
  r = await apply(renamed, [{ type: 'style.set', style: 'apa' }]);
  const changed = await JSZip.loadAsync(r.bytes);
  assert(changed.file('customXml/item9.xml'));
  assert.equal(changed.file('customXml/citeflow.xml'), null);
});
test('APA bibliography preserves journal italics and hanging indents in DOCX', async () => {
  let r = await apply(await createDocx(['Text.']), [{ type: 'source.upsert', source }]);
  r = await apply(r.bytes, [
    {
      type: 'citation.insert',
      items: [{ id: r.results[0].sourceId }],
      anchor: { exactText: 'Text.' },
    },
    { type: 'style.set', style: 'apa' },
    { type: 'bibliography.place' },
  ]);
  const z = await JSZip.loadAsync(r.bytes),
    xml = await z.file('word/document.xml').async('string');
  assert.match(xml, /<w:i\s*\/>/);
  assert.match(xml, /w:hanging="720"/);
});

test('opens DOCX packages larger than the former 25 MB limit and rejects over 100 MB', async () => {
  const original = await createDocx(['Large document with embedded media']);
  const zip = await JSZip.loadAsync(original);
  zip.file('word/media/large.bin', new Uint8Array(26_000_000));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  assert(bytes.byteLength > 25_000_000);
  const result = await inspectDocx(bytes);
  assert.equal(result.paragraphs[0].text, 'Large document with embedded media');
  await assert.rejects(inspectDocx(new Uint8Array(100_000_001)), /exceeds 100 MB/);
});
