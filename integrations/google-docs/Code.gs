/** CiteFlow bound Apps Script. Human adapter preview; see docs/INTEGRATIONS.md. */
var CF_PREFIX = 'citeflow:citation:';
function onOpen() {
  DocumentApp.getUi()
    .createMenu('CiteFlow')
    .addItem('Configure server', 'cfConfigure')
    .addSeparator()
    .addItem('Add citation from URL', 'cfAdd')
    .addItem('Edit selected citation', 'cfEdit')
    .addItem('Remove selected citation', 'cfRemove')
    .addItem('Change citation style', 'cfStyle')
    .addItem('Reference list here', 'cfBibliography')
    .addItem('Refresh citations', 'cfRefresh')
    .addToUi();
}
function cfPrompt(title, message) {
  var r = DocumentApp.getUi().prompt(title, message, DocumentApp.getUi().ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === DocumentApp.getUi().Button.OK ? r.getResponseText() : null;
}
function cfConfigure() {
  var url = cfPrompt('CiteFlow server', 'HTTPS URL of your private CiteFlow service');
  if (!url) return;
  if (!/^https:\/\//.test(url)) throw new Error('HTTPS required');
  var token = cfPrompt('Access token', 'Token for your CiteFlow service');
  if (!token) return;
  PropertiesService.getUserProperties().setProperties({
    CF_URL: url.replace(/\/$/, ''),
    CF_TOKEN: token,
  });
}
function cfCall(method, args) {
  var p = PropertiesService.getUserProperties();
  var response = UrlFetchApp.fetch(p.getProperty('CF_URL') + '/api/call', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + p.getProperty('CF_TOKEN') },
    payload: JSON.stringify({ method: method, args: args }),
    muteHttpExceptions: true,
  });
  var data = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200) throw new Error(data.error);
  return data.result;
}
function cfTab() {
  return DocumentApp.getActiveDocument().getActiveTab().asDocumentTab();
}
function cfKey() {
  return 'CF_' + DocumentApp.getActiveDocument().getActiveTab().getId() + '_';
}
function cfRead() {
  var p = PropertiesService.getDocumentProperties(),
    prefix = cfKey(),
    count = Number(p.getProperty(prefix + 'count') || 0),
    json = '';
  for (var i = 0; i < count; i++) json += p.getProperty(prefix + i) || '';
  return json
    ? JSON.parse(json)
    : {
        schemaVersion: 1,
        id: Utilities.getUuid(),
        title: DocumentApp.getActiveDocument().getName(),
        revision: 0,
        style: 'vancouver',
        sources: {},
        citations: [],
        bibliography: { id: Utilities.getUuid(), heading: 'References' },
      };
}
function cfSave(doc) {
  var json = JSON.stringify(doc),
    p = PropertiesService.getDocumentProperties(),
    prefix = cfKey();
  if (json.length > 120000) throw new Error('Tab metadata exceeds this preview’s storage limit');
  var old = Number(p.getProperty(prefix + 'count') || 0),
    parts = {};
  for (var i = 0; i < json.length; i += 2000) parts[prefix + i / 2000] = json.slice(i, i + 2000);
  parts[prefix + 'count'] = String(Math.ceil(json.length / 2000));
  p.setProperties(parts);
  for (var j = Number(parts[prefix + 'count']); j < old; j++) p.deleteProperty(prefix + j);
}
function cfLocked(fn) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
function cfCompute(doc, operations) {
  return cfCall('documents.compute', {
    document: doc,
    expectedRevision: doc.revision,
    operations: operations,
  });
}
function cfRanges() {
  return cfTab()
    .getNamedRanges()
    .filter(function (r) {
      return r.getName().indexOf(CF_PREFIX) === 0;
    });
}
function cfPath(element) {
  var result = [];
  while (element.getParent()) {
    var parent = element.getParent();
    if (parent.getChildIndex) result.unshift(parent.getChildIndex(element));
    element = parent;
  }
  return result.join('/');
}
function cfSelected() {
  var cursor = DocumentApp.getActiveDocument().getCursor();
  if (!cursor || cursor.getElement().getType() !== DocumentApp.ElementType.TEXT)
    throw new Error('Place the cursor inside a citation');
  var matches = cfRanges().filter(function (r) {
    return r
      .getRange()
      .getRangeElements()
      .some(function (e) {
        return (
          e.getElement().getType() === DocumentApp.ElementType.TEXT &&
          cfPath(e.getElement()) === cfPath(cursor.getElement()) &&
          cursor.getOffset() >= e.getStartOffset() &&
          cursor.getOffset() <= e.getEndOffsetInclusive() + 1
        );
      });
  });
  if (matches.length !== 1) throw new Error('Select one unambiguous citation');
  return matches[0];
}
function cfReplace(range, text) {
  var elements = range.getRange().getRangeElements();
  if (
    elements.length !== 1 ||
    !elements[0].isPartial() ||
    elements[0].getElement().getType() !== DocumentApp.ElementType.TEXT
  )
    throw new Error('Citation range split or damaged; repair required');
  var e = elements[0],
    node = e.getElement().asText(),
    start = e.getStartOffset(),
    end = e.getEndOffsetInclusive(),
    name = range.getName();
  range.remove();
  node.deleteText(start, end);
  node.insertText(start, text);
  return cfTab().addNamedRange(
    name,
    cfTab()
      .newRange()
      .addElement(node, start, start + text.length - 1)
      .build(),
  );
}
function cfAdd() {
  var input = cfPrompt('Add citation', 'Source URL, DOI, or PMID:123');
  if (!input) return;
  var resolved = cfCall('sources.resolve', { input: input });
  var answer = DocumentApp.getUi().alert(
    'Confirm source',
    resolved.source.title + '\n' + resolved.warnings.join('\n'),
    DocumentApp.getUi().ButtonSet.OK_CANCEL,
  );
  if (answer !== DocumentApp.getUi().Button.OK) return;
  cfLocked(function () {
    var cursor = DocumentApp.getActiveDocument().getCursor();
    if (!cursor) throw new Error('Place the cursor where the citation belongs');
    var doc = cfRead(),
      saved = cfCompute(doc, [{ type: 'source.upsert', source: resolved.source }]),
      cid = Utilities.getUuid(),
      result = cfCompute(saved.document, [
        { type: 'citation.insert', id: cid, items: [{ id: saved.results[0].sourceId }] },
      ]);
    var value = result.rendered.citations[cid],
      node = cursor.insertText(value);
    if (!node) throw new Error('Cannot insert citation here');
    cfTab().addNamedRange(
      CF_PREFIX + cid,
      cfTab()
        .newRange()
        .addElement(node, 0, value.length - 1)
        .build(),
    );
    cfSave(result.document);
    cfRefreshInner();
  });
}
function cfEdit() {
  var range = cfSelected(),
    doc = cfRead(),
    cid = range.getName().slice(CF_PREFIX.length),
    citation = doc.citations.filter(function (c) {
      return c.id === cid;
    })[0];
  if (!citation) throw new Error('Unknown citation');
  var json = cfPrompt(
    'Edit citation group',
    'Edit source IDs and optional locator/label:\n' + JSON.stringify(citation.items),
  );
  if (!json) return;
  cfLocked(function () {
    var latest = cfRead();
    if (latest.revision !== doc.revision) throw new Error('Document changed');
    var result = cfCompute(latest, [
      { type: 'citation.update', citationId: cid, items: JSON.parse(json) },
    ]);
    cfReplace(range, result.rendered.citations[cid]);
    cfSave(result.document);
    cfRefreshInner();
  });
}
function cfRemove() {
  cfLocked(function () {
    var range = cfSelected(),
      cid = range.getName().slice(CF_PREFIX.length),
      e = range.getRange().getRangeElements();
    if (e.length !== 1 || !e[0].isPartial()) throw new Error('Split citation range');
    var result = cfCompute(cfRead(), [{ type: 'citation.remove', citationId: cid }]);
    range.remove();
    e[0].getElement().asText().deleteText(e[0].getStartOffset(), e[0].getEndOffsetInclusive());
    cfSave(result.document);
    cfRefreshInner();
  });
}
function cfStyle() {
  var style = cfPrompt('Citation style', 'vancouver, apa, or harvard1');
  if (!style) return;
  cfLocked(function () {
    var result = cfCompute(cfRead(), [{ type: 'style.set', style: style }]);
    cfSave(result.document);
    cfRefreshInner(true);
  });
}
function cfBibliography() {
  cfLocked(function () {
    if (cfTab().getNamedRanges('citeflow:bibliography').length)
      throw new Error(
        'Move the existing reference-list text with its range, or remove it before placing another',
      );
    var doc = cfRead(),
      formatted = cfCall('documents.format', { document: doc }),
      value = doc.bibliography.heading + '\n' + formatted.bibliography.join('\n'),
      cursor = DocumentApp.getActiveDocument().getCursor();
    if (!cursor) throw new Error('Place the cursor for the reference list');
    var node = cursor.insertText(value);
    if (!node) throw new Error('Cannot insert here');
    cfTab().addNamedRange(
      'citeflow:bibliography',
      cfTab()
        .newRange()
        .addElement(node, 0, value.length - 1)
        .build(),
    );
    cfSave(doc);
  });
}
function cfRefresh() {
  cfLocked(function () {
    cfRefreshInner();
  });
}
function cfRefreshInner(repair) {
  var doc = cfRead(),
    ranges = cfRanges(),
    seen = {};
  var ordered = [];
  var body = cfTab().getBody();
  function position(element) {
    var path = [];
    while (element.getParent()) {
      var parent = element.getParent();
      if (parent.getChildIndex) path.unshift(parent.getChildIndex(element));
      element = parent;
    }
    return path;
  }
  ranges.forEach(function (r) {
    var cid = r.getName().slice(CF_PREFIX.length);
    if (seen[cid]) throw new Error('Duplicate citation anchor');
    seen[cid] = true;
    var c = doc.citations.filter(function (c) {
      return c.id === cid;
    })[0];
    if (!c) throw new Error('Unknown citation anchor');
    var e = r.getRange().getRangeElements();
    if (e.length !== 1 || !e[0].isPartial()) throw new Error('Split citation range');
    ordered.push({
      citation: c,
      range: r,
      path: position(e[0].getElement()).concat(e[0].getStartOffset()),
    });
  });
  ordered.sort(function (a, b) {
    for (var i = 0; i < Math.min(a.path.length, b.path.length); i++)
      if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
    return a.path.length - b.path.length;
  });
  var before = cfCall('documents.format', { document: doc });
  if (!repair)
    ordered.forEach(function (a) {
      var e = a.range.getRange().getRangeElements()[0],
        visible = e
          .getElement()
          .asText()
          .getText()
          .slice(e.getStartOffset(), e.getEndOffsetInclusive() + 1);
      if (visible !== before.citations[a.citation.id])
        throw new Error('Citation text changed manually; inspect before refresh');
    });
  doc.citations = ordered.map(function (a) {
    return a.citation;
  });
  var result = cfCompute(doc, []);
  ordered.reverse().forEach(function (a) {
    cfReplace(a.range, result.rendered.citations[a.citation.id]);
  });
  cfTab()
    .getNamedRanges('citeflow:bibliography')
    .forEach(function (r) {
      cfReplace(
        r,
        result.document.bibliography.heading + '\n' + result.rendered.bibliography.join('\n'),
      );
    });
  cfSave(result.document);
}
