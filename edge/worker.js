import { fromCrossref, fromHTML } from '../src/metadata.js';
import { normalizeSource } from '../src/model.js';
import { limitedText } from '../browser/lookup.js';
const DEFAULT_HOSTS = [
  'api.crossref.org',
  'pubmed.ncbi.nlm.nih.gov',
  'pmc.ncbi.nlm.nih.gov',
  'www.nature.com',
  'nature.com',
  'journals.plos.org',
];
function allowed(value, hosts) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.includes(u.hostname))
    throw new Error('Source host is not enabled on this relay');
  return u;
}
export default {
  async fetch(request, env = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'POST required' });
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return reply(415, {
          error: 'JSON identifier requests only; document uploads are not accepted',
        });
      const raw = await limitedRequest(request);
      const body = JSON.parse(raw);
      if (
        Object.keys(body).length !== 1 ||
        typeof body.input !== 'string' ||
        body.input.length > 2048
      )
        throw new Error(
          'Expected only {input: sourceURL}; no documents or extra fields are accepted',
        );
      const hosts = env.ALLOWED_SOURCE_HOSTS
        ? env.ALLOWED_SOURCE_HOSTS.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : DEFAULT_HOSTS;
      let url = allowed(body.input, hosts),
        response;
      for (let hop = 0; hop < 5; hop++) {
        response = await fetch(url.href, {
          redirect: 'manual',
          headers: { Accept: 'application/json, text/html;q=0.9' },
          signal: AbortSignal.timeout(10000),
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = response.headers.get('location');
          await response.body?.cancel();
          if (!next) throw new Error('Missing redirect destination');
          url = allowed(new URL(next, url).href, hosts);
          continue;
        }
        break;
      }
      if (!response.ok) throw new Error('Source returned HTTP ' + response.status);
      const text = await limitedText(response);
      let source, provider;
      if (url.hostname === 'api.crossref.org') {
        const record = JSON.parse(text).message;
        source = fromCrossref(record);
        provider = 'Crossref';
      } else if (response.headers.get('content-type')?.includes('json')) {
        source = normalizeSource(JSON.parse(text));
        provider = 'Remote CSL JSON';
      } else {
        if (response.headers.get('content-type')?.includes('pdf'))
          throw new Error('Use a publisher page or DOI, not a PDF');
        source = fromHTML(text, url.href);
        provider = 'Page metadata';
      }
      return reply(200, { source, provider });
    } catch (e) {
      return reply(400, { error: e.message });
    }
  },
};
async function limitedRequest(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body required');
  let text = '',
    size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      throw new Error('Identifier request exceeds size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
