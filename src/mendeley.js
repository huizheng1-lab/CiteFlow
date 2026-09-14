import { apply, assert, exactSourceKey } from './model.js';

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
      const source = item.itemData;
      const key = exactSourceKey(source);
      const externalId = String(item.id ?? source.id ?? key);
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
  assert(
    !hasForeignCitations(root),
    'Other citation fields remain in this document. The document was not converted.',
  );
  return {
    manager: 'Mendeley Cite',
    citationCount: citations.length,
    sourceCount: Object.keys(doc.sources).length,
    bibliographyCount: bibliographies.length,
  };
}

function retag(node, value) {
  all(node, 'tag')[0].setAttributeNS(W, 'w:val', value);
  // Remove Mendeley locks and labels from controls now managed by CiteFlow.
  for (const name of ['lock', 'alias'])
    for (const child of all(node, name)) child.parentNode.removeChild(child);
}
