import JSZip from 'jszip';
import { createDocx } from '../../src/docx.js';

export const paper = {
  id: 'external-1',
  type: 'article-journal',
  title: 'Synthetic Mendeley study',
  author: [{ family: 'Källberg', given: 'Zoë' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Test Journal',
};
export const citation = (items = [{ id: paper.id, itemData: paper }]) => ({
  citationID: 'MENDELEY_CITATION_synthetic',
  properties: { noteIndex: 0 },
  isEdited: false,
  manualOverride: { isManuallyOverridden: false },
  citationItems: items,
});
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export async function mendeleyDocx(payloads = [citation()], options = {}) {
  const zip = await JSZip.loadAsync(await createDocx(['Before citation.']));
  const control = (tag, content) =>
    `<w:sdt><w:sdtPr><w:tag w:val="${escape(tag)}"/><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  const inline = payloads
    .map((payload, i) =>
      control(
        typeof payload === 'string'
          ? payload
          : 'MENDELEY_CITATION_v3_' + Buffer.from(JSON.stringify(payload)).toString('base64'),
        `<w:r><w:t>(${i + 1})</w:t></w:r>`,
      ),
    )
    .join('<w:r><w:t> and </w:t></w:r>');
  let raw = await zip.file('word/document.xml').async('string');
  raw = raw.replace('</w:p>', `${inline}<w:r><w:t> After citation.</w:t></w:r></w:p>`);
  if (options.bibliography !== false)
    raw = raw.replace(
      '<w:sectPr/>',
      control('MENDELEY_BIBLIOGRAPHY', '<w:p><w:r><w:t>Old bibliography</w:t></w:r></w:p>') +
        '<w:sectPr/>',
    );
  if (options.transform) raw = options.transform(raw);
  zip.file('word/document.xml', raw);
  zip.file('customXml/unrelated.xml', '<preserve>Unrelated metadata</preserve>');
  if (options.footnotes) zip.file('word/footnotes.xml', '<footnotes>MENDELEY_CITATION</footnotes>');
  return zip.generateAsync({ type: 'uint8array' });
}
