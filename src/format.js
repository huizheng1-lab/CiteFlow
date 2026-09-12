import CSL from 'citeproc';
import { plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import { assert, hash, validate } from './model.js';
const { templates, locales } = plugins.config.get('@csl');
export const styles = ['vancouver', 'apa', 'harvard1'];
export function format(doc, output = 'text') {
  assert(styles.includes(doc.style), 'Unsupported style');
  assert(['text', 'html'].includes(output), 'Unsupported output format');
  assert(
    !validate(doc).some((x) => ['missing-source', 'duplicate-occurrence'].includes(x.code)),
    'Broken citation links',
    409,
  );
  const template = templates.get(doc.style);
  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang) => locales.get(lang) || locales.get('en-US'),
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
    for (const [index, text] of updates) rendered[doc.citations[index].id] = text;
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
