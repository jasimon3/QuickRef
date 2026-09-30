import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
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

// A pasted screenshot arrives as raw image bytes on the clipboard, not a URL — TipTap's Image
// extension can display an image, but doesn't by itself turn clipboard bytes into one. This reads
// the pasted image, converts it to a data URL, and inserts it as an image node directly. Storing
// it inline (rather than as a separate attached file) keeps a pasted screenshot exactly where you
// dropped it in the text, which matches how pasting a screenshot behaves in most note apps.
function handleImagePaste(view, event) {
  const items = event.clipboardData ? event.clipboardData.items : null;
  if (!items) return false;
  for (const item of items) {
    if (item.type.indexOf('image') !== 0) continue;
    const file = item.getAsFile();
    if (!file) continue;
    event.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      const node = view.state.schema.nodes.image.create({ src: reader.result });
      view.dispatch(view.state.tr.replaceSelectionWith(node));
    };
    reader.readAsDataURL(file);
    return true;
  }
  return false;
}

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
      Image.configure({ allowBase64: true, inline: false }),
      Placeholder.configure({ placeholder: 'Start writing…' })
    ],
    content: content || '',
    editable: !!editable,
    editorProps: {
      handlePaste: handleImagePaste
    },
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor.getHTML());
    }
  });
}
