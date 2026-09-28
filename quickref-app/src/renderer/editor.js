import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';

// Replaces the old document.execCommand-based formatting (deprecated, inconsistent across
// machines) with a real, maintained editor engine. `editable` can be toggled later via
// editor.setEditable() to switch between the read view and edit mode.
export function createEditor(element, { content, editable, onUpdate }) {
  return new Editor({
    element,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: 'Start writing…' })
    ],
    content: content || '',
    editable: !!editable,
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor.getHTML());
    }
  });
}
