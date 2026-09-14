import { assert } from './model.js';

export const reviewMessage =
  'The original bibliography has entries that need metadata review. Citation and bibliography changes are paused to preserve its text and numbering. You can edit prose and download the preserved copy. Correct the citation links in the original document, then reopen it.';

// This is a completeness check, not a parser that invents missing CSL records.
// Ambiguous or unmatched text must survive exactly as it appeared in Word.
export function reviewBibliography(texts, sources, citationText) {
  const normalize = (s) =>
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  const entries = texts
    .filter((text) => text.trim() && !/^(references|bibliography)\s*:?$/i.test(text.trim()))
    .map((text, index) => {
      const normalized = normalize(text);
      const matches = Object.values(sources).filter(
        (s) => normalize(s.title).length >= 8 && normalized.includes(normalize(s.title)),
      );
      return {
        number: Number(/^\s*(\d+)[.)]/.exec(text)?.[1]) || index + 1,
        text,
        ...(matches.length === 1 ? { sourceId: matches[0].id } : {}),
      };
    });
  const matched = new Set(entries.map((e) => e.sourceId).filter(Boolean));
  if (
    entries.length &&
    entries.every((e) => e.sourceId) &&
    entries.length === matched.size &&
    matched.size === Object.keys(sources).length
  )
    return null;
  return {
    entries,
    citationText,
    unmatchedCount: entries.filter((e) => !e.sourceId).length,
    sourcesWithoutEntry: Object.keys(sources).filter((id) => !matched.has(id)).length,
  };
}

export function assertReviewOperation(doc, op) {
  if (doc.bibliographyReview) assert(op.type === 'document.replace', reviewMessage);
}
