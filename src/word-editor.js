// Loss-aware OOXML bridge. Unchanged paragraphs and unsupported elements retain their original XML.
import { assert, id } from './model.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (n) => Array.from(n.childNodes || []).filter((x) => x.nodeType === 1);
const all = (n, t) => Array.from(n.getElementsByTagNameNS(W, t));
const first = (n, t) => kids(n).find((x) => x.namespaceURI === W && x.localName === t);
const val = (n) => n?.getAttributeNS(W, 'val');
const tag = (n) => val(all(n, 'tag')[0]) || '';
const txt = (n) =>
  all(n, 't')
    .map((x) => x.textContent)
    .join('');
const enabled = (n) => n && !['0', 'false', 'off'].includes(val(n));
const markTags = { bold: 'b', italic: 'i', underline: 'u', strike: 'strike' };
function context(root, numbering = null) {
  const listInfo = new WeakMap();
  const formats = new Map();
  if (numbering)
    for (const num of all(numbering, 'num')) {
      const abstractId = val(first(num, 'abstractNumId'));
      const definition = all(numbering, 'abstractNum').find(
        (n) => n.getAttributeNS(W, 'abstractNumId') === abstractId,
      );
      formats.set(
        num.getAttributeNS(W, 'numId'),
        val(definition && all(definition, 'numFmt')[0]) !== 'bullet',
      );
    }
  const nodes = new Map(),
    originals = new Map(),
    runs = new Map();
  all(root, 'r').forEach((r, i) => runs.set('r' + i, r));
  const runIds = new Map([...runs].map(([k, v]) => [v, k]));
  const paragraphs = new Map(all(root, 'p').map((p, i) => [p, i]));
  let sequence = 0,
    protectedCount = 0;
  const protectedRefs = new Set();
  const ref = (n) => {
    const key = 'w' + sequence++;
    nodes.set(key, n);
    return key;
  };
  function opaque(n, inline) {
    protectedCount++;
    const wordId = ref(n);
    protectedRefs.add(wordId);
    return {
      type: inline ? 'wordInline' : 'wordBlock',
      attrs: {
        wordId,
        sourceText: txt(n),
        label:
          txt(n) || (all(n, 'drawing').length ? 'Image (preserved)' : 'Word content (preserved)'),
      },
    };
  }
  function inline(n) {
    if (n.namespaceURI !== W) return [opaque(n, true)];
    if (n.localName === 'sdt' && tag(n).startsWith('citeflow:citation:'))
      return [
        {
          type: 'citation',
          attrs: { citationId: tag(n).slice('citeflow:citation:'.length), label: txt(n) },
        },
      ];
    if (n.localName !== 'r') return [opaque(n, true)];
    if (kids(n).some((x) => !['rPr', 't', 'br', 'tab'].includes(x.localName)))
      return [opaque(n, true)];
    const pr = first(n, 'rPr'),
      marks = [{ type: 'wordStyle', attrs: { ref: runIds.get(n) } }];
    for (const [type, name] of Object.entries(markTags))
      if (enabled(pr && first(pr, name))) marks.push({ type });
    return kids(n).flatMap((x) =>
      x.localName === 't' && x.textContent
        ? [{ type: 'text', text: x.textContent, marks }]
        : x.localName === 'br'
          ? [{ type: 'hardBreak' }]
          : x.localName === 'tab'
            ? [{ type: 'text', text: '\t', marks }]
            : [],
    );
  }
  function block(n) {
    if (n.namespaceURI !== W) return opaque(n, false);
    if (n.localName === 'p') {
      if (all(n, 'sectPr').length) return opaque(n, false);
      const pr = first(n, 'pPr'),
        style = val(pr && first(pr, 'pStyle')) || '';
      const level = /^heading\s*([1-6])$/i.exec(style)?.[1];
      const result = {
        type: level ? 'heading' : 'paragraph',
        attrs: {
          wordId: ref(n),
          paragraphIndex: paragraphs.get(n),
          textAlign: val(pr && first(pr, 'jc')) || null,
          ...(level ? { level: Number(level) } : {}),
        },
        content: kids(n)
          .filter((x) => x.localName !== 'pPr')
          .flatMap(inline),
      };
      const num = pr && first(pr, 'numPr');
      if (num)
        listInfo.set(result, {
          id: val(first(num, 'numId')),
          level: Number(val(first(num, 'ilvl'))) || 0,
          ordered: formats.get(val(first(num, 'numId'))) ?? false,
        });
      originals.set(result.attrs.wordId, result);
      return result;
    }
    if (n.localName === 'tbl') {
      // Merged cells and nested tables are retained intact until full support is implemented.
      if (all(n, 'vMerge').length || all(n, 'gridSpan').length || all(n, 'tbl').length)
        return opaque(n, false);
      return {
        type: 'table',
        attrs: { wordId: ref(n) },
        content: kids(n)
          .filter((x) => x.localName === 'tr')
          .map((r) => ({
            type: 'tableRow',
            attrs: { wordId: ref(r) },
            content: kids(r)
              .filter((x) => x.localName === 'tc')
              .map((c) => ({
                type: 'tableCell',
                attrs: { wordId: ref(c), colspan: 1, rowspan: 1, colwidth: null },
                content: group(
                  kids(c)
                    .filter((x) => x.localName !== 'tcPr')
                    .map(block),
                ),
              })),
          })),
      };
    }
    if (n.localName === 'sdt' && tag(n) === 'citeflow:bibliography')
      return {
        type: 'bibliography',
        attrs: { wordId: ref(n), label: all(n, 'p').map(txt).join('\n') },
      };
    return opaque(n, false);
  }
  function group(nodes) {
    const out = [],
      stack = [];
    for (const node of nodes) {
      const info = listInfo.get(node);
      if (!info) {
        stack.length = 0;
        out.push(node);
        continue;
      }
      const level = Math.min(Math.max(0, info.level), stack.length);
      stack.length = Math.min(stack.length, level + 1);
      if (!stack[level] || stack[level].id !== info.id || stack[level].ordered !== info.ordered) {
        const list = { type: info.ordered ? 'orderedList' : 'bulletList', content: [] };
        if (level && stack[level - 1]?.item) stack[level - 1].item.content.push(list);
        else out.push(list);
        stack[level] = { ...info, list };
      }
      const item = { type: 'listItem', content: [node] };
      stack[level].list.content.push(item);
      stack[level].item = item;
    }
    return out;
  }
  const body = all(root, 'body')[0];
  const content = group(
    kids(body)
      .filter((x) => x.localName !== 'sectPr')
      .map(block),
  );
  const blocked = ['ins', 'del', 'moveFrom', 'moveTo'].some((t) => all(root, t).length);
  return {
    root,
    body,
    nodes,
    originals,
    runs,
    protectedRefs,
    protectedCount: () => protectedCount,
    blocked,
    document: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
  };
}
export function wordEditorDocument(root, numbering = null) {
  const c = context(root, numbering);
  return { content: c.document, protectedCount: c.protectedCount(), editable: !c.blocked };
}
export function replaceWordContent(root, document, model, numberingStart = 10000) {
  assert(document?.type === 'doc' && Array.isArray(document.content), 'Invalid editor document');
  assert(JSON.stringify(document).length <= 10_000_000, 'Editor content exceeds 10 MB');
  const c = context(root);
  assert(!c.blocked, 'Accept tracked changes in a copy before editing this document.');
  const citationNodes = new Map(
    all(root, 'sdt')
      .filter((n) => tag(n).startsWith('citeflow:citation:'))
      .map((n) => [tag(n).slice('citeflow:citation:'.length), n]),
  );
  const seenCitations = new Set(),
    seenProtected = new Set(),
    seenOrigins = new Set();
  const el = (name) => root.createElementNS(W, 'w:' + name);
  const set = (parent, name, value) => {
    let n = first(parent, name);
    if (n) parent.removeChild(n);
    n = el(name);
    if (value != null) n.setAttributeNS(W, 'w:val', String(value));
    parent.appendChild(n);
    return n;
  };
  const original = (node, expected) => {
    const n = c.nodes.get(node.attrs?.wordId);
    assert(
      n && (!expected || n.localName === expected),
      'Original Word content is missing. Reload the document.',
    );
    return n;
  };
  let budget = 0;
  function protectedNode(node) {
    const n = original(node);
    assert(!seenProtected.has(node.attrs.wordId), 'Protected Word content cannot be duplicated.');
    seenProtected.add(node.attrs.wordId);
    return n.cloneNode(true);
  }
  function inlines(node) {
    if (node.type === 'wordInline') return [protectedNode(node)];
    if (node.type === 'citation') {
      const cid = node.attrs?.citationId,
        old = citationNodes.get(cid),
        metadata = model.citations.find((x) => x.id === cid);
      assert(old && metadata, 'Citation link is invalid');
      const copy = old.cloneNode(true);
      if (seenCitations.has(cid)) {
        const next = id();
        model.citations.push({ ...structuredClone(metadata), id: next });
        all(copy, 'tag')[0].setAttributeNS(W, 'w:val', 'citeflow:citation:' + next);
      }
      seenCitations.add(cid);
      return [copy];
    }
    assert(['text', 'hardBreak'].includes(node.type), 'Unsupported inline content: ' + node.type);
    const r = el('r');
    const marks = node.marks || [],
      style = marks.find((m) => m.type === 'wordStyle');
    const old = c.runs.get(style?.attrs?.ref),
      oldPr = old && first(old, 'rPr');
    const pr = oldPr ? oldPr.cloneNode(true) : el('rPr');
    for (const [type, name] of Object.entries(markTags)) {
      const existing = first(pr, name);
      if (existing) pr.removeChild(existing);
      // Preserve unrelated run properties while applying the supported text marks.
      if (marks.some((m) => m.type === type)) set(pr, name, name === 'u' ? 'single' : '1');
    }
    r.appendChild(pr);
    if (node.type === 'hardBreak') r.appendChild(el('br'));
    else {
      assert(typeof node.text === 'string', 'Invalid editor text');
      for (const [i, piece] of node.text.split('\t').entries()) {
        if (i) r.appendChild(el('tab'));
        const t = el('t');
        t.setAttribute('xml:space', 'preserve');
        t.appendChild(root.createTextNode(piece));
        r.appendChild(t);
      }
    }
    return [r];
  }
  const newNumberings = [];
  function paragraph(node, list) {
    const source = c.nodes.get(node.attrs?.wordId),
      prev = c.originals.get(node.attrs?.wordId);
    const semantic = (n) => ({
      type: n.type,
      text: n.text || '',
      level: n.attrs?.level || null,
      align: n.attrs?.textAlign || null,
      marks: (n.marks || []).map((m) => JSON.stringify(m)).sort(),
      content: (n.content || []).map(semantic),
    });
    if (
      source &&
      prev &&
      !list &&
      !seenOrigins.has(node.attrs?.wordId) &&
      (node.content || []).every((n) => ['text', 'hardBreak'].includes(n.type)) &&
      JSON.stringify(semantic(prev)) === JSON.stringify(semantic(node))
    ) {
      seenOrigins.add(node.attrs.wordId);
      return source.cloneNode(true);
    }
    // Changed paragraphs reconstruct supported runs and preserve unrelated paragraph properties.
    const p = source?.localName === 'p' ? source.cloneNode(false) : el('p');
    const oldPr = source && first(source, 'pPr'),
      pr = oldPr ? oldPr.cloneNode(true) : el('pPr');
    if (seenOrigins.has(node.attrs?.wordId)) {
      p.removeAttribute('w14:paraId');
      p.removeAttribute('w14:textId');
    }
    seenOrigins.add(node.attrs?.wordId);
    const alignment = node.attrs?.textAlign;
    if (alignment && ['left', 'center', 'right', 'justify', 'both'].includes(alignment))
      set(pr, 'jc', alignment === 'justify' ? 'both' : alignment);
    else if (first(pr, 'jc')) pr.removeChild(first(pr, 'jc'));
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level);
      assert(level >= 1 && level <= 6, 'Invalid heading level');
      set(pr, 'pStyle', 'Heading' + level);
      set(pr, 'outlineLvl', level - 1);
    } else if (prev?.type === 'heading') {
      for (const tag of ['pStyle', 'outlineLvl']) {
        const x = first(pr, tag);
        if (x) pr.removeChild(x);
      }
    }
    if (!list && first(pr, 'numPr')) pr.removeChild(first(pr, 'numPr'));
    if (list) {
      const num = set(pr, 'numPr');
      set(num, 'ilvl', list.level);
      set(num, 'numId', list.id);
    }
    p.appendChild(pr);
    for (const child of node.content || [])
      for (const r of inlines(child)) {
        if (node.type === 'heading' && r.localName === 'r') {
          const rp = first(r, 'rPr') || el('rPr');
          if (!rp.parentNode) r.insertBefore(rp, r.firstChild);
          set(rp, 'b', '1');
          set(rp, 'sz', [32, 28, 26, 24, 22, 22][Number(node.attrs.level) - 1]);
        }
        p.appendChild(r);
      }
    return p;
  }
  function blocks(node, list = null, depth = 0) {
    assert(++budget <= 30000 && depth < 40, 'Document is too complex');
    if (['paragraph', 'heading'].includes(node.type)) return [paragraph(node, list)];
    if (node.type === 'wordBlock') return [protectedNode(node)];
    if (node.type === 'bibliography') return [protectedNode(node)];
    if (['bulletList', 'orderedList'].includes(node.type)) {
      const numId = numberingStart + newNumberings.length;
      newNumberings.push({
        id: numId,
        ordered: node.type === 'orderedList',
        start: Number(node.attrs?.start) || 1,
      });
      return (node.content || []).flatMap((item) => {
        assert(item.type === 'listItem', 'Invalid list item');
        return (item.content || []).flatMap((n) =>
          blocks(n, { id: numId, level: Math.min(list ? list.level + 1 : 0, 8) }, depth + 1),
        );
      });
    }
    if (node.type === 'table') {
      const source = c.nodes.get(node.attrs?.wordId),
        table = el('tbl');
      const pr = source && first(source, 'tblPr');
      table.appendChild(pr ? pr.cloneNode(true) : el('tblPr'));
      if (!pr) {
        const borders = set(first(table, 'tblPr'), 'tblBorders');
        for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
          const b = set(borders, side, 'single');
          b.setAttributeNS(W, 'w:sz', '4');
          b.setAttributeNS(W, 'w:color', 'D9D9D9');
        }
      }
      const rows = node.content || [];
      assert(rows.length && rows.length <= 200, 'Table needs 1–200 rows');
      for (const row of rows) {
        assert(row.type === 'tableRow', 'Invalid table row');
        const tr = el('tr');
        const oldRow = c.nodes.get(row.attrs?.wordId),
          rowPr = oldRow && first(oldRow, 'trPr');
        if (rowPr) tr.appendChild(rowPr.cloneNode(true));
        const cells = row.content || [];
        assert(cells.length && cells.length <= 20, 'Table needs 1–20 columns');
        for (const cell of cells) {
          assert(['tableCell', 'tableHeader'].includes(cell.type), 'Invalid table cell');
          assert(
            (cell.attrs?.colspan || 1) === 1 && (cell.attrs?.rowspan || 1) === 1,
            'Merged table cells are not supported',
          );
          const tc = el('tc'),
            old = c.nodes.get(cell.attrs?.wordId),
            cp = old && first(old, 'tcPr');
          if (cp) tc.appendChild(cp.cloneNode(true));
          for (const child of cell.content || [])
            for (const b of blocks(child, null, depth + 1)) tc.appendChild(b);
          if (!kids(tc).some((n) => n.localName === 'p')) tc.appendChild(el('p'));
          tr.appendChild(tc);
        }
        table.appendChild(tr);
      }
      return [table];
    }
    throw new Error('Unsupported document block: ' + node.type);
  }
  const result = document.content.flatMap((n) => blocks(n));
  for (const ref of c.protectedRefs)
    assert(
      seenProtected.has(ref),
      'Protected Word content cannot be deleted. Undo the deletion to preserve it.',
    );
  const section = first(c.body, 'sectPr')?.cloneNode(true);
  while (c.body.firstChild) c.body.removeChild(c.body.firstChild);
  for (const b of result) c.body.appendChild(b);
  if (!result.length) c.body.appendChild(el('p'));
  if (section) c.body.appendChild(section);
  const active = all(root, 'sdt')
    .filter((n) => tag(n).startsWith('citeflow:citation:'))
    .map((n) => tag(n).slice('citeflow:citation:'.length));
  model.citations = active.map((cid) => model.citations.find((x) => x.id === cid));
  return newNumberings;
}
