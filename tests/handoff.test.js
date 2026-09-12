import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { createDocx, inspectDocx, editDocx, fileHash } from '../src/docx.js';
import { exportHandoff } from '../src/handoff.js';
import { LocalWorkspace } from '../browser/workspace.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
const nodes = (n, t) => Array.from(n.getElementsByTagNameNS(W, t));
const source = {
  type: 'article-journal',
  title: 'Study <one> & two 🧬',
  author: [{ family: 'Smith', given: 'Jane' }],
  issued: { 'date-parts': [[2024, 3, 12]] },
  'container-title': 'Journal',
  DOI: '10.1234/test',
  volume: '12',
  issue: '2',
  page: '5-9',
};
async function apply(bytes, operations) {
  const i = await inspectDocx(bytes);
  return editDocx(bytes, {
    expectedFileHash: i.fileHash,
    expectedRevision: i.document.revision,
    operations,
  });
}
async function fixture() {
  let r = await apply(
    await createDocx(['First finding.', 'Second finding.', 'List here.', 'Tail remains.']),
    [
      { type: 'source.upsert', source },
      {
        type: 'source.upsert',
        source: {
          ...source,
          DOI: '10.1234/second',
          title: 'Second study',
          author: [{ family: 'Mali' }],
        },
      },
      {
        type: 'source.upsert',
        source: { ...source, DOI: '10.1234/uncited', title: 'Unused source' },
      },
    ],
  );
  const [a, b] = r.results.map((x) => x.sourceId);
  r = await apply(r.bytes, [
    {
      type: 'citation.insert',
      id: 'first',
      leadingSpace: true,
      items: [{ id: a, locator: '5', label: 'page', prefix: 'see ', suffix: ' also' }, { id: b }],
      anchor: { exactText: 'First finding.' },
    },
    {
      type: 'citation.insert',
      id: 'second',
      leadingSpace: true,
      items: [{ id: a }],
      anchor: { exactText: 'Second finding.' },
    },
    { type: 'bibliography.place', anchor: { exactParagraph: 'List here.' } },
  ]);
  const zip = await JSZip.loadAsync(r.bytes);
  zip.file('word/media/sentinel.bin', new Uint8Array([1, 3, 8]));
  zip.file('customXml/other.xml', '<other>retain</other>');
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), a, b };
}
async function unpack(bytes, target) {
  const bundle = await JSZip.loadAsync(await exportHandoff(bytes, target));
  const converted = await bundle.file(`manuscript-${target}.docx`).async('uint8array');
  const zip = await JSZip.loadAsync(converted);
  const raw = await zip.file('word/document.xml').async('string');
  return { bundle, zip, raw, root: parse(raw), converted };
}
test('EndNote bulk handoff uses matching stable labels, groups and pages; original is untouched', async () => {
  const { bytes } = await fixture(),
    original = fileHash(bytes);
  const { bundle, zip, root } = await unpack(bytes, 'endnote');
  const refs = parse(await bundle.file('references.xml').async('string'));
  const labels = Array.from(refs.getElementsByTagName('label')).map((n) => n.textContent);
  assert.equal(labels.length, 2);
  const text = nodes(root, 't')
    .map((n) => n.textContent)
    .join('');
  assert.ok(text.includes(`{see \\Smith, 2024 #${labels[0]}@5  also; Mali, 2024 #${labels[1]}}`));
  assert.equal(text.split('#' + labels[0]).length - 1, 2);
  assert.ok(text.includes('Tail remains.'));
  assert.ok(!text.includes('References'));
  assert.equal(nodes(root, 'sdt').length, 0);
  assert.equal(refs.getElementsByTagName('title')[0].textContent, source.title);
  assert.equal(zip.file('customXml/citeflow.xml'), null);
  assert.ok(
    !(await zip.file('word/_rels/document.xml.rels').async('string')).includes('citeflow.xml'),
  );
  assert.equal(await zip.file('customXml/other.xml').async('string'), '<other>retain</other>');
  assert.deepEqual(
    await zip.file('word/media/sentinel.bin').async('uint8array'),
    new Uint8Array([1, 3, 8]),
  );
  assert.equal(fileHash(await bundle.file('original-citeflow.docx').async('uint8array')), original);
  assert.equal(fileHash(bytes), original);
  const report = JSON.parse(await bundle.file('handoff-report.json').async('string'));
  assert.equal(report.nativeApplicationVerified, false);
  assert.equal(report.citationCount, 2);
  assert.equal(report.sourceCount, 2);
});
test('Mendeley bridge creates balanced fields with embedded metadata and original bibliography position', async () => {
  const { bytes, a, b } = await fixture();
  const { root, raw, zip, bundle } = await unpack(bytes, 'mendeley');
  const fields = [],
    stack = [];
  for (const r of nodes(root, 'r')) {
    const kind = nodes(r, 'fldChar')[0]?.getAttributeNS(W, 'fldCharType');
    if (kind === 'begin') stack.push({ code: '', text: '', separate: false });
    if (kind === 'separate') {
      assert.equal(stack.length, 1);
      stack.at(-1).separate = true;
    }
    if (stack.length) {
      stack.at(-1).code += nodes(r, 'instrText')
        .map((n) => n.textContent)
        .join('');
      if (stack.at(-1).separate)
        stack.at(-1).text += nodes(r, 't')
          .map((n) => n.textContent)
          .join('');
    }
    if (kind === 'end') fields.push(stack.pop());
  }
  assert.equal(stack.length, 0);
  assert.equal(fields.length, 3);
  const c = JSON.parse(fields[0].code.replace(' ADDIN CSL_CITATION ', ''));
  assert.deepEqual(
    c.citationItems.map((i) => i.id),
    [a, b],
  );
  assert.equal(c.citationItems[0].itemData.title, source.title);
  assert.equal(c.citationItems[0].locator, '5');
  assert.equal(c.citationItems[0].prefix, 'see ');
  assert.equal(c.citationItems[0].suffix, ' also');
  assert.equal(c.mendeley.previouslyFormattedCitation, fields[0].text);
  assert.ok(!fields[0].text.startsWith(' '));
  assert.equal(
    JSON.parse(fields[1].code.replace(' ADDIN CSL_CITATION ', '')).citationItems[0].id,
    a,
  );
  assert.equal(fields[2].code.trim(), 'ADDIN CSL_BIBLIOGRAPHY');
  assert.ok(raw.indexOf('CSL_BIBLIOGRAPHY') < raw.indexOf('Tail remains.'));
  assert.equal(nodes(root, 'sdt').length, 0);
  assert.equal(zip.file('customXml/citeflow.xml'), null);
  assert.equal(JSON.parse(await bundle.file('references.csl.json').async('string')).length, 2);
});
test('handoff rejects unsupported EndNote locators and ambiguous delimiters', async () => {
  const { bytes, a } = await fixture();
  const changed = await apply(bytes, [
    {
      type: 'citation.update',
      citationId: 'first',
      items: [{ id: a, locator: '3', label: 'chapter' }],
    },
  ]);
  await assert.rejects(exportHandoff(changed.bytes, 'endnote'), /page locators only/);
  await exportHandoff(changed.bytes, 'mendeley');
  const z = await JSZip.loadAsync(bytes);
  z.file(
    'word/document.xml',
    (await z.file('word/document.xml').async('string')).replace(
      'Tail remains.',
      'Tail {formula} remains.',
    ),
  );
  await assert.rejects(
    exportHandoff(await z.generateAsync({ type: 'uint8array' }), 'endnote'),
    /literal braces/,
  );
});
test('export rejects deleted anchors, foreign bibliography fields, and tracked changes', async () => {
  const { bytes } = await fixture();
  for (const [needle, replacement, expected] of [
    ['citeflow:citation:first', 'citeflow:citation:unknown', /anchors/],
    [
      'Tail remains.',
      '</w:t></w:r><w:fldSimple w:instr=" ADDIN CSL_BIBLIOGRAPHY "><w:r><w:t>foreign</w:t></w:r></w:fldSimple><w:r><w:t>',
      /Another citation manager/,
    ],
    [
      'Tail remains.',
      '</w:t></w:r><w:ins><w:r><w:t>new</w:t></w:r></w:ins><w:r><w:t>',
      /Tracked changes/,
    ],
  ]) {
    const z = await JSZip.loadAsync(bytes);
    z.file(
      'word/document.xml',
      (await z.file('word/document.xml').async('string')).replace(needle, replacement),
    );
    await assert.rejects(
      exportHandoff(await z.generateAsync({ type: 'uint8array' }), 'mendeley'),
      expected,
    );
  }
});
test('renamed custom XML is detached and workspace export never changes revision or undo', async () => {
  const { bytes } = await fixture();
  const z = await JSZip.loadAsync(bytes);
  z.file('customXml/item7.xml', await z.file('customXml/citeflow.xml').async('string'));
  z.remove('customXml/citeflow.xml');
  z.file(
    'word/_rels/document.xml.rels',
    (await z.file('word/_rels/document.xml.rels').async('string')).replace(
      '../customXml/citeflow.xml',
      '../customXml/item7.xml',
    ),
  );
  const renamed = await z.generateAsync({ type: 'uint8array' });
  const ws = new LocalWorkspace();
  await ws.open(renamed, 'sample.docx');
  const before = await ws.inspect();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Network must not be used');
  };
  try {
    const bundle = await JSZip.loadAsync(await ws.exportHandoff('mendeley'));
    const doc = await JSZip.loadAsync(
      await bundle.file('manuscript-mendeley.docx').async('uint8array'),
    );
    assert.equal(doc.file('customXml/item7.xml'), null);
    assert.ok(
      !(await doc.file('word/_rels/document.xml.rels').async('string')).includes('item7.xml'),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(await ws.inspect(), before);
  assert.equal(fileHash(ws.download()), fileHash(renamed));
});
