import { LocalWorkspace } from './workspace.js';
const workspace = new LocalWorkspace();
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const methods = {
        open: () => workspace.open(data.bytes, data.filename),
        inspect: () => workspace.inspect(),
        edit: () => workspace.edit(data.operations, data.options),
        undo: () => workspace.undo(),
        download: () => workspace.download(),
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
