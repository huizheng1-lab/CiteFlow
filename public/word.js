/* global Office, Word */
const NS = 'https://digimatrix-labs.org/citeflow/v1',
  prefix = 'citeflow:citation:';
const $ = (s) => document.querySelector(s);
let snapshot,
  part,
  candidate,
  busy = false;
function message(s) {
  $('#status').textContent = s;
}
function asyncOffice(start) {
  return new Promise((resolve, reject) =>
    start((r) =>
      r.status === Office.AsyncResultStatus.Succeeded
        ? resolve(r.value)
        : reject(new Error(r.error.message)),
    ),
  );
}
async function call(method, args) {
  const r = await fetch('/api/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + $('#token').value },
    body: JSON.stringify({ method, args }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.result;
}
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
async function read() {
  const parts = await asyncOffice((cb) =>
    Office.context.document.customXmlParts.getByNamespaceAsync(NS, cb),
  );
  if (parts.length > 1)
    throw new Error('Multiple CiteFlow metadata parts; inspect document before editing');
  part = parts[0];
  if (part) {
    const value = await asyncOffice((cb) => part.getXmlAsync(cb));
    const root = new DOMParser().parseFromString(value, 'application/xml');
    snapshot = JSON.parse(root.documentElement.textContent);
  } else {
    snapshot = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title: 'Word manuscript',
      revision: 0,
      style: 'vancouver',
      sources: {},
      citations: [],
      bibliography: { id: crypto.randomUUID(), heading: 'References' },
    };
  }
}
async function persist(doc) {
  const value = `<citeflow xmlns="${NS}">${escape(JSON.stringify(doc))}</citeflow>`;
  if (part) {
    const nodes = await asyncOffice((cb) => part.getNodesAsync('/*', cb));
    if (nodes.length !== 1) throw new Error('Metadata root missing');
    await asyncOffice((cb) => nodes[0].setXmlAsync(value, cb));
  } else
    part = await asyncOffice((cb) => Office.context.document.customXmlParts.addAsync(value, cb));
  snapshot = doc;
}
async function reconcile() {
  await read();
  await Word.run(async (ctx) => {
    ctx.document.load('changeTrackingMode');
    const ooxml = ctx.document.body.getOoxml();
    const controls = ctx.document.body.contentControls;
    controls.load('items/tag,items/text');
    await ctx.sync();
    if (
      ctx.document.changeTrackingMode !== 'Off' ||
      /<w:(?:ins|del|moveFrom|moveTo)\b/.test(ooxml.value)
    )
      throw new Error(
        'Turn off Track Changes and resolve pending changes before this preview edits citations',
      );
    const list = controls.items.filter((c) => c.tag.startsWith(prefix));
    if (new Set(list.map((c) => c.tag)).size !== list.length)
      throw new Error('Duplicate anchors from copy/paste; repair required');
    const rendered = await call('documents.format', { document: snapshot });
    for (const c of list) {
      const id = c.tag.slice(prefix.length);
      if (!snapshot.citations.some((x) => x.id === id)) throw new Error('Unknown citation anchor');
      if (c.text !== rendered.citations[id])
        throw new Error('Citation text was changed manually; inspect the document before refresh');
    }
    snapshot.citations = list.map((c) =>
      snapshot.citations.find((x) => x.id === c.tag.slice(prefix.length)),
    );
  });
  $('#style').value = snapshot.style;
  drawSources();
}
async function commit(result, { insertId, bibliography = false } = {}) {
  const originalRevision = snapshot.revision;
  await read();
  if (snapshot.revision !== originalRevision) throw new Error('Document metadata changed; retry');
  // Office.js cannot atomically commit controls and custom XML. Failures must be inspected.
  try {
    await Word.run(async (ctx) => {
      if (insertId) {
        const c = ctx.document.getSelection().getRange('End').insertContentControl();
        c.tag = prefix + insertId;
        c.title = 'CiteFlow citation';
        c.insertText(result.rendered.citations[insertId], 'Replace');
      }
      if (bibliography) {
        const old = ctx.document.body.contentControls.getByTag('citeflow:bibliography');
        old.load('items');
        await ctx.sync();
        for (const c of old.items) c.delete(false);
        const c = ctx.document.getSelection().getRange('End').insertContentControl();
        c.tag = 'citeflow:bibliography';
        c.title = 'CiteFlow references';
        c.insertText(
          result.document.bibliography.heading + '\n' + result.rendered.bibliography.join('\n'),
          'Replace',
        );
      }
      const controls = ctx.document.body.contentControls;
      controls.load('items/tag');
      await ctx.sync();
      for (const c of controls.items) {
        if (c.tag.startsWith(prefix)) {
          const value = result.rendered.citations[c.tag.slice(prefix.length)];
          if (value === undefined) throw new Error('Unknown citation anchor');
          c.insertText(value, 'Replace');
        }
        if (c.tag === 'citeflow:bibliography')
          c.insertText(
            result.document.bibliography.heading + '\n' + result.rendered.bibliography.join('\n'),
            'Replace',
          );
      }
      await ctx.sync();
    });
    await persist(result.document);
    drawSources();
    message('Updated. Citation metadata is embedded in this Word file.');
  } catch (e) {
    message('Update interrupted. Inspect this copy before retrying: ' + e.message);
    throw e;
  }
}
function drawSources() {
  const el = $('#sources');
  el.replaceChildren();
  for (const source of Object.values(snapshot.sources)) {
    const b = document.createElement('button');
    b.className = 'wide';
    b.textContent = source.title;
    b.onclick = guard(async () => {
      await reconcile();
      await insertSource(source);
    });
    el.append(b);
  }
}
async function insertSource(source) {
  const s = await call('documents.compute', {
    document: snapshot,
    expectedRevision: snapshot.revision,
    operations: [{ type: 'source.upsert', source }],
  });
  const cid = crypto.randomUUID();
  const result = await call('documents.compute', {
    document: s.document,
    expectedRevision: s.document.revision,
    operations: [{ type: 'citation.insert', id: cid, items: [{ id: s.results[0].sourceId }] }],
  });
  await commit(result, { insertId: cid });
  /* A subsequent explicit refresh reconciles insertion order. */ await reconcile();
  const refreshed = await call('documents.compute', {
    document: snapshot,
    expectedRevision: snapshot.revision,
    operations: [],
  });
  await commit(refreshed);
}
function guard(fn) {
  return async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      message(e.message);
    } finally {
      busy = false;
    }
  };
}
$('#lookup').onclick = guard(async () => {
  message('Resolving metadata…');
  candidate = await call('sources.resolve', { input: $('#source').value });
  $('#candidate').textContent = candidate.source.title + ' · ' + candidate.warnings.join(' ');
  $('#insert').disabled = false;
  message('Check the title, then insert.');
});
$('#insert').onclick = guard(async () => {
  await reconcile();
  await insertSource({ ...candidate.source, _citeflow: candidate.provenance });
});
$('#refresh').onclick = guard(async () => {
  await reconcile();
  await commit(
    await call('documents.compute', {
      document: snapshot,
      expectedRevision: snapshot.revision,
      operations: [],
    }),
  );
});
$('#style').onchange = guard(async () => {
  const style = $('#style').value;
  await reconcile();
  await commit(
    await call('documents.compute', {
      document: snapshot,
      expectedRevision: snapshot.revision,
      operations: [{ type: 'style.set', style }],
    }),
  );
});
$('#bibliography').onclick = guard(async () => {
  await reconcile();
  await commit(
    await call('documents.compute', {
      document: snapshot,
      expectedRevision: snapshot.revision,
      operations: [],
    }),
    { bibliography: true },
  );
});
Office.onReady(
  guard(async () => {
    if (!Office.context.document.customXmlParts)
      throw new Error('This Word client does not expose custom XML parts required by this preview');
    const r = await fetch('/api/session');
    if (r.ok) $('#token').value = (await r.json()).token;
    await read();
    drawSources();
    message('Ready. Enter the server token if needed, then find a source.');
  }),
);
