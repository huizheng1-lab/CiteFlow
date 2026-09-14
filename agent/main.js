#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FileAgent, definitions } from './api.js';
import { workflow, schemas, explainError } from './discovery.js';
import { realpath, stat } from 'node:fs/promises';

async function main() {
  const argv = process.argv.slice(2);
  let root = process.cwd(),
    allowOnline = false;
  for (let i = 0; i < argv.length;) {
    if (argv[i] === '--root') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new Error('--root requires a directory');
      root = argv[i + 1];
      argv.splice(i, 2);
    } else if (argv[i] === '--allow-online') {
      allowOnline = true;
      argv.splice(i, 1);
    } else i++;
  }
  const api = new FileAgent(root, { allowOnline });
  const error = explainError;
  if (argv[0] === 'mcp') {
    const server = new McpServer({ name: 'citeflow-local', version: '0.6.4' });
    server.resource('workflow', 'citeflow://workflow', async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/plain', text: workflow }],
    }));
    for (const [name, definition] of Object.entries(definitions)) {
      server.tool(name, definition.description, definition.schema.shape, async (args) => {
        try {
          const result = await api.call(name, args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify(error(e)) }] };
        }
      });
    }
    await server.connect(new StdioServerTransport());
  } else {
    try {
      if (argv[0] === '--schema' || (argv[0] === '--help' && argv[1])) {
        if (argv.length > 2) throw new Error('Use --schema [TOOL] or --help TOOL');
        console.log(JSON.stringify(schemas(argv[1]), null, 2));
      } else if (argv[0] === 'doctor') {
        if (argv.length !== 1) throw new Error('doctor takes no JSON arguments');
        const directory = await realpath(root);
        if (!(await stat(directory)).isDirectory())
          throw new Error('Workspace must be a directory');
        const [major, minor] = process.versions.node.split('.').map(Number);
        const supported = major > 22 || (major === 22 && minor >= 13);
        console.log(
          JSON.stringify(
            {
              ok: supported,
              version: '0.6.4',
              node: process.version,
              workspace: directory,
              onlineLookup: allowOnline,
              browserRequired: false,
              next: 'Run --help docx_inspect, then --help docx_cite. Read the workflow below.',
              workflow,
            },
            null,
            2,
          ),
        );
        if (!supported) process.exitCode = 1;
      } else if (!argv.length || argv[0] === '--help') {
        console.log(
          JSON.stringify(
            {
              usage:
                'node citeflow-agent.cjs [--root DIRECTORY] [--allow-online] TOOL < request.json; use mcp for stdio MCP',
              onboarding: ['doctor', '--help docx_inspect', '--help docx_cite', '--schema'],
              workflow,
              tools: Object.fromEntries(
                Object.entries(definitions).map(([name, d]) => [name, d.description]),
              ),
              privacy:
                'Local processing. Inspection output is visible to the calling agent. Online lookup is disabled by default.',
            },
            null,
            2,
          ),
        );
      } else {
        if (argv.length !== 1)
          throw new Error('Expected one tool name and JSON arguments on stdin');
        let input = '';
        for await (const chunk of process.stdin) {
          input += chunk;
          if (Buffer.byteLength(input) > 4_000_000) throw new Error('JSON request exceeds 4 MB');
        }
        console.log(
          JSON.stringify(await api.call(argv[0], input.trim() ? JSON.parse(input) : {}), null, 2),
        );
      }
    } catch (e) {
      console.error(JSON.stringify(error(e)));
      process.exitCode = 1;
    }
  }
}
main().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exitCode = 1;
});
