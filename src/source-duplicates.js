import { exactSourceKey, doi } from './model.js';
const normalized = (text = '') =>
  String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const tokens = (title) => new Set(normalized(title).split(' ').filter(Boolean));
function similar(a, b) {
  if (a.DOI && b.DOI && doi(a.DOI) === doi(b.DOI)) return 'Same DOI, different metadata';
  if (a.PMID && b.PMID && String(a.PMID) === String(b.PMID)) return 'Same PMID, different metadata';
  if (a.URL && b.URL && a.URL === b.URL) return 'Same URL, different metadata';
  const left = normalized(a.title),
    right = normalized(b.title);
  if (left && left === right) return 'Same title, different metadata';
  const x = tokens(a.title),
    y = tokens(b.title);
  const shared = [...x].filter((word) => y.has(word)).length;
  if (x.size >= 4 && y.size >= 4 && shared / (x.size + y.size - shared) >= 0.8)
    return 'Nearly identical titles';
  return '';
}
/** Exact matches are automatic. Similar metadata is advisory and requires a human choice. */
export function reviewSources(existing, candidates) {
  const keys = new Set(existing.map(exactSourceKey)),
    incoming = [];
  let duplicates = 0;
  for (const source of candidates) {
    const key = exactSourceKey(source);
    if (keys.has(key)) duplicates++;
    else {
      keys.add(key);
      incoming.push(source);
    }
  }
  const near = [];
  incoming.forEach((source, i) => {
    for (const old of existing) {
      const reason = similar(source, old);
      if (reason) near.push({ incomingIndices: [i], existingSource: old, reason });
    }
    for (let j = 0; j < i; j++) {
      const reason = similar(source, incoming[j]);
      if (reason) near.push({ incomingIndices: [j, i], reason });
    }
  });
  return { incoming, near, duplicates };
}
