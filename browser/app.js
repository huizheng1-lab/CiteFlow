import { LocalLibrary } from './library.js';
import { lookupSource } from './lookup.js';
import { insertionFromSelection } from './selection.js';
const $ = (s) => document.querySelector(s);
let worker,
  sequence = 0,
  state,
  anchor,
  dirty = false,
  busy = false,
  candidate,
  editing;
const pending = new Map(),
  library = new LocalLibrary();
function makeWorker() {
  worker = new Worker(new URL('./document-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
  };
  worker.onerror = () => {
    for (const p of pending.values())
      p.reject(new Error('Local document processor stopped. Reopen your original file.'));
    pending.clear();
  };
}
function local(method, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, ...args });
  });
}
function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
function enabled() {
  for (const e of document.querySelectorAll('[data-needs-doc]')) e.disabled = !state || busy;
  $('#undo').disabled = !state?.undoCount || busy;
  $('#lookup').disabled = busy;
  $('#file').disabled = busy;
}
const guard = (fn) => async (event) => {
  event?.preventDefault();
  if (busy) return;
  busy = true;
  enabled();
  try {
    await fn(event);
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
    enabled();
  }
};
function button(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = guard(fn);
  return b;
}
function paragraph(text, cls = 'hint') {
  const p = document.createElement('p');
  p.textContent = text;
  p.className = cls;
  return p;
}
function setAnchor(next) {
  anchor = next;
  for (const p of $('#preview').querySelectorAll('[data-paragraph]'))
    p.classList.toggle('selected', Number(p.dataset.paragraph) === anchor?.paragraphIndex);
  $('#insertion').textContent = anchor
    ? `Insert after: “…${anchor.paragraphText.slice(Math.max(0, anchor.endOffset - 100), anchor.endOffset)}”`
    : 'Choose an insertion point in the document.';
}
async function openFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.docx')) throw new Error('Choose a .docx Word file');
  if (file.size > 25_000_000) throw new Error('This version accepts documents up to 25 MB');
  if (dirty && !confirm('Discard changes that have not been downloaded?')) return;
  status('Opening locally…');
  const result = await local('open', {
    bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
  });
  state = result;
  dirty = false;
  setAnchor(null);
  draw();
  status('Opened locally. Select a citation position. No document was uploaded.');
}
async function edit(operations, options = {}) {
  status('Updating citations on this device…');
  state = await local('edit', { operations, options });
  dirty = true;
  setAnchor(null);
  draw();
  status('Updated locally. Download the Word file to save your changes.');
  return state;
}
function sourceCard(s, { saved = false } = {}) {
  const el = document.createElement('article');
  el.className = 'source';
  const h = document.createElement('h3');
  h.textContent = s.title;
  const p = paragraph(
    (s.author || []).map((a) => a.family || a.literal).join(', ') +
      ' · ' +
      (s.issued?.['date-parts']?.[0]?.[0] || 'Date missing'),
  );
  const actions = document.createElement('div');
  actions.className = 'actions';
  if (saved) {
    actions.append(
      button('Add to document', async () => {
        if (!state) throw new Error('Open a Word document first');
        await edit([{ type: 'source.upsert', source: s }]);
      }),
    );
  } else {
    actions.append(
      button('Cite here', async () => {
        if (!anchor) throw new Error('Select an insertion point in the manuscript first');
        await edit([
          {
            type: 'citation.insert',
            items: [{ id: s.id }],
            leadingSpace: !/\s/.test(anchor.paragraphText[anchor.endOffset - 1] || ' '),
            anchor: { ...anchor },
          },
        ]);
      }),
      button('Edit details', () => sourceEditor(s)),
      button('Save to library', () => {
        library.save(s);
        drawLibrary();
        status('Reference saved in this browser. Export a backup for safekeeping.');
      }),
    );
  }
  el.append(h, p, actions);
  return el;
}
function drawLibrary() {
  try {
    $('#library').replaceChildren(...library.read().map((s) => sourceCard(s, { saved: true })));
  } catch (e) {
    status(e.message, true);
  }
}
function draw() {
  $('#filename').textContent = state?.filename || 'No document open';
  $('#revision').textContent = state
    ? `Revision ${state.document.revision}${dirty ? ' · unsaved changes' : ''}`
    : '';
  $('#sources').replaceChildren();
  $('#citations').replaceChildren();
  $('#preview').replaceChildren();
  if (!state) {
    $('#preview').append(paragraph('Your manuscript will appear here.', 'empty'));
    drawLibrary();
    enabled();
    return;
  }
  $('#style').value = state.document.style;
  for (const p of state.paragraphs) {
    const el = paragraph(p.text, 'paragraph' + (p.managed ? ' managed' : ''));
    el.dataset.paragraph = p.index;
    if (!p.managed)
      el.onclick = () => {
        if (busy) return;
        const selection = insertionFromSelection(window.getSelection());
        setAnchor(
          !window.getSelection()?.isCollapsed &&
            selection?.paragraphIndex === p.index &&
            selection.endOffset > 0
            ? selection
            : { paragraphIndex: p.index, paragraphText: p.text, endOffset: p.text.length },
        );
      };
    $('#preview').append(el);
  }
  for (const s of Object.values(state.document.sources)) $('#sources').append(sourceCard(s));
  if (!Object.keys(state.document.sources).length)
    $('#sources').append(
      paragraph('No sources in this document yet. Add a URL or enter one manually.'),
    );
  for (const c of state.document.citations) {
    const el = document.createElement('article');
    el.className = 'citation';
    const h = document.createElement('h3');
    h.textContent = state.rendered.citations[c.id];
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Edit group / pages', () => citationEditor(c)),
      button('Remove', () => edit([{ type: 'citation.remove', citationId: c.id }])),
    );
    el.append(
      h,
      paragraph(
        c.items.map((x) => state.document.sources[x.id]?.title || 'Missing source').join(' · '),
      ),
      actions,
    );
    $('#citations').append(el);
  }
  drawLibrary();
  enabled();
}
function field(name, label, value = '', kind = 'input') {
  const l = document.createElement('label');
  l.textContent = label;
  const e = document.createElement(kind);
  e.dataset.field = name;
  e.value = value;
  l.append(e);
  $('#fields').append(l);
  return e;
}
function sourceEditor(source) {
  editing = { sourceId: source?.id, source: structuredClone(source || {}) };
  $('#editor-title').textContent = 'Reference details';
  $('#fields').replaceChildren();
  const type = field('type', 'Source type', '', 'select');
  for (const v of [
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
    o.value = v;
    o.textContent = v.replaceAll('-', ' ');
    type.append(o);
  }
  type.value = source?.type || 'article-journal';
  field('title', 'Title', source?.title || '');
  field(
    'author',
    'Authors · one per line: Family, Given; or organization name',
    (source?.author || [])
      .map((a) => a.literal || a.family + (a.given ? ', ' + a.given : ''))
      .join('\n'),
    'textarea',
  );
  field('year', 'Publication year', source?.issued?.['date-parts']?.[0]?.[0] || '').type = 'number';
  for (const [k, label] of [
    ['container-title', 'Journal / book title'],
    ['publisher', 'Publisher'],
    ['volume', 'Volume'],
    ['issue', 'Issue'],
    ['page', 'Pages'],
    ['DOI', 'DOI'],
    ['URL', 'Source URL'],
  ])
    field(k, label, source?.[k] || '');
  $('#editor').showModal();
}
function citationEditor(c) {
  editing = { citationId: c.id, items: structuredClone(c.items) };
  $('#editor-title').textContent = 'Citation group and pages';
  $('#fields').replaceChildren();
  for (const s of Object.values(state.document.sources)) {
    const old = c.items.find((x) => x.id === s.id),
      l = document.createElement('label');
    l.className = 'check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.dataset.source = s.id;
    check.checked = !!old;
    l.append(check, document.createTextNode(s.title));
    $('#fields').append(l);
    field('locator:' + s.id, 'Page / locator', old?.locator || '');
    const label = field('label:' + s.id, 'Locator type', '', 'select');
    for (const v of [
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
      o.value = v;
      o.textContent = v;
      label.append(o);
    }
    label.value = old?.label || 'page';
  }
  $('#editor').showModal();
}
$('#save-edit').onclick = guard(async () => {
  let op;
  if (editing.citationId) {
    const items = [...$('#fields').querySelectorAll('[data-source]:checked')].map((e) => {
      const sid = e.dataset.source,
        locator = $(`[data-field="locator:${sid}"]`).value;
      return {
        ...editing.items.find((x) => x.id === sid),
        id: sid,
        locator: locator || undefined,
        label: locator ? $(`[data-field="label:${sid}"]`).value : undefined,
      };
    });
    op = { type: 'citation.update', citationId: editing.citationId, items };
  } else {
    const values = {};
    for (const e of $('#fields').querySelectorAll('[data-field]'))
      values[e.dataset.field] = e.value.trim();
    const s = { ...editing.source, ...values };
    s.author = values.author
      .split('\n')
      .filter(Boolean)
      .map((a) =>
        a.includes(',')
          ? { family: a.split(',')[0].trim(), given: a.split(',').slice(1).join(',').trim() }
          : { literal: a },
      );
    s.issued = values.year
      ? Number(values.year) === editing.source.issued?.['date-parts']?.[0]?.[0]
        ? editing.source.issued
        : { 'date-parts': [[Number(values.year)]] }
      : null;
    delete s.year;
    op = editing.sourceId
      ? { type: 'source.update', sourceId: editing.sourceId, patch: s }
      : { type: 'source.upsert', source: s };
  }
  await edit([op]);
  $('#editor').close();
});
$('#cancel-edit').onclick = () => $('#editor').close();
$('#manual').onclick = guard(() => sourceEditor());
$('#file').onchange = guard(async (e) => {
  await openFile(e.target.files[0]);
  e.target.value = '';
});
$('#drop').ondragover = (e) => e.preventDefault();
$('#drop').ondrop = guard((e) => openFile(e.dataTransfer.files[0]));
$('#preview').onmouseup = () => {
  if (!busy) {
    const found = insertionFromSelection(window.getSelection());
    if (!window.getSelection()?.isCollapsed && found?.endOffset) setAnchor(found);
  }
};
$('#lookup').onclick = guard(async () => {
  if (localStorage.getItem('citeflow.offline') === 'true')
    throw new Error(
      'Offline mode is enabled. Use the local library or enter a reference manually.',
    );
  status('Looking up only the source identifier…');
  candidate = await lookupSource($('#url').value, {
    relay: localStorage.getItem('citeflow.relay') || '',
  });
  const el = $('#candidate');
  el.hidden = false;
  el.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = candidate.source.title;
  el.append(
    h,
    paragraph(candidate.provider + ' · Metadata only. ' + candidate.warnings.join(' ')),
    button('Add to document', async () => {
      if (!state) throw new Error('Open a document first');
      await edit([
        { type: 'source.upsert', source: { ...candidate.source, _citeflow: candidate.provenance } },
      ]);
      el.hidden = true;
    }),
    button('Save in local library', () => {
      library.save(candidate.source);
      drawLibrary();
      status('Saved locally.');
    }),
  );
  status('Review the source identity before adding it.');
});
$('#style').onchange = guard(() => edit([{ type: 'style.set', style: $('#style').value }]));
$('#undo').onclick = guard(async () => {
  state = await local('undo');
  dirty = true;
  setAnchor(null);
  draw();
  status('Restored the previous local revision.');
});
function download(bytes, name, type) {
  const u = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
$('#download').onclick = guard(async () => {
  const bytes = await local('download');
  download(
    bytes,
    state.filename.replace(/\.docx$/i, '') + '-cited.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  dirty = false;
  draw();
  status('Download requested. Keep the downloaded file to retain your changes.');
});
$('#handoff').onclick = () => $('#handoff-dialog').showModal();
$('#cancel-handoff').onclick = () => $('#handoff-dialog').close();
$('#handoff-target').onchange = () => {
  $('#handoff-details').textContent =
    $('#handoff-target').value === 'endnote'
      ? 'EndNote: import the included XML library, select Label for temporary citations, then update the whole document in Word. References are regenerated by EndNote. Page locators only.'
      : 'Mendeley: exports legacy Desktop citation fields with embedded sources. Try the document conversion offered by Mendeley Cite. If it does not recognize the document, this bridge needs further compatibility work.';
};
$('#download-handoff').onclick = guard(async () => {
  const target = $('#handoff-target').value;
  status('Preparing collaborator copy on this device…');
  const bytes = await local('exportHandoff', { target });
  download(
    bytes,
    state.filename.replace(/\.docx$/i, '') + '-' + target + '-handoff.zip',
    'application/zip',
  );
  $('#handoff-dialog').close();
  status(
    'Handoff ZIP downloaded. Read its instructions: add-in compatibility is experimental. Your CiteFlow document is unchanged.',
  );
});
$('#close').onclick = guard(async () => {
  if (dirty && !confirm('Close without downloading your changes?')) return;
  await local('close');
  worker.terminate();
  makeWorker();
  state = null;
  dirty = false;
  setAnchor(null);
  draw();
  status(
    'Document closed and local working memory released. Saved library references remain on this browser.',
  );
});
$('#bibliography').onclick = guard(() => edit([{ type: 'bibliography.place' }]));
$('#bibliography-here').onclick = guard(() => {
  if (!anchor) throw new Error('Select a paragraph first');
  return edit([
    {
      type: 'bibliography.place',
      anchor: { paragraphIndex: anchor.paragraphIndex, exactParagraph: anchor.paragraphText },
    },
  ]);
});
$('#refresh').onclick = guard(() => edit([]));
for (const name of ['sources', 'citations', 'library'])
  $('#tab-' + name).onclick = () => {
    for (const v of ['sources', 'citations', 'library']) {
      $('#' + v + '-panel').hidden = v !== name;
      $('#tab-' + v).classList.toggle('active', v === name);
    }
  };
$('#export-library').onclick = guard(() =>
  download(library.export(), 'citeflow-library.json', 'application/json'),
);
$('#import-library').onchange = guard(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5_000_000) throw new Error('Library backup exceeds 5 MB');
  const n = library.import(await file.text());
  drawLibrary();
  status(`Imported locally. ${n} saved references.`);
  e.target.value = '';
});
$('#clear-library').onclick = guard(() => {
  if (confirm('Clear saved references from this browser? Export a backup first.')) {
    library.clear();
    drawLibrary();
    status('Local library cleared.');
  }
});
$('#settings').onclick = () => {
  $('#relay').value = localStorage.getItem('citeflow.relay') || '';
  $('#offline').checked = localStorage.getItem('citeflow.offline') === 'true';
  $('#settings-dialog').showModal();
};
$('#cancel-settings').onclick = () => $('#settings-dialog').close();
$('#save-settings').onclick = guard(() => {
  const relay = $('#relay').value.trim();
  if (relay) {
    const u = new URL(relay);
    if (u.protocol !== 'https:' || u.username || u.password)
      throw new Error('Relay must be an HTTPS URL without credentials');
  }
  localStorage.setItem('citeflow.relay', relay);
  localStorage.setItem('citeflow.offline', String($('#offline').checked));
  $('#settings-dialog').close();
  status(
    $('#offline').checked
      ? 'Offline mode: source lookups are disabled.'
      : 'Lookup settings saved on this browser.',
  );
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
if (!globalThis.crypto?.randomUUID || !globalThis.Worker)
  status('This app requires a modern browser on HTTPS or localhost.', true);
else {
  makeWorker();
  draw();
}
