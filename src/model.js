import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
export class Fault extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const id = () => globalThis.crypto.randomUUID();
export const hash = (value) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
export const clone = (value) => structuredClone(value);
export function assert(ok, message, status = 400) {
  if (!ok) throw new Fault(message, status);
}
export function doi(value = '') {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}
export function sourceKey(source) {
  if (source.DOI) return 'doi:' + doi(source.DOI);
  if (source.PMID) return 'pmid:' + source.PMID;
  if (source.URL) {
    const u = new URL(source.URL);
    u.hash = '';
    return 'url:' + u.href;
  }
  return exactSourceKey(source);
}
export function exactSourceKey(source) {
  // Ignore internal IDs and citation keys; compare all bibliographic metadata.
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const clean = normalizeSource(source);
  delete clean['citation-key'];
  delete clean._graph;
  return 'record:' + hash(canonical(clean));
}
export function normalizeSource(input) {
  assert(
    input && typeof input === 'object' && !Array.isArray(input),
    'A CSL JSON source object is required',
  );
  assert(typeof input.title === 'string' && input.title.trim(), 'Source title is required');
  assert(
    [
      'article-journal',
      'webpage',
      'book',
      'chapter',
      'report',
      'dataset',
      'paper-conference',
      'thesis',
      'article',
    ].includes(input.type),
    'Unsupported CSL source type',
  );
  const s = clone(input);
  delete s.id;
  for (const key of Object.keys(s))
    if (s[key] === null || s[key] === undefined || s[key] === '') delete s[key];
  if (s.DOI) {
    s.DOI = doi(s.DOI);
    assert(/^10\.\d{4,9}\/\S+$/.test(s.DOI), 'Invalid DOI');
  }
  if (s.URL) {
    const u = new URL(s.URL);
    assert(['http:', 'https:'].includes(u.protocol), 'Source URL must be HTTP(S)');
  }
  if (s.author)
    assert(
      Array.isArray(s.author) &&
        s.author.every((a) => a && (typeof a.family === 'string' || typeof a.literal === 'string')),
      'Authors require family or literal names',
    );
  if (s.issued)
    assert(
      Array.isArray(s.issued['date-parts']) &&
        s.issued['date-parts'].every(
          (p) => Array.isArray(p) && p.length > 0 && p.length <= 3 && p.every(Number.isInteger),
        ),
      'Invalid issued date',
    );
  return s;
}
export function newDocument(title = 'Untitled manuscript', style = 'vancouver') {
  assert(
    typeof title === 'string' && title.trim() && title.length <= 500,
    'A title of 1–500 characters is required',
  );
  return {
    schemaVersion: 1,
    id: id(),
    title,
    revision: 0,
    style,
    sources: {},
    citations: [],
    bibliography: { id: id(), heading: 'References' },
    updatedAt: new Date().toISOString(),
  };
}
export function validate(doc) {
  const issues = [],
    ids = new Set();
  for (const c of doc.citations) {
    if (ids.has(c.id)) issues.push({ code: 'duplicate-occurrence', id: c.id });
    ids.add(c.id);
    for (const item of c.items)
      if (!Object.hasOwn(doc.sources, item.id))
        issues.push({ code: 'missing-source', citationId: c.id, sourceId: item.id });
  }
  for (const [sid, s] of Object.entries(doc.sources)) {
    if (!s.author?.length) issues.push({ code: 'missing-author', sourceId: sid });
    if (!s.issued?.['date-parts']?.[0]?.[0]) issues.push({ code: 'missing-year', sourceId: sid });
    if (s.type === 'article-journal' && !s['container-title'])
      issues.push({ code: 'missing-journal', sourceId: sid });
  }
  return issues;
}
export function apply(doc, op) {
  switch (op.type) {
    case 'source.upsert': {
      const s = normalizeSource(op.source);
      const key = op.allowDuplicate ? exactSourceKey : sourceKey;
      const existing = Object.entries(doc.sources).find(([, v]) => key(v) === key(s));
      if (existing) {
        for (const [sid, other] of Object.entries(doc.sources))
          if (sid !== existing[0] && exactSourceKey(other) === exactSourceKey(existing[1]))
            apply(doc, { type: 'source.merge', from: sid, to: existing[0] });
        return { sourceId: existing[0], reused: true };
      }
      const sid = id();
      doc.sources[sid] = { ...s, id: sid };
      return { sourceId: sid, reused: false };
    }
    case 'source.remove': {
      assert(Object.hasOwn(doc.sources, op.sourceId), 'Source not found', 404);
      assert(
        !doc.citations.some((c) => c.items.some((item) => item.id === op.sourceId)),
        'This source is cited. Remove its citations or merge it into another source first.',
        409,
      );
      delete doc.sources[op.sourceId];
      return { removed: op.sourceId };
    }
    case 'source.merge': {
      assert(op.from !== op.to, 'Choose two different sources');
      assert(
        Object.hasOwn(doc.sources, op.from) && Object.hasOwn(doc.sources, op.to),
        'Both merge sources must exist',
        404,
      );
      const result = apply(doc, { type: 'source.replace', from: op.from, to: op.to });
      delete doc.sources[op.from];
      return { ...result, removed: op.from, sourceId: op.to };
    }
    case 'source.update': {
      assert(Object.hasOwn(doc.sources, op.sourceId), 'Source not found', 404);
      const s = normalizeSource({ ...doc.sources[op.sourceId], ...op.patch });
      assert(
        !Object.entries(doc.sources).some(
          ([k, v]) => k !== op.sourceId && exactSourceKey(v) === exactSourceKey(s),
        ),
        'Update would duplicate an existing source; replace citations instead',
        409,
      );
      doc.sources[op.sourceId] = { ...s, id: op.sourceId };
      return { sourceId: op.sourceId };
    }
    case 'citation.insert': {
      const c = { id: op.id || id(), items: checkItems(doc, op.items) };
      if (op.leadingSpace === true) c.leadingSpace = true;
      assert(
        typeof c.id === 'string' &&
          /^[A-Za-z0-9_-]{1,100}$/.test(c.id) &&
          !['__proto__', 'constructor', 'prototype'].includes(c.id),
        'Invalid citation ID',
      );
      assert(!doc.citations.some((x) => x.id === c.id), 'Citation ID already exists', 409);
      let i = doc.citations.length;
      if (op.beforeId) {
        i = doc.citations.findIndex((x) => x.id === op.beforeId);
        assert(i >= 0, 'Insertion anchor not found', 409);
      }
      doc.citations.splice(i, 0, c);
      return { citationId: c.id };
    }
    case 'citation.update': {
      const c = doc.citations.find((x) => x.id === op.citationId);
      assert(c, 'Citation not found', 404);
      c.items = checkItems(doc, op.items);
      return { citationId: c.id };
    }
    case 'citation.remove': {
      const i = doc.citations.findIndex((x) => x.id === op.citationId);
      assert(i >= 0, 'Citation not found', 404);
      doc.citations.splice(i, 1);
      return { removed: op.citationId };
    }
    case 'citation.reorder': {
      assert(
        Array.isArray(op.ids) &&
          op.ids.length === doc.citations.length &&
          new Set(op.ids).size === op.ids.length &&
          op.ids.every((x) => doc.citations.some((c) => c.id === x)),
        'Order must contain every occurrence exactly once',
        409,
      );
      doc.citations = op.ids.map((x) => doc.citations.find((c) => c.id === x));
      return { reordered: true };
    }
    case 'source.replace': {
      assert(
        Object.hasOwn(doc.sources, op.from) && Object.hasOwn(doc.sources, op.to),
        'Replacement sources must exist',
      );
      let changed = 0;
      for (const c of doc.citations) {
        if (op.citationId && c.id !== op.citationId) continue;
        for (const item of c.items)
          if (item.id === op.from) {
            item.id = op.to;
            changed++;
          }
        c.items = checkItems(doc, c.items);
      }
      return { changed };
    }
    case 'style.set':
      assert(['apa', 'vancouver', 'harvard1'].includes(op.style), 'Unsupported style');
      doc.style = op.style;
      return { style: op.style };
    case 'bibliography.set':
      assert(typeof op.heading === 'string' && op.heading.length < 200, 'Invalid heading');
      doc.bibliography.heading = op.heading;
      return { bibliography: doc.bibliography };
    default:
      throw new Fault('Unknown operation: ' + op.type);
  }
}
function checkItems(doc, items) {
  assert(
    Array.isArray(items) && items.length > 0 && items.length <= 100,
    'Citation needs 1–100 source items',
  );
  const result = [],
    seen = new Set();
  for (const item of items) {
    assert(item && Object.hasOwn(doc.sources, item.id), 'Citation source not found');
    const v = { id: item.id };
    for (const key of ['locator', 'prefix', 'suffix'])
      if (item[key] != null) {
        assert(typeof item[key] === 'string', 'Invalid ' + key);
        v[key] = item[key];
      }
    if (item.locator) {
      assert(
        ['page', 'chapter', 'section', 'figure', 'table', 'paragraph', 'volume', 'issue'].includes(
          item.label || 'page',
        ),
        'Invalid locator label',
      );
      v.label = item.label || 'page';
    }
    const signature = JSON.stringify(v);
    if (!seen.has(signature)) {
      seen.add(signature);
      result.push(v);
    }
  }
  return result;
}
