import { assert, clone, apply } from './model.js';
import { format } from './format.js';
// Pure planner: the caller owns OAuth and the portable document snapshot.
// No bearer tokens, manuscript text, or credentials are persisted by this adapter.
export function googleRefreshPlan(googleDocument, snapshot, { repair = false } = {}) {
  assert(googleDocument.revisionId, 'A fresh Google Docs revisionId is required');
  const tabs = [];
  function walk(items) {
    for (const t of items || []) {
      if (t.documentTab) tabs.push(t);
      walk(t.childTabs);
    }
  }
  walk(googleDocument.tabs);
  if (!tabs.length && googleDocument.body)
    tabs.push({
      documentTab: { body: googleDocument.body, namedRanges: googleDocument.namedRanges || {} },
      tabProperties: { tabId: undefined },
    });
  const anchors = [],
    textSegments = [];
  function content(elements, tabId) {
    for (const e of elements || []) {
      if (e.paragraph)
        for (const r of e.paragraph.elements || [])
          if (r.textRun) {
            assert(
              !r.textRun.suggestedInsertionIds?.length && !r.textRun.suggestedDeletionIds?.length,
              'Resolve Google Docs suggestions before refreshing',
            );
            textSegments.push({
              start: r.startIndex,
              end: r.endIndex,
              text: r.textRun.content,
              tabId,
            });
          }
      if (e.table)
        for (const row of e.table.tableRows || [])
          for (const cell of row.tableCells || []) content(cell.content, tabId);
    }
  }
  for (const t of tabs) {
    const tabId = t.tabProperties.tabId;
    content(t.documentTab.body?.content, tabId);
    for (const [name, group] of Object.entries(t.documentTab.namedRanges || {})) {
      if (!name.startsWith('citeflow:')) continue;
      for (const n of group.namedRanges || []) {
        assert(n.ranges?.length === 1, 'Split citation anchor requires repair', 409);
        anchors.push({
          name,
          namedRangeId: n.namedRangeId,
          ...n.ranges[0],
          tabId: n.ranges[0].tabId || tabId,
        });
      }
    }
  }
  assert(
    new Set(anchors.map((a) => a.name)).size === anchors.length,
    'Duplicate Google Docs citation anchors',
    409,
  );
  const doc = clone(snapshot),
    before = format(doc);
  const ordered = anchors
    .filter((a) => a.name.startsWith('citeflow:citation:'))
    .sort(
      (a, b) =>
        tabs.findIndex((t) => t.tabProperties.tabId === a.tabId) -
          tabs.findIndex((t) => t.tabProperties.tabId === b.tabId) || a.startIndex - b.startIndex,
    );
  for (const a of ordered) {
    const cid = a.name.slice('citeflow:citation:'.length);
    assert(
      doc.citations.some((c) => c.id === cid),
      'Unknown citation anchor',
      409,
    );
    if (!repair) {
      const visible = textSegments
        .filter((t) => t.tabId === a.tabId && t.start < a.endIndex && t.end > a.startIndex)
        .map((t) =>
          t.text.slice(
            Math.max(0, a.startIndex - t.start),
            Math.min(t.text.length, a.endIndex - t.start),
          ),
        )
        .join('');
      assert(
        visible === before.citations[cid],
        'Citation text changed; inspect before using repair=true',
        409,
      );
    }
  }
  doc.citations = ordered.map((a) =>
    doc.citations.find((c) => c.id === a.name.slice('citeflow:citation:'.length)),
  );
  const rendered = format(doc),
    requests = [];
  // Descending offsets prevent an earlier replacement shifting a later anchor.
  for (const a of [...anchors].sort(
    (a, b) => String(a.tabId).localeCompare(String(b.tabId)) || b.startIndex - a.startIndex,
  )) {
    const value =
      a.name === 'citeflow:bibliography'
        ? doc.bibliography.heading + '\n' + rendered.bibliography.map((x) => x.trim()).join('\n')
        : rendered.citations[a.name.slice('citeflow:citation:'.length)];
    assert(typeof value === 'string', 'Unknown managed range');
    const range = {
      startIndex: a.startIndex,
      endIndex: a.endIndex,
      ...(a.tabId ? { tabId: a.tabId } : {}),
      ...(a.segmentId ? { segmentId: a.segmentId } : {}),
    };
    assert(range.endIndex > range.startIndex, 'Empty managed range', 409);
    requests.push(
      {
        deleteNamedRange: {
          namedRangeId: a.namedRangeId,
          ...(a.tabId ? { tabsCriteria: { tabIds: [a.tabId] } } : {}),
        },
      },
      { deleteContentRange: { range } },
      {
        insertText: {
          location: {
            index: a.startIndex,
            ...(a.tabId ? { tabId: a.tabId } : {}),
            ...(a.segmentId ? { segmentId: a.segmentId } : {}),
          },
          text: value,
        },
      },
      {
        createNamedRange: {
          name: a.name,
          range: { ...range, endIndex: a.startIndex + value.length },
        },
      },
    );
  }
  return {
    body: { writeControl: { requiredRevisionId: googleDocument.revisionId }, requests },
    document: doc,
    rendered,
  };
}
export async function refreshGoogleDocument(
  documentId,
  snapshot,
  { accessToken, fetcher = fetch, repair = false } = {},
) {
  assert(accessToken, 'Google OAuth access token is required');
  const base = 'https://docs.googleapis.com/v1/documents/' + encodeURIComponent(documentId);
  const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
  const r = await fetcher(base + '?includeTabsContent=true', { headers });
  assert(r.ok, 'Cannot read Google document: ' + r.status, r.status);
  const plan = googleRefreshPlan(await r.json(), snapshot, { repair });
  if (!plan.body.requests.length) return { ...plan, applied: false };
  const written = await fetcher(base + ':batchUpdate', {
    method: 'POST',
    headers,
    body: JSON.stringify(plan.body),
  });
  assert(
    written.ok,
    'Google revision conflict or update failure: ' + written.status,
    written.status === 400 ? 409 : written.status,
  );
  return { ...plan, applied: true, response: await written.json() };
}

export function googleEditPlan(googleDocument, snapshot, operations, { repair = false } = {}) {
  // First verify the existing anchors and reconcile deletions made in the editor.
  const checked = googleRefreshPlan(googleDocument, snapshot, { repair });
  const doc = clone(checked.document),
    tabs = [],
    segments = [],
    anchors = [];
  function walk(ts) {
    for (const t of ts || []) {
      if (t.documentTab) tabs.push(t);
      walk(t.childTabs);
    }
  }
  walk(googleDocument.tabs);
  if (!tabs.length)
    tabs.push({
      tabProperties: {},
      documentTab: { body: googleDocument.body, namedRanges: googleDocument.namedRanges || {} },
    });
  function read(content, tabId) {
    for (const e of content || []) {
      if (e.paragraph) {
        let text = '';
        const start = e.startIndex ?? e.paragraph.elements?.[0]?.startIndex;
        for (const r of e.paragraph.elements || []) text += r.textRun?.content || '';
        segments.push({ start, text, tabId });
      }
      if (e.table)
        for (const row of e.table.tableRows || [])
          for (const c of row.tableCells || []) read(c.content, tabId);
    }
  }
  for (const t of tabs) {
    const tabId = t.tabProperties.tabId;
    read(t.documentTab.body?.content, tabId);
    for (const [name, group] of Object.entries(t.documentTab.namedRanges || {}))
      if (name.startsWith('citeflow:'))
        for (const n of group.namedRanges || [])
          anchors.push({
            name,
            namedRangeId: n.namedRangeId,
            ...n.ranges[0],
            tabId: n.ranges[0].tabId || tabId,
          });
  }
  function locate(anchor) {
    assert(anchor?.exactText, 'anchor.exactText is required');
    const matches = [];
    for (const p of segments) {
      if (anchor.tabId && p.tabId !== anchor.tabId) continue;
      let from = 0,
        i;
      while ((i = p.text.indexOf(anchor.exactText, from)) >= 0) {
        matches.push({ index: p.start + i + anchor.exactText.length, tabId: p.tabId });
        from = i + 1;
      }
    }
    assert(matches.length === 1, 'Google text anchor must match exactly once', 409);
    const location = matches[0];
    assert(
      !anchors.some(
        (a) =>
          a.tabId === location.tabId &&
          location.index > a.startIndex &&
          location.index < a.endIndex,
      ),
      'Cannot insert inside another citation or reference list',
      409,
    );
    return location;
  }
  const changes = [],
    results = [];
  for (const op of operations) {
    if (op.type === 'citation.reorder')
      throw new Error('Move Google Docs text to reorder citations');
    if (op.type === 'bibliography.place') {
      assert(
        !anchors.some((a) => a.name === 'citeflow:bibliography'),
        'Reference list already exists; move its range in Docs',
      );
      const loc = locate(op.anchor);
      const a = {
        name: 'citeflow:bibliography',
        startIndex: loc.index,
        endIndex: loc.index,
        tabId: loc.tabId,
        isNew: true,
      };
      anchors.push(a);
      results.push({ placed: true });
      continue;
    }
    const result = apply(doc, op);
    results.push(result);
    if (op.type === 'citation.insert') {
      const loc = locate(op.anchor);
      anchors.push({
        name: 'citeflow:citation:' + result.citationId,
        startIndex: loc.index,
        endIndex: loc.index,
        tabId: loc.tabId,
        isNew: true,
      });
    }
    if (op.type === 'citation.remove') {
      const index = anchors.findIndex((a) => a.name === 'citeflow:citation:' + op.citationId);
      assert(index >= 0, 'Citation range missing', 409);
      changes.push({ ...anchors.splice(index, 1)[0], value: '' });
    }
  }
  const tabOrder = (a) => tabs.findIndex((t) => t.tabProperties.tabId === a.tabId);
  const order = anchors
    .filter((a) => a.name.startsWith('citeflow:citation:'))
    .sort((a, b) => tabOrder(a) - tabOrder(b) || a.startIndex - b.startIndex);
  doc.citations = order.map((a) =>
    doc.citations.find((c) => c.id === a.name.slice('citeflow:citation:'.length)),
  );
  doc.revision++;
  doc.updatedAt = new Date().toISOString();
  const rendered = format(doc);
  for (const a of anchors)
    changes.push({
      ...a,
      value:
        a.name === 'citeflow:bibliography'
          ? doc.bibliography.heading + '\n' + rendered.bibliography.map((s) => s.trim()).join('\n')
          : rendered.citations[a.name.slice('citeflow:citation:'.length)],
    });
  // A shared start offset would make batch insertion ordering ambiguous.
  assert(
    new Set(changes.map((a) => a.tabId + ':' + a.startIndex)).size === changes.length,
    'Overlapping insertion locations; apply edits separately',
    409,
  );
  const requests = [];
  for (const a of changes.sort(
    (a, b) => tabOrder(b) - tabOrder(a) || b.startIndex - a.startIndex,
  )) {
    const scope = {
      ...(a.tabId ? { tabId: a.tabId } : {}),
      ...(a.segmentId ? { segmentId: a.segmentId } : {}),
    };
    if (a.namedRangeId)
      requests.push({
        deleteNamedRange: {
          namedRangeId: a.namedRangeId,
          ...(a.tabId ? { tabsCriteria: { tabIds: [a.tabId] } } : {}),
        },
      });
    if (a.endIndex > a.startIndex)
      requests.push({
        deleteContentRange: { range: { ...scope, startIndex: a.startIndex, endIndex: a.endIndex } },
      });
    if (a.value) {
      requests.push(
        { insertText: { location: { ...scope, index: a.startIndex }, text: a.value } },
        {
          createNamedRange: {
            name: a.name,
            range: { ...scope, startIndex: a.startIndex, endIndex: a.startIndex + a.value.length },
          },
        },
      );
    }
  }
  return {
    body: { writeControl: { requiredRevisionId: googleDocument.revisionId }, requests },
    document: doc,
    rendered,
    results,
  };
}
export async function editGoogleDocument(
  documentId,
  snapshot,
  operations,
  { accessToken, fetcher = fetch, repair = false } = {},
) {
  assert(accessToken, 'Google OAuth access token is required');
  const base = 'https://docs.googleapis.com/v1/documents/' + encodeURIComponent(documentId),
    headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
  const read = await fetcher(base + '?includeTabsContent=true', { headers });
  assert(read.ok, 'Google document read failed: ' + read.status, read.status);
  const plan = googleEditPlan(await read.json(), snapshot, operations, { repair });
  if (!plan.body.requests.length) return { ...plan, applied: false };
  const response = await fetcher(base + ':batchUpdate', {
    method: 'POST',
    headers,
    body: JSON.stringify(plan.body),
  });
  assert(
    response.ok,
    'Google document update failed: ' + response.status,
    response.status === 400 ? 409 : response.status,
  );
  return { ...plan, applied: true, response: await response.json() };
}
