import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { apply, assert, hash, id, newDocument, validate } from './model.js';
export class Store {
  constructor(path = process.env.CITEFLOW_DB || 'data/citeflow.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS library(key TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(doc TEXT, key TEXT, hash TEXT, result TEXT, PRIMARY KEY(doc,key));
      CREATE TABLE IF NOT EXISTS history(doc TEXT, revision INTEGER, body TEXT, PRIMARY KEY(doc,revision));`);
  }
  close() {
    this.db.close();
  }
  create(title, style = 'vancouver') {
    assert(['apa', 'vancouver', 'harvard1'].includes(style), 'Unsupported style');
    const d = newDocument(title, style);
    this.db.prepare('INSERT INTO documents VALUES(?,?)').run(d.id, JSON.stringify(d));
    return d;
  }
  list() {
    return this.db
      .prepare('SELECT body FROM documents')
      .all()
      .map((x) => {
        const d = JSON.parse(x.body);
        return { id: d.id, title: d.title, revision: d.revision };
      });
  }
  get(docId) {
    const row = this.db.prepare('SELECT body FROM documents WHERE id=?').get(docId);
    assert(row, 'Document not found', 404);
    return JSON.parse(row.body);
  }
  transact(docId, { expectedRevision, requestId, operations }) {
    assert(Number.isInteger(expectedRevision), 'expectedRevision is required');
    assert(
      typeof requestId === 'string' && requestId.length > 0 && requestId.length < 200,
      'requestId is required',
    );
    assert(
      Array.isArray(operations) && operations.length > 0 && operations.length <= 500,
      'Provide 1–500 operations',
    );
    const signature = hash({ expectedRevision, operations });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db
        .prepare('SELECT hash,result FROM requests WHERE doc=? AND key=?')
        .get(docId, requestId);
      if (prior) {
        assert(
          prior.hash === signature,
          'requestId was already used with different arguments',
          409,
        );
        this.db.exec('COMMIT');
        return { ...JSON.parse(prior.result), replayed: true };
      }
      const doc = this.get(docId);
      assert(
        doc.revision === expectedRevision,
        'Document changed; read the current revision and retry',
        409,
      );
      this.db
        .prepare('INSERT INTO history VALUES(?,?,?)')
        .run(docId, doc.revision, JSON.stringify(doc));
      const results = operations.map((op) => apply(doc, op));
      doc.revision++;
      doc.updatedAt = new Date().toISOString();
      this.db.prepare('UPDATE documents SET body=? WHERE id=?').run(JSON.stringify(doc), docId);
      const result = { document: doc, results, issues: validate(doc) };
      this.db
        .prepare('INSERT INTO requests VALUES(?,?,?,?)')
        .run(docId, requestId, signature, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  restore(docId, expectedRevision, targetRevision) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(docId);
      assert(current.revision === expectedRevision, 'Revision conflict', 409);
      const row = this.db
        .prepare('SELECT body FROM history WHERE doc=? AND revision=?')
        .get(docId, targetRevision);
      assert(row, 'Historical revision not found', 404);
      const doc = JSON.parse(row.body);
      doc.revision = current.revision + 1;
      doc.updatedAt = new Date().toISOString();
      this.db
        .prepare('INSERT INTO history VALUES(?,?,?)')
        .run(docId, current.revision, JSON.stringify(current));
      this.db.prepare('UPDATE documents SET body=? WHERE id=?').run(JSON.stringify(doc), docId);
      this.db.exec('COMMIT');
      return doc;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  cache(key, source) {
    this.db.prepare('INSERT OR REPLACE INTO library VALUES(?,?)').run(key, JSON.stringify(source));
  }
  cached(key) {
    const row = this.db.prepare('SELECT body FROM library WHERE key=?').get(key);
    return row ? JSON.parse(row.body) : null;
  }
  library() {
    return this.db
      .prepare('SELECT body FROM library')
      .all()
      .map((x) => JSON.parse(x.body));
  }
  import(document) {
    assert(
      document?.schemaVersion === 1 && document.sources && Array.isArray(document.citations),
      'Invalid portable document',
    );
    assert(
      Object.keys(document.sources).length <= 5000 && document.citations.length <= 20000,
      'Document exceeds citation limits',
    );
    const snapshot = structuredClone(document);
    const fresh = newDocument(snapshot.title, snapshot.style);
    snapshot.id = fresh.id;
    snapshot.revision = 0;
    snapshot.updatedAt = fresh.updatedAt;
    assert(['apa', 'vancouver', 'harvard1'].includes(snapshot.style), 'Unsupported style');
    assert(
      snapshot.bibliography && typeof snapshot.bibliography.heading === 'string',
      'Bibliography metadata required',
    );
    for (const [sid, s] of Object.entries(snapshot.sources)) {
      assert(!['__proto__', 'constructor', 'prototype'].includes(sid), 'Reserved source ID');
      const temp = newDocument();
      const result = apply(temp, { type: 'source.upsert', source: s });
      snapshot.sources[sid] = { ...temp.sources[result.sourceId], id: sid };
    }
    assert(
      !validate(snapshot).some((x) => ['missing-source', 'duplicate-occurrence'].includes(x.code)),
      'Broken portable citation links',
    );
    for (const c of snapshot.citations)
      apply({ ...snapshot, citations: [] }, { type: 'citation.insert', id: c.id, items: c.items });
    this.db.prepare('INSERT INTO documents VALUES(?,?)').run(snapshot.id, JSON.stringify(snapshot));
    return snapshot;
  }
}
