import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { inspectDocx, editDocx, loadPackage, fileHash } from './docx.js';
import { assert, hash } from './model.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const serialize = (n) => new XMLSerializer().serializeToString(n);
const all = (n, t) => Array.from(n.getElementsByTagNameNS(W, t));
const tag = (n) => all(n, 'tag')[0]?.getAttributeNS(W, 'val');
const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const element = (name, value) =>
  value == null || value === '' ? '' : `<${name}>${esc(value)}</${name}>`;
const label = (sid) => 'CF' + hash(sid).slice(0, 32);
const names = (authors) =>
  (authors || []).map((a) =>
    a.literal ? a.literal + ',' : [a.family, a.given].filter(Boolean).join(', '),
  );
// EndNote's standard XML reference type numbers. Other CSL types are blocked
// for this route, rather than silently imported as the wrong reference type.
const endnoteTypes = {
  'article-journal': [17, 'Journal Article'],
  book: [6, 'Book'],
  chapter: [5, 'Book Section'],
  'paper-conference': [10, 'Conference Paper'],
  report: [27, 'Report'],
  thesis: [32, 'Thesis'],
  webpage: [12, 'Web Page'],
};
function endnoteRecord(s) {
  const type = endnoteTypes[s.type];
  assert(
    type,
    `EndNote handoff does not yet support source type ${s.type}. Use the Mendeley bridge or keep the CiteFlow copy.`,
  );
  const authorXml = names(s.author)
    .map((a) => element('author', a))
    .join('');
  const editorXml = names(s.editor)
    .map((a) => element('author', a))
    .join('');
  return (
    `<record><ref-type name="${type[1]}">${type[0]}</ref-type>` +
    element('label', label(s.id)) +
    `<contributors><authors>${authorXml}</authors><secondary-authors>${editorXml}</secondary-authors></contributors>` +
    `<titles>${element('title', s.title)}${element('secondary-title', s['container-title'])}</titles>` +
    `<dates>${element('year', s.issued?.['date-parts']?.[0]?.[0])}</dates>` +
    element('volume', s.volume) +
    element('number', s.issue) +
    element('pages', s.page) +
    element('publisher', s.publisher) +
    element('pub-location', s['publisher-place']) +
    element('edition', s.edition) +
    element('isbn', s.ISBN || s.ISSN) +
    element('electronic-resource-num', s.DOI) +
    element('accession-num', s.PMID) +
    `<urls><related-urls>${element('url', s.URL || (s.DOI && 'https://doi.org/' + s.DOI))}</related-urls></urls></record>`
  );
}
function temporaryCitation(c, sources) {
  return (
    '{' +
    c.items
      .map((item) => {
        const s = sources[item.id];
        // Keep the author component, since #label alone means pages-only in EndNote.
        const author = s.author?.[0]?.family || s.author?.[0]?.literal;
        const year = s.issued?.['date-parts']?.[0]?.[0];
        assert(
          author && year,
          'EndNote handoff requires an author and year for every cited source. Complete the source details first.',
        );
        for (const value of [author, item.prefix, item.suffix, item.locator])
          assert(
            !/[{};\\#@\r\n]/.test(value || ''),
            'EndNote temporary citations cannot safely represent delimiters in an author, prefix, suffix, or locator. Edit those details before exporting.',
          );
        assert(
          !author.includes(','),
          'EndNote handoff cannot safely represent a comma in the first author name.',
        );
        assert(
          !item.locator || !item.label || item.label === 'page',
          'EndNote handoff currently supports page locators only. Other locator types must not be silently changed.',
        );
        assert(
          !item['suppress-author'] && !item['author-only'],
          'EndNote handoff does not support author suppression.',
        );
        return (
          (item.prefix ? item.prefix + '\\' : '') +
          author +
          ', ' +
          year +
          ' #' +
          label(item.id) +
          (item.locator ? '@' + item.locator : '') +
          (item.suffix ? ' ' + item.suffix : '')
        );
      })
      .join('; ') +
    '}'
  );
}
function run(root, value, instruction = false) {
  const r = root.createElementNS(W, 'w:r');
  const t = root.createElementNS(W, instruction ? 'w:instrText' : 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(root.createTextNode(value));
  r.appendChild(t);
  return r;
}
function replace(node, replacements) {
  for (const n of replacements) node.parentNode.insertBefore(n, node);
  node.parentNode.removeChild(node);
}
function mendeleyTag(c, sources, display, sourceIds) {
  const payload = {
    citationID: 'MENDELEY_CITATION_' + c.id,
    properties: { noteIndex: 0 },
    isEdited: false,
    manualOverride: { isManuallyOverridden: false, citeprocText: display, manualOverrideText: '' },
    citationItems: c.items.map((item) => {
      const id = sourceIds?.[item.id] || item.id;
      return { ...item, id, itemData: { ...sources[item.id], id }, isTemporary: false };
    }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return (
    'MENDELEY_CITATION_v3_' + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  );
}
function retagMendeley(control, value) {
  all(control, 'tag')[0].setAttributeNS(W, 'w:val', value);
  for (const name of ['lock', 'alias'])
    for (const child of all(control, name)) child.parentNode.removeChild(child);
}
async function refreshMendeleySettings(zip, root, target, style) {
  const namespace = 'http://schemas.microsoft.com/office/webextensions/webextension/2010/11';
  const citations = all(root, 'sdt')
    .map(tag)
    .filter((value) => value?.startsWith('MENDELEY_CITATION_v3_'))
    .map((value) => ({
      ...JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(value.slice('MENDELEY_CITATION_v3_'.length)), (c) =>
            c.charCodeAt(0),
          ),
        ),
      ),
      citationTag: value,
    }));
  for (const entry of Object.values(zip.files).filter((e) =>
    /^word\/webextensions\/.*\.xml$/.test(e.name),
  )) {
    const settings = xml(await entry.async('string'));
    let changed = false;
    for (const property of Array.from(settings.getElementsByTagNameNS(namespace, 'property'))) {
      const name = property.getAttribute('name');
      if (!name.startsWith('MENDELEY_')) continue;
      changed = true;
      if (target !== 'mendeley') property.parentNode.removeChild(property);
      else if (name === 'MENDELEY_CITATIONS')
        property.setAttribute('value', JSON.stringify(citations));
      else if (name === 'MENDELEY_BIBLIOGRAPHY_IS_DIRTY') property.setAttribute('value', 'true');
      else if (name === 'MENDELEY_BIBLIOGRAPHY_LAST_MODIFIED')
        property.setAttribute('value', String(Date.now()));
      else if (name === 'MENDELEY_CITATIONS_STYLE')
        property.setAttribute(
          'value',
          JSON.stringify({
            id: 'https://www.zotero.org/styles/' + style,
            title:
              style === 'apa'
                ? 'American Psychological Association'
                : 'NLM/Vancouver: Citing Medicine 2nd edition (citation-sequence)',
            format: style === 'apa' ? 'author-date' : 'numeric',
            defaultLocale: null,
            isLocaleCodeValid: true,
          }),
        );
    }
    if (changed) zip.file(entry.name, serialize(settings));
  }
}
function normalizedPath(base, target) {
  const segments = (target.startsWith('/') ? target.slice(1) : base + '/' + target).split('/');
  const result = [];
  for (const s of segments) {
    if (s === '..') result.pop();
    else if (s && s !== '.') result.push(s);
  }
  return result.join('/');
}
async function detachMetadata(zip, metadataPath) {
  if (!zip.file(metadataPath)) return;
  zip.remove(metadataPath);
  const slash = metadataPath.lastIndexOf('/');
  zip.remove(metadataPath.slice(0, slash) + '/_rels/' + metadataPath.slice(slash + 1) + '.rels');
  for (const entry of Object.values(zip.files).filter((e) => e.name.endsWith('.rels'))) {
    const rels = xml(await entry.async('string'));
    const base =
      entry.name === '_rels/.rels' ? '' : entry.name.slice(0, entry.name.indexOf('/_rels/'));
    let changed = false;
    for (const r of Array.from(rels.documentElement.childNodes)) {
      if (
        r.getAttribute?.('TargetMode') !== 'External' &&
        r.getAttribute?.('Target') &&
        normalizedPath(base, r.getAttribute('Target')) === metadataPath
      ) {
        r.parentNode.removeChild(r);
        changed = true;
      }
    }
    if (changed) zip.file(entry.name, serialize(rels));
  }
  const types = xml(await zip.file('[Content_Types].xml').async('string'));
  for (const n of Array.from(types.documentElement.childNodes))
    if (n.getAttribute?.('PartName') === '/' + metadataPath) n.parentNode.removeChild(n);
  zip.file('[Content_Types].xml', serialize(types));
}

export async function exportHandoff(bytes, target) {
  assert(['endnote', 'mendeley'].includes(target), 'Choose EndNote or Mendeley');
  const inspection = await inspectDocx(bytes);
  assert(
    !inspection.document.bibliographyReview,
    'Resolve the original bibliography review before collaborator conversion. Download Word file preserves the complete original bibliography.',
  );
  assert(
    inspection.document.citations.length,
    'Insert at least one CiteFlow citation before exporting',
  );
  assert(
    !inspection.issues.some((x) =>
      [
        'duplicate-anchor',
        'unknown-anchor',
        'deleted-anchor',
        'missing-source',
        'duplicate-occurrence',
      ].includes(x.code),
    ),
    'Resolve missing or conflicting citation anchors before exporting',
  );
  // Run the existing consistency and foreign-manager checks on a private copy.
  const refreshed = await editDocx(bytes, {
    expectedFileHash: inspection.fileHash,
    expectedRevision: inspection.document.revision,
    operations: [],
  });
  const { zip, root, doc, metadataPath } = await loadPackage(refreshed.bytes);
  const foreignInstructions =
    all(root, 'instrText')
      .map((n) => n.textContent)
      .join(' ') +
    all(root, 'fldSimple')
      .map((n) => n.getAttributeNS(W, 'instr') || '')
      .join(' ');
  assert(
    !/EN\.REFLIST|CSL_BIBLIOGRAPHY|ZOTERO/i.test(foreignInstructions),
    'Another citation manager owns bibliography fields in this document',
  );
  assert(
    !all(root, 'sdt').some((c) => /mendeley|zotero|endnote/i.test(tag(c) || '')),
    'Another citation manager owns content controls in this document',
  );
  for (const e of Object.values(zip.files).filter(
    (e) =>
      /^word\/.*\.xml$/.test(e.name) &&
      e.name !== 'word/document.xml' &&
      !e.name.startsWith('word/webextensions/'),
  )) {
    const raw = await e.async('string');
    assert(
      !/citeflow:|CSL_CITATION|CSL_BIBLIOGRAPHY|EN\.CITE|EN\.REFLIST|MENDELEY|ZOTERO/i.test(raw),
      'Citation fields outside the main document are not supported for handoff',
    );
  }
  const managed = all(root, 'sdt').filter((c) => tag(c)?.startsWith('citeflow:'));
  assert(
    managed.every(
      (c) => tag(c) === 'citeflow:bibliography' || tag(c).startsWith('citeflow:citation:'),
    ),
    'Unknown CiteFlow control cannot be exported',
  );
  const citedIds = [...new Set(doc.citations.flatMap((c) => c.items.map((i) => i.id)))];
  assert(new Set(citedIds.map(label)).size === citedIds.length, 'Export label collision');
  const sources = Object.fromEntries(
    citedIds.map((sid) => [sid, { ...doc.sources[sid], id: sid }]),
  );
  if (target === 'endnote') {
    // Literal braces in surrounding prose would be interpreted by EndNote as
    // additional citations, so block instead of potentially converting prose.
    const unmanaged = all(root, 't').filter((t) => {
      for (let p = t.parentNode; p; p = p.parentNode)
        if (p.localName === 'sdt' && tag(p)?.startsWith('citeflow:')) return false;
      return true;
    });
    assert(
      !unmanaged.some((t) => /[{}]/.test(t.textContent)),
      'EndNote handoff uses curly braces. Remove literal braces from a copy of the manuscript before exporting.',
    );
  }
  for (const control of managed) {
    const content = all(control, 'sdtContent')[0];
    if (tag(control) === 'citeflow:bibliography') {
      if (target === 'endnote')
        replace(control, []); // EndNote regenerates its own list.
      else {
        // Modern Mendeley Cite discovers the bibliography by its content-control tag.
        // Keep the heading outside the managed bibliography, at its original position.
        const heading = Array.from(content.childNodes).find((n) => n.localName === 'p');
        if (heading) control.parentNode.insertBefore(heading, control);
        retagMendeley(control, 'MENDELEY_BIBLIOGRAPHY');
      }
      continue;
    }
    const cid = tag(control).slice('citeflow:citation:'.length);
    const c = doc.citations.find((x) => x.id === cid);
    if (target === 'endnote')
      replace(control, [run(root, (c.leadingSpace ? ' ' : '') + temporaryCitation(c, sources))]);
    else {
      const result = Array.from(content.childNodes).map((n) => n.cloneNode(true));
      // Leading whitespace belongs to manuscript layout, not the manager field.
      if (c.leadingSpace) {
        const t = result.flatMap((n) => all(n, 't'))[0];
        if (t?.textContent.startsWith(' ')) t.textContent = t.textContent.slice(1);
      }
      const display = result
        .flatMap((n) => all(n, 't'))
        .map((t) => t.textContent)
        .join('');
      if (c.leadingSpace) control.parentNode.insertBefore(run(root, ' '), control);
      while (content.firstChild) content.removeChild(content.firstChild);
      for (const child of result) content.appendChild(child);
      retagMendeley(control, mendeleyTag(c, sources, display, doc.mendeleySourceIds));
    }
  }
  await refreshMendeleySettings(zip, root, target, doc.style);
  await detachMetadata(zip, metadataPath);
  zip.file('word/document.xml', serialize(root));
  const converted = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const report = {
    schemaVersion: 1,
    target,
    compatibility: 'experimental',
    nativeApplicationVerified: false,
    strategy:
      target === 'endnote'
        ? 'temporary-citations-with-labels'
        : 'mendeley-cite-v3-content-controls',
    originalFileHash: fileHash(bytes),
    exportedFileHash: fileHash(converted),
    citationCount: doc.citations.length,
    sourceCount: citedIds.length,
    citations: doc.citations.map((c) => ({ id: c.id, items: c.items })),
    bibliography:
      target === 'endnote'
        ? 'Regenerated by EndNote at its chosen position'
        : 'Existing position preserved when a CiteFlow bibliography is present',
    warnings: [
      'Actual Word add-in compatibility has not yet been verified. Test on a copy before handing off important work.',
    ],
  };
  if (target === 'mendeley' && !managed.some((c) => tag(c) === 'citeflow:bibliography'))
    report.warnings.push(
      'No bibliography was placed in CiteFlow. Insert one with Mendeley after conversion.',
    );
  const bundle = new JSZip();
  bundle.file('original-citeflow.docx', bytes);
  bundle.file(`manuscript-${target}.docx`, converted);
  bundle.file('references.csl.json', JSON.stringify(Object.values(sources), null, 2));
  if (target === 'endnote')
    bundle.file(
      'references.xml',
      '<?xml version="1.0" encoding="UTF-8"?><xml><records>' +
        Object.values(sources).map(endnoteRecord).join('') +
        '</records></xml>',
    );
  bundle.file('handoff-report.json', JSON.stringify(report, null, 2));
  bundle.file('READ-ME.txt', instructions(target, report));
  return bundle.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
function instructions(target, report) {
  const common = `CiteFlow collaborator handoff — experimental\n\n${report.citationCount} citation groups; ${report.sourceCount} cited sources.\nGenerated locally. No document was uploaded.\n\nThis export has structural automated tests but has NOT been verified in the actual EndNote or Mendeley Word add-in. It is a candidate handoff, not a certified native conversion. Keep original-citeflow.docx as your editable backup. The collaborator document no longer has CiteFlow controls. Do not use two citation managers on that copy.\n\n`;
  return (
    common +
    (target === 'endnote'
      ? `ENDNOTE BULK CONVERSION\n1. In desktop EndNote, create a new empty library for this handoff. Import references.xml using EndNote generated XML. Do not discard duplicate references during this import: the unique Label values are needed.\n2. In EndNote Settings/Preferences → Temporary Citations, choose Use field instead of record number → Label. Use the standard delimiters { and }, record marker #, prefix marker \\, and group separator semicolon. Restore your usual preferences after conversion if desired.\n3. Open manuscript-endnote.docx in Word with Cite While You Write. It intentionally shows temporary citations such as {Smith, 2024 #CF...}. Choose a style and run Update Citations and Bibliography for the whole document. No citation-by-citation reinsertion is intended.\n4. Confirm that all placeholders resolve without ambiguous matches. The original reference list was removed so EndNote can generate its own; its position and heading may need adjustment. Page locators require a style that renders Cited Pages.\n5. Try Edit & Manage Citation(s), change a page, add/remove a citation, change style, save, close and reopen. If anything fails, keep the original and report the EndNote/Word versions; do not silently accept unmatched citations.\n\nThis route supports journal articles, books, book sections, conference papers, reports, theses, and web pages. Only page locators are supported. Some less common source fields remain in references.csl.json but are not mapped into EndNote XML. Review imported metadata.\n\nFormat references:\nhttps://docs.endnote.com/docs/endnote/2025/macos/v1/content/09word/components_ofatempcite.htm\nhttps://docs.endnote.com/docs/endnote/2025/macos/v1/content/21prefs/temporary_citations.htm\n`
      : `MENDELEY CITE
1. Open manuscript-mendeley.docx in Word and open the modern Mendeley Cite add-in. This copy contains Mendeley Cite v3 citation content controls with embedded source data and a MENDELEY_BIBLIOGRAPHY control at the existing list position. The legacy Mendeley Desktop plugin is not the target.
2. Select an existing citation and verify that Mendeley Cite displays its references. Check that the existing bibliography updates when adding or removing a citation; do not insert a second bibliography.
3. Test a style change and a page locator, then save, close and reopen the copy. Compare citation and reference counts with handoff-report.json.
4. If the add-in does not recognize the controls, retain the original and report the Mendeley Cite version and its message. Native add-in behavior still requires application verification.

Original Mendeley source IDs are retained for documents imported after this update. Other records use document-local IDs with embedded metadata; this does not add references to your Mendeley cloud library.

`)
  );
}
