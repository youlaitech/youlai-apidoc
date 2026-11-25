<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState, Facet } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { jsonLinePropertyKey, type SchemaCommentMap } from "../utils/schema-comments";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    comments?: SchemaCommentMap;
  }>(),
  { comments: () => ({}) }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "submit"): void;
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const commentsCompartment = new Compartment();

const schemaCommentsFacet = Facet.define<SchemaCommentMap, SchemaCommentMap>({
  combine: (values) => values[0] || {},
});

/** 行尾 Widget 只负责绘制，不属于 EditorState.doc，因此不会被复制、格式化或提交 */
class SchemaCommentWidget extends WidgetType {
  constructor(private readonly description: string) {
    super();
  }

  override eq(other: SchemaCommentWidget): boolean {
    return this.description === other.description;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-schema-comment";
    element.textContent = `  // ${this.description}`;
    element.title = this.description;
    element.setAttribute("aria-hidden", "true");
    element.contentEditable = "false";
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(currentView: EditorView): DecorationSet {
  const comments = currentView.state.facet(schemaCommentsFacet);
  const decorations = [];
  for (let number = 1; number <= currentView.state.doc.lines; number += 1) {
    const line = currentView.state.doc.line(number);
    const key = jsonLinePropertyKey(line.text);
    const description = key ? comments[key] : undefined;
    if (description) {
      decorations.push(
        Decoration.widget({
          widget: new SchemaCommentWidget(description),
          side: 1,
        }).range(line.to)
      );
    }
  }
  return Decoration.set(decorations);
}

const schemaCommentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(currentView: EditorView) {
      this.decorations = buildDecorations(currentView);
    }

    update(update: ViewUpdate) {
      const commentsChanged =
        update.startState.facet(schemaCommentsFacet) !== update.state.facet(schemaCommentsFacet);
      if (update.docChanged || commentsChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--ad-bg-code)",
    color: "var(--ad-text)",
    border: "1px solid var(--ad-border)",
    borderRadius: "var(--ad-radius)",
    fontSize: "12px",
    overflow: "hidden",
  },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--ad-primary)",
    boxShadow: "0 0 0 1px var(--ad-primary) inset, 0 0 0 3px var(--ad-primary-soft) inset",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--ad-font-mono)",
    lineHeight: "1.7",
  },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "var(--ad-text)",
  },
  ".cm-line": {
    padding: "0 14px",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--ad-text)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--ad-primary-soft-2)",
  },
  ".cm-schema-comment": {
    color: "var(--ad-text-tertiary)",
    opacity: "0.62",
    fontStyle: "italic",
    userSelect: "none",
    pointerEvents: "none",
  },
});

onMounted(() => {
  if (!host.value) return;
  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      EditorState.tabSize.of(2),
      commentsCompartment.of(schemaCommentsFacet.of(props.comments)),
      json(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      history(),
      keymap.of([
        {
          key: "Ctrl-Enter",
          mac: "Cmd-Enter",
          preventDefault: true,
          run: () => {
            emit("submit");
            return true;
          },
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "JSON 请求体",
        spellcheck: "false",
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit("update:modelValue", update.state.doc.toString());
      }),
      schemaCommentPlugin,
      editorTheme,
    ],
  });
  view = new EditorView({ state, parent: host.value });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }
);

watch(
  () => props.comments,
  (comments) => {
    if (!view) return;
    view.dispatch({
      effects: commentsCompartment.reconfigure(schemaCommentsFacet.of(comments)),
    });
  },
  { deep: true }
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="schema-json-editor"></div>
</template>

<style scoped>
.schema-json-editor { display: flex; flex: 1; min-width: 0; min-height: 0; }
.schema-json-editor :deep(.cm-editor) { flex: 1; min-width: 0; }
</style>
