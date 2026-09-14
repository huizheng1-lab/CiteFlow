import { importSources } from '../src/import-sources.js';
import { normalizeSource, exactSourceKey, assert } from '../src/model.js';
import { exportSources } from '../src/export-sources.js';
export class LocalLibrary {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }
  read() {
    const raw = this.storage.getItem('citeflow.library.v1');
    if (!raw) return [];
    const items = JSON.parse(raw);
    assert(Array.isArray(items), 'Local library is invalid; restore a backup');
    const seen = new Set();
    return items.map(normalizeSource).filter((source) => {
      const key = exactSourceKey(source);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  save(source) {
    const normalized = normalizeSource(source),
      items = this.read(),
      key = exactSourceKey(normalized);
    const old = items.find((x) => exactSourceKey(x) === key);
    if (!old) items.push(normalized);
    this.storage.setItem('citeflow.library.v1', JSON.stringify(items));
    return old || normalized;
  }
  export(format = 'json') {
    return exportSources(this.read(), format);
  }
  import(raw) {
    return this.include(importSources(raw).sources);
  }
  include(incoming) {
    incoming = incoming.map(normalizeSource);
    const items = this.read(),
      keys = new Set(items.map(exactSourceKey));
    for (const s of incoming)
      if (!keys.has(exactSourceKey(s))) {
        items.push(s);
        keys.add(exactSourceKey(s));
      }
    this.storage.setItem('citeflow.library.v1', JSON.stringify(items));
    return items.length;
  }
  clear() {
    this.storage.removeItem('citeflow.library.v1');
  }
}
