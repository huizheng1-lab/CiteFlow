import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { Store } from '../src/store.js';
test('HTTP API authenticates calls and rejects cross-origin requests', async () => {
  const store = new Store(':memory:'),
    server = createServer({ store, token: 'test-token' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/call', { method: 'POST' })).status, 401);
    assert.equal(
      (await fetch(base + '/api/session', { headers: { Origin: 'https://evil.example' } })).status,
      403,
    );
    const r = await fetch(base + '/api/call', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'documents.create', args: { title: 'API test' } }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).result.title, 'API test');
    assert.equal((await fetch(base + '/')).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
test('cloud mode does not disclose the server token', async () => {
  const store = new Store(':memory:'),
    server = createServer({ store, token: 'secret', local: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(
      (await fetch('http://127.0.0.1:' + server.address().port + '/api/session')).status,
      403,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
});
