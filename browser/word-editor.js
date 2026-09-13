import { Editor, Node, Mark, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Plugin, TextSelection } from '@tiptap/pm/state';

const ParagraphAlignment = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-align') || element.style.textAlign || null,
            renderHTML: (attrs) => (attrs.textAlign ? { 'data-align': attrs.textAlign } : {}),
          },
        },
      },
    ];
  },
});
const WordAttrs = Extension.create({
  name: 'wordAttrs',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'table', 'tableRow', 'tableCell', 'tableHeader'],
        attributes: {
          wordId: { default: null, renderHTML: () => ({}) },
          paragraphIndex: {
            default: null,
            renderHTML: (a) =>
              a.paragraphIndex == null ? {} : { 'data-paragraph': a.paragraphIndex },
          },
        },
      },
    ];
  },
});
const WordStyle = Mark.create({
  name: 'wordStyle',
  inclusive: true,
  addAttributes() {
    return { ref: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-word-style]',
        getAttrs: (el) => ({ ref: el.getAttribute('data-word-style') }),
      },
    ];
  },
  renderHTML({ mark }) {
    return ['span', { 'data-word-style': mark.attrs.ref }, 0];
  },
});
function atom(name, inline, attribute, css) {
  return Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        [attribute]: { default: null },
        label: { default: '' },
        sourceText: { default: '' },
      };
    },
    parseHTML() {
      return [
        {
          tag: `${inline ? 'span' : 'div'}[data-word-node="${name}"]`,
          getAttrs: (el) => ({
            [attribute]: el.getAttribute('data-word-ref'),
            label: el.textContent,
            sourceText: el.getAttribute('data-source-text') || '',
          }),
        },
      ];
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        inline ? 'span' : 'div',
        mergeAttributes(HTMLAttributes, {
          'data-word-node': name,
          'data-word-ref': node.attrs[attribute],
          'data-source-text': node.attrs.sourceText,
          contenteditable: 'false',
          class: css,
        }),
        node.attrs.label,
      ];
    },
    renderText({ node }) {
      return name === 'wordInline' ? node.attrs.sourceText : node.attrs.label;
    },
  });
}
const citation = atom('citation', true, 'citationId', 'citation-token');
const bibliography = atom('bibliography', false, 'wordId', 'bibliography-block');
const wordInline = atom('wordInline', true, 'wordId', 'word-preserved');
const wordBlock = atom('wordBlock', false, 'wordId', 'word-preserved word-preserved-block');
function protectedKeys(doc) {
  const out = [];
  doc.descendants((n) => {
    if (['wordInline', 'wordBlock'].includes(n.type.name)) out.push(n.attrs.wordId);
  });
  return out.sort().join('|');
}
export class WordEditor {
  constructor(element, callbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.editor = null;
    this.changed = false;
    this.snapshot = null;
  }
  show(snapshot, { preserveSelection = true } = {}) {
    const position = preserveSelection ? this.editor?.state.selection.from : null;
    this.editor?.destroy();
    this.element.replaceChildren();
    this.changed = false;
    this.snapshot = snapshot;
    if (!snapshot) {
      this.element.textContent = 'Create a document or open a Word file to start writing.';
      return;
    }
    const self = this;
    const protectedContent = Extension.create({
      name: 'protectWordContent',
      addProseMirrorPlugins() {
        return [
          new Plugin({
            filterTransaction(tr, state) {
              if (tr.docChanged && protectedKeys(tr.doc) !== protectedKeys(state.doc)) {
                self.callbacks.problem(
                  'This Word element is preserved. Edit the surrounding text; this element cannot be deleted or copied.',
                );
                return false;
              }
              return true;
            },
          }),
        ];
      },
    });
    this.editor = new Editor({
      element: this.element,
      injectCSS: false,
      editable: snapshot.editable,
      extensions: [
        StarterKit.configure({
          trailingNode: false,
          blockquote: false,
          codeBlock: false,
          code: false,
          horizontalRule: false,
          link: false,
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        WordAttrs,
        WordStyle,
        ParagraphAlignment.configure({ types: ['heading', 'paragraph'] }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        citation,
        bibliography,
        wordInline,
        wordBlock,
        protectedContent,
      ],
      content: snapshot.content,
      editorProps: {
        handleKeyDown(view) {
          // Native caret movement can precede the browser's selectionchange event.
          // Read it before an editing key uses a stale selected range.
          const selection = view.dom.ownerDocument.getSelection();
          if (
            view.state.selection instanceof TextSelection &&
            selection?.anchorNode &&
            view.dom.contains(selection.anchorNode) &&
            view.dom.contains(selection.focusNode)
          ) {
            const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
            const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
            if (anchor !== view.state.selection.anchor || head !== view.state.selection.head) {
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.between(
                    view.state.doc.resolve(anchor),
                    view.state.doc.resolve(head),
                  ),
                ),
              );
            }
          }
          return false;
        },
        attributes: {
          class: 'word-surface',
          role: 'textbox',
          'aria-label': 'Document editor',
          'aria-multiline': 'true',
          spellcheck: 'true',
        },
      },
      onUpdate() {
        self.changed = true;
        self.callbacks.change();
      },
      onSelectionUpdate() {
        self.callbacks.selection(self.anchor());
      },
    });
    if (position != null)
      this.editor.commands.setTextSelection(Math.min(position, this.editor.state.doc.content.size));
  }
  json() {
    return this.editor.getJSON();
  }
  setEditable(value) {
    this.editor?.setEditable(Boolean(value && this.snapshot?.editable), false);
  }
  anchor() {
    if (!this.editor) return null;
    const { $head } = this.editor.state.selection;
    let depth = $head.depth;
    while (depth && !['paragraph', 'heading'].includes($head.node(depth).type.name)) depth--;
    if (!depth) return null;
    const p = $head.node(depth);
    if (p.attrs.paragraphIndex == null) return null;
    const offset = $head.pos - $head.start(depth);
    const plain = (n) =>
      n.isText
        ? n.text
        : n.type.name === 'citation'
          ? n.attrs.label
          : n.type.name === 'wordInline'
            ? n.attrs.sourceText
            : '';
    let text = '',
      before = '',
      position = 0;
    p.forEach((n) => {
      const value = plain(n);
      text += value;
      if (offset >= position + n.nodeSize) before += value;
      else if (offset > position && n.isText) before += value.slice(0, offset - position);
      position += n.nodeSize;
    });
    return {
      paragraphIndex: p.attrs.paragraphIndex,
      paragraphText: text,
      endOffset: before.length,
    };
  }
  command(name, value) {
    if (!this.editor || !this.snapshot?.editable) return;
    this.editor.view.focus();
    const chain = this.editor.chain();
    const commands = {
      bold: () => chain.toggleBold(),
      italic: () => chain.toggleItalic(),
      underline: () => chain.toggleUnderline(),
      bullet: () => chain.toggleBulletList(),
      numbered: () => chain.toggleOrderedList(),
      left: () => chain.setTextAlign('left'),
      center: () => chain.setTextAlign('center'),
      right: () => chain.setTextAlign('right'),
      justify: () => chain.setTextAlign('justify'),
      paragraph: () => chain.setParagraph(),
      heading: () => chain.toggleHeading({ level: Number(value) }),
      table: () => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: false }),
      row: () => chain.addRowAfter(),
      column: () => chain.addColumnAfter(),
      deleteRow: () => chain.deleteRow(),
      deleteColumn: () => chain.deleteColumn(),
      deleteTable: () => chain.deleteTable(),
    };
    commands[name]?.().run();
  }
  undo() {
    return this.editor?.can().undo() ? this.editor.commands.undo() : false;
  }
  redo() {
    return this.editor?.can().redo() ? this.editor.commands.redo() : false;
  }
}
