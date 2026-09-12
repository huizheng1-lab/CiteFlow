import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { assert, apply, newDocument, validate } from './model.js';
import { format } from './format.js';
import { richRuns } from './rich-text.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  CF = 'https://digimatrix-labs.org/citeflow/v1',
  REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const out = (node) => new XMLSerializer().serializeToString(node);
const all = (node, tag) => Array.from(node.getElementsByTagNameNS(W, tag));
const attr = (node, name) => node?.getAttributeNS(W, name);
const escape = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export const fileHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function tag(control) {
  return attr(all(control, 'tag')[0], 'val');
}
function controls(root) {
  return all(root, 'sdt').filter((c) => tag(c)?.startsWith('citeflow:'));
}
function text(node) {
  return all(node, 't')
    .map((x) => x.textContent)
    .join('');
}
function run(root, value, style) {
  const r = root.createElementNS(W, 'w:r');
  if (style) r.appendChild(style.cloneNode(true));
  const t = root.createElementNS(W, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(root.createTextNode(value));
  r.appendChild(t);
  return r;
}
function setControl(root, control, value, block = false) {
  const content = all(control, 'sdtContent')[0];
  while (content.firstChild) content.removeChild(content.firstChild);
  if (block)
    for (const line of value.split('\n')) {
      const p = root.createElementNS(W, 'w:p');
      p.appendChild(run(root, line));
      content.appendChild(p);
    }
  else content.appendChild(run(root, value));
}
function control(root, name, value, block = false) {
  const el = root.createElementNS(W, 'w:sdt');
  const pr = root.createElementNS(W, 'w:sdtPr');
  const t = root.createElementNS(W, 'w:tag');
  t.setAttributeNS(W, 'w:val', name);
  pr.appendChild(t);
  el.appendChild(pr);
  el.appendChild(root.createElementNS(W, 'w:sdtContent'));
  setControl(root, el, value, block);
  return el;
}
function richControl(root, control, entries, parameters = {}) {
  const content = all(control, 'sdtContent')[0];
  while (content.firstChild) content.removeChild(content.firstChild);
  for (const html of entries) {
    const p = root.createElementNS(W, 'w:p');
    if (parameters.hangingindent) {
      const pr = root.createElementNS(W, 'w:pPr'),
        ind = root.createElementNS(W, 'w:ind');
      ind.setAttributeNS(W, 'w:left', '720');
      ind.setAttributeNS(W, 'w:hanging', '720');
      pr.appendChild(ind);
      p.appendChild(pr);
    }
    for (const piece of richRuns(html)) {
      const pr = root.createElementNS(W, 'w:rPr');
      for (const [key, tagName] of [
        ['italic', 'i'],
        ['bold', 'b'],
        ['smallCaps', 'smallCaps'],
      ])
        if (piece[key]) pr.appendChild(root.createElementNS(W, 'w:' + tagName));
      if (piece.superscript || piece.subscript) {
        const v = root.createElementNS(W, 'w:vertAlign');
        v.setAttributeNS(W, 'w:val', piece.superscript ? 'superscript' : 'subscript');
        pr.appendChild(v);
      }
      p.appendChild(run(root, piece.text, pr));
    }
    content.appendChild(p);
  }
}
async function loadPackage(bytes) {
  assert(bytes.length <= 25_000_000, 'DOCX input exceeds 25 MB');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  assert(entries.length < 5000, 'DOCX has too many ZIP entries');
  assert(
    entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) < 100_000_000,
    'DOCX uncompressed size exceeds limit',
  );
  assert(zip.file('word/document.xml'), 'Not a DOCX document');
  const main = await zip.file('word/document.xml').async('string');
  assert(!/<!DOCTYPE|<!ENTITY/i.test(main), 'DTD is not allowed');
  const root = xml(main);
  let doc = newDocument();
  let metadataPath;
  for (const entry of entries.filter((e) => /^customXml\/[^/]+\.xml$/.test(e.name))) {
    const raw = await entry.async('string');
    if (!raw.includes(CF)) continue;
    assert(!/<!DOCTYPE|<!ENTITY/i.test(raw), 'DTD is not allowed');
    const parsed = xml(raw);
    if (parsed.documentElement.namespaceURI !== CF) continue;
    assert(!metadataPath, 'Multiple CiteFlow metadata parts', 409);
    metadataPath = entry.name;
    doc = JSON.parse(parsed.documentElement.textContent);
    assert(doc.schemaVersion === 1, 'Unsupported CiteFlow document version');
  }
  return { zip, root, doc, metadataPath: metadataPath || 'customXml/citeflow.xml' };
}
export async function inspectDocx(bytes) {
  const { root, doc } = await loadPackage(bytes);
  const found = controls(root).filter((x) => tag(x).startsWith('citeflow:citation:'));
  const ids = found.map((x) => tag(x).slice('citeflow:citation:'.length));
  return {
    document: doc,
    fileHash: fileHash(bytes),
    physicalOrder: ids,
    issues: [
      ...validate(doc),
      ...ids.filter((x, i) => ids.indexOf(x) !== i).map((id) => ({ code: 'duplicate-anchor', id })),
      ...ids
        .filter((x) => !doc.citations.some((c) => c.id === x))
        .map((id) => ({ code: 'unknown-anchor', id })),
      ...doc.citations
        .filter((c) => !ids.includes(c.id))
        .map((c) => ({ code: 'deleted-anchor', id: c.id })),
    ],
  };
}
function insertAfterText(root, needle, node) {
  assert(
    typeof needle === 'string' && needle.length > 0,
    'Citation insertion needs anchor.exactText',
  );
  const matches = [];
  for (const p of all(root, 'p')) {
    const ts = all(p, 't');
    const full = ts.map((t) => t.textContent).join('');
    let from = 0,
      pos;
    while ((pos = full.indexOf(needle, from)) >= 0) {
      matches.push({ ts, end: pos + needle.length });
      from = pos + 1;
    }
  }
  assert(matches.length === 1, 'Text anchor must match exactly once; found ' + matches.length, 409);
  const { ts, end } = matches[0];
  let offset = 0;
  for (const t of ts) {
    const len = t.textContent.length;
    if (offset + len >= end) {
      const r = t.parentNode;
      assert(
        r.localName === 'r' &&
          all(r, 't').length === 1 &&
          Array.from(r.childNodes).every(
            (x) => x.nodeType !== 1 || ['rPr', 't'].includes(x.localName),
          ),
        'Anchor ends in a complex Word run; choose another anchor',
      );
      assert(
        r.parentNode.localName === 'p',
        'Anchor must end in ordinary paragraph text, outside links and controls',
      );
      const left = t.textContent.slice(0, end - offset),
        right = t.textContent.slice(end - offset),
        parent = r.parentNode,
        next = r.nextSibling;
      t.textContent = left;
      parent.insertBefore(node, next);
      if (right) parent.insertBefore(run(root, right, all(r, 'rPr')[0]), next);
      return;
    }
    offset += len;
  }
}
export async function editDocx(
  bytes,
  { expectedFileHash, expectedRevision, operations, repair = false },
) {
  assert(expectedFileHash === fileHash(bytes), 'DOCX changed since inspection', 409);
  const { zip, root, doc, metadataPath } = await loadPackage(bytes);
  assert(doc.revision === expectedRevision, 'Citation revision conflict', 409);
  assert(
    !['ins', 'del', 'moveFrom', 'moveTo'].some((t) => all(root, t).length),
    'Tracked changes are present. Accept/reject changes in a copy before using headless editing.',
  );
  const fieldInstructions = all(root, 'instrText')
    .map((x) => x.textContent)
    .concat(all(root, 'fldSimple').map((x) => attr(x, 'instr') || ''))
    .join(' ');
  assert(
    !/CSL_CITATION|EN\.CITE|MENDELEY|\bCITATION\b|\bBIBLIOGRAPHY\b/i.test(fieldInstructions),
    'Another citation manager controls fields in this document. Convert a copy before using CiteFlow.',
  );
  const current = controls(root),
    citationControls = current.filter((c) => tag(c).startsWith('citeflow:citation:'));
  const ids = citationControls.map((c) => tag(c).slice('citeflow:citation:'.length));
  assert(
    new Set(ids).size === ids.length,
    'Duplicate citation anchors; repair copy/paste before editing',
    409,
  );
  assert(
    ids.every((cid) => doc.citations.some((c) => c.id === cid)),
    'Unknown citation anchor',
    409,
  );
  const before = format(doc);
  if (!repair)
    for (const c of citationControls)
      assert(
        text(c) === before.citations[tag(c).slice('citeflow:citation:'.length)],
        'Citation display was manually changed; inspect and retry with repair=true to restore formatting',
        409,
      );
  doc.citations = ids.map((cid) => doc.citations.find((c) => c.id === cid));
  const results = [];
  for (const op of operations) {
    if (op.type === 'bibliography.place') {
      const existing = controls(root).filter((c) => tag(c) === 'citeflow:bibliography');
      for (const c of existing) c.parentNode.removeChild(c);
      const c = control(root, 'citeflow:bibliography', 'References', true);
      const body = all(root, 'body')[0];
      if (op.anchor) {
        const p = all(root, 'p').filter((p) => text(p) === op.anchor.exactParagraph);
        assert(p.length === 1, 'Bibliography paragraph anchor must match once', 409);
        p[0].parentNode.insertBefore(c, p[0].nextSibling);
      } else body.insertBefore(c, all(body, 'sectPr')[0] || null);
      results.push({ placed: true });
      continue;
    }
    if (op.type === 'citation.reorder')
      throw new Error('Move manuscript text to reorder DOCX citations, then refresh');
    const result = apply(doc, op);
    results.push(result);
    if (op.type === 'citation.insert')
      insertAfterText(
        root,
        op.anchor?.exactText,
        control(root, 'citeflow:citation:' + result.citationId, '[citation]'),
      );
    if (op.type === 'citation.remove') {
      const c = controls(root).find((c) => tag(c) === 'citeflow:citation:' + op.citationId);
      assert(c, 'Citation anchor missing', 409);
      c.parentNode.removeChild(c);
    }
  }
  const physical = controls(root).filter((c) => tag(c).startsWith('citeflow:citation:'));
  doc.citations = physical.map((c) =>
    doc.citations.find((x) => x.id === tag(c).slice('citeflow:citation:'.length)),
  );
  doc.revision++;
  doc.updatedAt = new Date().toISOString();
  const rendered = format(doc),
    rich = format(doc, 'html');
  for (const c of physical)
    setControl(root, c, rendered.citations[tag(c).slice('citeflow:citation:'.length)]);
  for (const c of controls(root).filter((c) => tag(c) === 'citeflow:bibliography'))
    richControl(
      root,
      c,
      [escape(doc.bibliography.heading), ...rich.bibliography],
      rich.bibliographyParameters,
    );
  zip.file('word/document.xml', out(root));
  zip.file(
    metadataPath,
    `<?xml version="1.0" encoding="UTF-8"?><citeflow xmlns="${CF}">${escape(JSON.stringify(doc))}</citeflow>`,
  );
  const relPath = 'word/_rels/document.xml.rels';
  const rels = xml(
    zip.file(relPath) ? await zip.file(relPath).async('string') : `<Relationships xmlns="${REL}"/>`,
  );
  if (
    !Array.from(rels.documentElement.childNodes).some(
      (n) => n.getAttribute?.('Target') === '../' + metadataPath,
    )
  ) {
    const rel = rels.createElementNS(REL, 'Relationship');
    rel.setAttribute('Id', 'rIdCiteFlow' + doc.id.replaceAll('-', ''));
    rel.setAttribute(
      'Type',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml',
    );
    rel.setAttribute('Target', '../' + metadataPath);
    rels.documentElement.appendChild(rel);
  }
  zip.file(relPath, out(rels));
  const types = xml(await zip.file('[Content_Types].xml').async('string'));
  if (
    !Array.from(types.documentElement.childNodes).some(
      (n) => n.getAttribute?.('Extension') === 'xml',
    )
  ) {
    const def = types.createElementNS(types.documentElement.namespaceURI, 'Default');
    def.setAttribute('Extension', 'xml');
    def.setAttribute('ContentType', 'application/xml');
    types.documentElement.appendChild(def);
  }
  zip.file('[Content_Types].xml', out(types));
  return {
    bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    document: doc,
    results,
    rendered,
  };
}
export async function createDocx(paragraphs = ['Start writing here.']) {
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  z.file(
    '_rels/.rels',
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  z.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${escape(p)}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`,
  );
  return z.generateAsync({ type: 'nodebuffer' });
}
