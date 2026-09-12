import { inspectDocx, editDocx } from '../src/docx.js';
import { format } from '../src/format.js';
import { assert } from '../src/model.js';

/** All document bytes remain in this object. No network capability is used here. */
export class LocalWorkspace {
  constructor() {
    this.bytes = null;
    this.history = [];
    this.filename = 'manuscript.docx';
  }
  async open(bytes, filename) {
    assert(bytes instanceof Uint8Array, 'Expected local file bytes');
    const verified = await inspectDocx(bytes);
    format(verified.document);
    this.bytes = bytes.slice();
    this.filename = filename;
    this.history = [];
    return this.inspect();
  }
  async inspect() {
    assert(this.bytes, 'Open a Word document first');
    const inspection = await inspectDocx(this.bytes);
    return {
      ...inspection,
      rendered: format(inspection.document),
      filename: this.filename,
      undoCount: this.history.length,
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
    this.bytes = this.history.pop();
    return this.inspect();
  }
  download() {
    assert(this.bytes, 'Open a Word document first');
    return this.bytes.slice();
  }
  close() {
    this.bytes = null;
    this.history = [];
  }
}
