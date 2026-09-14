import { apply, assert, exactSourceKey, doi } from './model.js';
import { XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const all = (n, name) => Array.from(n.getElementsByTagNameNS(W, name));
const tag = (n) => all(n, 'tag')[0]?.getAttributeNS(W, 'val') || '';
const prefix = 'MENDELEY_CITATION_v3_';
const unsupported =
  'This Mendeley document cannot be imported completely. Use a copy with Mendeley Cite v3 citations containing embedded reference data.';

export function hasForeignCitations(root) {
  const instructions =
    all(root, 'instrText')
      .map((n) => n.textContent)
      .join('') +
    all(root, 'fldSimple')
      .map((n) => n.getAttributeNS(W, 'instr') || '')
      .join('');
  return (
    /CSL_CITATION|CSL_BIBLIOGRAPHY|EN\.CITE|MENDELEY|\bCITATION\b|\bBIBLIOGRAPHY\b/i.test(
      instructions,
    ) || all(root, 'sdt').some((n) => /mendeley|zotero|endnote/i.test(tag(n)))
  );
}

// Only the v3 content-control representation verified against a real Mendeley
// Cite document is migrated. Unknown formats fail atomically, never flatten.
export async function importMendeleyControls({ zip, root, doc }) {
  const controls = all(root, 'sdt');
  const managed = controls.filter((n) => /^MENDELEY_/i.test(tag(n)));
  let elsewhere = false;
  for (const entry of Object.values(zip.files).filter((e) =>
    /^word\/(?:footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(e.name),
  )) {
    if (/MENDELEY|CSL_CITATION/i.test(await entry.async('string'))) elsewhere = true;
  }
  assert(
    !elsewhere,
    'Mendeley citations in footnotes, endnotes, headers, or footers are not supported. The document was not converted.',
  );
  if (!managed.length) {
    assert(
      !hasForeignCitations(root),
      'Another citation manager controls this document. Automatic import currently supports Mendeley Cite v3 content controls only.',
    );
    return null;
  }
  assert(
    !controls.some((n) => tag(n).startsWith('citeflow:')) &&
      !doc.citations.length &&
      !Object.keys(doc.sources).length,
    'Mixed CiteFlow and Mendeley citations cannot be converted automatically.',
  );
  assert(
    !['ins', 'del', 'moveFrom', 'moveTo'].some((name) => all(root, name).length),
    'Accept or reject tracked changes in a copy before importing Mendeley citations.',
  );
  assert(
    managed.every((n) => tag(n).startsWith(prefix) || tag(n) === 'MENDELEY_BIBLIOGRAPHY'),
    unsupported,
  );
  const citations = managed.filter((n) => tag(n).startsWith(prefix));
  const bibliographies = managed.filter((n) => tag(n) === 'MENDELEY_BIBLIOGRAPHY');
  assert(
    citations.length > 0 && citations.length <= 5000 && bibliographies.length <= 1,
    unsupported,
  );
  const sourceIds = new Map();
  const repairedSources = new Set();
  for (const [index, node] of citations.entries()) {
    assert(
      node.parentNode.localName === 'p' &&
        all(node, 'sdt').length === 0 &&
        !all(node, 'dataBinding').length,
      unsupported,
    );
    // Text-box and nested-control citations need a separate placement model.
    for (let parent = node.parentNode; parent; parent = parent.parentNode)
      assert(!['txbxContent', 'sdt'].includes(parent.localName), unsupported);
    let citation;
    try {
      const encoded = tag(node).slice(prefix.length);
      assert(encoded.length <= 5_000_000, unsupported);
      citation = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
        ),
      );
    } catch {
      throw new Error(
        `Mendeley citation ${index + 1} has invalid embedded data. The document was not converted.`,
      );
    }
    assert(
      citation && !citation.manualOverride?.isManuallyOverridden && !citation.isEdited,
      `Mendeley citation ${index + 1} has manually overridden text. Resolve it in Mendeley before importing.`,
    );
    assert(
      !citation.properties?.noteIndex &&
        !citation.properties?.prefix &&
        !citation.properties?.suffix,
      unsupported,
    );
    assert(
      Array.isArray(citation.citationItems) &&
        citation.citationItems.length > 0 &&
        citation.citationItems.length <= 100,
      unsupported,
    );
    const items = citation.citationItems.map((item) => {
      assert(
        item &&
          item.itemData &&
          !item.isTemporary &&
          !item['suppress-author'] &&
          !item['author-only'] &&
          !item.suppressAuthor &&
          !item.authorOnly,
        unsupported,
      );
      let source, key;
      try {
        source = splitEmbeddedIdentifiers(item.itemData);
        key = exactSourceKey(source);
      } catch (error) {
        throw new Error(
          `Mendeley citation ${index + 1}: ${error.message}. Check the reference metadata in Mendeley and retry.`,
        );
      }
      const externalId = String(item.id ?? source.id ?? key);
      if (source.DOI !== item.itemData.DOI) repairedSources.add(externalId);
      let existing = sourceIds.get(externalId);
      assert(
        !existing || existing.key === key,
        'Conflicting metadata for the same Mendeley reference. The document was not converted.',
      );
      if (!existing) {
        const result = apply(doc, { type: 'source.upsert', source, allowDuplicate: true });
        existing = { key, id: result.sourceId };
        sourceIds.set(externalId, existing);
      }
      return Object.fromEntries(
        Object.entries({
          id: existing.id,
          locator: item.locator,
          label: item.label,
          prefix: item.prefix,
          suffix: item.suffix,
        }).filter(([, v]) => v !== undefined),
      );
    });
    const result = apply(doc, { type: 'citation.insert', items });
    retag(node, 'citeflow:citation:' + result.citationId);
  }
  for (const node of bibliographies) {
    assert(
      ['body', 'tc'].includes(node.parentNode.localName) &&
        !all(node, 'sdt').length &&
        !all(node, 'dataBinding').length,
      unsupported,
    );
    retag(node, 'citeflow:bibliography');
  }
  const inactiveEndNoteFields = archiveEmptyEndNoteFields(root, doc);
  assert(
    !hasForeignCitations(root),
    'Other citation fields remain in this document. The document was not converted.',
  );
  return {
    manager: 'Mendeley Cite',
    citationCount: citations.length,
    sourceCount: Object.keys(doc.sources).length,
    bibliographyCount: bibliographies.length,
    ...(repairedSources.size ? { metadataRepairs: repairedSources.size } : {}),
    ...(inactiveEndNoteFields ? { inactiveEndNoteFields } : {}),
  };
}

// Old EndNote field remnants can coexist with modern citations. Only complete,
// empty, run-only fields within one paragraph qualify; visible or complex
// fields still block conversion. Keep their exact XML in CiteFlow metadata.
function archiveEmptyEndNoteFields(root, doc) {
  const archived = [];
  for (const paragraph of all(root, 'p')) {
    let nodes = [],
      stack = [],
      codes = [],
      safe = true;
    for (const node of Array.from(paragraph.childNodes)) {
      const markers = node.nodeType === 1 ? all(node, 'fldChar') : [];
      const type = markers[0]?.getAttributeNS(W, 'fldCharType');
      if (!stack.length && type !== 'begin') continue;
      if (type === 'begin') stack.push('');
      nodes.push(node);
      safe &&=
        node.namespaceURI === W &&
        node.localName === 'r' &&
        markers.length <= 1 &&
        Array.from(node.childNodes)
          .filter((n) => n.nodeType === 1)
          .every(
            (n) => n.namespaceURI === W && ['rPr', 'instrText', 'fldChar'].includes(n.localName),
          );
      if (stack.length)
        stack[stack.length - 1] += all(node, 'instrText')
          .map((n) => n.textContent)
          .join('');
      if (type !== 'end') continue;
      codes.push(stack.pop());
      if (stack.length) continue;
      if (safe && codes.every((code) => /^\s*ADDIN EN\.CITE(?:\.DATA)?(?:\s|$)/.test(code))) {
        archived.push(nodes.map((n) => new XMLSerializer().serializeToString(n)).join(''));
        for (const n of nodes) n.parentNode.removeChild(n);
      }
      nodes = [];
      codes = [];
      safe = true;
    }
  }
  if (archived.length) doc.importProvenance = { inactiveEndNoteFields: archived };
  return archived.length;
}

// Some imported Mendeley records store labelled PubMed export lines in DOI.
// Split only an unambiguous DOI plus PMID/PMCID lines. Never truncate unknown
// text or discard an identifier; conflicting values still fail validation.
function splitEmbeddedIdentifiers(input) {
  if (typeof input.DOI !== 'string' || !/[\r\n]/.test(input.DOI)) return input;
  const lines = input.DOI.trim()
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || !/^10\.\d{4,9}\/\S+$/.test(doi(lines[0]))) return input;
  const identifiers = [];
  for (const line of lines.slice(1)) {
    const match = /^(PMID|PMCID)\s*(?:-\s*-?|:)\s*(PMC\d+|\d+)$/i.exec(line);
    if (!match) return input;
    const key = match[1].toUpperCase(),
      value = match[2].toUpperCase();
    if (!(key === 'PMID' ? /^\d+$/ : /^PMC\d+$/).test(value)) return input;
    identifiers.push([key, value]);
  }
  const source = { ...input, DOI: doi(lines[0]) };
  for (const [key, value] of identifiers) {
    assert(
      !source[key] || String(source[key]).trim() === value,
      `Conflicting ${key} values in DOI metadata`,
    );
    source[key] = value;
  }
  return source;
}

function retag(node, value) {
  all(node, 'tag')[0].setAttributeNS(W, 'w:val', value);
  // Remove Mendeley locks and labels from controls now managed by CiteFlow.
  for (const name of ['lock', 'alias'])
    for (const child of all(node, name)) child.parentNode.removeChild(child);
}
