const $ = (s) => document.querySelector(s);
let token = sessionStorage.getItem('citeflow-token'),
  state,
  candidate,
  editing,
  rendered;
const status = (message, error = false) => {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
};
async function call(method, args = {}) {
  const r = await fetch('/api/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ method, args }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.result;
}
const guard = (fn) => async (e) => {
  e?.preventDefault();
  try {
    await fn(e);
  } catch (error) {
    status(error.message, true);
  }
};
function button(label, action) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = guard(action);
  return b;
}
async function list() {
  const docs = await call('documents.list');
  $('#documents').replaceChildren(
    ...docs.map((d) => {
      const b = button(d.title, () => open(d.id));
      b.className = 'wide' + (d.id === state?.id ? ' selected' : '');
      return b;
    }),
  );
  return docs;
}
async function open(documentId) {
  const result = await call('documents.inspect', { documentId });
  state = result.document;
  rendered = result.rendered;
  sessionStorage.setItem('citeflow-document', state.id);
  draw();
  await list();
  status(
    result.issues.length
      ? `${result.issues.length} metadata detail(s) need review. Missing details are never invented.`
      : 'All citation links are up to date.',
  );
}
async function edit(operations) {
  if (!state) throw new Error('Create a manuscript first');
  await call('documents.edit', {
    documentId: state.id,
    expectedRevision: state.revision,
    requestId: crypto.randomUUID(),
    operations,
  });
  await open(state.id);
}
function draw() {
  $('#title').textContent = state.title;
  $('#style').value = state.style;
  $('#revision').textContent = 'REVISION ' + state.revision;
  $('#source-count').textContent = Object.keys(state.sources).length;
  $('#citation-count').textContent = state.citations.length;
  $('#sources').replaceChildren();
  for (const s of Object.values(state.sources)) {
    const el = document.createElement('article');
    el.className = 'source';
    const title = document.createElement('h3');
    title.textContent = s.title;
    const meta = document.createElement('p');
    meta.textContent =
      (s.author || []).map((a) => a.family || a.literal).join(', ') +
      ' · ' +
      (s.issued?.['date-parts']?.[0]?.[0] || 'Date missing') +
      ' · ' +
      (s['container-title'] || s.type);
    const actions = document.createElement('div');
    actions.className = 'toolbar';
    actions.append(
      button('＋ Cite', () => edit([{ type: 'citation.insert', items: [{ id: s.id }] }])),
      button('Edit details', () => editor(s)),
    );
    if (s.URL) {
      const a = document.createElement('a');
      a.textContent = 'Open source ↗';
      a.href = s.URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'small';
      actions.append(a);
    }
    el.append(title, meta, actions);
    $('#sources').append(el);
  }
  if (!Object.keys(state.sources).length)
    $('#sources').append(empty('Your sources will appear here. Start with a link above.'));
  $('#citations').replaceChildren();
  state.citations.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'citation';
    const label = document.createElement('strong');
    label.textContent = rendered.citations[c.id];
    const details = document.createElement('p');
    details.className = 'small';
    details.textContent = c.items.map((x) => state.sources[x.id].title).join(' · ');
    const actions = document.createElement('div');
    actions.className = 'toolbar';
    actions.append(
      button('Edit group / pages', () => editCitation(c)),
      button('Remove', () => edit([{ type: 'citation.remove', citationId: c.id }])),
    );
    if (i)
      actions.append(
        button('↑ Move up', () => {
          const ids = state.citations.map((x) => x.id);
          [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
          return edit([{ type: 'citation.reorder', ids }]);
        }),
      );
    el.append(label, details, actions);
    $('#citations').append(el);
  });
  if (!state.citations.length)
    $('#citations').append(empty('Choose “Cite” on a source to create an occurrence.'));
  $('#bibliography').replaceChildren(
    ...rendered.bibliography.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }),
  );
}
function empty(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}
function field(name, label, value = '', type = 'text') {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.dataset.field = name;
  input.value = value;
  input.style.width = '100%';
  if (type === 'number') input.type = 'number';
  wrap.append(input);
  $('#fields').append(wrap);
  return input;
}
function sourceFields(value) {
  $('#fields').replaceChildren();
  const label = document.createElement('label');
  label.textContent = 'Source type';
  const select = document.createElement('select');
  select.dataset.field = 'type';
  for (const type of [
    'article-journal',
    'webpage',
    'book',
    'chapter',
    'report',
    'dataset',
    'paper-conference',
    'thesis',
    'article',
  ]) {
    const o = document.createElement('option');
    o.value = type;
    o.textContent = type.replaceAll('-', ' ');
    select.append(o);
  }
  select.value = value.type || 'article-journal';
  label.append(select);
  $('#fields').append(label);
  field('title', 'Title', value.title);
  field(
    'author',
    'Authors · one per line: Family, Given; or organization name',
    (value.author || [])
      .map((a) => a.literal || a.family + (a.given ? ', ' + a.given : ''))
      .join('\n'),
    'textarea',
  );
  field('year', 'Publication year', value.issued?.['date-parts']?.[0]?.[0] || '', 'number');
  for (const [name, label] of [
    ['container-title', 'Journal / book title'],
    ['publisher', 'Publisher'],
    ['volume', 'Volume'],
    ['issue', 'Issue'],
    ['page', 'Pages'],
    ['DOI', 'DOI'],
    ['URL', 'Source URL'],
  ])
    field(name, label, value[name] || '');
}
function editor(s) {
  editing = { sourceId: s?.id, original: s ? structuredClone(s) : {} };
  const value = s ? structuredClone(s) : { type: 'article-journal', title: '', author: [] };
  delete value.id;
  $('#edit-title').textContent = 'Source details';
  $('#json').value = JSON.stringify(value, null, 2);
  sourceFields(value);
  $('#editor').showModal();
}
function citationFields(items) {
  $('#fields').replaceChildren();
  for (const s of Object.values(state.sources)) {
    const old = items.find((x) => x.id === s.id),
      label = document.createElement('label'),
      check = document.createElement('input');
    check.type = 'checkbox';
    check.dataset.source = s.id;
    check.checked = !!old;
    label.append(check, document.createTextNode(' ' + s.title));
    $('#fields').append(label);
    const locator = field('locator:' + s.id, 'Page or other locator', old?.locator || '');
    locator.dataset.locator = s.id;
    const kind = document.createElement('select');
    kind.dataset.label = s.id;
    for (const k of [
      'page',
      'chapter',
      'section',
      'figure',
      'table',
      'paragraph',
      'volume',
      'issue',
    ]) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k;
      kind.append(o);
    }
    kind.value = old?.label || 'page';
    $('#fields').append(kind);
  }
}
function editCitation(c) {
  editing = { citationId: c.id, items: structuredClone(c.items) };
  $('#edit-title').textContent = 'Edit citation group';
  $('#json').value = JSON.stringify(c.items, null, 2);
  citationFields(c.items);
  $('#editor').showModal();
}
$('#load-json').onclick = guard(() => {
  const value = JSON.parse($('#json').value);
  if (editing.citationId) {
    editing.items = value;
    citationFields(value);
  } else {
    editing.original = value;
    sourceFields(value);
  }
});
$('#save-json').onclick = guard(async () => {
  let op;
  if (editing.citationId) {
    const items = [...$('#fields').querySelectorAll('input[data-source]:checked')].map((input) => {
      const sid = input.dataset.source,
        old = editing.items.find((x) => x.id === sid) || {},
        locator = $('#fields').querySelector('[data-locator="' + sid + '"]').value,
        label = $('#fields').querySelector('[data-label="' + sid + '"]').value;
      return { ...old, id: sid, locator: locator || undefined, label: locator ? label : undefined };
    });
    op = { type: 'citation.update', citationId: editing.citationId, items };
  } else {
    const values = {};
    for (const input of $('#fields').querySelectorAll('[data-field]'))
      values[input.dataset.field] = input.value.trim();
    const source = { ...editing.original, ...values };
    source.author = values.author
      .split('\n')
      .filter(Boolean)
      .map((name) =>
        name.includes(',')
          ? { family: name.split(',')[0].trim(), given: name.split(',').slice(1).join(',').trim() }
          : { literal: name },
      );
    source.issued = values.year
      ? Number(values.year) === editing.original.issued?.['date-parts']?.[0]?.[0]
        ? editing.original.issued
        : { 'date-parts': [[Number(values.year)]] }
      : null;
    delete source.year;
    op = editing.sourceId
      ? { type: 'source.update', sourceId: editing.sourceId, patch: source }
      : { type: 'source.upsert', source };
  }
  await edit([op]);
  $('#editor').close();
});
$('#resolve').onsubmit = guard(async () => {
  if (!state) throw new Error('Create a manuscript first');
  status('Looking up source metadata…');
  const b = $('#resolve button');
  b.disabled = true;
  try {
    candidate = await call('sources.resolve', { input: $('#url').value });
    const el = $('#candidate');
    el.hidden = false;
    el.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = candidate.source.title;
    const p = document.createElement('p');
    p.className = 'small';
    p.textContent =
      candidate.provenance.provider +
      ' · ' +
      candidate.provenance.accessLevel +
      '\n' +
      candidate.warnings.join(' ');
    el.append(
      h,
      p,
      button('Save to manuscript', async () => {
        await edit([
          {
            type: 'source.upsert',
            source: { ...candidate.source, _citeflow: candidate.provenance },
          },
        ]);
        el.hidden = true;
        $('#url').value = '';
      }),
    );
    status('Review the source, then save it.');
  } finally {
    b.disabled = false;
  }
});
$('#new').onclick = guard(async () => {
  const title = prompt('Manuscript title');
  if (title?.trim()) {
    const d = await call('documents.create', { title: title.trim() });
    await open(d.id);
  }
});
$('#manual').onclick = guard(() => {
  if (!state) throw new Error('Create a manuscript first');
  editor();
});
$('#style').onchange = guard(() => edit([{ type: 'style.set', style: $('#style').value }]));
$('#undo').onclick = guard(async () => {
  if (!state?.revision) return;
  await call('documents.restore', {
    documentId: state.id,
    expectedRevision: state.revision,
    targetRevision: state.revision - 1,
  });
  await open(state.id);
});
$('#copy').onclick = guard(async () => {
  if (!rendered) return;
  await navigator.clipboard.writeText(rendered.bibliography.join('\n'));
  status('Reference list copied as text.');
});
$('#export').onclick = guard(() => {
  if (!state) return;
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = u;
  a.download = 'citeflow-document.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
});
$('#import').onchange = guard(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const d = await call('documents.import', { document: JSON.parse(await file.text()) });
  await open(d.id);
});
for (const tab of ['sources', 'citations'])
  $('#tab-' + tab).onclick = () => {
    for (const other of ['sources', 'citations']) {
      $('#' + other).hidden = tab !== other;
      $('#tab-' + other).classList.toggle('active', tab === other);
    }
  };
$('#connect').onclick = guard(async () => {
  const value = prompt('Server access token');
  if (value) {
    token = value;
    sessionStorage.setItem('citeflow-token', token);
    await init();
  }
});
async function init() {
  if (!token) {
    const r = await fetch('/api/session');
    if (r.ok) token = (await r.json()).token;
    else {
      status('Use Server access to enter your deployment token.');
      return;
    }
  }
  const docs = await list();
  const old = sessionStorage.getItem('citeflow-document');
  if (docs.length) await open(docs.some((d) => d.id === old) ? old : docs[0].id);
}
await guard(init)();
