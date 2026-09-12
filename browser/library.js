import { importSources } from '../src/import-sources.js';
import { normalizeSource, sourceKey, assert } from '../src/model.js';
export class LocalLibrary {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }
  read() {
    const raw = this.storage.getItem('citeflow.library.v1');
    if (!raw) return [];
    const items = JSON.parse(raw);
    assert(Array.isArray(items), 'Local library is invalid; restore a backup');
    return items.map(normalizeSource);
  }
  save(source) {
    const normalized = normalizeSource(source),
      items = this.read(),
      key = sourceKey(normalized);
    const old = items.find((x) => sourceKey(x) === key);
    if (!old) items.push(normalized);
    this.storage.setItem('citeflow.library.v1', JSON.stringify(items));
    return old || normalized;
  }
  export() {
    return JSON.stringify({ schemaVersion: 1, sources: this.read() }, null, 2);
  }
  import(raw) {
    const incoming = importSources(raw).sources,
      items = this.read(),
      keys = new Set(items.map(sourceKey));
    for (const s of incoming)
      if (!keys.has(sourceKey(s))) {
        items.push(s);
        keys.add(sourceKey(s));
      }
    this.storage.setItem('citeflow.library.v1', JSON.stringify(items));
    return items.length;
  }
  clear() {
    this.storage.removeItem('citeflow.library.v1');
  }
}
