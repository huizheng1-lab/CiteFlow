import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSources } from '../src/source-duplicates.js';
import { apply, newDocument, exactSourceKey } from '../src/model.js';
import { importSources } from '../src/import-sources.js';
const a = {
  type: 'article-journal',
  title: 'Attention is all you need',
  DOI: '10.1234/test',
  issued: { 'date-parts': [[2017]] },
};
test('exact duplicates ignore internal identifiers and citation keys', () => {
  const plan = reviewSources([a], [{ ...a, id: 'internal', 'citation-key': 'external' }, a]);
  assert.equal(plan.duplicates, 2);
  assert.equal(plan.incoming.length, 0);
});
test('same identifiers with differing metadata and similar titles require review', () => {
  const b = { ...a, issued: { 'date-parts': [[2018]] } };
  assert.notEqual(exactSourceKey(a), exactSourceKey(b));
  assert.equal(reviewSources([a], [b]).near[0].reason, 'Same DOI, different metadata');
  assert.equal(reviewSources([], [a, b]).near.length, 1);
  assert.equal(
    reviewSources([a], [{ ...a, DOI: '10.1234/other', title: 'Attention is all you need!' }]).near
      .length,
    1,
  );
  assert.equal(reviewSources([a], [{ type: 'book', title: 'An unrelated book' }]).near.length, 0);
  const result = importSources(JSON.stringify([a, b, a]));
  assert.equal(result.sources.length, 2);
  assert.equal(result.duplicates, 1);
});
test('explicitly selected metadata variants coexist but exact repetitions are reused', () => {
  const doc = newDocument();
  const one = apply(doc, { type: 'source.upsert', source: a, allowDuplicate: true });
  const two = apply(doc, {
    type: 'source.upsert',
    source: { ...a, issued: { 'date-parts': [[2018]] } },
    allowDuplicate: true,
  });
  assert.notEqual(one.sourceId, two.sourceId);
  assert.equal(
    apply(doc, { type: 'source.upsert', source: a, allowDuplicate: true }).sourceId,
    one.sourceId,
  );
  assert.equal(Object.keys(doc.sources).length, 2);
  apply(doc, { type: 'source.update', sourceId: two.sourceId, patch: { page: '10-12' } });
  assert.equal(doc.sources[two.sourceId].page, '10-12');
});
