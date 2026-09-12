import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { format } from '../src/format.js';
const paper = (title = 'Alpha', year = 2024) => ({
  type: 'article-journal',
  title,
  author: [{ family: 'Smith', given: 'Jane' }],
  issued: { 'date-parts': [[year]] },
  'container-title': 'Journal of Testing',
  volume: '12',
  issue: '2',
  page: '10-20',
});
function setup(style = 'vancouver') {
  const s = new Store(':memory:');
  let d = s.create('Test', style),
    seq = 0;
  const edit = (operations) => {
    const r = s.transact(d.id, {
      expectedRevision: d.revision,
      requestId: String(seq++),
      operations,
    });
    d = r.document;
    return r;
  };
  return {
    s,
    get d() {
      return d;
    },
    edit,
  };
}
test('CSL numbers follow citation order; repeats share one bibliography entry', () => {
  const x = setup();
  const a = x.edit([{ type: 'source.upsert', source: paper('Alpha') }]).results[0].sourceId,
    b = x.edit([{ type: 'source.upsert', source: paper('Beta') }]).results[0].sourceId;
  x.edit([
    { type: 'citation.insert', id: 'first', items: [{ id: a }] },
    { type: 'citation.insert', id: 'second', items: [{ id: b }] },
    { type: 'citation.insert', id: 'repeat', items: [{ id: a }] },
  ]);
  const f = format(x.d);
  assert.equal(f.citations.first, '(1)');
  assert.equal(f.citations.repeat, '(1)');
  assert.equal(f.bibliography.length, 2);
  x.edit([{ type: 'citation.reorder', ids: ['second', 'first', 'repeat'] }]);
  assert.equal(format(x.d).citations.second, '(1)');
  x.s.close();
});
test('final occurrence removal omits bibliography but keeps reusable source', () => {
  const x = setup();
  const a = x.edit([{ type: 'source.upsert', source: paper() }]).results[0].sourceId;
  x.edit([{ type: 'citation.insert', id: 'c', items: [{ id: a }] }]);
  x.edit([{ type: 'citation.remove', citationId: 'c' }]);
  assert.equal(format(x.d).bibliography.length, 0);
  assert(x.d.sources[a]);
  x.s.close();
});
test('DOI deduplication reuses identity without silently overwriting metadata', () => {
  const x = setup();
  const a = x.edit([
    { type: 'source.upsert', source: { ...paper(), DOI: 'https://doi.org/10.1234/ABC' } },
  ]).results[0];
  const b = x.edit([{ type: 'source.upsert', source: { ...paper('Changed'), DOI: '10.1234/abc' } }])
    .results[0];
  assert.equal(a.sourceId, b.sourceId);
  assert.equal(x.d.sources[a.sourceId].title, 'Alpha');
  x.s.close();
});
test('APA disambiguates same-author same-year works and refreshes previous citations', () => {
  const x = setup('apa');
  const a = x.edit([{ type: 'source.upsert', source: paper('Alpha') }]).results[0].sourceId,
    b = x.edit([{ type: 'source.upsert', source: paper('Beta') }]).results[0].sourceId;
  x.edit([
    { type: 'citation.insert', id: 'a', items: [{ id: a }] },
    { type: 'citation.insert', id: 'b', items: [{ id: b }] },
  ]);
  const f = format(x.d);
  assert.match(f.citations.a, /2024a/);
  assert.match(f.citations.b, /2024b/);
  x.s.close();
});
test('citation locators and groups survive style changes', () => {
  const x = setup('apa');
  const a = x.edit([{ type: 'source.upsert', source: paper() }]).results[0].sourceId;
  x.edit([{ type: 'citation.insert', id: 'a', items: [{ id: a, locator: '12', label: 'page' }] }]);
  assert.match(format(x.d).citations.a, /p\. 12/);
  x.edit([{ type: 'style.set', style: 'vancouver' }]);
  assert.equal(x.d.citations[0].items[0].locator, '12');
  x.s.close();
});
test('idempotent retries and stale writes have distinct semantics', () => {
  const x = setup();
  const args = {
    expectedRevision: 0,
    requestId: 'same',
    operations: [{ type: 'source.upsert', source: paper() }],
  };
  const first = x.s.transact(x.d.id, args),
    second = x.s.transact(x.d.id, args);
  assert.equal(first.document.revision, second.document.revision);
  assert.equal(second.replayed, true);
  assert.throws(
    () => x.s.transact(x.d.id, { ...args, operations: [{ type: 'style.set', style: 'apa' }] }),
    /already used/,
  );
  assert.throws(() => x.s.transact(x.d.id, { ...args, requestId: 'other' }), /changed/);
  x.s.close();
});
test('a failed batch rolls back all earlier operations', () => {
  const x = setup();
  assert.throws(() =>
    x.edit([
      { type: 'source.upsert', source: paper() },
      { type: 'citation.insert', items: [{ id: 'missing' }] },
    ]),
  );
  assert.equal(x.s.get(x.d.id).revision, 0);
  assert.deepEqual(x.s.get(x.d.id).sources, {});
  x.s.close();
});
test('restore creates a new revision and does not rewrite history', () => {
  const x = setup();
  x.edit([{ type: 'style.set', style: 'apa' }]);
  const d = x.s.restore(x.d.id, 1, 0);
  assert.equal(d.style, 'vancouver');
  assert.equal(d.revision, 2);
  assert.equal(x.s.get(x.d.id).revision, 2);
  x.s.close();
});
test('portable import retains stable source and occurrence identities', () => {
  const x = setup();
  const sid = x.edit([{ type: 'source.upsert', source: paper() }]).results[0].sourceId;
  x.edit([{ type: 'citation.insert', id: 'cid', items: [{ id: sid }] }]);
  const imported = x.s.import(x.d);
  assert.notEqual(imported.id, x.d.id);
  assert.equal(imported.citations[0].items[0].id, sid);
  assert.deepEqual(format(imported), format(x.d));
  x.s.close();
});
test('incomplete metadata stays visible and URL scripts are rejected', () => {
  const x = setup();
  const r = x.edit([{ type: 'source.upsert', source: { type: 'webpage', title: 'Page' } }]);
  assert(r.issues.some((x) => x.code === 'missing-year'));
  assert.throws(() =>
    x.edit([
      {
        type: 'source.upsert',
        source: { type: 'webpage', title: 'Page', URL: 'javascript:alert(1)' },
      },
    ]),
  );
  x.s.close();
});
