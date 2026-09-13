import { wordEditorDocument } from '../src/word-editor.js';
import { DOMParser } from '@xmldom/xmldom';
import { readFile, realpath, stat, writeFile, link, unlink } from 'node:fs/promises';
import { resolve, relative, dirname, basename, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createDocx, inspectDocx, editDocx, fileHash, loadPackage } from '../src/docx.js';
import { exportHandoff } from '../src/handoff.js';
import { resolveSource } from '../src/resolver.js';
import { importSources } from '../src/import-sources.js';
import { assert } from '../src/model.js';

const path = z.string().min(1);
const source = z
  .object({
    type: z.enum([
      'article-journal',
      'book',
      'chapter',
      'webpage',
      'report',
      'dataset',
      'paper-conference',
      'thesis',
      'article',
    ]),
    title: z.string().min(1),
    author: z
      .array(
        z.object({
          family: z.string().optional(),
          given: z.string().optional(),
          literal: z.string().optional(),
        }),
      )
      .optional(),
    issued: z.object({ 'date-parts': z.array(z.array(z.number().int())) }).optional(),
    DOI: z.string().optional(),
    URL: z.string().optional(),
  })
  .passthrough()
  .describe('Reviewed CSL JSON metadata. Lookup does not verify support for manuscript claims.');
const item = z
  .object({
    id: z.string(),
    locator: z.string().optional(),
    label: z
      .enum(['page', 'chapter', 'section', 'figure', 'table', 'paragraph', 'volume', 'issue'])
      .optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
  })
  .strict();
const anchor = z.union([
  z.object({ exactText: z.string().min(1) }).strict(),
  z
    .object({
      paragraphIndex: z.number().int().nonnegative(),
      paragraphText: z.string(),
      endOffset: z.number().int().nonnegative(),
    })
    .strict(),
]);
const operation = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('source.upsert'),
      source,
      allowDuplicate: z
        .boolean()
        .optional()
        .describe(
          'Only after reviewing near duplicates: retain distinct metadata for the same identifier. Exact duplicates are still reused.',
        ),
    }),
    z.object({
      type: z.literal('document.replace'),
      content: z
        .record(z.unknown())
        .describe(
          'Editor document JSON from docx_inspect with includeEditor=true. Preserve protected nodes and citation IDs; edit supported text, headings, lists and tables.',
        ),
    }),
    z.object({ type: z.literal('source.remove'), sourceId: z.string() }),
    z.object({ type: z.literal('source.merge'), from: z.string(), to: z.string() }),
    z.object({
      type: z.literal('source.update'),
      sourceId: z.string(),
      patch: z.record(z.unknown()),
    }),
    z.object({
      type: z.literal('source.replace'),
      from: z.string(),
      to: z.string(),
      citationId: z.string().optional(),
    }),
    z.object({
      type: z.literal('citation.insert'),
      id: z.string().optional(),
      items: z.array(item).min(1),
      anchor,
      leadingSpace: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('citation.update'),
      citationId: z.string(),
      items: z.array(item).min(1),
    }),
    z.object({ type: z.literal('citation.remove'), citationId: z.string() }),
    z.object({ type: z.literal('style.set'), style: z.enum(['vancouver', 'apa', 'harvard1']) }),
    z.object({ type: z.literal('bibliography.set'), heading: z.string() }),
    z.object({
      type: z.literal('bibliography.place'),
      anchor: z
        .object({
          exactParagraph: z.string(),
          paragraphIndex: z.number().int().nonnegative().optional(),
        })
        .strict()
        .optional(),
    }),
  ].map((s) => s.strict()),
);
const guards = {
  input: path,
  output: path,
  expectedFileHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().nonnegative(),
};
export const definitions = {
  sources_import: {
    description:
      'Import local RIS, BibTeX, EndNote XML, PubMed XML, or CSL JSON references offline. Returns normalized, deduplicated CSL sources for review and docx_cite/docx_edit. Does not modify a manuscript.',
    schema: z
      .object({
        input: path,
        format: z.enum(['auto', 'ris', 'bibtex', 'xml', 'json']).default('auto'),
      })
      .strict(),
  },
  docx_create: {
    description:
      'Create a new local Word document from plain paragraphs. Never overwrites files. Returns hash/revision for subsequent edits.',
    schema: z
      .object({
        output: path,
        paragraphs: z.array(z.string()).min(1).max(10000),
        style: z.enum(['vancouver', 'apa', 'harvard1']).optional(),
      })
      .strict(),
  },
  docx_inspect: {
    description:
      'Inspect citation IDs, source metadata, revision and file hash. Manuscript paragraphs are omitted unless includeParagraphs=true. Tool output is visible to the calling agent.',
    schema: z
      .object({
        input: path,
        includeParagraphs: z.boolean().default(false),
        includeEditor: z.boolean().default(false),
      })
      .strict(),
  },
  docx_edit: {
    description:
      'Apply typed citation/source/style/bibliography operations to a new local file. Use hash and revision from inspection; never guess stale guards. Return source IDs from upsert before citing them.',
    schema: z
      .object({
        ...guards,
        operations: z.array(operation).min(1).max(1000),
        repair: z.boolean().default(false),
      })
      .strict(),
  },
  docx_cite: {
    description:
      'Add/reuse reviewed source metadata and insert its citation at an exact text anchor in one call. Optional bibliography at end. Source lookup is separate so metadata can be reviewed first.',
    schema: z
      .object({
        ...guards,
        source,
        anchor,
        locator: z.string().optional(),
        bibliography: z.boolean().default(false),
      })
      .strict(),
  },
  docx_replace_source: {
    description:
      'Replace a cited source everywhere, or in one occurrence, using reviewed new metadata. Clears old locators by default because page numbers from another paper are not interchangeable. Does not rewrite manuscript prose.',
    schema: z
      .object({
        ...guards,
        fromSourceId: z.string(),
        source,
        citationId: z.string().optional(),
        preserveLocators: z.boolean().default(false),
      })
      .strict(),
  },
  docx_export: {
    description:
      'Export an experimental EndNote or Mendeley collaborator ZIP. Native Word add-in acceptance remains unverified. Original input is preserved.',
    schema: z.object({ ...guards, target: z.enum(['endnote', 'mendeley']) }).strict(),
  },
  sources_resolve: {
    description:
      'Look up bibliographic metadata from a public URL, DOI or PMID. Requires --allow-online. Sends only the identifier; never reads a manuscript. Review returned metadata before citing.',
    schema: z.object({ input: z.string().min(1).max(2048) }).strict(),
  },
};

export class FileAgent {
  constructor(root, { allowOnline = false } = {}) {
    this.root = resolve(root);
    this.allowOnline = allowOnline;
  }
  async bounded(name, output = false) {
    const root = await realpath(this.root);
    const requested = resolve(root, name);
    const actual = output
      ? resolve(await realpath(dirname(requested)), basename(requested))
      : await realpath(requested);
    const rel = relative(root, actual);
    assert(
      rel !== '..' &&
        !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
        !isAbsolute(rel),
      'Path is outside the configured workspace',
    );
    return actual;
  }
  async read(input) {
    const file = await this.bounded(input);
    const info = await stat(file);
    assert(
      info.isFile() && info.size <= 100_000_000,
      'Input must be a regular DOCX file of at most 100 MB',
    );
    return readFile(file);
  }
  async save(output, bytes) {
    const destination = await this.bounded(output, true);
    const temp = resolve(dirname(destination), '.citeflow-' + randomUUID() + '.tmp');
    try {
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      // Hard-link installation is atomic and fails if destination already exists.
      await link(temp, destination);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return destination;
  }
  async summarize(bytes, extra = {}) {
    const result = await inspectDocx(bytes);
    delete result.paragraphs;
    return { ...result, ...extra };
  }
  async call(name, input = {}) {
    assert(Object.hasOwn(definitions, name), 'Unknown agent tool');
    const args = definitions[name].schema.parse(input);
    if (name === 'sources_import') {
      const file = await this.bounded(args.input);
      const info = await stat(file);
      assert(
        info.isFile() && info.size <= 5_000_000,
        'Reference file must be a regular file of at most 5 MB',
      );
      return importSources(await readFile(file, 'utf8'), args.format);
    }
    if (name === 'sources_resolve') {
      assert(
        this.allowOnline,
        'Online source lookup is disabled. Start with --allow-online or supply reviewed metadata manually.',
      );
      return resolveSource(args.input);
    }
    if (name === 'docx_create') {
      let bytes = await createDocx(args.paragraphs);
      if (args.style) {
        const i = await inspectDocx(bytes);
        bytes = (
          await editDocx(bytes, {
            expectedFileHash: i.fileHash,
            expectedRevision: i.document.revision,
            operations: [{ type: 'style.set', style: args.style }],
          })
        ).bytes;
      }
      return this.summarize(bytes, { output: await this.save(args.output, bytes) });
    }
    let bytes = await this.read(args.input);
    const inspected = await inspectDocx(bytes);
    if (name === 'docx_inspect') {
      if (!args.includeParagraphs) delete inspected.paragraphs;
      if (args.includeEditor) {
        const pack = await loadPackage(bytes);
        const numbering = pack.zip.file('word/numbering.xml')
          ? new DOMParser().parseFromString(
              await pack.zip.file('word/numbering.xml').async('string'),
              'application/xml',
            )
          : null;
        inspected.editor = wordEditorDocument(pack.root, numbering);
      }
      return inspected;
    }
    assert(inspected.fileHash === args.expectedFileHash, 'DOCX changed since inspection', 409);
    assert(
      inspected.document.revision === args.expectedRevision,
      'Citation revision conflict',
      409,
    );
    assert(
      (await this.bounded(args.input)) !== (await this.bounded(args.output, true)),
      'Output must differ from input',
    );
    if (name === 'docx_export') {
      const result = await exportHandoff(bytes, args.target);
      return {
        output: await this.save(args.output, result),
        fileHash: fileHash(result),
        target: args.target,
        nativeApplicationVerified: false,
      };
    }
    const change = async (operations) => {
      const i = await inspectDocx(bytes);
      const edited = await editDocx(bytes, {
        expectedFileHash: i.fileHash,
        expectedRevision: i.document.revision,
        operations,
        repair: args.repair || false,
      });
      bytes = edited.bytes;
      return edited.results;
    };
    let results,
      warnings = [];
    if (name === 'docx_edit') results = await change(args.operations);
    else {
      if (name === 'docx_replace_source')
        assert(
          inspected.document.citations.some(
            (c) =>
              (!args.citationId || args.citationId === c.id) &&
              c.items.some((i) => i.id === args.fromSourceId),
          ),
          'The source is not cited in the requested scope',
        );
      const added = await change([{ type: 'source.upsert', source: args.source }]);
      const sid = added[0].sourceId;
      if (name === 'docx_cite') {
        results = [
          ...added,
          ...(await change([
            {
              type: 'citation.insert',
              items: [
                { id: sid, ...(args.locator ? { locator: args.locator, label: 'page' } : {}) },
              ],
              anchor: args.anchor,
              leadingSpace: true,
            },
            ...(args.bibliography ? [{ type: 'bibliography.place' }] : []),
          ])),
        ];
      } else {
        assert(
          sid !== args.fromSourceId,
          'Replacement identifies the same source. Use source.update for metadata corrections.',
        );
        const operations = inspected.document.citations
          .filter(
            (c) =>
              (!args.citationId || args.citationId === c.id) &&
              c.items.some((i) => i.id === args.fromSourceId),
          )
          .map((c) => ({
            type: 'citation.update',
            citationId: c.id,
            items: c.items.map((i) => {
              if (i.id !== args.fromSourceId) return i;
              const replacement = { ...i, id: sid };
              if (!args.preserveLocators) {
                delete replacement.locator;
                delete replacement.label;
              }
              return replacement;
            }),
          }));
        results = [...added, ...(await change(operations))];
        warnings = [
          'Review manuscript prose that names the previous source.',
          args.preserveLocators
            ? 'Old locators were retained; verify them against the new source.'
            : 'Locators on replaced items were cleared.',
        ];
      }
    }
    return this.summarize(bytes, {
      output: await this.save(args.output, bytes),
      results,
      warnings,
    });
  }
}
