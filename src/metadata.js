import { load } from 'cheerio/slim';
import { normalizeSource } from './model.js';
export function fromCrossref(m) {
  const mapping = {
    'journal-article': 'article-journal',
    book: 'book',
    monograph: 'book',
    'book-chapter': 'chapter',
    'proceedings-article': 'paper-conference',
    dataset: 'dataset',
    report: 'report',
    'posted-content': 'article',
  };
  return normalizeSource({
    type: mapping[m.type] || 'article',
    title: m.title?.[0],
    author: (m.author || []).map((a) =>
      a.family
        ? { family: a.family, ...(a.given ? { given: a.given } : {}) }
        : { literal: a.name || 'Unknown' },
    ),
    DOI: m.DOI,
    URL: m.URL,
    'container-title': m['container-title']?.[0],
    publisher: m.publisher,
    volume: m.volume,
    issue: m.issue,
    page: m.page,
    ISBN: m.ISBN?.[0],
    issued: m.published || m['published-print'] || m['published-online'],
  });
}
function parsedDate(value) {
  const m = String(value || '').match(/^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
  return m ? { 'date-parts': [m.slice(1).filter(Boolean).map(Number)] } : undefined;
}
export function fromHTML(html, url) {
  const $ = load(html),
    meta = {};
  $('meta').each((_i, el) => {
    const key = ($(el).attr('name') || $(el).attr('property') || '').toLowerCase(),
      value = $(el).attr('content');
    if (value) (meta[key] ??= []).push(value.trim());
  });
  const first = (...keys) => keys.map((k) => meta[k]?.[0]).find(Boolean);
  let schema;
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const raw = JSON.parse($(el).text());
      const entries = (Array.isArray(raw) ? raw : [raw]).flatMap((x) => x['@graph'] || [x]);
      schema ??= entries.find((x) =>
        [
          'ScholarlyArticle',
          'Article',
          'NewsArticle',
          'Book',
          'Chapter',
          'Report',
          'Dataset',
          'WebPage',
        ].includes(x['@type']),
      );
    } catch {
      /* Non-JSON scripts are ignored. */
    }
  });
  const journal = first('citation_journal_title');
  const type = journal
    ? 'article-journal'
    : {
        ScholarlyArticle: 'article-journal',
        Book: 'book',
        Chapter: 'chapter',
        Report: 'report',
        Dataset: 'dataset',
        Article: 'article',
        NewsArticle: 'article',
      }[schema?.['@type']] || 'webpage';
  const author = (meta.citation_author || meta['dc.creator'] || meta.author || []).map((name) =>
    name.includes(',')
      ? { family: name.split(',')[0].trim(), given: name.split(',').slice(1).join(',').trim() }
      : { literal: name },
  );
  if (!author.length && schema?.author)
    for (const a of Array.isArray(schema.author) ? schema.author : [schema.author])
      author.push(
        typeof a === 'string'
          ? { literal: a }
          : a.familyName
            ? { family: a.familyName, given: a.givenName || '' }
            : { literal: a.name || 'Unknown' },
      );
  const start = first('citation_firstpage'),
    end = first('citation_lastpage');
  return normalizeSource({
    type,
    title:
      first('citation_title', 'dc.title') ||
      schema?.headline ||
      schema?.name ||
      first('og:title') ||
      $('title').first().text().trim(),
    author,
    DOI: first('citation_doi'),
    URL: url,
    issued: parsedDate(
      first('citation_publication_date', 'citation_date', 'dc.date') || schema?.datePublished,
    ),
    'container-title': journal || schema?.isPartOf?.name,
    publisher: first('citation_publisher') || schema?.publisher?.name,
    volume: first('citation_volume'),
    issue: first('citation_issue'),
    page: start ? (end ? `${start}-${end}` : start) : undefined,
    ISBN: first('citation_isbn') || schema?.isbn,
    accessed: { 'date-parts': [new Date().toISOString().slice(0, 10).split('-').map(Number)] },
  });
}
