import https from 'node:https';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { fromCrossref, fromHTML } from './metadata.js';
export { fromCrossref, fromHTML } from './metadata.js';
import { assert, Fault, doi, normalizeSource } from './model.js';
export function publicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}
export async function safeURL(value, lookupFn = lookup) {
  const u = new URL(value);
  assert(['https:', 'http:'].includes(u.protocol), 'Only HTTP(S) source URLs are supported');
  assert(!u.username && !u.password, 'URLs with credentials are not allowed');
  assert(!u.port || ['80', '443'].includes(u.port), 'Only standard web ports are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const records = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }]
    : await lookupFn(host, { all: true });
  assert(
    records.length > 0 && records.every((x) => publicAddress(x.address)),
    'Private, local, and reserved network destinations are blocked',
  );
  return { url: u, address: records[0] };
}
export async function fetchPublic(url, accept = 'text/html, application/json;q=0.9') {
  let current = url;
  for (let redirect = 0; redirect < 6; redirect++) {
    const { url: u, address } = await safeURL(current);
    const response = await new Promise((resolve, reject) => {
      const req = (u.protocol === 'https:' ? https : http).get(
        u,
        {
          headers: {
            Accept: accept,
            'User-Agent': 'CiteFlow/0.1 (bibliographic metadata resolver)',
          },
          lookup: (_host, opts, cb) =>
            cb(null, opts.all ? [address] : address.address, address.family),
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.resume();
            resolve({ redirect: res.headers.location });
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            reject(new Fault('Source returned HTTP ' + res.statusCode, 502));
            return;
          }
          const chunks = [];
          let total = 0;
          res.on('data', (chunk) => {
            total += chunk.length;
            if (total > 2_000_000) req.destroy(new Fault('Source exceeds 2 MB metadata limit'));
            else chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              contentType: res.headers['content-type'] || '',
              url: u.href,
            }),
          );
          res.on('error', reject);
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Fault('Source request timed out', 504)),
        12000,
      );
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
    });
    if (response.redirect) {
      current = new URL(response.redirect, current).href;
      continue;
    }
    return response;
  }
  throw new Fault('Too many source redirects');
}
export async function resolveSource(input, { fetcher = fetchPublic, store, refresh = false } = {}) {
  assert(
    typeof input === 'string' && input.trim() && input.length <= 4096,
    'A URL, DOI, or PMID is required',
  );
  const key = input.trim();
  const cached = !refresh && store?.cached(key);
  if (cached) return { ...cached, cached: true };
  let source,
    provider,
    sourceURL,
    warnings = [];
  const identifier = doi(key),
    pmid = key.match(/^(?:PMID:\s*)(\d+)$/i);
  if (/^10\.\d{4,9}\/\S+$/.test(identifier)) {
    const r = await fetcher(
      'https://api.crossref.org/works/' + encodeURIComponent(identifier),
      'application/json',
    );
    const m = JSON.parse(r.body).message;
    assert(doi(m?.DOI) === identifier, 'DOI response did not match the requested source', 502);
    source = fromCrossref(m);
    provider = 'Crossref';
    sourceURL = 'https://doi.org/' + identifier;
  } else {
    sourceURL = pmid ? 'https://pubmed.ncbi.nlm.nih.gov/' + pmid[1] + '/' : new URL(key).href;
    const r = await fetcher(sourceURL);
    assert(
      !r.contentType.includes('pdf'),
      'Direct PDF extraction is not available yet. Use its DOI/publisher page or import CSL JSON.',
    );
    if (r.contentType.includes('json')) {
      const value = JSON.parse(r.body);
      assert(!Array.isArray(value), 'Provide one CSL JSON reference URL, not a collection');
      source = normalizeSource(value);
      provider = 'Remote CSL JSON';
    } else {
      source = fromHTML(r.body, r.url || sourceURL);
      provider = 'Page metadata';
    }
    if (pmid) source.PMID = pmid[1];
    if (source.DOI) {
      try {
        const resolved = await resolveSource(source.DOI, { fetcher });
        const cleanTitle = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        if (cleanTitle(source.title) === cleanTitle(resolved.source.title)) {
          source = {
            ...resolved.source,
            URL: source.URL,
            ...(source.PMID ? { PMID: source.PMID } : {}),
          };
          provider = 'Page metadata + Crossref';
        } else warnings.push('Page title and DOI record differ; review source identity.');
      } catch {
        warnings.push('DOI could not be independently verified.');
      }
    }
  }
  if (!source.author?.length) warnings.push('Author information is missing.');
  if (!source.issued) warnings.push('Publication date is missing.');
  const result = {
    source,
    provenance: {
      input: key,
      sourceURL,
      provider,
      retrievedAt: new Date().toISOString(),
      accessLevel: 'metadata-only',
      supportsClaim: 'not-assessed',
    },
    warnings,
  };
  store?.cache(key, result);
  return result;
}
