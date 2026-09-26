<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { ElMessage } from "element-plus";
import type { OpenAPIDocument, Operation } from "./types/openapi";
import { fetchOpenApiDoc, fetchServiceDoc, getSchemaType, getMethodTagType } from "./api/openapi";
import { copyToClipboard } from "./utils/curl";
import axios from "axios";
import SchemaView from "./components/SchemaView.vue";
import ApiTester from "./components/ApiTester.vue";

/* ===================== 状态 ===================== */

const loading = ref(true);
const error = ref("");
const doc = ref<OpenAPIDocument | null>(null);
const keyword = ref("");

// 网关服务列表
const gatewayServices = ref<string[]>([]);
const selectedService = ref<string>("");
const isGatewayMode = ref(false);

// 暗黑模式
const isDark = ref(false);

// 语言（中/英）
const lang = ref<"zh" | "en">("zh");
const i18n: Record<string, Record<"zh" | "en", string>> = {
  title: { zh: "API 接口文档", en: "API Documentation" },
  search: { zh: "搜索接口...", en: "Search APIs..." },
  detail: { zh: "接口详情", en: "API Details" },
  tester: { zh: "在线调试", en: "Try it out" },
  params: { zh: "请求参数", en: "Parameters" },
  requestBody: { zh: "请求体", en: "Request Body" },
  responses: { zh: "响应", en: "Responses" },
  required: { zh: "必填", en: "Required" },
  fieldName: { zh: "字段", en: "Field" },
  fieldType: { zh: "类型", en: "Type" },
  fieldDesc: { zh: "说明", en: "Description" },
  fieldExample: { zh: "示例值", en: "Example" },
  deprecated: { zh: "已废弃", en: "Deprecated" },
  send: { zh: "发送请求", en: "Send" },
  sending: { zh: "发送中...", en: "Sending..." },
  responseBody: { zh: "响应体", en: "Response Body" },
  responseHeaders: { zh: "响应头", en: "Response Headers" },
  empty: { zh: "请从左侧选择接口查看详情", en: "Select an API from the left" },
  loadFailed: { zh: "文档加载失败", en: "Failed to load" },
  export: { zh: "导出 JSON", en: "Export JSON" },
  retry: { zh: "重试", en: "Retry" },
};
function t(key: string): string {
  return i18n[key]?.[lang.value] || key;
}

/* ===================== 接口选择 ===================== */

interface SelectedApi {
  method: string;
  path: string;
  operation: Operation;
}
const selectedApi = ref<SelectedApi | null>(null);
const activeTab = ref<"detail" | "tester">("detail");

/* ===================== tag 折叠记忆 ===================== */

// 从 localStorage 恢复折叠状态
const COLLAPSE_KEY = "apilens-collapsed-tags";
const collapsedTags = ref<Set<string>>(loadCollapsedTags());

function loadCollapsedTags(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function toggleTag(tag: string) {
  if (collapsedTags.value.has(tag)) {
    collapsedTags.value.delete(tag);
  } else {
    collapsedTags.value.add(tag);
  }
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedTags.value]));
}

/* ===================== 接口总数 ===================== */

const totalApiCount = computed(() => {
  if (!doc.value?.paths) return 0;
  let count = 0;
  const methods = ["get", "post", "put", "delete", "patch", "options", "head"];
  for (const pathItem of Object.values(doc.value.paths)) {
    for (const m of methods) {
      if ((pathItem as any)[m]) count++;
    }
  }
  return count;
});

/** 复制接口路径到剪贴板 */
async function copyApiPath(path: string) {
  const ok = await copyToClipboard(path);
  if (ok) {
    ElMessage.success("路径已复制");
  }
}

/* ===================== 分组列表 ===================== */

// 按 tag 分组 + 关键词过滤
const groupedApis = computed(() => {
  if (!doc.value?.paths) return [];
  const groups: Record<string, SelectedApi[]> = {};

  for (const [path, pathItem] of Object.entries(doc.value.paths)) {
    const methods = ["get", "post", "put", "delete", "patch", "options", "head"] as const;
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;
      const api: SelectedApi = { method, path, operation };
      const tags = operation.tags?.length ? operation.tags : ["default"];
      for (const tag of tags) {
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push(api);
      }
    }
  }

  let result = Object.entries(groups).map(([tag, apis]) => ({ tag, apis }));
  if (keyword.value.trim()) {
    const kw = keyword.value.toLowerCase();
    result = result
      .map(({ tag, apis }) => ({
        tag,
        apis: apis.filter(
          (a) =>
            a.path.toLowerCase().includes(kw) ||
            a.operation.summary?.toLowerCase().includes(kw) ||
            a.operation.operationId?.toLowerCase().includes(kw)
        ),
      }))
      .filter((g) => g.apis.length > 0);
  }
  return result;
});

// tag 描述映射
const tagDescriptions = computed(() => {
  const map: Record<string, string> = {};
  if (doc.value?.tags) {
    for (const tag of doc.value.tags) {
      map[tag.name] = tag.description || "";
    }
  }
  return map;
});

/* ===================== 接口详情 ===================== */

const currentParams = computed(() => {
  if (!selectedApi.value?.operation.parameters) return [];
  return selectedApi.value.operation.parameters.map((p) => ({
    name: p.name,
    in: p.in,
    required: p.required || false,
    description: p.description || "",
    type: p.schema ? getSchemaType(p.schema, doc.value!) : "string",
    example: p.example ?? p.schema?.example ?? "",
  }));
});

const currentRequestBody = computed(() => {
  const rb = selectedApi.value?.operation.requestBody;
  if (!rb?.content) return null;
  const json = rb.content["application/json"];
  if (!json?.schema) return null;
  return {
    required: rb.required || false,
    description: rb.description || "",
    schema: json.schema,
    example: json.example,
  };
});

const currentResponses = computed(() => {
  const responses = selectedApi.value?.operation.responses;
  if (!responses) return [];
  return Object.entries(responses).map(([code, resp]) => ({
    code,
    description: resp.description || "",
    schema: resp.content?.["application/json"]?.schema,
    example: resp.content?.["application/json"]?.example,
  }));
});

function selectApi(method: string, path: string, operation: Operation) {
  selectedApi.value = { method, path, operation };
  activeTab.value = "detail";
}

/* ===================== 暗黑模式 ===================== */

watch(isDark, (dark) => {
  document.documentElement.classList.toggle("dark", dark);
});

/* ===================== 导出 JSON ===================== */

function exportJson() {
  if (!doc.value) return;
  const blob = new Blob([JSON.stringify(doc.value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "openapi.json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================== 加载文档 ===================== */

async function loadDoc() {
  loading.value = true;
  error.value = "";
  try {
    if (isGatewayMode.value && selectedService.value) {
      // 网关模式：加载指定服务的文档
      doc.value = await fetchServiceDoc(selectedService.value);
    } else {
      doc.value = await fetchOpenApiDoc();
    }
  } catch (e: any) {
    error.value = e.message || "获取文档失败";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // 先探测是否网关模式：尝试请求 swagger-config
  try {
    const res = await axios.get("/v3/api-docs/swagger-config");
    if (res.data?.urls?.length) {
      isGatewayMode.value = true;
      gatewayServices.value = res.data.urls.map((u: any) => u.name);
      selectedService.value = gatewayServices.value[0];
      await loadDoc();
      return;
    }
  } catch {
    // swagger-config 不存在，说明是单体模式，走默认逻辑
  }
  await loadDoc();
});

// 网关模式下切换服务时重新加载文档
watch(selectedService, () => {
  if (isGatewayMode.value) {
    selectedApi.value = null;
    loadDoc();
  }
});
</script>

<template>
  <div class="doc-layout" :class="{ dark: isDark }">
    <!-- 顶部标题栏 -->
    <header class="doc-header">
      <div class="header-left">
        <h1 class="doc-title">{{ doc?.info?.title || t("title") }}</h1>
        <span v-if="doc?.info?.version" class="meta-item">v{{ doc.info.version }}</span>
      </div>
      <div class="header-right">
        <!-- 网关模式下展示服务选择器 -->
        <el-select
          v-if="isGatewayMode"
          v-model="selectedService"
          size="small"
          placeholder="选择服务"
          class="service-select"
        >
          <el-option v-for="svc in gatewayServices" :key="svc" :label="svc" :value="svc" />
        </el-select>
        <el-switch v-model="isDark" inline-prompt active-text="🌙" inactive-text="☀️" size="small" />
        <el-radio-group v-model="lang" size="small">
          <el-radio-button value="zh">中文</el-radio-button>
          <el-radio-button value="en">EN</el-radio-button>
        </el-radio-group>
        <el-button size="small" @click="exportJson" :disabled="!doc">{{ t("export") }}</el-button>
      </div>
    </header>

    <div class="doc-body" v-loading="loading">
      <!-- 左侧接口列表 -->
      <aside class="doc-sidebar">
        <div class="search-row">
          <el-input v-model="keyword" :placeholder="t('search')" clearable size="small" class="search-input" />
          <span class="api-total">{{ totalApiCount }}</span>
        </div>
        <div class="api-groups">
          <div v-for="group in groupedApis" :key="group.tag" class="api-group">
            <div class="group-header" @click="toggleTag(group.tag)">
              <div class="group-left">
                <el-icon class="collapse-icon" :class="{ collapsed: collapsedTags.has(group.tag) }">
                  <ArrowDown />
                </el-icon>
                <span class="group-name">{{ group.tag }}</span>
              </div>
              <span class="group-count">{{ group.apis.length }}</span>
            </div>
            <div v-if="tagDescriptions[group.tag] && !collapsedTags.has(group.tag)" class="group-desc">{{ tagDescriptions[group.tag] }}</div>
            <div v-show="!collapsedTags.has(group.tag)">
              <div
                v-for="api in group.apis"
                :key="api.method + api.path"
                class="api-item"
                :class="{ active: selectedApi?.method === api.method && selectedApi?.path === api.path }"
                @click="selectApi(api.method, api.path, api.operation)"
              >
                <el-tag :type="getMethodTagType(api.method)" size="small" class="method-tag">
                  {{ api.method.toUpperCase() }}
                </el-tag>
                <span class="api-summary">{{ api.operation.summary || api.path }}</span>
                <el-icon class="copy-icon" @click.stop="copyApiPath(api.path)"><CopyDocument /></el-icon>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧接口详情 -->
      <main class="doc-main">
        <div v-if="error" class="error-panel">
          <el-result icon="error" :title="t('loadFailed')" :sub-title="error">
            <template #extra>
              <el-button @click="loadDoc">{{ t("retry") }}</el-button>
            </template>
          </el-result>
        </div>

        <template v-else-if="selectedApi">
          <div class="api-header">
            <el-tag :type="getMethodTagType(selectedApi.method)" size="large">
              {{ selectedApi.method.toUpperCase() }}
            </el-tag>
            <code class="api-path">{{ selectedApi.path }}</code>
            <el-tag v-if="selectedApi.operation.deprecated" type="danger" size="small">{{ t("deprecated") }}</el-tag>
          </div>

          <div v-if="selectedApi.operation.summary" class="api-summary-text">
            {{ selectedApi.operation.summary }}
          </div>
          <div v-if="selectedApi.operation.description" class="api-description">
            {{ selectedApi.operation.description }}
          </div>

          <el-tabs v-model="activeTab" class="api-tabs">
            <el-tab-pane :label="t('detail')" name="detail">
              <section v-if="currentParams.length" class="section">
                <h3 class="section-title">{{ t("params") }}</h3>
                <el-table :data="currentParams" border size="small">
                  <el-table-column prop="name" :label="t('fieldName')" width="180" />
                  <el-table-column prop="in" label="in" width="90">
                    <template #default="{ row }">
                      <el-tag size="small" type="info">{{ row.in }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="required" :label="t('required')" width="70" align="center">
                    <template #default="{ row }">
                      <span :style="{ color: row.required ? '#f56c6c' : '#909399' }">{{ row.required ? "是" : "否" }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="type" :label="t('fieldType')" width="160" />
                  <el-table-column prop="description" :label="t('fieldDesc')" />
                  <el-table-column prop="example" :label="t('fieldExample')" width="160" />
                </el-table>
              </section>

              <section v-if="currentRequestBody" class="section">
                <h3 class="section-title">
                  {{ t("requestBody") }}
                  <el-tag v-if="currentRequestBody.required" type="danger" size="small">{{ t("required") }}</el-tag>
                </h3>
                <div v-if="currentRequestBody.description" class="section-desc">{{ currentRequestBody.description }}</div>
                <SchemaView :schema="currentRequestBody.schema" :doc="doc!" />
              </section>

              <section v-if="currentResponses.length" class="section">
                <h3 class="section-title">{{ t("responses") }}</h3>
                <div v-for="resp in currentResponses" :key="resp.code" class="response-item">
                  <div class="response-header">
                    <el-tag :type="resp.code.startsWith('2') ? 'success' : resp.code.startsWith('4') ? 'warning' : 'danger'" size="small">
                      {{ resp.code }}
                    </el-tag>
                    <span class="response-desc">{{ resp.description }}</span>
                  </div>
                  <SchemaView v-if="resp.schema" :schema="resp.schema" :doc="doc!" />
                </div>
              </section>
            </el-tab-pane>

            <el-tab-pane :label="t('tester')" name="tester">
              <ApiTester
                :method="selectedApi.method"
                :path="selectedApi.path"
                :params="currentParams"
                :request-body="currentRequestBody"
                :doc="doc!"
              />
            </el-tab-pane>
          </el-tabs>
        </template>

        <div v-else-if="!loading && !error" class="empty-panel">
          <el-empty :description="t('empty')" />
        </div>
      </main>
    </div>
  </div>
</template>

<style>
/* 暗黑模式 CSS 变量 */
:root {
  --yl-bg: #ffffff;
  --yl-bg-sidebar: #fafafa;
  --yl-border: #e8e8e8;
  --yl-text: #303133;
  --yl-text-secondary: #606266;
  --yl-text-tertiary: #909399;
  --yl-hover: #ecf5ff;
  --yl-active: #d9ecff;
}
.dark {
  --yl-bg: #1d1e1f;
  --yl-bg-sidebar: #181a1b;
  --yl-border: #3a3a3a;
  --yl-text: #e0e0e0;
  --yl-text-secondary: #a0a0a0;
  --yl-text-tertiary: #707070;
  --yl-hover: #2a2a2a;
  --yl-active: #2d4a6e;
}
</style>

<style scoped>
.doc-layout { height: 100vh; display: flex; flex-direction: column; background: var(--yl-bg); color: var(--yl-text); }
.doc-header { background: var(--yl-bg); border-bottom: 1px solid var(--yl-border); padding: 12px 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 12px; }
.header-right { display: flex; align-items: center; gap: 12px; }
.service-select { width: 180px; }
.doc-title { font-size: 18px; margin: 0; color: var(--yl-text); }
.meta-item { font-size: 13px; color: var(--yl-text-tertiary); }
.doc-body { flex: 1; display: flex; overflow: hidden; }
.search-row { display: flex; align-items: center; padding: 10px; gap: 6px; }
.search-input { flex: 1; }
.api-total { font-size: 12px; color: var(--yl-text-tertiary); flex-shrink: 0; }
.doc-sidebar { width: 320px; border-right: 1px solid var(--yl-border); background: var(--yl-bg-sidebar); overflow-y: auto; flex-shrink: 0; }
.api-groups { padding: 0 10px 10px; }
.api-group { margin-bottom: 12px; }
.group-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; font-size: 14px; font-weight: 600; color: var(--yl-text); cursor: pointer; user-select: none; }
.group-left { display: flex; align-items: center; gap: 4px; }
.collapse-icon { font-size: 12px; transition: transform 0.2s; }
.collapse-icon.collapsed { transform: rotate(-90deg); }
.group-count { font-size: 12px; color: var(--yl-text-tertiary); font-weight: normal; }
.group-desc { padding: 0 8px 4px; font-size: 12px; color: var(--yl-text-tertiary); }
.api-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 13px; transition: background 0.2s; }
.api-item:hover { background: var(--yl-hover); }
.api-item.active { background: var(--yl-active); }
.method-tag { width: 50px; text-align: center; flex-shrink: 0; }
.api-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--yl-text-secondary); flex: 1; }
.copy-icon { font-size: 14px; color: var(--yl-text-tertiary); opacity: 0; transition: opacity 0.2s; flex-shrink: 0; }
.api-item:hover .copy-icon { opacity: 1; }
.copy-icon:hover { color: var(--el-color-primary); }
.doc-main { flex: 1; overflow-y: auto; padding: 20px 24px; background: var(--yl-bg); }
.api-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.api-path { font-size: 16px; font-weight: 600; color: var(--yl-text); }
.api-summary-text { font-size: 15px; color: var(--yl-text-secondary); margin-bottom: 4px; }
.api-description { font-size: 13px; color: var(--yl-text-tertiary); margin-bottom: 16px; white-space: pre-wrap; }
.api-tabs { margin-top: 16px; }
.section { margin-bottom: 24px; }
.section-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: var(--yl-text); display: flex; align-items: center; gap: 8px; }
.section-desc { font-size: 13px; color: var(--yl-text-tertiary); margin-bottom: 8px; }
.response-item { margin-bottom: 16px; }
.response-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.response-desc { font-size: 13px; color: var(--yl-text-secondary); }
.error-panel, .empty-panel { display: flex; align-items: center; justify-content: center; height: 100%; }
</style>
