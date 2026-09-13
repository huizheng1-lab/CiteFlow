import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSources } from '../src/import-sources.js';
import { LocalLibrary } from '../browser/library.js';
import { FileAgent } from '../agent/api.js';
const ris =
  'TY  - CONF\nTI  - Study & results\nAU  - Smith, Jane\nPY  - 2024\nT2  - Proceedings\nSP  - 10\nEP  - 19\nDO  - 10.1234/test\nUR  - https://example.org/paper\nAB  - An abstract\nER  -';
const bib =
  '@string{journalname = "Journal of Tests"}\n@article{one,title={A {DNA} study},author={Smith, Jane and {Research Group}},year={2024},journal=journalname,doi={10.1234/test},abstract={An abstract},pages={10--19}}';
test('RIS preserves conference type, names, identifiers, abstract and pages', () => {
  const s = importSources('\uFEFF' + ris).sources[0];
  assert.equal(s.type, 'paper-conference');
  assert.equal(s.title, 'Study & results');
  assert.equal(s.author[0].family, 'Smith');
  assert.equal(s.page, '10-19');
  assert.equal(s.DOI, '10.1234/test');
  assert.equal(s.abstract, 'An abstract');
  assert.equal(s.URL, 'https://example.org/paper');
});
test('BibTeX handles nested braces, macros and corporate authors', () => {
  const s = importSources(bib).sources[0];
  assert.match(s.title, /DNA/);
  assert.equal(s['container-title'], 'Journal of Tests');
  assert.equal(s.author[1].family, 'Research Group');
  assert.equal(s.abstract, 'An abstract');
});
test('EndNote XML preserves styled text, entities, names and bibliographic fields', () => {
  const s = importSources(
    '<xml><records><record><ref-type name="Journal Article">17</ref-type><titles><title><style>A &amp; B</style></title><secondary-title>Journal</secondary-title></titles><contributors><authors><author>Smith, Jane</author></authors></contributors><dates><year>2024</year></dates><volume>12</volume><number>3</number><pages>10-19</pages><electronic-resource-num>10.1234/test</electronic-resource-num><abstract>Text</abstract></record></records></xml>',
  ).sources[0];
  assert.equal(s.title, 'A & B');
  assert.equal(s.issue, '3');
  assert.equal(s.author[0].given, 'Jane');
  assert.equal(s.issued['date-parts'][0][0], 2024);
});
test('PubMed XML uses article title, journal date, identifiers and collective authors', () => {
  const s = importSources(
    '<?xml version="1.0"?><!DOCTYPE PubmedArticleSet SYSTEM "https://example.org/no-fetch.dtd"><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><Journal><Title>Journal</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal><ArticleTitle>A <i>DNA</i> study</ArticleTitle><AuthorList><Author><CollectiveName>Study Group</CollectiveName></Author></AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1234/test</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>',
  ).sources[0];
  assert.equal(s.title, 'A DNA study');
  assert.equal(s.PMID, '123');
  assert.equal(s.DOI, '10.1234/test');
  assert.equal(s.author[0].literal, 'Study Group');
});
test('import deduplicates and failed imports preserve saved library atomically', () => {
  const data = new Map();
  const l = new LocalLibrary({ getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) });
  assert.equal(importSources(ris + '\n' + ris).duplicates, 1);
  l.import(ris);
  l.import(bib);
  assert.equal(l.read().length, 2); // Same DOI with different metadata remains available for review.
  const before = l.export();
  assert.throws(() => l.import(ris + '\nTY  - JOUR\nER  -'), /Reference 2/);
  assert.equal(l.export(), before);
});
test('empty, malformed, unsupported and entity XML fail clearly', () => {
  for (const text of [
    '',
    '<xml><record></xml>',
    '<something/>',
    '<!DOCTYPE xml [<!ENTITY x "abc">]><xml/>',
    'TY  - JOUR\nTI  - Incomplete',
  ])
    assert.throws(() => importSources(text));
});
test('offline agent imports a local file and enforces workspace boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'citeflow-import-'));
  await writeFile(join(root, 'refs.ris'), ris);
  const agent = new FileAgent(root);
  const result = await agent.call('sources_import', { input: 'refs.ris' });
  assert.equal(result.sources[0].DOI, '10.1234/test');
  await assert.rejects(agent.call('sources_import', { input: '/etc/hosts' }), /outside/);
});

test('mixed RIS batches preserve generic records alongside journal articles and books', () => {
  const raw = ['JOUR', 'GEN', 'BOOK']
    .map(
      (type, i) =>
        `TY  - ${type}\nTI  - Synthetic reference ${i}\nAU  - Example, Jane\nPY  - 2024\nER  -`,
    )
    .join('\n\n');
  for (const ending of ['\n', '\r\n', '\r']) {
    const result = importSources(raw.replaceAll('\n', ending));
    assert.equal(result.parsed, 3);
    assert.deepEqual(
      result.sources.map((s) => s.type),
      ['article-journal', 'document', 'book'],
    );
  }
});
