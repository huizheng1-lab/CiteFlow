import { exactSourceKey } from '../src/model.js';
import { WordEditor } from './word-editor.js';
import { reviewSources } from '../src/source-duplicates.js';
import { importSources } from '../src/import-sources.js';
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
  worker = new Worker(new URL('./document-worker.js?v=0.6.2', import.meta.url), { type: 'module' });
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
const wordEditor = new WordEditor($('#preview'), {
  change: () => {
    dirty = true;
    status('Editing locally. Download the Word file to save your changes.');
    enabled();
  },
  selection: (next) => setAnchor(next),
  problem: (message) => status(message, true),
});
async function flushTextEdits() {
  if (!wordEditor.changed) return;
  const result = await local('edit', {
    operations: [{ type: 'document.replace', content: wordEditor.json() }],
  });
  state = result;
  dirty = true;
  draw();
  setAnchor(wordEditor.anchor());
}
function enabled() {
  for (const e of document.querySelectorAll('[data-needs-doc]')) e.disabled = !state || busy;
  $('#undo').disabled = (!state?.undoCount && !wordEditor.changed) || busy;
  $('#redo').disabled = (!state?.redoCount && !wordEditor.changed) || busy;
  $('#lookup').disabled = busy;
  $('#file').disabled = busy;
}
const guard = (fn) => async (event) => {
  event?.preventDefault();
  if (busy) return;
  busy = true;
  enabled();
  try {
    wordEditor.setEditable(false);
    await flushTextEdits();
    await fn(event);
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
    wordEditor.setEditable(true);
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

  $('#insertion').textContent = anchor
    ? `Insert after: “…${anchor.paragraphText.slice(Math.max(0, anchor.endOffset - 100), anchor.endOffset)}”`
    : 'Choose an insertion point in the document.';
}
async function openFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.docx')) throw new Error('Choose a .docx Word file');
  if (file.size > 100_000_000) throw new Error('This version accepts documents up to 100 MB');
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
  status(
    result.editor.editable
      ? 'Opened locally. Type in the document to edit it. Protected Word content is preserved.'
      : 'This document has tracked changes. Accept them in a copy before editing.',
  );
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
async function includeSavedSource(source) {
  return includeSavedSources([source]);
}
async function includeSavedSources(sources) {
  if (!state) throw new Error('Open a Word document first');
  const existing = Object.values(state.document.sources);
  const plan = reviewSources(existing, sources);
  const commit = async (selected) => {
    if (selected.length)
      await edit(
        selected.map((source) => ({ type: 'source.upsert', source, allowDuplicate: true })),
      );
    status(
      selected.length
        ? `${selected.length} references included in resources. Select an insertion point and use Cite here under Sources.`
        : 'No new resources included.',
    );
  };
  if (!plan.incoming.length) {
    status('This reference is already included in resources. Exact duplicates are reused.');
  } else if (plan.near.length) reviewEditor(plan, commit, 'resources');
  else await commit(plan.incoming);
}
async function saveToLibrary(sources) {
  const plan = reviewSources(library.read(), sources);
  const commit = async (selected) => {
    const n = library.include(selected);
    drawLibrary();
    status(`${n} saved references. ${plan.duplicates} exact duplicates skipped.`);
  };
  if (plan.near.length) reviewEditor(plan, commit, 'the Local library');
  else await commit(plan.incoming);
}
function reviewEditor(plan, commit, target) {
  editing = { review: { plan, commit } };
  $('#editor-title').textContent = 'Review nearly identical references';
  $('#save-edit').textContent = 'Keep selected';
  $('#fields').replaceChildren(
    paragraph(
      `Exact duplicates have been skipped automatically. Select new references to keep in ${target}. Existing entries remain unchanged.`,
    ),
  );
  const nearIndices = new Set(plan.near.flatMap((match) => match.incomingIndices));
  plan.incoming.forEach((source, index) => {
    const label = document.createElement('label');
    label.className = 'check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.dataset.reviewSource = String(index);
    check.checked = !nearIndices.has(index);
    label.append(check, document.createTextNode(sourceSummary(source)));
    $('#fields').append(label);
    for (const match of plan.near.filter((m) => m.incomingIndices.includes(index))) {
      $('#fields').append(
        paragraph(
          match.reason +
            (match.existingSource
              ? ' — Already present: ' + sourceSummary(match.existingSource)
              : ' — Similar to another new reference shown here.'),
        ),
      );
    }
  });
  $('#editor').showModal();
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
    const label = document.createElement('label');
    label.className = 'check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.dataset.librarySource = exactSourceKey(s);
    check.setAttribute('aria-label', 'Select ' + s.title);
    label.append(check, document.createTextNode('Select'));
    actions.append(
      label,
      button('Include in resources', () => includeSavedSource(s)),
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
      button('Save to library', () => saveToLibrary([s])),
    );
  }
  if (!saved) {
    const count = state.document.citations.filter((c) =>
      c.items.some((item) => item.id === s.id),
    ).length;
    const remove = button('Delete unused source', () =>
      edit([{ type: 'source.remove', sourceId: s.id }]),
    );
    remove.disabled = count > 0;
    remove.title = count
      ? 'Remove its citations or merge it into another source first.'
      : 'Remove this unused source from the document. Undo is available.';
    actions.append(remove);
    if (Object.keys(state.document.sources).length > 1)
      actions.append(button('Merge duplicates', () => mergeEditor(s)));
    p.append(document.createTextNode(` · ${count} citation${count === 1 ? '' : 's'}`));
  }
  el.append(h, p, actions);
  return el;
}
function drawLibrary() {
  try {
    const selected = new Set(
      [...$('#library').querySelectorAll('[data-library-source]:checked')].map(
        (check) => check.dataset.librarySource,
      ),
    );
    $('#library').replaceChildren(...library.read().map((s) => sourceCard(s, { saved: true })));
    const checks = [...$('#library').querySelectorAll('[data-library-source]')];
    for (const check of checks) check.checked = selected.has(check.dataset.librarySource);
    $('#select-library').checked = checks.length > 0 && checks.every((check) => check.checked);
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
  wordEditor.show(state?.editor || null);
  if (!state) {
    drawLibrary();
    enabled();
    return;
  }
  $('#style').value = state.document.style;
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
function sourceSummary(source) {
  return [
    source.title,
    (source.author || [])
      .map((a) => a.literal || [a.family, a.given].filter(Boolean).join(', '))
      .join('; '),
    source.issued?.['date-parts']?.[0]?.[0] || 'Date missing',
    source.type,
    source['container-title'],
    source.volume,
    source.issue,
    source.page,
    source.publisher,
    source.DOI,
    source.PMID,
    source.URL,
  ]
    .filter(Boolean)
    .join(' · ');
}
function mergeEditor(keep) {
  editing = { mergeInto: keep.id };
  $('#editor-title').textContent = 'Merge duplicate sources';
  $('#save-edit').textContent = 'Merge selected duplicates';
  $('#fields').replaceChildren(
    paragraph('Keep this source: ' + sourceSummary(keep)),
    paragraph(
      'Select duplicate copies to remove. Their citations will use the source above, keeping page numbers and citation locations. The kept source’s metadata stays unchanged. Undo is available.',
    ),
  );
  for (const source of Object.values(state.document.sources).filter((s) => s.id !== keep.id)) {
    const label = document.createElement('label');
    label.className = 'check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.dataset.mergeSource = source.id;
    label.append(check, document.createTextNode(sourceSummary(source)));
    $('#fields').append(label);
  }
  $('#editor').showModal();
}
function sourceEditor(source) {
  $('#save-edit').textContent = 'Save changes';
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
    'document',
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
  $('#save-edit').textContent = 'Save changes';
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
  if (editing.review) {
    const { plan, commit } = editing.review;
    const selected = [...$('#fields').querySelectorAll('[data-review-source]:checked')].map(
      (e) => plan.incoming[Number(e.dataset.reviewSource)],
    );
    await commit(selected);
    $('#editor').close();
    return;
  }
  if (editing.mergeInto) {
    const selected = [...$('#fields').querySelectorAll('[data-merge-source]:checked')];
    if (!selected.length) throw new Error('Select at least one duplicate to merge.');
    await edit(
      selected.map((e) => ({
        type: 'source.merge',
        from: e.dataset.mergeSource,
        to: editing.mergeInto,
      })),
    );
    $('#editor').close();
    return;
  }
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
      return saveToLibrary([candidate.source]);
    }),
  );
  status('Review the source identity before adding it.');
});
$('#style').onchange = (event) => {
  const style = event.target.value;
  return guard(() => edit([{ type: 'style.set', style }]))(event);
};
$('#undo').onclick = async (event) => {
  event.preventDefault();
  if (busy) return;
  if (wordEditor.changed && wordEditor.undo()) return;
  return guard(async () => {
    state = await local('undo');
    dirty = true;
    setAnchor(null);
    draw();
    status('Restored the previous local revision.');
  })(event);
};
$('#redo').onclick = async (event) => {
  event.preventDefault();
  if (busy) return;
  if (wordEditor.changed && wordEditor.redo()) return;
  return guard(async () => {
    state = await local('redo');
    dirty = true;
    draw();
    status('Restored the next local revision.');
  })(event);
};
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
$('#library').onchange = () => {
  const checks = [...$('#library').querySelectorAll('[data-library-source]')];
  $('#select-library').checked = checks.length > 0 && checks.every((check) => check.checked);
};
$('#select-library').onchange = (event) => {
  for (const check of $('#library').querySelectorAll('[data-library-source]'))
    check.checked = event.target.checked;
};
$('#include-library').onclick = guard(async () => {
  const ids = new Set(
    [...$('#library').querySelectorAll('[data-library-source]:checked')].map(
      (check) => check.dataset.librarySource,
    ),
  );
  if (!ids.size) throw new Error('Select references from the Local library first.');
  await includeSavedSources(library.read().filter((source) => ids.has(exactSourceKey(source))));
});
$('#export-library').onclick = guard(() =>
  download(library.export(), 'citeflow-library.json', 'application/json'),
);
$('#import-library').onchange = guard(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5_000_000) throw new Error('Reference file exceeds 5 MB');
  const parsed = importSources(await file.text());
  const plan = reviewSources(library.read(), parsed.sources);
  const commit = async (selected) => {
    const n = library.include(selected);
    drawLibrary();
    status(
      `Imported ${parsed.parsed} records from ${file.name}. ${n} saved references. ${parsed.duplicates + plan.duplicates} exact duplicates skipped.`,
    );
  };
  if (plan.near.length) reviewEditor(plan, commit, 'the Local library');
  else await commit(plan.incoming);
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

$('#new-document').onclick = guard(async () => {
  if (dirty && !confirm('Create a new document without downloading the current changes?')) return;
  state = await local('create');
  dirty = true;
  setAnchor(null);
  draw();
  status('New document. Start typing, then download the Word file to save it.');
});
for (const control of document.querySelectorAll('[data-format]')) {
  control.onmousedown = (e) => e.preventDefault();
  control.onclick = (e) => {
    e.preventDefault();
    if (!busy) wordEditor.command(control.dataset.format, control.dataset.value);
  };
}
$('#block-style').onchange = (e) => {
  if (!busy)
    wordEditor.command(e.target.value === 'paragraph' ? 'paragraph' : 'heading', e.target.value);
};
$('#apply-text').onclick = guard(async () =>
  status('Text edits applied locally. Download the Word file to save them.'),
);
