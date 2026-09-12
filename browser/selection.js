export function insertionFromSelection(selection) {
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0),
    end = range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer;
  const p = end?.closest?.('[data-paragraph]');
  if (!p || p.classList.contains('managed')) return null;
  if (!p.contains(range.startContainer) || !p.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(p);
  before.setEnd(range.endContainer, range.endOffset);
  return {
    paragraphIndex: Number(p.dataset.paragraph),
    paragraphText: p.textContent,
    endOffset: before.toString().length,
  };
}
