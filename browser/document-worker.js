import { LocalWorkspace } from './workspace.js';
const workspace = new LocalWorkspace();
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const methods = {
        open: () => workspace.open(data.bytes, data.filename),
        inspect: () => workspace.inspect(),
        citeSource: () => workspace.citeSource(data.source, data.anchor, data.leadingSpace),
        edit: () => workspace.edit(data.operations, data.options),
        undo: () => workspace.undo(),
        download: () => workspace.download(),
        exportHandoff: () => workspace.exportHandoff(data.target),
        close: () => workspace.close(),
      };
      if (!methods[data.method]) throw new Error('Unknown local operation');
      const result = await methods[data.method]();
      self.postMessage(
        { id: data.id, result },
        result instanceof Uint8Array ? [result.buffer] : [],
      );
    } catch (e) {
      self.postMessage({ id: data.id, error: e.message });
    }
  });
};
