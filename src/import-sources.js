import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import { DOMParser } from '@xmldom/xmldom';
import { assert, normalizeSource, exactSourceKey } from './model.js';

const all = (node, tag) => Array.from(node.getElementsByTagName(tag));
const first = (node, tag) => all(node, tag)[0];
const value = (node, tag) => first(node, tag)?.textContent?.trim() || '';
const name = (text) => {
  if (text.endsWith(',')) return { literal: text.slice(0, -1).trim() };
  const parts = text.split(',').map((s) => s.trim());
  if (parts.length > 1) return { family: parts[0], given: parts.slice(1).join(', ') };
  const words = text.trim().split(/\s+/);
  return { family: words.pop(), given: words.join(' ') };
};
const year = (s) => {
  const y = s.match(/\b\d{4}\b/);
  return y ? { 'date-parts': [[Number(y[0])]] } : undefined;
};
const endnoteTypes = {
  17: 'article-journal',
  6: 'book',
  5: 'chapter',
  10: 'paper-conference',
  47: 'paper-conference',
  27: 'report',
  32: 'thesis',
  12: 'webpage',
  59: 'dataset',
  13: 'article',
};
function parseXML(raw) {
  assert(
    !/<!ENTITY/i.test(raw) && !/<!DOCTYPE[^>]*\[/is.test(raw),
    'XML entity declarations are not supported',
  );
  const errors = [];
  const doc = new DOMParser({ onError: (level, message) => errors.push(message) }).parseFromString(
    raw,
    'application/xml',
  );
  assert(!errors.length && doc.documentElement, 'Invalid XML: ' + errors[0]);
  if (['xml', 'records'].includes(doc.documentElement.tagName)) {
    return all(doc, 'record').map((r) => {
      const type = endnoteTypes[value(r, 'ref-type')];
      assert(type, 'Unsupported EndNote reference type: ' + value(r, 'ref-type'));
      const authors = first(r, 'authors'),
        editors = first(r, 'secondary-authors');
      return {
        type,
        title: value(r, 'title'),
        author: authors ? all(authors, 'author').map((a) => name(a.textContent.trim())) : undefined,
        editor: editors ? all(editors, 'author').map((a) => name(a.textContent.trim())) : undefined,
        issued: year(value(r, 'year')),
        'container-title': value(r, 'secondary-title'),
        volume: value(r, 'volume'),
        issue: value(r, 'number'),
        page: value(r, 'pages'),
        publisher: value(r, 'publisher'),
        'publisher-place': value(r, 'pub-location'),
        edition: value(r, 'edition'),
        [type === 'article-journal' ? 'ISSN' : 'ISBN']: value(r, 'isbn'),
        DOI: value(r, 'electronic-resource-num'),
        URL: value(r, 'url'),
        abstract: value(r, 'abstract'),
        keyword: all(r, 'keyword')
          .map((k) => k.textContent.trim())
          .join('; '),
      };
    });
  }
  assert(
    ['PubmedArticleSet', 'PubmedArticle'].includes(doc.documentElement.tagName),
    'Unsupported XML format. Use EndNote XML or PubMed XML.',
  );
  assert(
    !all(doc, 'PubmedBookArticle').length,
    'PubMed book records are not supported; export these as RIS or BibTeX.',
  );
  return all(doc, 'PubmedArticle').map((r) => {
    const article = first(r, 'Article');
    assert(article, 'PubMed record is missing Article');
    const journal = first(article, 'Journal');
    const ids = all(r, 'ArticleId');
    const doi =
      ids.find((i) => i.getAttribute('IdType') === 'doi')?.textContent ||
      all(article, 'ELocationID').find((i) => i.getAttribute('EIdType') === 'doi')?.textContent;
    return {
      type: 'article-journal',
      title: value(article, 'ArticleTitle'),
      author: all(article, 'Author').map((a) =>
        value(a, 'CollectiveName')
          ? { literal: value(a, 'CollectiveName') }
          : { family: value(a, 'LastName'), given: value(a, 'ForeName') || value(a, 'Initials') },
      ),
      issued: year(
        journal ? value(journal, 'Year') || value(journal, 'MedlineDate') : value(article, 'Year'),
      ),
      'container-title': journal ? value(journal, 'Title') : '',
      volume: journal ? value(journal, 'Volume') : '',
      issue: journal ? value(journal, 'Issue') : '',
      page: value(article, 'MedlinePgn'),
      ISSN: journal ? value(journal, 'ISSN') : '',
      DOI: doi,
      PMID: value(r, 'PMID'),
      abstract: all(article, 'AbstractText')
        .map((a) => a.textContent.trim())
        .join('\n'),
      keyword: all(r, 'Keyword')
        .map((k) => k.textContent.trim())
        .join('; '),
    };
  });
}

/** Offline, atomic import shared by the browser and local CLI/MCP. */
export function importSources(raw, format = 'auto') {
  assert(
    typeof raw === 'string' && new TextEncoder().encode(raw).length <= 5_000_000,
    'Reference file exceeds 5 MB',
  );
  raw = raw.replace(/^\uFEFF/, '').trim();
  assert(raw, 'Reference file is empty');
  if (format === 'auto')
    format = raw.startsWith('<')
      ? 'xml'
      : /^[\[{]/.test(raw)
        ? 'json'
        : /^TY\s+-/m.test(raw)
          ? 'ris'
          : 'bibtex';
  assert(['json', 'ris', 'bibtex', 'xml'].includes(format), 'Unsupported reference format');
  let records;
  if (format === 'xml') records = parseXML(raw);
  else if (format === 'json') {
    const parsed = JSON.parse(raw);
    records = Array.isArray(parsed)
      ? parsed
      : parsed.schemaVersion === 1
        ? parsed.sources
        : undefined;
  } else {
    if (format === 'ris') {
      const starts = raw.match(/^TY\s+-/gm) || [],
        ends = raw.match(/^ER\s+-/gm) || [];
      assert(
        starts.length && starts.length === ends.length,
        'Invalid RIS: each record requires TY and ER tags',
      );
    }
    records = new Cite(raw, { forceType: format === 'ris' ? '@ris/file' : '@biblatex/text' }).data;
  }
  assert(
    Array.isArray(records) && (records.length > 0 || format === 'json') && records.length <= 5000,
    'Expected 1–5000 references',
  );
  const sources = [],
    keys = new Set();
  records.forEach((record, i) => {
    try {
      const clean = { ...record };
      delete clean._graph;
      const source = normalizeSource(clean),
        key = exactSourceKey(source);
      if (!keys.has(key)) {
        keys.add(key);
        sources.push(source);
      }
    } catch (error) {
      throw new Error(`Reference ${i + 1}: ${error.message}`);
    }
  });
  return { format, sources, parsed: records.length, duplicates: records.length - sources.length };
}
