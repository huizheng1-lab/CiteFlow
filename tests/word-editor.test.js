import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { LocalWorkspace } from '../browser/workspace.js';
import { createDocx, inspectDocx } from '../src/docx.js';
const paper = {
  type: 'article-journal',
  title: 'Editing study',
  author: [{ family: 'Smith' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Test Journal',
};
const text = (value, marks = []) => ({ type: 'text', text: value, marks });
test('Word editor exports formatted text, headings, lists and tables with Undo and Redo', async () => {
  const w = new LocalWorkspace();
  await w.create();
  const before = w.download();
  const content = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('Study report')] },
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [
          text('Bold text', [{ type: 'bold' }]),
          text(' and italic', [{ type: 'italic' }]),
          text(' underline', [{ type: 'underline' }]),
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [text('First item')] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [text('Second item')] }] },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [text('Group')] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [text('Count')] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [text('Treatment')] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [text('25')] }] },
            ],
          },
        ],
      },
    ],
  };
  const edited = await w.edit([{ type: 'document.replace', content }]);
  assert.equal(edited.editor.content.content[0].type, 'heading');
  assert.equal(edited.editor.content.content[2].type, 'bulletList');
  assert.equal(edited.editor.content.content[3].type, 'table');
  const z = await JSZip.loadAsync(w.download()),
    xml = await z.file('word/document.xml').async('string');
  assert.match(xml, /w:jc w:val="center"/);
  assert.match(xml, /w:u w:val="single"/);
  assert.match(xml, /<w:tbl>/);
  assert.ok(z.file('word/numbering.xml'));
  const after = w.download();
  await w.undo();
  assert.deepEqual(w.download(), before);
  await w.redo();
  assert.deepEqual(w.download(), after);
});
test('editing, moving, copying and deleting citation atoms keeps Word metadata synchronized', async () => {
  const w = new LocalWorkspace();
  await w.open(await createDocx(['First sentence.', 'Second sentence.']), 'cited.docx');
  const s = (await w.edit([{ type: 'source.upsert', source: paper }])).results[0].sourceId;
  await w.edit([
    {
      type: 'citation.insert',
      items: [{ id: s, locator: '12' }],
      anchor: { exactText: 'First sentence.' },
    },
    { type: 'bibliography.place' },
  ]);
  let content = (await w.inspect()).editor.content;
  const atom = content.content[0].content.find((n) => n.type === 'citation');
  content.content[0].content = [text('Rewritten before '), atom, text(' and after.')];
  content.content[1].content.push(structuredClone(atom));
  let r = await w.edit([{ type: 'document.replace', content }]);
  assert.equal(r.document.citations.length, 2);
  assert.notEqual(r.document.citations[0].id, r.document.citations[1].id);
  assert.equal(r.document.citations[1].items[0].locator, '12');
  assert.equal(r.rendered.bibliography.length, 1);
  assert.equal(r.issues.length, 0);
  content = r.editor.content;
  content.content[0].content = content.content[0].content.filter((n) => n.type !== 'citation');
  r = await w.edit([{ type: 'document.replace', content }]);
  assert.equal(r.document.citations.length, 1);
  assert.equal(r.issues.length, 0);
  content = r.editor.content;
  content.content = [content.content[1], content.content[0], content.content[2]];
  r = await w.edit([{ type: 'document.replace', content }]);
  assert.equal(r.physicalOrder[0], r.document.citations[0].id);
  assert.equal(r.issues.length, 0);
});
test('unsupported Word parts survive edits and cannot be silently deleted', async () => {
  const z = await JSZip.loadAsync(await createDocx(['Editable.']));
  z.file(
    'word/document.xml',
    (await z.file('word/document.xml').async('string')).replace(
      '<w:sectPr/>',
      '<w:p><w:r><w:drawing><kept xmlns="urn:test">original-image-reference</kept></w:drawing></w:r></w:p><w:sectPr/>',
    ),
  );
  z.file('word/media/image.bin', 'image bytes');
  z.file('word/header1.xml', '<kept>header</kept>');
  const w = new LocalWorkspace();
  await w.open(await z.generateAsync({ type: 'uint8array' }), 'complex.docx');
  let r = await w.inspect();
  assert.equal(r.editor.protectedCount, 1);
  r.editor.content.content[0].content = [text('Edited safely.')];
  await w.edit([{ type: 'document.replace', content: r.editor.content }]);
  const after = await JSZip.loadAsync(w.download());
  assert.equal(await after.file('word/header1.xml').async('string'), '<kept>header</kept>');
  assert.equal(await after.file('word/media/image.bin').async('string'), 'image bytes');
  assert.match(await after.file('word/document.xml').async('string'), /original-image-reference/);
  r = await w.inspect();
  r.editor.content.content.pop();
  const before = w.download();
  await assert.rejects(
    w.edit([{ type: 'document.replace', content: r.editor.content }]),
    /Protected Word content cannot be deleted/,
  );
  assert.deepEqual(w.download(), before);
});
test('citations can be inserted in an empty paragraph', async () => {
  const w = new LocalWorkspace();
  await w.create();
  const s = (await w.edit([{ type: 'source.upsert', source: paper }])).results[0].sourceId;
  const r = await w.edit([
    {
      type: 'citation.insert',
      items: [{ id: s }],
      anchor: { paragraphIndex: 0, paragraphText: '', endOffset: 0 },
    },
  ]);
  assert.equal(r.document.citations.length, 1);
  assert.equal((await inspectDocx(w.download())).issues.length, 0);
});
