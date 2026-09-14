import { inspectDocx, editDocx, loadPackage, createDocx, importMendeleyDocx } from '../src/docx.js';
import { DOMParser } from '@xmldom/xmldom';
import { wordEditorDocument } from '../src/word-editor.js';
import { format } from '../src/format.js';
import { assert } from '../src/model.js';
import { exportHandoff } from '../src/handoff.js';

/** All document bytes remain in this object. No network capability is used here. */
export class LocalWorkspace {
  constructor() {
    this.bytes = null;
    this.history = [];
    this.future = [];
    this.filename = 'manuscript.docx';
  }
  async open(bytes, filename) {
    assert(bytes instanceof Uint8Array, 'Expected local file bytes');
    const imported = await importMendeleyDocx(bytes);
    bytes = imported.bytes;
    const verified = await inspectDocx(bytes);
    format(verified.document);
    this.bytes = bytes.slice();
    this.filename = filename;
    this.history = [];
    this.future = [];
    return { ...(await this.inspect()), importReport: imported.report };
  }
  async inspect() {
    assert(this.bytes, 'Open a Word document first');
    const inspection = await inspectDocx(this.bytes);
    const pack = await loadPackage(this.bytes);
    const numbering = pack.zip.file('word/numbering.xml')
      ? new DOMParser().parseFromString(
          await pack.zip.file('word/numbering.xml').async('string'),
          'application/xml',
        )
      : null;
    return {
      ...inspection,
      rendered: format(inspection.document),
      filename: this.filename,
      undoCount: this.history.length,
      redoCount: this.future.length,
      editor: wordEditorDocument(pack.root, numbering),
    };
  }
  async edit(operations, { repair = false } = {}) {
    const before = await this.inspect();
    const edited = await editDocx(this.bytes, {
      expectedFileHash: before.fileHash,
      expectedRevision: before.document.revision,
      operations,
      repair,
    });
    return this.commitEdit(edited);
  }
  async citeSource(source, anchor, leadingSpace = false) {
    const before = await this.inspect();
    const staged = await editDocx(this.bytes, {
      expectedFileHash: before.fileHash,
      expectedRevision: before.document.revision,
      operations: [{ type: 'source.upsert', source }],
    });
    const verified = await inspectDocx(staged.bytes);
    const edited = await editDocx(staged.bytes, {
      expectedFileHash: verified.fileHash,
      expectedRevision: verified.document.revision,
      operations: [
        {
          type: 'citation.insert',
          items: [{ id: staged.results[0].sourceId }],
          anchor,
          leadingSpace,
        },
      ],
    });
    // Commit both steps together: failed insertion leaves no unused source, and Undo restores both.
    return this.commitEdit(edited);
  }
  async commitEdit(edited) {
    this.future = [];
    this.history.push(this.bytes);
    while (
      this.history.length > 10 ||
      this.history.reduce((n, b) => n + b.byteLength, 0) > 100_000_000
    )
      this.history.shift();
    this.bytes = edited.bytes;
    return { ...(await this.inspect()), results: edited.results };
  }
  async undo() {
    assert(this.history.length, 'No earlier local revision');
    this.future.push(this.bytes);
    this.bytes = this.history.pop();
    return this.inspect();
  }
  async redo() {
    assert(this.future.length, 'No later local revision');
    this.history.push(this.bytes);
    this.bytes = this.future.pop();
    return this.inspect();
  }
  async create() {
    return this.open(await createDocx(['']), 'Untitled.docx');
  }
  download() {
    assert(this.bytes, 'Open a Word document first');
    return this.bytes.slice();
  }
  exportHandoff(target) {
    assert(this.bytes, 'Open a Word document first');
    return exportHandoff(this.bytes, target);
  }
  close() {
    this.bytes = null;
    this.history = [];
    this.future = [];
  }
}
