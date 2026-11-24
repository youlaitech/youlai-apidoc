<script setup lang="ts">
/**
 * OpenAPI JSON 查看弹窗
 *
 * 顶栏「OpenAPI JSON → 查看 JSON」打开：高亮展示当前文档全文，
 * 支持一键复制与下载（openapi.json），让「下载的是什么」一目了然。
 */
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type { OpenAPIDocument } from "../types/openapi";
import { highlightJson } from "../utils/json-highlight";
import { copyWithFeedback } from "../utils/copy";

const props = defineProps<{
  doc: OpenAPIDocument | null;
}>();

const visible = ref(false);

const jsonText = computed(() => (props.doc ? JSON.stringify(props.doc, null, 2) : ""));
const highlighted = computed(() => highlightJson(jsonText.value));
const sizeText = computed(() => {
  if (!jsonText.value) return "";
  const kb = new Blob([jsonText.value]).size / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
});
const pathCount = computed(() => Object.keys(props.doc?.paths || {}).length);

function open() {
  if (!props.doc) return;
  visible.value = true;
}

async function copyJson() {
  await copyWithFeedback(jsonText.value, "OpenAPI JSON 已复制");
}

function download() {
  if (!props.doc) return;
  const blob = new Blob([jsonText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "openapi.json";
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success("已开始下载 openapi.json");
}

defineExpose({ open, download });
</script>

<template>
  <el-dialog v-model="visible" title="OpenAPI JSON" width="780px" top="6vh" class="oas-dialog" append-to-body>
    <div class="oas-meta">
      <span class="oas-chip is-primary">OpenAPI {{ doc?.openapi }}</span>
      <span class="oas-chip">{{ pathCount }} 个路径</span>
      <span class="oas-chip">{{ sizeText }}</span>
      <span class="oas-file">openapi.json</span>
    </div>
    <pre class="oas-pre json-highlight" v-html="highlighted"></pre>
    <template #footer>
      <span class="oas-foot-note">当前页面渲染所用的完整文档描述</span>
      <el-button @click="copyJson"><el-icon><CopyDocument /></el-icon>复制</el-button>
      <el-button type="primary" @click="download"><el-icon><Download /></el-icon>下载 JSON</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.oas-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.oas-chip { font-size: var(--ad-fs-aux); font-weight: 600; font-family: var(--ad-font-mono); font-variant-numeric: tabular-nums; color: var(--ad-text-secondary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-pill); padding: 3px 10px; }
.oas-chip.is-primary { color: var(--ad-primary); background: var(--ad-primary-soft); }
.oas-file { margin-left: auto; font-size: var(--ad-fs-aux); font-family: var(--ad-font-mono); color: var(--ad-text-tertiary); }
.oas-pre { margin: 0; padding: 14px 16px; background: var(--ad-bg-code); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text); white-space: pre-wrap; word-break: break-word; max-height: 62vh; overflow: auto; }
.oas-foot-note { float: left; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); line-height: 36px; }
</style>