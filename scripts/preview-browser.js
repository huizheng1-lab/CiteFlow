// Developer-only static asset preview. It exposes no upload or API routes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/document-worker.js': 'document-worker.js',
  '/style.css': 'style.css',
  '/THIRD_PARTY_NOTICES.txt': 'THIRD_PARTY_NOTICES.txt',
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method !== 'GET' || !files[pathname]) {
        res.writeHead(404);
        res.end();
        return;
      }
      const f = files[pathname],
        mime = f.endsWith('.js')
          ? 'text/javascript'
          : f.endsWith('.css')
            ? 'text/css'
            : f.endsWith('.txt')
              ? 'text/plain'
              : 'text/html';
      res.setHeader('Content-Type', mime);
      if (f === 'document-worker.js')
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; connect-src 'none'; script-src 'self'",
        );
      res.end(await readFile(new URL('../dist/' + f, import.meta.url)));
    } catch {
      res.writeHead(404);
      res.end('Run npm run build:browser first.');
    }
  })
  .listen(4173, '127.0.0.1', () => console.log('Static preview: http://127.0.0.1:4173'));
