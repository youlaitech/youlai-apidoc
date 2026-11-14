<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { ElMessage } from "element-plus";
import type { OpenAPIDocument, Operation } from "./types/openapi";
import { fetchOpenApiDoc, fetchServiceDoc, getSchemaType, getSchemaExample, getMediaTypeExample } from "./api/openapi";
import { copyToClipboard } from "./utils/curl";
import axios from "axios";
import SchemaView from "./components/SchemaView.vue";
import ApiTester from "./components/ApiTester.vue";
import AuthDialog from "./components/AuthDialog.vue";
import { authValues } from "./stores/auth";

/* ===================== 状态 ===================== */

const loading = ref(true);
const error = ref("");
const doc = ref<OpenAPIDocument | null>(null);
const keyword = ref("");

// 非 3.1 文档的兼容提示（3.0 降级渲染时展示）
const protocolWarning = ref("");

// 网关服务列表
const gatewayServices = ref<string[]>([]);
const selectedService = ref<string>("");
const isGatewayMode = ref(false);

/* ===================== 接口选择 ===================== */

interface SelectedApi {
  method: string;
  path: string;
  operation: Operation;
}
const selectedApi = ref<SelectedApi | null>(null);
const activeTab = ref<"detail" | "tester">("detail");
const mainRef = ref<HTMLElement>();

// 全局授权：按文档声明的 securitySchemes 渲染表单
const securitySchemes = computed(() => doc.value?.components?.securitySchemes || {});
const hasAnyAuth = computed(() => Object.keys(authValues.value).length > 0);
const authDialogRef = ref();

const oasVersion = computed(() => doc.value?.openapi || "");

/* ===================== 搜索快捷键 ===================== */

const searchInputRef = ref();

function onGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  const editing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  if (e.key === "/" && !editing) {
    e.preventDefault();
    searchInputRef.value?.focus();
  }
}

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

/**
 * 复制文本并提示
 */
async function copyText(text: string, tip: string) {
  const ok = await copyToClipboard(text);
  if (ok) {
    ElMessage.success(tip);
  }
}

/* ===================== 分组列表 ===================== */

/**
 * x-order 升序，未声明的排在后面
 */
function compareOrder(a?: number, b?: number): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

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

  // knife4j 用 x-order 指定显示顺序，缺失时按名称与路径
  const tagOrders = new Map<string, number>();
  for (const tag of doc.value?.tags || []) {
    if (typeof tag["x-order"] === "number") {
      tagOrders.set(tag.name, tag["x-order"]);
    }
  }
  let result = Object.entries(groups)
    .map(([tag, apis]) => ({
      tag,
      apis: apis.sort(
        (a, b) =>
          compareOrder(a.operation["x-order"], b.operation["x-order"]) ||
          a.path.localeCompare(b.path) ||
          a.method.localeCompare(b.method)
      ),
    }))
    .sort((a, b) => compareOrder(tagOrders.get(a.tag), tagOrders.get(b.tag)) || a.tag.localeCompare(b.tag, "zh-CN"));
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

const filteredCount = computed(() => groupedApis.value.reduce((sum, g) => sum + g.apis.length, 0));

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
    example: p.example ?? getSchemaExample(p.schema) ?? "",
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
    example: getMediaTypeExample(json),
  };
});

const currentResponses = computed(() => {
  const responses = selectedApi.value?.operation.responses;
  if (!responses) return [];
  return Object.entries(responses).map(([code, resp]) => ({
    code,
    description: resp.description || "",
    schema: resp.content?.["application/json"]?.schema,
    example: getMediaTypeExample(resp.content?.["application/json"]),
  }));
});

function selectApi(method: string, path: string, operation: Operation) {
  selectedApi.value = { method, path, operation };
  activeTab.value = "detail";
  mainRef.value?.scrollTo({ top: 0 });
}

/**
 * 首页点击分组卡片，展开该组并打开第一个接口
 */
function selectFirstInGroup(tag: string) {
  const first = groupedApis.value.find((group) => group.tag === tag)?.apis[0];
  if (!first) return;
  collapsedTags.value.delete(tag);
  selectApi(first.method, first.path, first.operation);
}

function isActiveApi(api: SelectedApi): boolean {
  return selectedApi.value?.method === api.method && selectedApi.value?.path === api.path;
}

/**
 * 示例值统一转文本，对象序列化为 JSON
 */
function formatExample(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * 响应状态码的语义分类
 */
function statusClass(code: string): string {
  if (code.startsWith("2")) return "is-success";
  if (code.startsWith("4")) return "is-client-error";
  if (code.startsWith("5")) return "is-server-error";
  return "is-other";
}

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
  protocolWarning.value = "";
  try {
    let result: { doc: OpenAPIDocument; warning: string };
    if (isGatewayMode.value && selectedService.value) {
      // 网关模式：加载指定服务的文档
      result = await fetchServiceDoc(selectedService.value);
    } else {
      result = await fetchOpenApiDoc();
    }
    doc.value = result.doc;
    protocolWarning.value = result.warning;
  } catch (e: any) {
    error.value = e.message || "获取文档失败";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onGlobalKeydown);
  // 先探测是否网关模式：尝试请求 swagger-config
  try {
    const res = await axios.get("/v3/api-docs/swagger-config");
    if (res.data?.urls?.length) {
      isGatewayMode.value = true;
      gatewayServices.value = res.data.urls.map((u: any) => u.name);
      // 赋值触发 watch(selectedService) 加载文档，避免重复请求
      selectedService.value = gatewayServices.value[0];
      return;
    }
  } catch {
    // swagger-config 不存在，说明是单体模式，走默认逻辑
  }
  await loadDoc();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
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
  <div class="doc-layout">
    <!-- 顶部标题栏 -->
    <header class="doc-header">
      <div class="header-left">
        <div class="doc-logo">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="2" />
            <path d="M15 15l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </div>
        <h1 class="doc-title">{{ doc?.info?.title || "API 接口文档" }}</h1>
        <span v-if="doc?.info?.version" class="meta-badge">{{ doc.info.version }}</span>
        <span v-if="oasVersion" class="meta-badge meta-badge--mono">OAS {{ oasVersion }}</span>
      </div>
      <div class="header-right">
        <!-- 全局授权：一次填写，所有接口共用 -->
        <button class="authorize-btn" :class="{ 'is-authorized': hasAnyAuth }" @click="authDialogRef?.open()">
          <el-icon><Lock /></el-icon>
          <span>Authorize</span>
          <i v-if="hasAnyAuth" class="authorize-dot" />
        </button>
        <el-tooltip content="下载 OpenAPI JSON" placement="bottom">
          <button class="icon-btn" :disabled="!doc" @click="exportJson">
            <el-icon><Download /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </header>

    <div class="doc-body" v-loading="loading">
      <!-- 左侧接口列表 -->
      <aside class="doc-sidebar">
        <div class="sidebar-search">
          <el-input ref="searchInputRef" v-model="keyword" placeholder="搜索接口名称、路径" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
            <template v-if="!keyword" #suffix>
              <kbd class="search-kbd">/</kbd>
            </template>
          </el-input>
        </div>
        <div class="sidebar-meta">
          <template v-if="keyword">匹配 {{ filteredCount }} / {{ totalApiCount }} 个接口</template>
          <template v-else>{{ totalApiCount }} 个接口 · {{ groupedApis.length }} 个分组</template>
        </div>
        <div v-if="isGatewayMode" class="service-row">
          <el-select v-model="selectedService" class="service-select">
            <el-option v-for="svc in gatewayServices" :key="svc" :label="svc" :value="svc" />
          </el-select>
        </div>

        <nav class="api-groups">
          <section v-for="group in groupedApis" :key="group.tag" class="api-group">
            <button class="group-header" @click="toggleTag(group.tag)">
              <el-icon class="collapse-icon" :class="{ collapsed: collapsedTags.has(group.tag) }">
                <ArrowDown />
              </el-icon>
              <span class="group-name" :title="group.tag">{{ group.tag }}</span>
              <span class="group-count">{{ group.apis.length }}</span>
            </button>
            <div v-show="!collapsedTags.has(group.tag)" class="group-items">
              <p v-if="tagDescriptions[group.tag]" class="group-desc">{{ tagDescriptions[group.tag] }}</p>
              <a
                v-for="api in group.apis"
                :key="api.method + api.path"
                class="api-item"
                :class="{ active: isActiveApi(api) }"
                :title="api.path"
                @click="selectApi(api.method, api.path, api.operation)"
              >
                <div class="api-item-top">
                  <span class="method-badge" :class="'method-' + api.method.toLowerCase()">
                    {{ api.method.toUpperCase() }}
                  </span>
                  <span class="api-summary">{{ api.operation.summary || api.path }}</span>
                  <el-icon class="copy-icon" @click.stop="copyText(api.path, '路径已复制')"><CopyDocument /></el-icon>
                </div>
                <div v-if="api.operation.summary" class="api-item-path">{{ api.path }}</div>
              </a>
            </div>
          </section>
          <div v-if="keyword && !groupedApis.length" class="sidebar-empty">
            没有匹配「{{ keyword }}」的接口
          </div>
        </nav>
      </aside>

      <!-- 右侧接口详情 -->
      <main ref="mainRef" class="doc-main">
        <el-alert
          v-if="protocolWarning"
          :title="protocolWarning"
          type="warning"
          show-icon
          :closable="false"
          class="protocol-alert"
        />
        <div v-if="error" class="error-panel">
          <el-result icon="error" title="文档加载失败" :sub-title="error">
            <template #extra>
              <el-button type="primary" @click="loadDoc">重新加载</el-button>
            </template>
          </el-result>
        </div>

        <template v-else-if="selectedApi">
          <div class="api-breadcrumb">{{ selectedApi.operation.tags?.join(" / ") || "default" }}</div>
          <h2 class="api-title">{{ selectedApi.operation.summary || selectedApi.path }}</h2>
          <div class="api-header">
            <span class="method-badge method-large" :class="'method-' + selectedApi.method.toLowerCase()">
              {{ selectedApi.method.toUpperCase() }}
            </span>
            <code class="api-path">{{ selectedApi.path }}</code>
            <el-tooltip content="复制路径" placement="top">
              <button class="icon-btn" @click="copyText(selectedApi.path, '路径已复制')">
                <el-icon><CopyDocument /></el-icon>
              </button>
            </el-tooltip>
            <span v-if="selectedApi.operation.deprecated" class="deprecated-badge">已废弃</span>
          </div>
          <div v-if="selectedApi.operation.description" class="api-description">
            {{ selectedApi.operation.description }}
          </div>

          <el-tabs v-model="activeTab" class="api-tabs">
            <el-tab-pane label="接口文档" name="detail">
              <section v-if="currentParams.length" class="section">
                <h3 class="section-title">请求参数<span class="section-count">{{ currentParams.length }}</span></h3>
                <table class="param-table">
                  <thead>
                    <tr>
                      <th class="col-name">参数名</th>
                      <th class="col-in">位置</th>
                      <th class="col-type">类型</th>
                      <th>说明</th>
                      <th class="col-example">示例</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="p in currentParams" :key="p.in + p.name">
                      <td class="col-name">
                        <span class="param-name-text">{{ p.name }}</span>
                        <span v-if="p.required" class="required-star" title="必填">*</span>
                      </td>
                      <td class="col-in"><span class="in-badge">{{ p.in }}</span></td>
                      <td class="col-type mono">{{ p.type }}</td>
                      <td class="col-desc">{{ p.description || "—" }}</td>
                      <td class="col-example mono">{{ formatExample(p.example) || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section v-if="currentRequestBody" class="section">
                <h3 class="section-title">
                  请求体
                  <span class="content-type-badge">application/json</span>
                  <span v-if="currentRequestBody.required" class="required-badge">必填</span>
                </h3>
                <div v-if="currentRequestBody.description" class="section-desc">{{ currentRequestBody.description }}</div>
                <SchemaView :schema="currentRequestBody.schema" :doc="doc!" />
              </section>

              <section v-if="currentResponses.length" class="section">
                <h3 class="section-title">响应<span class="section-count">{{ currentResponses.length }}</span></h3>
                <div v-for="resp in currentResponses" :key="resp.code" class="response-item">
                  <div class="response-header">
                    <span class="status-badge" :class="statusClass(resp.code)">{{ resp.code }}</span>
                    <span class="response-desc">{{ resp.description }}</span>
                  </div>
                  <SchemaView v-if="resp.schema" :schema="resp.schema" :doc="doc!" />
                </div>
              </section>
            </el-tab-pane>

            <el-tab-pane label="在线调试" name="tester">
              <ApiTester
                :method="selectedApi.method"
                :path="selectedApi.path"
                :params="currentParams"
                :request-body="currentRequestBody"
                :operation="selectedApi.operation"
                :doc="doc!"
              />
            </el-tab-pane>
          </el-tabs>
        </template>

        <div v-else-if="!loading && !error" class="doc-home">
          <div class="home-head">
            <h2 class="home-title">{{ doc?.info?.title || "API 接口文档" }}</h2>
            <p v-if="doc?.info?.description" class="home-desc">{{ doc.info.description }}</p>
            <div class="home-meta">
              <span v-if="doc?.info?.version" class="home-chip">版本 {{ doc.info.version }}</span>
              <span class="home-chip">{{ totalApiCount }} 个接口</span>
              <span class="home-chip">{{ groupedApis.length }} 个分组</span>
              <a v-if="doc?.info?.contact?.url" :href="doc.info.contact.url" target="_blank" class="home-chip home-chip--link">
                {{ doc.info.contact.name || "联系方式" }}
              </a>
              <a v-if="doc?.info?.license?.url" :href="doc.info.license.url" target="_blank" class="home-chip home-chip--link">
                {{ doc.info.license.name }}
              </a>
            </div>
          </div>
          <div class="home-groups">
            <button v-for="group in groupedApis" :key="group.tag" class="home-group" @click="selectFirstInGroup(group.tag)">
              <div class="home-group-head">
                <span class="home-group-name">{{ group.tag }}</span>
                <span class="home-group-count">{{ group.apis.length }}</span>
              </div>
              <div v-if="tagDescriptions[group.tag]" class="home-group-desc">{{ tagDescriptions[group.tag] }}</div>
              <div class="home-group-more">查看接口<el-icon><Right /></el-icon></div>
            </button>
          </div>
        </div>
      </main>
    </div>

    <AuthDialog ref="authDialogRef" :schemes="securitySchemes" />
  </div>
</template>

<style scoped>
/* ===== 布局骨架 ===== */
.doc-layout { height: 100vh; display: flex; flex-direction: column; background: var(--yl-bg); color: var(--yl-text); }
.doc-body { flex: 1; display: flex; overflow: hidden; }

/* ===== 顶栏 ===== */
.doc-header { height: 60px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 24px; background: var(--yl-bg); border-bottom: 1px solid var(--yl-border); }
.header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.doc-logo { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(140deg, #4f6bed, #7b9bff); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 6px rgba(79, 107, 237, 0.3); }
.doc-logo svg { width: 18px; height: 18px; }
.doc-title { font-size: 16px; font-weight: 600; margin: 0; color: var(--yl-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
.meta-badge { font-size: 11px; font-weight: 500; color: var(--yl-text-secondary); padding: 2px 8px; background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 20px; flex-shrink: 0; line-height: 16px; }
.meta-badge--mono { font-family: var(--yl-font-mono); }

.authorize-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; font-size: 13px; font-weight: 500; color: var(--yl-primary); background: var(--yl-primary-soft); border: 1px solid transparent; border-radius: 6px; cursor: pointer; transition: background 0.15s, color 0.15s; }
.authorize-btn:hover { background: #e2e9fd; }
.authorize-btn.is-authorized { color: #1d7a4f; background: #e7f6ee; }
.authorize-btn.is-authorized:hover { background: #d9efe3; }
.authorize-dot { width: 6px; height: 6px; border-radius: 50%; background: #22a06b; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; color: var(--yl-text-tertiary); background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; transition: color 0.15s, background 0.15s; }
.icon-btn:hover { color: var(--yl-primary); background: var(--yl-hover); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ===== 侧栏 ===== */
.doc-sidebar { width: 312px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--yl-bg-sidebar); border-right: 1px solid var(--yl-border); overflow: hidden; }
.sidebar-search { padding: 14px 14px 10px; }
.search-kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; font-family: var(--yl-font-mono); font-size: 11px; color: var(--yl-text-tertiary); background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 4px; }
.sidebar-meta { padding: 0 16px 12px; font-size: 12px; color: var(--yl-text-tertiary); border-bottom: 1px solid var(--yl-border); }
.service-row { padding: 12px 14px 0; }
.service-select { width: 100%; }

.api-groups { flex: 1; overflow-y: auto; padding: 10px 10px 24px; }
.api-group { margin-bottom: 6px; }
.group-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 8px; font-size: 13px; font-weight: 600; color: var(--yl-text); background: transparent; border: none; border-radius: 6px; cursor: pointer; user-select: none; text-align: left; }
.group-header:hover { background: var(--yl-hover); }
.group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collapse-icon { font-size: 12px; color: var(--yl-text-tertiary); transition: transform 0.2s; flex-shrink: 0; }
.collapse-icon.collapsed { transform: rotate(-90deg); }
.group-count { font-size: 11px; font-weight: 500; color: var(--yl-text-tertiary); background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 10px; padding: 0 7px; line-height: 16px; flex-shrink: 0; }
.group-items { padding: 2px 0 4px; }
.group-desc { margin: 0; padding: 0 10px 8px 26px; font-size: 12px; line-height: 1.6; color: var(--yl-text-tertiary); }

.api-item { position: relative; display: block; padding: 7px 8px 7px 12px; margin: 1px 0; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
.api-item::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: transparent; transition: background 0.15s; }
.api-item:hover { background: var(--yl-hover); }
.api-item.active { background: var(--yl-active); }
.api-item.active::before { background: var(--yl-primary); }
.api-item-top { display: flex; align-items: center; gap: 8px; }
.api-item-path { margin-top: 3px; padding-left: 52px; font-family: var(--yl-font-mono); font-size: 11px; line-height: 1.5; color: var(--yl-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.api-summary { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--yl-text-secondary); }
.api-item.active .api-summary { color: var(--yl-primary); font-weight: 500; }
.copy-icon { font-size: 13px; color: var(--yl-text-tertiary); opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.api-item:hover .copy-icon { opacity: 1; }
.copy-icon:hover { color: var(--yl-primary); }
.sidebar-empty { padding: 32px 12px; text-align: center; font-size: 13px; color: var(--yl-text-tertiary); }

/* 方法徽标 */
.method-badge { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 20px; font-family: var(--yl-font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.02em; border-radius: 4px; color: #fff; }
.method-large { width: 62px; height: 26px; font-size: 12px; border-radius: 6px; }
.method-get { background: var(--yl-get); }
.method-post { background: var(--yl-post); }
.method-put { background: var(--yl-put); }
.method-delete { background: var(--yl-delete); }
.method-patch { background: var(--yl-patch); }
.method-options, .method-head, .method-trace { background: var(--yl-other); }

/* ===== 主区 ===== */
.doc-main { flex: 1; overflow-y: auto; padding: 28px 40px 64px; background: var(--yl-bg-main); }
.doc-main > * { max-width: 1080px; margin-left: auto; margin-right: auto; }
.protocol-alert { margin-bottom: 20px; }
.api-breadcrumb { font-size: 12px; color: var(--yl-text-tertiary); margin-bottom: 8px; }
.api-title { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 14px; color: var(--yl-text); }
.api-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.api-path { font-size: 15px; font-weight: 500; color: var(--yl-text-secondary); font-family: var(--yl-font-mono); word-break: break-all; }
.deprecated-badge { font-size: 11px; font-weight: 500; color: #b4463c; background: #fdeceb; border-radius: 4px; padding: 2px 8px; }
.api-description { font-size: 13px; color: var(--yl-text-secondary); margin-bottom: 20px; white-space: pre-wrap; line-height: 1.8; }
.api-tabs { margin-top: 12px; }

/* ===== 内容卡片 ===== */
.section { background: var(--yl-bg); border: 1px solid var(--yl-border); border-radius: 10px; padding: 20px 22px; margin-bottom: 18px; box-shadow: var(--yl-shadow); }
.section-title { font-size: 14px; font-weight: 600; margin: 0 0 16px; color: var(--yl-text); display: flex; align-items: center; gap: 8px; }
.section-count { font-size: 11px; font-weight: 500; color: var(--yl-text-tertiary); background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 10px; padding: 0 7px; line-height: 16px; }
.section-desc { font-size: 12px; color: var(--yl-text-tertiary); margin: -6px 0 12px; line-height: 1.7; }
.content-type-badge { font-size: 11px; font-weight: 400; font-family: var(--yl-font-mono); color: var(--yl-text-tertiary); }
.required-badge { font-size: 11px; font-weight: 500; color: #b4463c; background: #fdeceb; border-radius: 4px; padding: 1px 6px; }

/* ===== 参数表格 ===== */
.param-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.param-table th { text-align: left; font-size: 12px; font-weight: 500; color: var(--yl-text-tertiary); padding: 8px 12px; background: var(--yl-bg-subtle); border-bottom: 1px solid var(--yl-border); }
.param-table th:first-child { border-radius: 6px 0 0 0; }
.param-table th:last-child { border-radius: 0 6px 0 0; }
.param-table td { padding: 11px 12px; border-bottom: 1px solid var(--yl-border); vertical-align: top; line-height: 1.6; }
.param-table tbody tr:last-child td { border-bottom: none; }
.param-table tbody tr:hover { background: var(--yl-bg-subtle); }
.col-name { width: 190px; }
.col-in { width: 80px; }
.col-type { width: 170px; }
.col-example { width: 170px; }
.param-name-text { font-family: var(--yl-font-mono); font-size: 12.5px; font-weight: 500; color: var(--yl-text); }
.required-star { color: #dc4c4c; margin-left: 3px; font-weight: 600; }
.in-badge { display: inline-block; font-family: var(--yl-font-mono); font-size: 11px; color: var(--yl-text-secondary); background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 4px; padding: 0 6px; line-height: 18px; }
.mono { font-family: var(--yl-font-mono); font-size: 12px; color: var(--yl-text-secondary); }
.col-desc { color: var(--yl-text-secondary); }

/* ===== 响应区 ===== */
.response-item { padding: 14px 0; border-bottom: 1px solid var(--yl-border); }
.response-item:first-of-type { padding-top: 0; }
.response-item:last-child { border-bottom: none; padding-bottom: 0; }
.response-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.status-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 22px; padding: 0 8px; font-family: var(--yl-font-mono); font-size: 12px; font-weight: 600; border-radius: 5px; }
.status-badge.is-success { color: #1d7a4f; background: #e7f6ee; }
.status-badge.is-client-error { color: #b4463c; background: #fdf3e7; }
.status-badge.is-server-error { color: #b4463c; background: #fdeceb; }
.status-badge.is-other { color: var(--yl-text-secondary); background: var(--yl-bg-subtle); }
.response-desc { font-size: 13px; color: var(--yl-text-secondary); }
.error-panel { display: flex; align-items: center; justify-content: center; min-height: 60vh; }

/* ===== 首页 ===== */
.doc-home { padding-top: 8px; }
.home-head { padding-bottom: 26px; margin-bottom: 26px; border-bottom: 1px solid var(--yl-border); }
.home-title { font-size: 28px; font-weight: 600; margin: 0 0 16px; color: var(--yl-text); letter-spacing: -0.02em; }
.home-desc { font-size: 14px; line-height: 1.9; color: var(--yl-text-secondary); margin: 0 0 18px; white-space: pre-wrap; }
.home-meta { display: flex; flex-wrap: wrap; gap: 10px; }
.home-chip { display: inline-flex; align-items: center; font-size: 12px; color: var(--yl-text-secondary); background: var(--yl-bg); border: 1px solid var(--yl-border); border-radius: 20px; padding: 4px 12px; text-decoration: none; }
.home-chip--link { color: var(--yl-primary); }
.home-chip--link:hover { border-color: var(--yl-primary); }
.home-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.home-group { background: var(--yl-bg); border: 1px solid var(--yl-border); border-radius: 12px; padding: 20px 22px; cursor: pointer; text-align: left; box-shadow: var(--yl-shadow); transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s; }
.home-group:hover { border-color: #b9c6f5; box-shadow: var(--yl-shadow-hover); transform: translateY(-2px); }
.home-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.home-group-name { font-size: 15px; font-weight: 600; color: var(--yl-text); }
.home-group-count { font-size: 11px; color: var(--yl-text-tertiary); background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 10px; padding: 0 8px; line-height: 18px; }
.home-group-desc { font-size: 12px; color: var(--yl-text-tertiary); margin-top: 10px; line-height: 1.7; }
.home-group-more { display: flex; align-items: center; gap: 4px; margin-top: 14px; font-size: 12px; color: var(--yl-primary); opacity: 0; transition: opacity 0.18s; }
.home-group:hover .home-group-more { opacity: 1; }
</style>
