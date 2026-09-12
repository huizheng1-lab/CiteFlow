import test from 'node:test';
import assert from 'node:assert/strict';
import { googleRefreshPlan } from '../src/google-docs.js';
const snapshot = {
  schemaVersion: 1,
  style: 'vancouver',
  sources: { s: { id: 's', type: 'webpage', title: 'A page' } },
  citations: [{ id: 'c', items: [{ id: 's' }] }],
  bibliography: { heading: 'References' },
};
function google(text = '(1)') {
  return {
    revisionId: 'rev-7',
    tabs: [
      {
        tabProperties: { tabId: 'tab-a' },
        documentTab: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ startIndex: 1, endIndex: 4, textRun: { content: text } }],
                },
              },
            ],
          },
          namedRanges: {
            'citeflow:citation:c': {
              namedRanges: [
                { namedRangeId: 'n1', ranges: [{ startIndex: 1, endIndex: 4, tabId: 'tab-a' }] },
              ],
            },
          },
        },
      },
    ],
  };
}
test('Google refresh is revision-guarded and includes tab identity', () => {
  const plan = googleRefreshPlan(google(), snapshot);
  assert.equal(plan.body.writeControl.requiredRevisionId, 'rev-7');
  assert.equal(plan.body.requests[2].insertText.location.tabId, 'tab-a');
  assert.equal(plan.body.requests[3].createNamedRange.range.endIndex, 4);
});
test('Google does not silently overwrite manual changes or accept duplicate anchors', () => {
  assert.throws(() => googleRefreshPlan(google('abc'), snapshot), /text changed/);
  const g = google();
  g.tabs[0].documentTab.namedRanges['citeflow:citation:c'].namedRanges.push({
    namedRangeId: 'n2',
    ranges: [{ startIndex: 7, endIndex: 10 }],
  });
  assert.throws(() => googleRefreshPlan(g, snapshot), /Duplicate/);
});
import { googleEditPlan, editGoogleDocument } from '../src/google-docs.js';
test('Google agent inserts before an existing citation using UTF-16 offsets and renumbers', () => {
  const text = 'A😀 finding. (1)\n',
    start = text.indexOf('(1)') + 1;
  const g = {
    revisionId: 'revision',
    tabs: [
      {
        tabProperties: { tabId: 'tab' },
        documentTab: {
          body: {
            content: [
              {
                startIndex: 1,
                paragraph: {
                  elements: [
                    { startIndex: 1, endIndex: text.length + 1, textRun: { content: text } },
                  ],
                },
              },
            ],
          },
          namedRanges: {
            'citeflow:citation:c': {
              namedRanges: [
                {
                  namedRangeId: 'n',
                  ranges: [{ startIndex: start, endIndex: start + 3, tabId: 'tab' }],
                },
              ],
            },
          },
        },
      },
    ],
  };
  const d = { ...structuredClone(snapshot), revision: 0 };
  d.sources.b = { id: 'b', type: 'webpage', title: 'Second page' };
  const plan = googleEditPlan(g, d, [
    {
      type: 'citation.insert',
      id: 'new',
      items: [{ id: 'b' }],
      anchor: { exactText: 'A😀 finding.', tabId: 'tab' },
    },
  ]);
  assert.equal(plan.rendered.citations.new, '(1)');
  assert.equal(plan.rendered.citations.c, '(2)');
  assert.equal(plan.document.revision, 1);
  const insertion = plan.body.requests.find((r) => r.insertText?.text === '(1)').insertText;
  assert.equal(insertion.location.index, 1 + 'A😀 finding.'.length);
  let simulated = text;
  for (const r of plan.body.requests) {
    if (r.deleteContentRange) {
      const a = r.deleteContentRange.range;
      simulated = simulated.slice(0, a.startIndex - 1) + simulated.slice(a.endIndex - 1);
    }
    if (r.insertText) {
      const a = r.insertText;
      simulated =
        simulated.slice(0, a.location.index - 1) + a.text + simulated.slice(a.location.index - 1);
    }
  }
  assert.equal(simulated, 'A😀 finding.(1) (2)\n');
});
test('Google apply surfaces revision rejection instead of claiming success', async () => {
  let calls = 0;
  await assert.rejects(
    editGoogleDocument('doc', { ...snapshot, revision: 0 }, [], {
      accessToken: 'test',
      fetcher: async () =>
        ++calls === 1 ? { ok: true, json: async () => google() } : { ok: false, status: 400 },
    }),
    /update failed/,
  );
  assert.equal(calls, 2);
});
