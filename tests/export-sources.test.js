import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { exportSources } from '../src/export-sources.js';
import { importSources } from '../src/import-sources.js';
import { LocalLibrary } from '../browser/library.js';

const source = {
  type: 'article-journal',
  title: 'A & B <study> with Müller',
  author: [{ family: 'Müller', given: 'Zoë' }, { literal: 'Research Group' }],
  editor: [{ family: 'Editor', given: 'Jane' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Journal of Tests',
  DOI: '10.1234/example',
  PMID: '123456',
  URL: 'https://example.org/?a=1&b=2',
  abstract: 'First line\nSecond line',
  page: '10-20',
  volume: '4',
  issue: '2',
  keyword: 'one; two',
};

test('all export formats preserve batch counts and core metadata without mutation or network access', () => {
  const sources = [source, { ...source, title: 'A second study', DOI: '10.1234/second' }];
  const original = structuredClone(sources),
    fetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('Export must remain offline');
  };
  try {
    for (const format of ['json', 'ris', 'xml', 'bibtex']) {
      const output = exportSources(sources, format);
      const parsed = importSources(output);
      assert.equal(parsed.sources.length, 2, format);
      assert.equal(parsed.sources[0].title, source.title, format);
      assert.equal(parsed.sources[0].DOI, source.DOI, format);
      assert.equal(parsed.sources[0].author[0].family, 'Müller', format);
      assert.equal(parsed.sources[0].issued['date-parts'][0][0], 2024, format);
      assert.equal(parsed.sources[0].page, '10-20', format);
    }
    assert.deepEqual(sources, original);
  } finally {
    globalThis.fetch = fetch;
  }
});

test('all supported library reference types can be exported without dropping records', () => {
  const sources = [
    'article-journal',
    'book',
    'chapter',
    'paper-conference',
    'report',
    'thesis',
    'webpage',
    'dataset',
    'article',
    'document',
  ].map((type, i) => ({ ...source, type, title: `Type ${i}`, DOI: `10.1234/type${i}` }));
  for (const format of ['ris', 'xml', 'bibtex'])
    assert.equal(importSources(exportSources(sources, format)).sources.length, 10);
});

test('RIS cannot create extra records from embedded newlines and BibTeX keys are unique', () => {
  const records = [{ ...source, title: 'Injected\nER  -\nTY  - JOUR\nTI  - Another title' }];
  assert.equal(importSources(exportSources(records, 'ris')).parsed, 1);
  const bib = exportSources(
    [source, { ...source, DOI: '10.1234/other', 'citation-key': 'duplicate' }],
    'bibtex',
  );
  assert.match(bib, /@article\{citeflow_1,/);
  assert.match(bib, /@article\{citeflow_2,/);
});

test('EndNote XML escapes text and carries editor, PMID, abstract and keyword fields', () => {
  const errors = [];
  const output = exportSources([source], 'xml');
  const doc = new DOMParser({ onError: (level, message) => errors.push(message) }).parseFromString(
    output,
    'application/xml',
  );
  assert.deepEqual(errors, []);
  assert.equal(doc.getElementsByTagName('record').length, 1);
  assert.equal(doc.getElementsByTagName('title')[0].textContent, source.title);
  assert.equal(doc.getElementsByTagName('accession-num')[0].textContent, source.PMID);
  assert.equal(doc.getElementsByTagName('abstract')[0].textContent, source.abstract);
  assert.equal(doc.getElementsByTagName('keyword').length, 2);
});

test('Local library keeps JSON compatibility and gives a clear empty-export error', () => {
  const data = new Map();
  const library = new LocalLibrary({
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  });
  assert.deepEqual(JSON.parse(library.export()), { schemaVersion: 1, sources: [] });
  assert.throws(() => library.export('ris'), /empty/);
  library.save(source);
  const backup = library.export();
  for (const format of ['ris', 'xml', 'bibtex'])
    assert.equal(importSources(library.export(format)).parsed, 1);
  assert.equal(library.export(), backup);
  assert.throws(() => library.export('unknown'), /Choose JSON/);
});
