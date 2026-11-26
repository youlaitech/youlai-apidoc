<script setup lang="ts">
// 导出范围由打开入口决定，格式可选 Markdown 或 Word
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { Document, Download } from "@element-plus/icons-vue";
import type { OpenAPIDocument } from "../types/openapi";
import type { ApiGroup } from "../utils/api-grouping";
import { buildExportDocument, type ExportScope } from "../utils/export-model";
import { renderMarkdown } from "../utils/export-markdown";
import { renderWordHtml } from "../utils/export-word";
import { downloadText, safeFileName } from "../utils/export-download";

const props = defineProps<{
  modelValue: boolean;
  doc: OpenAPIDocument | null;
  groups: ApiGroup[];
  baseUrl: string;
  scope?: ExportScope;
  scopeLabel?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
}>();

const format = ref<"word" | "markdown">("word");
const exporting = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

const summary = computed(() => {
  if (!props.doc) return null;
  return buildExportDocument(props.doc, props.groups, props.baseUrl, props.scope || {});
});

const rangeText = computed(() => props.scopeLabel || "全部接口");

/**
 * 生成并下载文档
 */
function doExport() {
  const model = summary.value;
  if (!model) return;
  exporting.value = true;
  try {
    const name = safeFileName(model.title || "api-doc");
    if (format.value === "markdown") {
      downloadText(renderMarkdown(model), `${name}.md`, "text/markdown");
    } else {
      downloadText(renderWordHtml(model), `${name}.doc`, "application/msword");
    }
    ElMessage.success(`已导出 ${model.apiCount} 个接口`);
    visible.value = false;
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="导出接口文档" width="480px" class="export-dialog">
    <div v-if="summary" class="export-body">
      <div class="export-row">
        <span class="export-label">导出范围</span>
        <span class="export-value">{{ rangeText }} · {{ summary.apiCount }} 个接口</span>
      </div>
      <div class="export-row">
        <span class="export-label">环境地址</span>
        <span class="export-value mono">{{ summary.baseUrl || "未设置" }}</span>
      </div>

      <div class="export-formats">
        <button
          type="button"
          class="format-card"
          :class="{ active: format === 'word' }"
          @click="format = 'word'"
        >
          <el-icon class="format-ico"><Document /></el-icon>
          <span class="format-name">Word 文档</span>
          <span class="format-desc">含封面与目录，适合对外交付</span>
        </button>
        <button
          type="button"
          class="format-card"
          :class="{ active: format === 'markdown' }"
          @click="format = 'markdown'"
        >
          <el-icon class="format-ico"><Document /></el-icon>
          <span class="format-name">Markdown</span>
          <span class="format-desc">纯文本，可导入文档平台</span>
        </button>
      </div>

      <p class="export-tip">Word 文件为 .doc 格式，Word 与 WPS 均可直接打开；目录为静态文本，不随页码自动更新。</p>
    </div>

    <template #footer>
      <div class="export-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="doExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.export-body { display: flex; flex-direction: column; gap: 12px; }
.export-row { display: flex; align-items: baseline; gap: 8px; font-size: var(--ad-fs-secondary); }
.export-label { flex-shrink: 0; width: 64px; color: var(--ad-text-tertiary); }
.export-value { color: var(--ad-text); }
.export-value.mono { font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); word-break: break-all; }
.export-formats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
.format-card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px 14px; text-align: left; background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius); cursor: pointer; transition: border-color var(--ad-duration), background var(--ad-duration), box-shadow var(--ad-duration); }
.format-card:hover { border-color: color-mix(in srgb, var(--ad-primary) 40%, transparent); }
.format-card.active { border-color: var(--ad-primary); background: var(--ad-primary-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ad-primary) 25%, transparent); }
.format-ico { font-size: 16px; color: var(--ad-primary); }
.format-name { font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); }
.format-desc { font-size: 11px; line-height: 1.5; color: var(--ad-text-tertiary); }
.export-tip { margin: 0; font-size: 11px; line-height: 1.6; color: var(--ad-text-tertiary); }
.export-footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
