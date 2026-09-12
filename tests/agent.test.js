import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import JSZip from 'jszip';
import { explainError } from '../agent/discovery.js';
execFileSync(process.execPath, ['scripts/build-agent.js']);
const bundle = resolve('dist/citeflow-agent.cjs');
const source = {
  type: 'article-journal',
  title: 'Test source',
  author: [{ family: 'Smith' }],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Journal',
};
const guards = (result) => ({
  expectedFileHash: result.fileHash,
  expectedRevision: result.document.revision,
});
test('standalone MCP agent creates, cites, replaces, edits and exports real files without browser or database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-agent-'));
  const client = new Client({ name: 'integration-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle, '--root', dir, 'mcp'],
    cwd: dir,
  });
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const guide = await client.readResource({ uri: 'citeflow://workflow' });
    assert.match(guide.contents[0].text, /Browser manipulation is not required/);
    assert.equal(tools.tools.length, 8);
    assert.ok(tools.tools.find((t) => t.name === 'docx_cite').inputSchema.properties.anchor);
    let r = await call('docx_create', {
      output: 'draft.docx',
      paragraphs: ['A private finding.', 'End.'],
    });
    assert.equal(r.paragraphs, undefined);
    let i = await call('docx_inspect', { input: 'draft.docx', includeParagraphs: true });
    assert.equal(i.paragraphs[0].text, 'A private finding.');
    r = await call('docx_cite', {
      input: 'draft.docx',
      output: 'cited.docx',
      ...guards(i),
      source,
      anchor: { exactText: 'A private finding.' },
      locator: '12',
      bibliography: true,
    });
    const oldId = r.results[0].sourceId;
    assert.equal(r.document.citations[0].items[0].locator, '12');
    r = await call('docx_replace_source', {
      input: 'cited.docx',
      output: 'replaced.docx',
      ...guards(r),
      fromSourceId: oldId,
      source: { ...source, title: 'Replacement source', author: [{ family: 'Mali' }] },
    });
    assert.equal(r.document.citations[0].items[0].locator, undefined);
    assert.equal(r.warnings.length, 2);
    r = await call('docx_edit', {
      input: 'replaced.docx',
      output: 'styled.docx',
      ...guards(r),
      operations: [{ type: 'style.set', style: 'apa' }],
    });
    const out = await call('docx_export', {
      input: 'styled.docx',
      output: 'collaborator.zip',
      ...guards(r),
      target: 'endnote',
    });
    assert.equal(out.nativeApplicationVerified, false);
    const archive = await JSZip.loadAsync(await readFile(out.output));
    assert.ok(archive.file('references.xml'));
    r = await call('docx_edit', {
      input: 'styled.docx',
      output: 'removed.docx',
      ...guards(r),
      operations: [{ type: 'citation.remove', citationId: r.document.citations[0].id }],
    });
    assert.equal(r.document.citations.length, 0);
    const denied = await client.callTool({
      name: 'sources_resolve',
      arguments: { input: '10.1234/test' },
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /disabled/);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('downloaded agent teaches its schemas and runs its offline example', async () => {
  const help = spawnSync(process.execPath, [bundle, '--help', 'docx_cite'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(help.status, 0, help.stderr);
  const schema = JSON.parse(help.stdout).docx_cite.inputSchema;
  assert.ok(schema.required.includes('expectedFileHash'));
  assert.ok(schema.properties.anchor.anyOf);
  assert.deepEqual(
    JSON.parse(await readFile('dist/agent-tools.json', 'utf8')).docx_cite.inputSchema,
    schema,
  );
  const doctor = spawnSync(process.execPath, [bundle, 'doctor'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(JSON.parse(doctor.stdout).browserRequired, false);
  const example = spawnSync(process.execPath, ['dist/agent-example.mjs'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(example.status, 0, example.stderr);
  const result = JSON.parse(example.stdout);
  assert.equal(result.success, true);
  assert.equal(result.citationCount, 1);
  await rm(resolve(result.output, '..'), { recursive: true, force: true });
  const failure = explainError(
    new Error('Private, local, and reserved network destinations are blocked'),
  );
  assert.equal(failure.code, 'SOURCE_NETWORK_POLICY');
  assert.match(failure.nextStep, /Offline citation editing still works/);
});
test('standalone CLI enforces workspace, guards, and no overwrite including symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-cli-'));
  const outside = await mkdtemp(join(tmpdir(), 'cf-outside-'));
  const call = (name, args) =>
    spawnSync(process.execPath, [bundle, '--root', dir, name], {
      input: JSON.stringify(args),
      encoding: 'utf8',
      cwd: dir,
    });
  try {
    const created = call('docx_create', { output: 'draft.docx', paragraphs: ['A finding.'] });
    assert.equal(created.status, 0, created.stderr);
    const r = JSON.parse(created.stdout),
      original = await readFile(r.output);
    assert.notEqual(
      call('docx_create', { output: 'draft.docx', paragraphs: ['Overwrite'] }).status,
      0,
    );
    assert.deepEqual(await readFile(r.output), original);
    assert.notEqual(call('docx_inspect', { input: join(outside, 'missing.docx') }).status, 0);
    const escaped = call('docx_create', {
      output: join(outside, 'escape.docx'),
      paragraphs: ['No'],
    });
    assert.match(escaped.stderr, /outside/);
    await symlink(outside, join(dir, 'outside'));
    assert.match(
      call('docx_create', { output: 'outside/escape.docx', paragraphs: ['No'] }).stderr,
      /outside/,
    );
    const stale = call('docx_edit', {
      input: 'draft.docx',
      output: 'stale.docx',
      ...guards(r),
      expectedFileHash: '0'.repeat(64),
      operations: [{ type: 'style.set', style: 'apa' }],
    });
    assert.match(stale.stderr, /changed since inspection/);
    const same = call('docx_edit', {
      input: 'draft.docx',
      output: 'draft.docx',
      ...guards(r),
      operations: [{ type: 'style.set', style: 'apa' }],
    });
    assert.match(same.stderr, /differ/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
