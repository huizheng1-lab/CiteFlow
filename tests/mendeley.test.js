import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace } from '../browser/workspace.js';
import { createDocx, inspectDocx, loadPackage, editDocx } from '../src/docx.js';
import { mendeleyDocx, paper, citation } from './fixtures/mendeley.js';
import { exportHandoff } from '../src/handoff.js';
import { reviewBibliography } from '../src/bibliography-review.js';
import JSZip from 'jszip';

test('Mendeley import/export retains original reference IDs and a single recognized bibliography', async () => {
  const w = new LocalWorkspace();
  await w.open(
    await mendeleyDocx([citation(), citation([{ id: paper.id, itemData: paper, locator: '7' }])]),
    'original.docx',
  );
  const bundle = await JSZip.loadAsync(await w.exportHandoff('mendeley'));
  const bytes = await bundle.file('manuscript-mendeley.docx').async('uint8array');
  const zip = await JSZip.loadAsync(bytes);
  const raw = await zip.file('word/document.xml').async('string');
  const payloads = [...raw.matchAll(/MENDELEY_CITATION_v3_([^"<]+)/g)].map((m) =>
    JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')),
  );
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].citationItems[0].id, paper.id);
  assert.equal(payloads[0].citationItems[0].itemData.id, paper.id);
  assert.equal(payloads[1].citationItems[0].locator, '7');
  assert.equal(raw.match(/MENDELEY_BIBLIOGRAPHY/g).length, 1);
  const reopened = new LocalWorkspace();
  const result = await reopened.open(bytes, 'exported.docx');
  assert.equal(result.document.citations.length, 2);
  assert.equal(Object.keys(result.document.sources).length, 1);
  assert.ok(!result.document.bibliographyReview);
});

test('duplicate and ambiguous bibliography matches also require preservation', () => {
  const source = { ...paper, id: 'one' };
  const text = 'Author. ' + source.title + '. 2024.';
  assert.equal(reviewBibliography([text, text], { one: source }, {}).entries.length, 2);
  const ambiguous = reviewBibliography([text], { one: source, two: { ...source, id: 'two' } }, {});
  assert.equal(ambiguous.unmatchedCount, 1);
});

test('Mendeley export updates add-in citation settings instead of retaining stale IDs', async () => {
  const zip = await JSZip.loadAsync(await mendeleyDocx());
  zip.file(
    'word/webextensions/webextension1.xml',
    '<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"><we:properties><we:property name="MENDELEY_CITATIONS" value="[]"/><we:property name="MENDELEY_BIBLIOGRAPHY_IS_DIRTY" value="false"/><we:property name="MENDELEY_CITATIONS_STYLE" value="{}"/></we:properties></we:webextension>',
  );
  const w = new LocalWorkspace();
  await w.open(await zip.generateAsync({ type: 'uint8array' }), 'settings.docx');
  const bundle = await JSZip.loadAsync(await w.exportHandoff('mendeley'));
  const exported = await JSZip.loadAsync(
    await bundle.file('manuscript-mendeley.docx').async('uint8array'),
  );
  const settings = await exported.file('word/webextensions/webextension1.xml').async('string');
  assert.match(settings, /MENDELEY_CITATION_v3_/);
  assert.match(settings, /MENDELEY_BIBLIOGRAPHY_IS_DIRTY" value="true"/);
  assert.match(settings, /external-1/);
  assert.match(settings, /styles\/vancouver/);
  const reopened = await new LocalWorkspace().open(
    await exported.generateAsync({ type: 'uint8array' }),
    'again.docx',
  );
  assert.equal(reopened.document.citations.length, 1);
});

test('Mendeley v3 imports groups, repeated sources, Unicode, locators and bibliography offline', async () => {
  const second = { ...paper, id: 'external-2', title: 'Another synthetic study' };
  const bytes = await mendeleyDocx([
    citation([
      { id: paper.id, itemData: paper },
      { id: second.id, itemData: second },
    ]),
    citation([
      {
        id: paper.id,
        itemData: paper,
        locator: '12–14',
        label: 'page',
        prefix: 'see ',
        suffix: ' also',
      },
    ]),
  ]);
  const original = bytes.slice();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('No network during import');
  };
  try {
    const w = new LocalWorkspace();
    const result = await w.open(bytes, 'synthetic.docx');
    assert.deepEqual(result.importReport, {
      manager: 'Mendeley Cite',
      citationCount: 2,
      sourceCount: 2,
      bibliographyCount: 1,
      style: 'vancouver',
    });
    assert.deepEqual(result.issues, []);
    assert.equal(result.document.citations[0].items.length, 2);
    const item = result.document.citations[1].items[0];
    assert.deepEqual(item, {
      id: result.document.citations[0].items[0].id,
      locator: '12–14',
      prefix: 'see ',
      suffix: ' also',
      label: 'page',
    });
    assert.equal(result.document.sources[item.id].author[0].family, 'Källberg');
    assert.match(result.paragraphs[0].text, /^Before citation\./);
    assert.match(result.paragraphs[0].text, / After citation\.$/);
    const changed = await w.edit([{ type: 'style.set', style: 'apa' }]);
    assert.match(Object.values(changed.rendered.citations)[0], /Källberg/);
    const reopened = new LocalWorkspace();
    const again = await reopened.open(w.download(), 'converted.docx');
    assert.equal(again.importReport, null);
    assert.deepEqual(again.document.citations, changed.document.citations);
    const pack = await loadPackage(w.download());
    assert.equal(
      await pack.zip.file('customXml/unrelated.xml').async('string'),
      '<preserve>Unrelated metadata</preserve>',
    );
    assert.doesNotMatch(
      await pack.zip.file('word/document.xml').async('string'),
      /MENDELEY_|Old bibliography|w:lock/,
    );
    await w.edit([{ type: 'citation.remove', citationId: changed.document.citations[0].id }]);
    assert.equal((await w.inspect()).document.citations.length, 1);
    await w.undo();
    assert.equal((await w.inspect()).document.citations.length, 2);
    assert.deepEqual(bytes, original);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('unsupported or incomplete Mendeley imports fail atomically without replacing the open file', async () => {
  const w = new LocalWorkspace();
  await w.open(await createDocx(['Keep this manuscript.']), 'keep.docx');
  const cases = [
    await mendeleyDocx(['MENDELEY_CITATION_v3_broken']),
    await mendeleyDocx(['MENDELEY_CITATION_v4_unknown']),
    await mendeleyDocx([citation([{ id: 'missing' }])]),
    await mendeleyDocx([{ ...citation(), manualOverride: { isManuallyOverridden: true } }]),
    await mendeleyDocx([citation([{ id: paper.id, itemData: paper, 'suppress-author': true }])]),
    await mendeleyDocx([
      citation(),
      citation([{ id: paper.id, itemData: { ...paper, title: 'Conflict' } }]),
    ]),
    await mendeleyDocx([citation()], { footnotes: true }),
    await mendeleyDocx([citation()], {
      transform: (s) => s.replace('<w:sectPr/>', '<w:ins/><w:sectPr/>'),
    }),
    await mendeleyDocx([citation()], {
      transform: (s) =>
        s.replace('<w:sectPr/>', '<w:fldSimple w:instr="ADDIN CSL_CITATION"/><w:sectPr/>'),
    }),
  ];
  for (const bytes of cases) {
    const original = bytes.slice();
    await assert.rejects(w.open(bytes, 'unsupported.docx'));
    assert.deepEqual(bytes, original);
    const current = await w.inspect();
    assert.equal(current.filename, 'keep.docx');
    assert.equal(current.paragraphs[0].text, 'Keep this manuscript.');
  }
});

test('unconverted Mendeley controls are detected and cannot be edited as ordinary text', async () => {
  const bytes = await mendeleyDocx();
  const inspected = await inspectDocx(bytes);
  assert(inspected.issues.some((issue) => issue.code === 'foreign-citations'));
  await assert.rejects(
    editDocx(bytes, {
      expectedFileHash: inspected.fileHash,
      expectedRevision: inspected.document.revision,
      operations: [{ type: 'style.set', style: 'apa' }],
    }),
    /Another citation manager/,
  );
});

test('Mendeley documents without a bibliography import without adding one', async () => {
  const w = new LocalWorkspace();
  const result = await w.open(
    await mendeleyDocx([citation()], { bibliography: false }),
    'no-bibliography.docx',
  );
  assert.equal(result.importReport.bibliographyCount, 0);
  const { root } = await loadPackage(w.download());
  assert(!root.toString().includes('citeflow:bibliography'));
});

test('unmatched bibliography entries and original numbering survive prose editing, Undo and reopen', async () => {
  const extra =
    '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>2. Another author. A reference with no embedded citation. 2020.</w:t></w:r></w:p>';
  const bytes = await mendeleyDocx([citation()], {
    transform: (s) =>
      s
        .replace('</w:sdtContent></w:sdt><w:sectPr/>', extra + '</w:sdtContent></w:sdt><w:sectPr/>')
        .replace('<w:t>(1)</w:t>', '<w:t>(42)</w:t>'),
  });
  const w = new LocalWorkspace();
  let result = await w.open(bytes, 'complete-bibliography.docx');
  assert.equal(result.importReport.bibliographyEntries, 2);
  assert.equal(result.importReport.unmatchedBibliographyEntries, 1);
  assert.equal(result.importReport.style, 'original');
  assert.equal(Object.values(result.rendered.citations)[0], '(42)');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const bibliographyContent = (root) =>
    Array.from(root.getElementsByTagNameNS(W, 'sdt'))
      .find((s) =>
        ['MENDELEY_BIBLIOGRAPHY', 'citeflow:bibliography'].includes(
          s.getElementsByTagNameNS(W, 'tag')[0]?.getAttributeNS(W, 'val'),
        ),
      )
      .getElementsByTagNameNS(W, 'sdtContent')[0]
      .toString();
  const original = bibliographyContent((await loadPackage(bytes)).root);
  assert.equal(bibliographyContent((await loadPackage(w.download())).root), original);
  const content = structuredClone(result.editor.content);
  content.content[0].content.find((n) => n.type === 'text').text = 'Revised prose.';
  result = await w.edit([{ type: 'document.replace', content }]);
  assert.match(result.paragraphs[0].text, /Revised prose/);
  assert.equal(bibliographyContent((await loadPackage(w.download())).root), original);
  await w.undo();
  await w.redo();
  const reopened = await new LocalWorkspace().open(w.download(), 'reopened.docx');
  assert.equal(reopened.document.bibliographyReview.entries.length, 2);
  assert.equal(Object.values(reopened.rendered.citations)[0], '(42)');
  for (const op of [
    { type: 'style.set', style: 'apa' },
    { type: 'bibliography.place' },
    { type: 'citation.remove', citationId: result.document.citations[0].id },
  ])
    await assert.rejects(w.edit([op]), /metadata review/);
  const deleted = structuredClone(result.editor.content);
  deleted.content = deleted.content.filter((n) => n.type !== 'bibliography');
  await assert.rejects(w.edit([{ type: 'document.replace', content: deleted }]), /metadata review/);
  const noCitation = structuredClone(result.editor.content);
  noCitation.content[0].content = noCitation.content[0].content.filter(
    (n) => n.type !== 'citation',
  );
  await assert.rejects(
    w.edit([{ type: 'document.replace', content: noCitation }]),
    /metadata review/,
  );
  await assert.rejects(exportHandoff(w.download(), 'mendeley'), /bibliography review/);
  assert.equal(bibliographyContent((await loadPackage(w.download())).root), original);
});

test('Mendeley DOI export lines are separated without losing PubMed identifiers', async () => {
  const source = {
    ...paper,
    DOI: 'https://doi.org/10.1234/example\r\nPMID- - 123456\r\nPMCID- - PMC987654',
  };
  const w = new LocalWorkspace();
  const result = await w.open(
    await mendeleyDocx([citation([{ id: paper.id, itemData: source }])]),
    'identifiers.docx',
  );
  const imported = Object.values(result.document.sources)[0];
  assert.equal(imported.DOI, '10.1234/example');
  assert.equal(imported.PMID, '123456');
  assert.equal(imported.PMCID, 'PMC987654');
  assert.equal(result.importReport.metadataRepairs, 1);
  for (const bad of [
    { ...source, DOI: '10.1234/example\nUnknown extra text' },
    { ...source, PMID: '999999' },
    { ...source, DOI: '10.1234/example\nPMID- invalid' },
  ]) {
    await assert.rejects(
      w.open(await mendeleyDocx([citation([{ id: paper.id, itemData: bad }])]), 'bad.docx'),
      /Mendeley citation 1:/,
    );
    assert.equal((await w.inspect()).filename, 'identifiers.docx');
  }
});

const emptyField = (code, result = '') =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
test('empty EndNote remnants are archived losslessly while visible fields still block import', async () => {
  const nested = emptyField(' ADDIN EN.CITE ', emptyField(' ADDIN EN.CITE.DATA '));
  const options = (field) => ({ transform: (raw) => raw.replace('</w:p>', field + '</w:p>') });
  const bytes = await mendeleyDocx([citation()], options(nested));
  const original = bytes.slice();
  const w = new LocalWorkspace();
  const imported = await w.open(bytes, 'remnants.docx');
  assert.equal(imported.importReport.inactiveEndNoteFields, 1);
  assert.equal(imported.document.citations.length, 1);
  const archive = imported.document.importProvenance.inactiveEndNoteFields;
  assert.equal(archive.length, 1);
  assert.match(archive[0], /ADDIN EN.CITE.DATA/);
  assert.doesNotMatch((await loadPackage(w.download())).root.toString(), /ADDIN EN.CITE/);
  const reopened = await new LocalWorkspace().open(w.download(), 'saved.docx');
  assert.deepEqual(reopened.document.importProvenance.inactiveEndNoteFields, archive);
  assert.deepEqual(bytes, original);
  for (const field of [
    emptyField(' ADDIN EN.CITE ', '<w:r><w:t>[8]</w:t></w:r>'),
    emptyField(' ADDIN EN.CITE ', '<w:r><w:drawing/></w:r>'),
    emptyField(' ADDIN EN.CITE ', '<w:r><w:tab/></w:r>'),
    emptyField(' ADDIN CSL_CITATION '),
    nested.replace(/<w:r><w:fldChar w:fldCharType="end"\/><\/w:r>$/, ''),
  ])
    await assert.rejects(
      w.open(await mendeleyDocx([citation()], options(field)), 'visible.docx'),
      /Other citation fields/,
    );
});
