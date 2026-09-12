import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { dispatch } from './service.js';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
export function createServer({
  store = new Store(),
  token = process.env.CITEFLOW_TOKEN || randomBytes(32).toString('hex'),
  local = true,
  allowedOrigin = process.env.CITEFLOW_ORIGIN,
} = {}) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    try {
      const origin = req.headers.origin,
        host = req.headers.host || '';
      if (local && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
        return send(403, { error: 'Invalid Host' });
      const expected = allowedOrigin || 'http://' + host;
      if (origin && origin !== expected) return send(403, { error: 'Origin not allowed' });
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/session' && req.method === 'GET') {
        if (!local) return send(403, { error: 'Enter your server access token' });
        return send(200, { token });
      }
      if (path === '/api/call') {
        const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, '')),
          secret = Buffer.from(token);
        if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
          return send(401, { error: 'Valid bearer token required' });
        if (req.method !== 'POST') return send(405, { error: 'POST required' });
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(415, { error: 'application/json required' });
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 2_000_000) {
            send(413, { error: 'Request too large' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        }
        const { method, args } = JSON.parse(Buffer.concat(chunks).toString());
        const result = await dispatch(store, method, args);
        return send(200, { result });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Method not allowed' });
      const files = {
        '/': 'index.html',
        '/app.js': 'app.js',
        '/style.css': 'style.css',
        '/word.js': 'word.js',
        '/word.html': 'word.html',
        '/llms.txt': 'llms.txt',
        '/openapi.json': 'openapi.json',
        '/manifest.xml': 'manifest.xml',
      };
      if (!files[path]) return send(404, { error: 'Not found' });
      const ext = files[path].split('.').pop(),
        mime = {
          html: 'text/html',
          js: 'text/javascript',
          css: 'text/css',
          txt: 'text/plain',
          json: 'application/json',
          xml: 'application/xml',
        }[ext];
      res.writeHead(200, {
        'Content-Type': mime + '; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
      });
      res.end(await readFile(publicDir + files[path]));
    } catch (e) {
      send(e.status || 400, { error: e.message });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.CITEFLOW_HOST || '127.0.0.1',
    port = Number(process.env.PORT || 3210),
    local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local && (!process.env.CITEFLOW_TOKEN || process.env.CITEFLOW_TOKEN.length < 32))
    throw new Error(
      'Non-local hosting requires CITEFLOW_TOKEN (32+ characters) and an HTTPS reverse proxy',
    );
  createServer({ local }).listen(port, host, () => console.log(`CiteFlow: http://${host}:${port}`));
}
