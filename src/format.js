import CSL from 'citeproc';
import templates from '@citation-js/plugin-csl/lib-mjs/styles.json' with { type: 'json' };
import locales from '@citation-js/plugin-csl/lib-mjs/locales.json' with { type: 'json' };
import { assert, hash, validate } from './model.js';
export const styles = ['vancouver', 'apa', 'harvard1'];
export function format(doc, output = 'text') {
  assert(styles.includes(doc.style), 'Unsupported style');
  assert(['text', 'html'].includes(output), 'Unsupported output format');
  if (doc.bibliographyReview) {
    assert(
      !validate(doc).some((x) => ['missing-source', 'duplicate-occurrence'].includes(x.code)),
      'Broken citation links',
      409,
    );
    const original = doc.bibliographyReview;
    const display = (text) =>
      output === 'html'
        ? text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        : text;
    assert(
      doc.citations.every((c) => Object.hasOwn(original.citationText, c.id)),
      'A preserved citation display is missing',
    );
    return {
      citations: Object.fromEntries(
        doc.citations.map((c) => [c.id, display(original.citationText[c.id])]),
      ),
      bibliography: original.entries.map((entry) => display(entry.text)),
      bibliographySourceIds: original.entries.map((entry) =>
        entry.sourceId ? [entry.sourceId] : [],
      ),
      bibliographyParameters: {},
      style: 'original',
      styleHash: hash(original),
      processorVersion: CSL.PROCESSOR_VERSION,
    };
  }
  assert(
    !validate(doc).some((x) => ['missing-source', 'duplicate-occurrence'].includes(x.code)),
    'Broken citation links',
    409,
  );
  const template = templates[doc.style];
  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang) => locales[lang] || locales['en-US'],
      retrieveItem: (sid) => structuredClone(doc.sources[sid]),
    },
    template,
    'en-US',
    true,
  );
  engine.setOutputFormat(output);
  const rendered = {},
    previous = [];
  for (const c of doc.citations) {
    const citation = {
      citationID: c.id,
      citationItems: structuredClone(c.items),
      properties: { noteIndex: 0 },
    };
    const [, updates] = engine.processCitationCluster(citation, previous, []);
    for (const [index, text] of updates)
      rendered[doc.citations[index].id] = (doc.citations[index].leadingSpace ? ' ' : '') + text;
    previous.push([c.id, 0]);
  }
  const b = doc.citations.length ? engine.makeBibliography() : false;
  return {
    citations: rendered,
    bibliography: b ? b[1] : [],
    bibliographySourceIds: b ? b[0].entry_ids : [],
    bibliographyParameters: b ? b[0] : {},
    style: doc.style,
    styleHash: hash(template),
    processorVersion: CSL.PROCESSOR_VERSION,
  };
}
