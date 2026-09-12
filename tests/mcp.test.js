import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('MCP client discovers tools and completes a real stdio request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'citeflow-mcp-'));
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp.js'],
    env: { ...process.env, CITEFLOW_DB: join(dir, 'test.sqlite') },
  });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    assert(listing.tools.some((t) => t.name === 'docx_edit'));
    assert(listing.tools.some((t) => t.name === 'google_edit'));
    const result = await client.callTool({
      name: 'documents_create',
      arguments: { title: 'Agent manuscript' },
    });
    assert.equal(JSON.parse(result.content[0].text).title, 'Agent manuscript');
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
