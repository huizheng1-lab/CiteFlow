import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace } from '../browser/workspace.js';
import { createDocx, inspectDocx, loadPackage, editDocx } from '../src/docx.js';
import { mendeleyDocx, paper, citation } from './fixtures/mendeley.js';

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
