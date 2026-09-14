import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import { assert, normalizeSource } from './model.js';

export const exportFormats = {
  json: { extension: 'json', mimeType: 'application/json' },
  ris: { extension: 'ris', mimeType: 'application/x-research-info-systems' },
  xml: { extension: 'xml', mimeType: 'application/xml' },
  bibtex: { extension: 'bib', mimeType: 'application/x-bibtex' },
};
const names = (list = []) =>
  list.map((a) =>
    a.literal
      ? a.literal + ','
      : [a['non-dropping-particle'], a.family].filter(Boolean).join(' ') +
        (a.given ? ', ' + a.given : ''),
  );
const types = {
  'article-journal': ['JOUR', 17, 'Journal Article'],
  book: ['BOOK', 6, 'Book'],
  chapter: ['CHAP', 5, 'Book Section'],
  'paper-conference': ['CONF', 10, 'Conference Paper'],
  report: ['RPRT', 27, 'Report'],
  thesis: ['THES', 32, 'Thesis'],
  webpage: ['ELEC', 12, 'Web Page'],
  dataset: ['DATA', 59, 'Dataset'],
  article: ['GEN', 13, 'Generic'],
  document: ['GEN', 13, 'Generic'],
};
const keywords = (s) =>
  Array.isArray(s.keyword)
    ? s.keyword
    : String(s.keyword || '')
        .split(/;\s*/)
        .filter(Boolean);
const singleLine = (value) => String(value).replace(/[\r\n\u2028\u2029]+/g, ' ');
function risRecord(s, i) {
  const lines = [];
  const add = (tag, value) => {
    if (value !== undefined && value !== null && value !== '')
      lines.push(`${tag}  - ${singleLine(value)}`);
  };
  add('TY', types[s.type][0]);
  add('ID', 'citeflow_' + (i + 1));
  add('TI', s.title);
  for (const a of names(s.author)) add('AU', a);
  for (const e of names(s.editor)) add('A2', e);
  add('T2', s['container-title']);
  add('PY', s.issued?.['date-parts']?.[0]?.join('/'));
  for (const [tag, key] of [
    ['VL', 'volume'],
    ['IS', 'issue'],
    ['SP', 'page'],
    ['PB', 'publisher'],
    ['CY', 'publisher-place'],
    ['ET', 'edition'],
    ['DO', 'DOI'],
    ['UR', 'URL'],
    ['AB', 'abstract'],
    ['N1', 'note'],
  ])
    add(tag, s[key]);
  add('SN', s.ISBN || s.ISSN);
  add('AN', s.PMID);
  if (s.PMCID) add('N1', 'PMCID: ' + s.PMCID);
  for (const word of keywords(s)) add('KW', word);
  return lines.join('\r\n') + '\r\nER  -\r\n';
}
const esc = (v) =>
  String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const el = (tag, value) => (value == null || value === '' ? '' : `<${tag}>${esc(value)}</${tag}>`);
function xmlRecord(s, i) {
  const [, number, label] = types[s.type];
  return (
    `<record>${el('rec-number', i + 1)}<ref-type name="${label}">${number}</ref-type>` +
    `<contributors><authors>${names(s.author)
      .map((a) => el('author', a))
      .join('')}</authors>` +
    `<secondary-authors>${names(s.editor)
      .map((a) => el('author', a))
      .join('')}</secondary-authors></contributors>` +
    `<titles>${el('title', s.title)}${el('secondary-title', s['container-title'])}</titles>` +
    `<dates>${el('year', s.issued?.['date-parts']?.[0]?.[0])}<pub-dates>${el('date', s.issued?.['date-parts']?.[0]?.slice(1).join('/'))}</pub-dates></dates>` +
    el('volume', s.volume) +
    el('number', s.issue) +
    el('pages', s.page) +
    el('publisher', s.publisher) +
    el('pub-location', s['publisher-place']) +
    el('edition', s.edition) +
    el('isbn', s.ISBN || s.ISSN) +
    el('electronic-resource-num', s.DOI) +
    el('accession-num', s.PMID) +
    el('abstract', s.abstract) +
    el('notes', [s.note, s.PMCID && 'PMCID: ' + s.PMCID].filter(Boolean).join('\n')) +
    `<keywords>${keywords(s)
      .map((k) => el('keyword', k))
      .join('')}</keywords>` +
    `<urls><related-urls>${el('url', s.URL)}</related-urls></urls></record>`
  );
}

export function exportSources(input, format = 'json') {
  assert(Object.hasOwn(exportFormats, format), 'Choose JSON, RIS, EndNote XML, or BibTeX');
  assert(Array.isArray(input), 'A reference list is required');
  const sources = input.map(normalizeSource);
  if (format === 'json') return JSON.stringify({ schemaVersion: 1, sources }, null, 2);
  assert(
    sources.length,
    'The Local library is empty. Save references to the library before exporting.',
  );
  if (format === 'ris') return sources.map(risRecord).join('\r\n');
  if (format === 'xml')
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n<xml><records>' +
      sources.map(xmlRecord).join('\n') +
      '</records></xml>\n'
    );
  const records = sources.map((s, i) => ({
    ...s,
    id: 'citeflow_' + (i + 1),
    'citation-key': 'citeflow_' + (i + 1),
  }));
  return new Cite(records).format('bibtex');
}
