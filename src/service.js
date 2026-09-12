import { id, assert, apply, clone, validate } from './model.js';
import { format } from './format.js';
import { resolveSource } from './resolver.js';
import { googleEditPlan, editGoogleDocument } from './google-docs.js';
export async function dispatch(store, name, args = {}) {
  switch (name) {
    case 'google.plan':
      return googleEditPlan(args.googleDocument, args.document, args.operations, {
        repair: args.repair,
      });
    case 'google.edit':
      return editGoogleDocument(args.googleDocumentId, args.document, args.operations, {
        accessToken: args.accessToken || process.env.CITEFLOW_GOOGLE_TOKEN,
        repair: args.repair,
      });
    case 'documents.list':
      return store.list();
    case 'documents.create':
      return store.create(args.title, args.style);
    case 'documents.inspect': {
      const document = store.get(args.documentId);
      return { document, rendered: format(document), issues: validate(document) };
    }
    case 'documents.edit':
      return store.transact(args.documentId, args);
    case 'documents.restore':
      return store.restore(args.documentId, args.expectedRevision, args.targetRevision);
    case 'documents.import':
      return store.import(args.document);
    case 'sources.resolve':
      return resolveSource(args.input, { store, refresh: args.refresh });
    case 'library.list':
      return store.library();
    case 'documents.format':
      return format(args.document || store.get(args.documentId), args.output || 'text');
    case 'documents.compute': {
      const document = clone(args.document);
      assert(
        document?.schemaVersion === 1 && Array.isArray(document.citations),
        'Invalid document snapshot',
      );
      assert(document.revision === args.expectedRevision, 'Revision conflict', 409);
      const results = args.operations.map((op) => apply(document, op));
      document.revision++;
      document.updatedAt = new Date().toISOString();
      return { document, results, rendered: format(document), issues: validate(document) };
    }
    default:
      throw Object.assign(new Error('Unknown method'), { status: 404 });
  }
}
