import { load } from 'cheerio/slim';
const escape = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
// Small, explicit formatting vocabulary. Source content cannot insert scripts or links.
export function richRuns(html) {
  const $ = load(html, null, false),
    runs = [];
  function walk(node, style = {}) {
    if (node.type === 'text') {
      if (node.data) runs.push({ text: node.data, ...style });
      return;
    }
    if (['script', 'style', 'iframe', 'object', 'img'].includes(node.name)) return;
    const next = { ...style };
    if (['i', 'em'].includes(node.name)) next.italic = true;
    if (['b', 'strong'].includes(node.name)) next.bold = true;
    if (node.name === 'sup') next.superscript = true;
    if (node.name === 'sub') next.subscript = true;
    const css = node.attribs?.style || '';
    if (/font-variant:\s*small-caps/.test(css)) next.smallCaps = true;
    if (/font-style:\s*italic/.test(css)) next.italic = true;
    for (const child of node.children || []) walk(child, next);
  }
  for (const node of $.root()[0].children) walk(node);
  // citeproc bibliography entries include an outer trailing newline.
  while (runs.length && /^\s*$/.test(runs.at(-1).text)) runs.pop();
  return runs;
}
export function safeHTML(html) {
  return richRuns(html)
    .map((r) => {
      let s = escape(r.text);
      if (r.italic) s = '<i>' + s + '</i>';
      if (r.bold) s = '<b>' + s + '</b>';
      if (r.superscript) s = '<sup>' + s + '</sup>';
      if (r.subscript) s = '<sub>' + s + '</sub>';
      if (r.smallCaps) s = '<span style="font-variant:small-caps">' + s + '</span>';
      return s;
    })
    .join('');
}
