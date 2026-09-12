import { doi, assert, normalizeSource } from '../src/model.js';
import { fromCrossref, fromHTML } from '../src/metadata.js';
/** The only application network boundary. Receives an explicitly entered identifier, never a document. */
export async function lookupSource(input, { relay = '', fetcher = fetch } = {}) {
  assert(
    typeof input === 'string' && input.trim().length <= 2048,
    'Enter a source URL, DOI, or PMID',
  );
  input = input.trim();
  const identifier = doi(input),
    isDOI = /^10\.\d{4,9}\/\S+$/.test(identifier),
    pmid = input.match(/^PMID:\s*(\d+)$/i);
  const url = isDOI
    ? 'https://api.crossref.org/works/' + encodeURIComponent(identifier)
    : pmid
      ? 'https://pubmed.ncbi.nlm.nih.gov/' + pmid[1] + '/'
      : new URL(input).href;
  const u = new URL(url);
  assert(
    u.protocol === 'https:' && !u.username && !u.password,
    'Online lookup requires an HTTPS source URL without credentials',
  );
  let source, provider;
  if (relay) {
    const service = new URL(relay);
    assert(
      service.protocol === 'https:' && !service.username && !service.password,
      'Metadata relay must use HTTPS',
    );
    const response = await fetcher(service.href, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: url }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        'Metadata relay rejected the lookup. Check its allowed source hosts or use manual entry.',
      );
    const result = await response.json();
    source = normalizeSource(result.source);
    provider = result.provider || 'Metadata relay';
  } else {
    let response;
    try {
      response = await fetcher(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { Accept: isDOI ? 'application/json' : 'text/html, application/json;q=0.9' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        'This source cannot be read directly by the browser. Use a DOI, enter metadata manually, or configure the optional metadata-only relay.',
      );
    }
    assert(response.ok, 'Source lookup returned HTTP ' + response.status);
    const text = await limitedText(response);
    if (isDOI) {
      const record = JSON.parse(text).message;
      assert(doi(record?.DOI) === identifier, 'Returned DOI differs from the requested source');
      source = fromCrossref(record);
      provider = 'Crossref';
    } else if (response.headers.get('content-type')?.includes('json')) {
      source = normalizeSource(JSON.parse(text));
      provider = 'Remote CSL JSON';
    } else {
      assert(
        !response.headers.get('content-type')?.includes('pdf'),
        'Use the PDF’s DOI or publisher page; PDF extraction is not included',
      );
      source = fromHTML(text, response.url || url);
      provider = 'Page metadata';
    }
  }
  if (isDOI)
    assert(doi(source.DOI) === identifier, 'Returned DOI differs from the requested source');
  if (pmid) source.PMID = pmid[1];
  const warnings = [];
  if (!source.author?.length) warnings.push('Author information missing.');
  if (!source.issued) warnings.push('Publication date missing.');
  return {
    source,
    provider,
    warnings,
    provenance: {
      input,
      provider,
      retrievedAt: new Date().toISOString(),
      accessLevel: 'metadata-only',
      supportsClaim: 'not-assessed',
    },
  };
}
export async function limitedText(response) {
  if (!response.body) {
    const text = await response.text();
    assert(text.length < 2_000_000, 'Source exceeds metadata size limit');
    return text;
  }
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2_000_000) {
      await reader.cancel();
      throw new Error('Source exceeds metadata size limit');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}
