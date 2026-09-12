import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, safeURL, fromHTML, resolveSource } from '../src/resolver.js';
import { Store } from '../src/store.js';
test('resolver blocks private/reserved IPv4 and IPv6, including mapped IPv4', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert(publicAddress('8.8.8.8'));
  await assert.rejects(
    safeURL('http://example.com', async () => [{ address: '10.0.0.1', family: 4 }]),
    /blocked/,
  );
  await assert.rejects(safeURL('http://user:secret@example.com'), /credentials/);
  await assert.rejects(safeURL('file:///etc/passwd'), /HTTP/);
});
test('highwire metadata preserves accented names and page ranges', () => {
  const s = fromHTML(
    '<meta name="citation_title" content="Étude"><meta name="citation_author" content="García, Ana"><meta name="citation_journal_title" content="Medicine"><meta name="citation_publication_date" content="2024/02/03"><meta name="citation_firstpage" content="12"><meta name="citation_lastpage" content="19">',
    'https://example.com/paper',
  );
  assert.equal(s.type, 'article-journal');
  assert.deepEqual(s.author, [{ family: 'García', given: 'Ana' }]);
  assert.deepEqual(s.issued['date-parts'], [[2024, 2, 3]]);
  assert.equal(s.page, '12-19');
});
test('JSON-LD distinguishes book chapters from webpages', () => {
  const s = fromHTML(
    '<script type="application/ld+json">{"@type":"Chapter","name":"A chapter","author":{"name":"Jane Smith"},"datePublished":"2021"}</script>',
    'https://example.com/chapter',
  );
  assert.equal(s.type, 'chapter');
  assert.equal(s.title, 'A chapter');
});
test('DOI identity is checked and metadata cached for offline reuse', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return {
      body: JSON.stringify({
        message: {
          type: 'journal-article',
          DOI: '10.1234/test',
          title: ['Paper'],
          author: [{ family: 'Smith' }],
          published: { 'date-parts': [[2024]] },
        },
      }),
    };
  };
  const a = await resolveSource('10.1234/test', { fetcher, store }),
    b = await resolveSource('10.1234/test', {
      fetcher: () => {
        throw Error('offline');
      },
      store,
    });
  assert.equal(calls, 1);
  assert.equal(b.cached, true);
  assert.equal(a.provenance.supportsClaim, 'not-assessed');
  await assert.rejects(resolveSource('10.1234/other', { fetcher }), /did not match/);
  store.close();
});
test('metadata absence is explicit and does not invent dates/authors', async () => {
  const r = await resolveSource('https://example.com/page', {
    fetcher: async () => ({ contentType: 'text/html', body: '<title>A page</title>' }),
  });
  assert.equal(r.source.issued, undefined);
  assert.equal(r.warnings.length, 2);
  assert.equal(r.provenance.accessLevel, 'metadata-only');
});
test('remote CSL JSON record works and PDF extraction fails explicitly', async () => {
  const r = await resolveSource('https://example.com/ref.json', {
    fetcher: async () => ({
      contentType: 'application/json',
      body: '{"type":"book","title":"Book"}',
    }),
  });
  assert.equal(r.source.type, 'book');
  await assert.rejects(
    resolveSource('https://example.com/p.pdf', {
      fetcher: async () => ({ contentType: 'application/pdf', body: '%PDF' }),
    }),
    /PDF extraction/,
  );
});
