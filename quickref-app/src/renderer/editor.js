import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';

// TipTap doesn't ship font size as a built-in extension, but it's designed to be extended exactly
// this way: this adds a `fontSize` attribute onto the existing textStyle mark (from the TextStyle
// extension above) rather than needing a whole new package. Standard, well-documented pattern.
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: 'font-size: ' + attributes.fontSize };
            }
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
    };
  }
});

// Replaces the old document.execCommand-based formatting (deprecated, inconsistent across
// machines) with a real, maintained editor engine. StarterKit alone already bundles headings,
// blockquotes, code blocks, horizontal rules, and undo/redo — those just need toolbar buttons
// wired up in app.js, no extra extensions required. `editable` can be toggled later via
// editor.setEditable() to switch between the read view and edit mode.
export function createEditor(element, { content, editable, onUpdate }) {
  return new Editor({
    element,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontSize,
      Placeholder.configure({ placeholder: 'Start writing…' })
    ],
    content: content || '',
    editable: !!editable,
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor.getHTML());
    }
  });
}
