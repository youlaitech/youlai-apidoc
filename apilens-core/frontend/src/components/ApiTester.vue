<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, nextTick } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import type { OpenAPIDocument, Schema } from "../types/openapi";
import { resolveRef, generateExampleJson } from "../api/openapi";
import { highlightJson } from "../utils/json-highlight";
import { generateCurl, copyToClipboard } from "../utils/curl";
import { authToken, setToken } from "../stores/auth";
import AuthDialog from "./AuthDialog.vue";

interface ParamInfo {
  name: string;
  in: string;
  required: boolean;
  description: string;
  type: string;
  example: any;
}

interface RequestBodyInfo {
  required: boolean;
  description: string;
  schema: Schema;
  example: any;
}

const props = defineProps<{
  method: string;
  path: string;
  params: ParamInfo[];
  requestBody: RequestBodyInfo | null;
  doc: OpenAPIDocument;
}>();

// 请求基础地址，默认取当前页面 origin
const baseUrl = ref(window.location.origin);

// 按 in 类型区分参数（header 参数之前被忽略了）
const pathParams = computed(() => props.params.filter((p) => p.in === "path"));
const queryParams = computed(() => props.params.filter((p) => p.in === "query"));
const headerParams = computed(() => props.params.filter((p) => p.in === "header"));

// 参数值映射
const pathValues = reactive<Record<string, string>>({});
const queryValues = reactive<Record<string, string>>({});
const headerValues = reactive<Record<string, string>>({});

// 全局自定义请求头（跨接口共享，localStorage 持久化）
const CUSTOM_HEADERS_KEY = "apilens-custom-headers";
const customHeaders = ref<Record<string, string>>(loadCustomHeaders());

function loadCustomHeaders(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_HEADERS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCustomHeaders() {
  localStorage.setItem(CUSTOM_HEADERS_KEY, JSON.stringify(customHeaders.value));
}

// 新增自定义 header 的输入
const newHeaderKey = ref("");
const newHeaderValue = ref("");

function addCustomHeader() {
  if (!newHeaderKey.value.trim()) return;
  customHeaders.value[newHeaderKey.value.trim()] = newHeaderValue.value.trim();
  newHeaderKey.value = "";
  newHeaderValue.value = "";
  saveCustomHeaders();
}

function removeCustomHeader(key: string) {
  delete customHeaders.value[key];
  saveCustomHeaders();
}

// 用示例值初始化参数
function initDefaults() {
  for (const p of pathParams.value) {
    pathValues[p.name] = String(p.example ?? "");
  }
  for (const p of queryParams.value) {
    queryValues[p.name] = String(p.example ?? "");
  }
  for (const p of headerParams.value) {
    headerValues[p.name] = String(p.example ?? "");
  }
}
initDefaults();

// 切换接口时重新初始化
watch(() => props.path, () => {
  for (const key of Object.keys(pathValues)) delete pathValues[key];
  for (const key of Object.keys(queryValues)) delete queryValues[key];
  for (const key of Object.keys(headerValues)) delete headerValues[key];
  initDefaults();
  requestBodyText.value = props.requestBody?.example
    ? JSON.stringify(props.requestBody.example, null, 2)
    : generateExampleJson(props.requestBody?.schema, props.doc);
  responseStatus.value = null;
  responseBody.value = "";
  responseTime.value = null;
});

// 请求体 JSON 编辑器内容
const requestBodyText = ref(
  props.requestBody?.example
    ? JSON.stringify(props.requestBody.example, null, 2)
    : generateExampleJson(props.requestBody?.schema, props.doc)
);

/** 格式化请求体 JSON */
function formatRequestBody() {
  try {
    requestBodyText.value = JSON.stringify(JSON.parse(requestBodyText.value), null, 2);
  } catch (e) {
    ElMessage.error("JSON 格式有误，无法格式化");
  }
}

// 最终请求 URL：替换 path 参数 + 拼接 query 参数
const finalUrl = computed(() => {
  let url = props.path;
  for (const [name, value] of Object.entries(pathValues)) {
    url = url.replace(`{${name}}`, encodeURIComponent(value));
  }
  const qs = Object.entries(queryValues)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += `?${qs}`;
  return baseUrl.value + url;
});

// 所有请求头（接口定义的 header 参数 + 自定义 header + Auth）
const allHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // 接口定义的 header 参数
  for (const [name, value] of Object.entries(headerValues)) {
    if (value) headers[name] = value;
  }
  // 全局自定义 header
  for (const [name, value] of Object.entries(customHeaders.value)) {
    if (value) headers[name] = value;
  }
  // Auth token
  if (authToken.value) {
    headers["Authorization"] = `Bearer ${authToken.value}`;
  }
  return headers;
});

// 发送请求
const sending = ref(false);
const responseStatus = ref<number | null>(null);
const responseHeaders = ref("");
const responseBody = ref("");
const responseTime = ref<number | null>(null);

async function sendRequest() {
  sending.value = true;
  responseBody.value = "";
  responseStatus.value = null;
  responseTime.value = null;
  const startTime = performance.now();
  try {
    // POST/PUT/PATCH 携带请求体
    let data: string | undefined;
    if (["post", "put", "patch"].includes(props.method) && props.requestBody) {
      data = requestBodyText.value;
    }
    const res = await axios.request({
      method: props.method,
      url: finalUrl.value,
      headers: allHeaders.value,
      data,
      validateStatus: () => true,
    });
    responseTime.value = Math.round(performance.now() - startTime);
    responseStatus.value = res.status;
    responseHeaders.value = JSON.stringify(res.headers, null, 2);
    responseBody.value = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);

    saveHistory({
      method: props.method.toUpperCase(),
      path: props.path,
      status: res.status,
      body: responseBody.value.slice(0, 500),
      time: new Date().toLocaleTimeString(),
    });
  } catch (e: any) {
    responseTime.value = Math.round(performance.now() - startTime);
    responseStatus.value = 0;
    responseBody.value = e.message || "请求失败";
    saveHistory({
      method: props.method.toUpperCase(),
      path: props.path,
      status: 0,
      body: e.message || "请求失败",
      time: new Date().toLocaleTimeString(),
    });
  } finally {
    sending.value = false;
  }
}

const statusType = computed(() => {
  if (responseStatus.value === null) return "info";
  if (responseStatus.value === 0) return "danger";
  if (responseStatus.value < 300) return "success";
  if (responseStatus.value < 400) return "warning";
  return "danger";
});

// 响应体高亮 HTML
const highlightedBody = computed(() => highlightJson(responseBody.value));

// 响应大小（字节）
const responseSize = computed(() => {
  if (!responseBody.value) return "";
  const bytes = new Blob([responseBody.value]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
});

/** 复制 cURL 命令 */
async function copyCurl() {
  const curl = generateCurl({
    method: props.method,
    url: finalUrl.value,
    headers: allHeaders.value,
    body: ["post", "put", "patch"].includes(props.method) && props.requestBody ? requestBodyText.value : undefined,
  });
  const ok = await copyToClipboard(curl);
  if (ok) {
    ElMessage.success("cURL 命令已复制");
  } else {
    ElMessage.error("复制失败");
  }
}

/** 清除 token */
function clearAuth() {
  setToken("");
}

/** 响应体一键复制 */
async function copyResponse() {
  const ok = await copyToClipboard(responseBody.value);
  if (ok) {
    ElMessage.success("响应体已复制");
  } else {
    ElMessage.error("复制失败");
  }
}

/** 请求体 textarea 支持 Tab 缩进 */
function handleTabIndent(e: KeyboardEvent) {
  const target = e.target as HTMLTextAreaElement;
  if (e.key === "Tab") {
    e.preventDefault();
    const start = target.selectionStart;
    const end = target.selectionEnd;
    // 插入两个空格代替 Tab
    requestBodyText.value =
      requestBodyText.value.substring(0, start) +
      "  " +
      requestBodyText.value.substring(end);
    // 把光标移到插入位置之后
    nextTick(() => {
      target.selectionStart = target.selectionEnd = start + 2;
    });
  }
}

/* ===================== 响应历史缓存 ===================== */

interface HistoryEntry {
  method: string;
  path: string;
  status: number;
  body: string;
  time: string;
}

const historyList = ref<HistoryEntry[]>(loadHistory());

const HISTORY_KEY = "apilens-history";
const HISTORY_MAX = 10;

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entry: HistoryEntry) {
  historyList.value.unshift(entry);
  if (historyList.value.length > HISTORY_MAX) {
    historyList.value = historyList.value.slice(0, HISTORY_MAX);
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(historyList.value));
}

function clearHistory() {
  historyList.value = [];
  localStorage.removeItem(HISTORY_KEY);
}

// token 是否已设置（用于 UI 显示）
const hasToken = computed(() => !!authToken.value);

// AuthDialog 引用
const authDialogRef = ref();
</script>

<template>
  <div class="api-tester">
    <!-- Auth 区域 -->
    <section class="section auth-section">
      <div class="auth-bar">
        <el-tag :type="hasToken ? 'success' : 'info'" size="small">
          {{ hasToken ? "Token 已设置" : "未认证" }}
        </el-tag>
        <el-button size="small" @click="authDialogRef?.open()">设置 Token</el-button>
        <el-button v-if="hasToken" size="small" text type="danger" @click="clearAuth">清除</el-button>
      </div>
      <div v-if="hasToken" class="token-preview">{{ authToken.slice(0, 30) }}...</div>
    </section>

    <!-- 请求配置 -->
    <section class="section">
      <h3 class="section-title">请求地址</h3>
      <el-input v-model="baseUrl" size="small" class="base-url-input">
        <template #prepend>Base URL</template>
      </el-input>

      <!-- Path 参数 -->
      <div v-if="pathParams.length" class="param-group">
        <div class="param-group-title">Path 参数</div>
        <div v-for="p in pathParams" :key="p.name" class="param-row">
          <span class="param-name">{{ p.name }}</span>
          <span class="param-type">{{ p.type }}</span>
          <el-input v-model="pathValues[p.name]" size="small" :placeholder="p.description" class="param-input" />
        </div>
      </div>

      <!-- Query 参数 -->
      <div v-if="queryParams.length" class="param-group">
        <div class="param-group-title">Query 参数</div>
        <div v-for="p in queryParams" :key="p.name" class="param-row">
          <span class="param-name">{{ p.name }}</span>
          <span class="param-type">{{ p.type }}</span>
          <el-input v-model="queryValues[p.name]" size="small" :placeholder="p.description" class="param-input" />
        </div>
      </div>

      <!-- Header 参数（接口定义的） -->
      <div v-if="headerParams.length" class="param-group">
        <div class="param-group-title">Header 参数</div>
        <div v-for="p in headerParams" :key="p.name" class="param-row">
          <span class="param-name">{{ p.name }}</span>
          <el-input v-model="headerValues[p.name]" size="small" :placeholder="p.description" class="param-input" />
        </div>
      </div>

      <!-- 全局自定义 Header -->
      <div class="param-group">
        <div class="param-group-title">自定义请求头（全局共享）</div>
        <div v-for="(val, key) in customHeaders" :key="key" class="param-row">
          <span class="param-name">{{ key }}</span>
          <el-input v-model="customHeaders[key]" size="small" class="param-input" />
          <el-button size="small" text type="danger" @click="removeCustomHeader(key)">删除</el-button>
        </div>
        <div class="param-row add-header-row">
          <el-input v-model="newHeaderKey" size="small" placeholder="Header 名" class="header-key-input" />
          <el-input v-model="newHeaderValue" size="small" placeholder="Header 值" class="param-input" />
          <el-button size="small" @click="addCustomHeader">添加</el-button>
        </div>
      </div>

      <!-- 请求体 -->
      <div v-if="requestBody && ['post', 'put', 'patch'].includes(method)" class="param-group">
        <div class="param-group-title">
          请求体 (JSON)
          <el-tag v-if="requestBody.required" type="danger" size="small">必填</el-tag>
          <el-button size="small" text @click="formatRequestBody">格式化</el-button>
        </div>
        <el-input
          v-model="requestBodyText"
          type="textarea"
          :rows="8"
          size="small"
          class="json-editor"
          @keydown="handleTabIndent"
          @keydown.ctrl.enter="sendRequest"
        />
      </div>
    </section>

    <!-- 发送按钮 -->
    <div class="send-bar">
      <el-button type="primary" :loading="sending" @click="sendRequest">
        {{ sending ? "发送中..." : "发送请求" }}
      </el-button>
      <el-button size="small" @click="copyCurl">复制 cURL</el-button>
      <span class="shortcut-hint">Ctrl+Enter 快速发送</span>
      <code class="final-url">{{ method.toUpperCase() }} {{ finalUrl }}</code>
    </div>

    <!-- 响应 -->
    <section v-if="responseStatus !== null" class="section">
      <h3 class="section-title">
        响应结果
        <el-tag :type="statusType" size="small">{{ responseStatus === 0 ? "请求失败" : responseStatus }}</el-tag>
        <span v-if="responseTime !== null" class="response-meta">{{ responseTime }} ms</span>
        <span v-if="responseSize" class="response-meta">{{ responseSize }}</span>
      </h3>
      <el-tabs>
        <el-tab-pane label="响应体" name="body">
          <div class="response-body-wrapper">
            <el-button size="small" text class="copy-response-btn" @click="copyResponse">复制</el-button>
            <pre class="response-pre json-highlight" v-html="highlightedBody"></pre>
          </div>
        </el-tab-pane>
        <el-tab-pane label="响应头" name="headers">
          <pre class="response-pre">{{ responseHeaders }}</pre>
        </el-tab-pane>
        <el-tab-pane :label="`历史 (${historyList.length})`" name="history">
          <div v-if="historyList.length === 0" class="history-empty">暂无历史记录</div>
          <div v-else class="history-list">
            <el-button size="small" text type="danger" @click="clearHistory" class="clear-btn">清空</el-button>
            <div v-for="(item, idx) in historyList" :key="idx" class="history-item">
              <el-tag :type="item.status === 0 ? 'danger' : item.status < 300 ? 'success' : 'danger'" size="small">
                {{ item.method }}
              </el-tag>
              <span class="history-path">{{ item.path }}</span>
              <el-tag :type="item.status === 0 ? 'danger' : item.status < 300 ? 'success' : 'danger'" size="small" effect="plain">
                {{ item.status === 0 ? "失败" : item.status }}
              </el-tag>
              <span class="history-time">{{ item.time }}</span>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <!-- AuthDialog -->
    <AuthDialog ref="authDialogRef" />
  </div>
</template>

<style scoped>
.section { margin-bottom: 16px; }
.section-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--yl-text); display: flex; align-items: center; gap: 8px; }
.auth-section { border: 1px solid var(--yl-border); border-radius: 4px; padding: 10px; }
.auth-bar { display: flex; align-items: center; gap: 8px; }
.token-preview { font-size: 12px; color: var(--yl-text-tertiary); margin-top: 6px; font-family: monospace; }
.base-url-input { margin-bottom: 12px; }
.param-group { margin-bottom: 12px; }
.param-group-title { font-size: 13px; font-weight: 600; color: var(--yl-text-secondary); margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.param-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.param-name { width: 140px; font-size: 13px; color: var(--yl-text); flex-shrink: 0; }
.param-type { width: 100px; font-size: 12px; color: var(--yl-text-tertiary); flex-shrink: 0; }
.param-input { flex: 1; }
.header-key-input { width: 160px; flex-shrink: 0; }
.add-header-row { margin-top: 6px; }
.json-editor :deep(textarea) { font-family: 'Consolas', 'Monaco', monospace; }
.send-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.final-url { font-size: 12px; color: var(--yl-text-secondary); background: var(--yl-bg-sidebar); padding: 4px 8px; border-radius: 4px; word-break: break-all; }
.shortcut-hint { font-size: 11px; color: var(--yl-text-tertiary); }
.response-pre { background: var(--yl-bg-sidebar); padding: 12px; border-radius: 4px; font-size: 13px; max-height: 400px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-family: 'Consolas', 'Monaco', monospace; }
.response-body-wrapper { position: relative; }
.copy-response-btn { position: absolute; top: 4px; right: 8px; z-index: 1; }
.response-meta { font-size: 12px; color: var(--yl-text-tertiary); }
.history-empty { text-align: center; color: var(--yl-text-tertiary); padding: 20px; font-size: 13px; }
.history-list { position: relative; }
.clear-btn { position: absolute; top: -40px; right: 0; }
.history-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--yl-border); font-size: 13px; }
.history-path { flex: 1; color: var(--yl-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
.history-time { color: var(--yl-text-tertiary); font-size: 12px; flex-shrink: 0; }
</style>

<!-- JSON 语法高亮颜色（全局，非 scoped） -->
<style>
.json-highlight .json-key { color: #c678dd; }
.json-highlight .json-string { color: #98c379; }
.json-highlight .json-number { color: #d19a66; }
.json-highlight .json-boolean { color: #56b6c2; }
.json-highlight .json-null { color: #e06c75; }
.dark .json-highlight .json-key { color: #c678dd; }
.dark .json-highlight .json-string { color: #98c379; }
.dark .json-highlight .json-number { color: #d19a66; }
.dark .json-highlight .json-boolean { color: #56b6c2; }
.dark .json-highlight .json-null { color: #e06c75; }
</style>
