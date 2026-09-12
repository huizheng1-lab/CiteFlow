#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Store } from './store.js';
import { dispatch } from './service.js';
import { inspectDocx, editDocx } from './docx.js';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const store = new Store(),
  server = new McpServer({ name: 'citeflow', version: '0.1.0' });
const methods = {
  'google.plan': {
    googleDocument: z.record(z.unknown()),
    document: z.record(z.unknown()),
    operations: z.array(z.record(z.unknown())),
    repair: z.boolean().optional(),
  },
  'google.edit': {
    googleDocumentId: z.string(),
    document: z.record(z.unknown()),
    operations: z.array(z.record(z.unknown())),
    repair: z.boolean().optional(),
  },
  'documents.list': {},
  'documents.create': {
    title: z.string(),
    style: z.enum(['vancouver', 'apa', 'harvard1']).optional(),
  },
  'documents.inspect': { documentId: z.string() },
  'sources.resolve': {
    input: z.string().describe('Public source URL, DOI, PMID:123, or remote CSL JSON URL'),
    refresh: z.boolean().optional(),
  },
  'documents.edit': {
    documentId: z.string(),
    expectedRevision: z.number().int(),
    requestId: z.string(),
    operations: z
      .array(z.record(z.unknown()))
      .describe('See citeflow://operations for operation schemas'),
  },
  'documents.format': { documentId: z.string(), output: z.enum(['text', 'html']).optional() },
  'documents.restore': {
    documentId: z.string(),
    expectedRevision: z.number().int(),
    targetRevision: z.number().int(),
  },
  'documents.import': { document: z.record(z.unknown()) },
  'library.list': {},
};
for (const [name, schema] of Object.entries(methods))
  server.tool(
    name.replaceAll('.', '_'),
    name + ' — structured citation operation',
    schema,
    async (args) => {
      try {
        return {
          content: [{ type: 'text', text: JSON.stringify(await dispatch(store, name, args)) }],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: 'text', text: JSON.stringify({ error: e.message, status: e.status || 400 }) },
          ],
        };
      }
    },
  );
server.resource('operations', 'citeflow://operations', async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: 'text/markdown',
      text: await readFile(new URL('../docs/AGENT_API.md', import.meta.url), 'utf8'),
    },
  ],
}));
server.tool(
  'docx_inspect',
  'Inspect embedded citation metadata, anchors, and file hash',
  { input: z.string() },
  async ({ input }) => ({
    content: [{ type: 'text', text: JSON.stringify(await inspectDocx(await readFile(input))) }],
  }),
);
server.tool(
  'docx_edit',
  'Edit a Word file without opening Word. Writes a new output file; requires inspected file hash.',
  {
    input: z.string(),
    output: z.string(),
    expectedFileHash: z.string(),
    expectedRevision: z.number().int(),
    operations: z.array(z.record(z.unknown())),
    repair: z.boolean().optional(),
  },
  async ({ input, output, ...args }) => {
    try {
      if (resolve(input) === resolve(output)) throw new Error('Output must differ from input');
      const result = await editDocx(await readFile(input), args);
      await writeFile(output, result.bytes, { flag: 'wx' });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, bytes: undefined, output }) }],
      };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
      };
    }
  },
);
await server.connect(new StdioServerTransport());
