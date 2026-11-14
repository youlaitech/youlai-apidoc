<script setup lang="ts">
import { ref, computed, reactive, watch, nextTick } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import type { OpenAPIDocument, Operation, Schema } from "../types/openapi";
import { generateExampleJson } from "../api/openapi";
import { highlightJson } from "../utils/json-highlight";
import { generateCurl, copyToClipboard } from "../utils/curl";
import { authValues } from "../stores/auth";
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

/**
 * 当前接口与文档数据
 */
const props = defineProps<{
  method: string;
  path: string;
  params: ParamInfo[];
  requestBody: RequestBodyInfo | null;
  operation?: Operation;
  doc: OpenAPIDocument;
}>();

/**
 * 取文档声明的 servers[0]，相对地址在开发环境指向本地后端
 */
function resolveBaseUrl(doc: OpenAPIDocument): string {
  const server = doc.servers?.[0]?.url;
  if (server && /^https?:\/\//i.test(server)) {
    return server.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:8000";
  }
  return window.location.origin;
}

// 请求基础地址
const baseUrl = ref(resolveBaseUrl(props.doc));

// 按 in 类型区分参数（header 参数之前被忽略了）
const pathParams = computed(() => props.params.filter((p) => p.in === "path"));
const queryParams = computed(() => props.params.filter((p) => p.in === "query"));
const headerParams = computed(() => props.params.filter((p) => p.in === "header"));
// 浏览器把 Cookie 列为禁止脚本设置的请求头，cookie 参数只能展示不能在页面内发送
const cookieParams = computed(() => props.params.filter((p) => p.in === "cookie"));

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

/**
 * 参数初始值：示例值为对象时序列化，避免出现 [object Object]
 */
function initialValue(p: ParamInfo): string {
  const example = p.example;
  if (example === undefined || example === null) return "";
  return typeof example === "object" ? JSON.stringify(example) : String(example);
}

// 用示例值初始化参数
function initDefaults() {
  for (const p of pathParams.value) {
    pathValues[p.name] = initialValue(p);
  }
  for (const p of queryParams.value) {
    queryValues[p.name] = initialValue(p);
  }
  for (const p of headerParams.value) {
    headerValues[p.name] = initialValue(p);
  }
}
initDefaults();

// 切换接口（含同路径不同方法）时重新初始化
watch(
  () => [props.path, props.method],
  () => {
    for (const key of Object.keys(pathValues)) delete pathValues[key];
    for (const key of Object.keys(queryValues)) delete queryValues[key];
    for (const key of Object.keys(headerValues)) delete headerValues[key];
    initDefaults();
    baseUrl.value = resolveBaseUrl(props.doc);
    requestBodyText.value = props.requestBody?.example
      ? JSON.stringify(props.requestBody.example, null, 2)
      : generateExampleJson(props.requestBody?.schema, props.doc);
    responseStatus.value = null;
    responseBody.value = "";
    responseTime.value = null;
  }
);

// 请求体 JSON 编辑器内容
const requestBodyText = ref(
  props.requestBody?.example
    ? JSON.stringify(props.requestBody.example, null, 2)
    : generateExampleJson(props.requestBody?.schema, props.doc)
);

const hasBody = computed(() => !!props.requestBody && ["post", "put", "patch"].includes(props.method));

/**
 * 格式化请求体 JSON
 */
function formatRequestBody() {
  try {
    requestBodyText.value = JSON.stringify(JSON.parse(requestBodyText.value), null, 2);
  } catch (e) {
    ElMessage.error("JSON 格式有误，无法格式化");
  }
}

/**
 * 恢复为文档生成的示例
 */
function resetRequestBody() {
  requestBodyText.value = props.requestBody?.example
    ? JSON.stringify(props.requestBody.example, null, 2)
    : generateExampleJson(props.requestBody?.schema, props.doc);
}

// 当前接口要求的安全方案，operation 优先，其次文档全局
const securityNames = computed(() => {
  const requirements = props.operation?.security?.length ? props.operation.security : props.doc.security || [];
  return [...new Set(requirements.flatMap((requirement) => Object.keys(requirement)))];
});

const securitySchemes = computed(() => props.doc.components?.securitySchemes || {});

// 按授权值生成请求头
const authHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {};
  for (const name of securityNames.value) {
    const scheme = securitySchemes.value[name];
    const value = authValues.value[name];
    if (!scheme || !value) continue;
    if (scheme.type === "apiKey" && (scheme.in || "header") === "header") {
      const raw = value.trim();
      // apiKey 声明了 Bearer 时补前缀，避免用户只填 token 导致 401
      const bearer = scheme.scheme?.toLowerCase() === "bearer";
      headers[scheme.name || name] = bearer && raw && !raw.includes(" ") ? `Bearer ${raw}` : raw;
    } else if (scheme.type === "http") {
      const mode = (scheme.scheme || "bearer").toLowerCase();
      headers[scheme.name || "Authorization"] = mode === "basic" ? `Basic ${btoa(value)}` : `Bearer ${value}`;
    }
  }
  return headers;
});

// 按授权值生成 query 参数
const authQuery = computed<Record<string, string>>(() => {
  const query: Record<string, string> = {};
  for (const name of securityNames.value) {
    const scheme = securitySchemes.value[name];
    const value = authValues.value[name];
    if (scheme?.type === "apiKey" && scheme.in === "query" && value) {
      query[scheme.name || name] = value;
    }
  }
  return query;
});

const authorizedCount = computed(() => securityNames.value.filter((name) => authValues.value[name]).length);

// 最终请求 URL：替换 path 参数 + 拼接 query 参数
const finalUrl = computed(() => {
  let url = props.path;
  for (const [name, value] of Object.entries(pathValues)) {
    url = url.replace(`{${name}}`, encodeURIComponent(value));
  }
  const qs = Object.entries({ ...queryValues, ...authQuery.value })
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += `?${qs}`;
  return baseUrl.value + url;
});

// 所有请求头（接口定义的 header 参数 + 自定义 header + 安全方案）
const allHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {};
  // 只有携带请求体时才声明 JSON 类型，避免给 GET 附加无意义的 Content-Type
  if (hasBody.value) {
    headers["Content-Type"] = "application/json";
  }
  for (const [name, value] of Object.entries(headerValues)) {
    if (value) headers[name] = value;
  }
  for (const [name, value] of Object.entries(customHeaders.value)) {
    if (value) headers[name] = value;
  }
  Object.assign(headers, authHeaders.value);
  return headers;
});

// 发送请求
const sending = ref(false);
const responseStatus = ref<number | null>(null);
const responseHeaders = ref("");
const responseBody = ref("");
const responseTime = ref<number | null>(null);
const responseTab = ref("body");

async function sendRequest() {
  sending.value = true;
  responseBody.value = "";
  responseStatus.value = null;
  responseTime.value = null;
  const startTime = performance.now();
  try {
    // POST/PUT/PATCH 携带请求体
    let data: string | undefined;
    if (hasBody.value) {
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
    responseTab.value = "body";

    saveHistory({
      method: props.method.toUpperCase(),
      path: props.path,
      status: res.status,
      body: responseBody.value.slice(0, 5000),
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

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

const statusText = computed(() => {
  if (responseStatus.value === null) return "";
  if (responseStatus.value === 0) return "请求失败";
  const text = STATUS_TEXT[responseStatus.value];
  return `${responseStatus.value}${text ? " " + text : ""}`;
});

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

/**
 * 复制 cURL 命令
 */
async function copyCurl() {
  const curl = generateCurl({
    method: props.method,
    url: finalUrl.value,
    headers: allHeaders.value,
    body: hasBody.value ? requestBodyText.value : undefined,
  });
  const ok = await copyToClipboard(curl);
  if (ok) {
    ElMessage.success("cURL 命令已复制");
  } else {
    ElMessage.error("复制失败");
  }
}

/**
 * 复制请求地址
 */
async function copyUrl() {
  const ok = await copyToClipboard(finalUrl.value);
  if (ok) {
    ElMessage.success("请求地址已复制");
  }
}

/**
 * 响应体一键复制
 */
async function copyResponse() {
  const ok = await copyToClipboard(responseBody.value);
  if (ok) {
    ElMessage.success("响应体已复制");
  } else {
    ElMessage.error("复制失败");
  }
}

/**
 * 请求体 textarea 支持 Tab 缩进
 */
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

/**
 * 查看历史响应内容
 */
function viewHistory(item: HistoryEntry) {
  responseStatus.value = item.status;
  responseBody.value = item.body;
  responseHeaders.value = "";
  responseTime.value = null;
  responseTab.value = "body";
}

// AuthDialog 引用
const authDialogRef = ref();
</script>

<template>
  <div class="api-tester">
    <!-- 请求地址预览 -->
    <div class="request-url-bar">
      <span class="method-badge" :class="'method-' + method.toLowerCase()">{{ method.toUpperCase() }}</span>
      <code class="request-url" :title="finalUrl">{{ finalUrl }}</code>
      <el-tooltip content="复制请求地址" placement="top">
        <button class="icon-btn" @click="copyUrl"><el-icon><CopyDocument /></el-icon></button>
      </el-tooltip>
    </div>

    <!-- 授权状态 -->
    <div v-if="securityNames.length" class="auth-banner" :class="{ 'is-authorized': authorizedCount > 0 }">
      <el-icon><Lock /></el-icon>
      <span class="auth-banner-text">
        此接口需要授权（{{ securityNames.join("、") }}）
      </span>
      <span class="auth-banner-state">{{ authorizedCount ? `已配置 ${authorizedCount}/${securityNames.length}` : "未配置" }}</span>
      <button class="auth-banner-btn" @click="authDialogRef?.open()">{{ authorizedCount ? "修改" : "去授权" }}</button>
    </div>

    <!-- 参数 -->
    <section v-if="pathParams.length || queryParams.length" class="section">
      <div v-if="pathParams.length" class="param-group">
        <div class="param-group-title">路径参数<span class="group-num">{{ pathParams.length }}</span></div>
        <div v-for="p in pathParams" :key="p.name" class="param-row">
          <div class="param-label">
            <span class="param-name">{{ p.name }}<i v-if="p.required" class="required-star">*</i></span>
            <span class="param-type">{{ p.type }}</span>
          </div>
          <el-input v-model="pathValues[p.name]" :placeholder="p.description || '参数值'" class="param-input" />
        </div>
      </div>

      <div v-if="queryParams.length" class="param-group">
        <div class="param-group-title">查询参数<span class="group-num">{{ queryParams.length }}</span></div>
        <div v-for="p in queryParams" :key="p.name" class="param-row">
          <div class="param-label">
            <span class="param-name">{{ p.name }}<i v-if="p.required" class="required-star">*</i></span>
            <span class="param-type">{{ p.type }}</span>
          </div>
          <el-input v-model="queryValues[p.name]" :placeholder="p.description || '留空则不发送'" class="param-input" clearable />
        </div>
      </div>
    </section>

    <!-- 请求头：接口声明的 header 参数 + 全局自定义请求头 -->
    <section class="section">
      <div class="param-group-title">
        请求头
        <span class="group-num">{{ headerParams.length + Object.keys(customHeaders).length }}</span>
        <span v-if="Object.keys(authHeaders).length" class="auth-header-hint">
          授权头 {{ Object.keys(authHeaders).join("、") }} 将自动附加
        </span>
      </div>
      <div v-for="p in headerParams" :key="p.name" class="param-row">
        <div class="param-label">
          <span class="param-name">{{ p.name }}<i v-if="p.required" class="required-star">*</i></span>
          <span class="param-type">{{ p.type }}</span>
        </div>
        <el-input v-model="headerValues[p.name]" :placeholder="p.description || 'Header 值'" class="param-input" clearable />
      </div>
      <div v-for="(val, key) in customHeaders" :key="key" class="param-row">
        <div class="param-label">
          <span class="param-name">{{ key }}</span>
          <span class="param-type param-type--global">全局</span>
        </div>
        <el-input v-model="customHeaders[key]" class="param-input" @change="saveCustomHeaders" />
        <el-button text type="danger" class="row-remove" @click="removeCustomHeader(key)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
      <div class="param-row add-header-row">
        <el-input v-model="newHeaderKey" placeholder="请求头名称，如 X-Tenant-Id" class="header-key-input" @keyup.enter="addCustomHeader" />
        <el-input v-model="newHeaderValue" placeholder="请求头值" class="param-input" @keyup.enter="addCustomHeader" />
        <el-button class="add-header-btn" :disabled="!newHeaderKey.trim()" @click="addCustomHeader">
          <el-icon><Plus /></el-icon>添加
        </el-button>
      </div>
      <p class="header-tip">自定义请求头全局共享，保存在本机浏览器，所有接口调试都会携带。</p>
    </section>

    <!-- Cookie 参数：浏览器禁止脚本设置 Cookie 头，仅展示 -->
    <section v-if="cookieParams.length" class="section">
      <div class="param-group-title">Cookie 参数</div>
      <div v-for="p in cookieParams" :key="p.name" class="param-row">
        <div class="param-label">
          <span class="param-name">{{ p.name }}</span>
          <span class="param-type">{{ p.type }}</span>
        </div>
        <span class="param-description">{{ p.description }}</span>
      </div>
      <p class="header-tip">浏览器禁止脚本设置 Cookie 请求头，此处仅展示，请在请求前确保浏览器已携带对应 Cookie。</p>
    </section>

    <!-- 请求体 -->
    <section v-if="hasBody" class="section">
      <div class="body-editor-head">
        <div class="param-group-title">
          请求体
          <span class="content-type-badge">application/json</span>
          <span v-if="requestBody?.required" class="required-badge">必填</span>
        </div>
        <div class="body-editor-actions">
          <el-button text size="small" @click="resetRequestBody">重置示例</el-button>
          <el-button text size="small" @click="formatRequestBody">格式化</el-button>
        </div>
      </div>
      <div v-if="requestBody?.description" class="section-desc">{{ requestBody.description }}</div>
      <el-input
        v-model="requestBodyText"
        type="textarea"
        :rows="12"
        class="json-editor"
        spellcheck="false"
        @keydown="handleTabIndent"
        @keydown.ctrl.enter="sendRequest"
      />
    </section>

    <!-- 发送 -->
    <div class="send-bar">
      <el-button type="primary" class="send-btn" :loading="sending" @click="sendRequest">
        <el-icon v-if="!sending"><Promotion /></el-icon>
        {{ sending ? "发送中" : "发送请求" }}
      </el-button>
      <el-button class="curl-btn" @click="copyCurl">复制 cURL</el-button>
      <span class="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 发送</span>
    </div>

    <!-- 高级设置 -->
    <el-collapse class="advanced">
      <el-collapse-item name="advanced">
        <template #title><span class="advanced-title"><el-icon><Setting /></el-icon>高级设置</span></template>
        <div class="param-group">
          <div class="param-group-title">Base URL</div>
          <el-input v-model="baseUrl" placeholder="默认为文档 servers[0] 或当前站点" />
        </div>
      </el-collapse-item>
    </el-collapse>

    <!-- 响应 -->
    <section v-if="responseStatus !== null" class="section response-section">
      <div class="response-statusbar">
        <span class="response-status" :class="'status-' + statusType">{{ statusText }}</span>
        <span v-if="responseTime !== null" class="response-meta">{{ responseTime }} ms</span>
        <span v-if="responseSize" class="response-meta">{{ responseSize }}</span>
        <div class="response-actions">
          <el-button text size="small" @click="copyResponse"><el-icon><CopyDocument /></el-icon>复制</el-button>
        </div>
      </div>
      <el-tabs v-model="responseTab" class="response-tabs">
        <el-tab-pane label="响应体" name="body">
          <pre class="response-pre json-highlight" v-html="highlightedBody"></pre>
        </el-tab-pane>
        <el-tab-pane label="响应头" name="headers">
          <pre v-if="responseHeaders" class="response-pre">{{ responseHeaders }}</pre>
          <div v-else class="history-empty">该记录未保存响应头</div>
        </el-tab-pane>
        <el-tab-pane :label="`历史 (${historyList.length})`" name="history">
          <div v-if="historyList.length === 0" class="history-empty">暂无历史记录</div>
          <div v-else class="history-list">
            <div class="history-toolbar">
              <el-button text type="danger" size="small" @click="clearHistory">清空历史</el-button>
            </div>
            <button v-for="(item, idx) in historyList" :key="idx" class="history-item" @click="viewHistory(item)">
              <span class="history-method" :class="'text-' + item.method.toLowerCase()">{{ item.method }}</span>
              <span class="history-path">{{ item.path }}</span>
              <span class="history-status" :class="item.status > 0 && item.status < 300 ? 'is-ok' : 'is-fail'">
                {{ item.status === 0 ? "失败" : item.status }}
              </span>
              <span class="history-time">{{ item.time }}</span>
            </button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <!-- AuthDialog -->
    <AuthDialog ref="authDialogRef" :schemes="securitySchemes" />
  </div>
</template>

<style scoped>
.section { background: var(--yl-bg); border: 1px solid var(--yl-border); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; box-shadow: var(--yl-shadow); }
.section-title { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: var(--yl-text); display: flex; align-items: center; gap: 8px; }
.section-desc { font-size: 12px; color: var(--yl-text-tertiary); margin-bottom: 10px; }

/* 请求地址条 */
.request-url-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 14px; background: var(--yl-bg); border: 1px solid var(--yl-border); border-radius: 10px; box-shadow: var(--yl-shadow); }
.request-url { flex: 1; font-family: var(--yl-font-mono); font-size: 12.5px; color: var(--yl-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.method-badge { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 24px; font-family: var(--yl-font-mono); font-size: 11px; font-weight: 700; border-radius: 5px; color: #fff; }
.method-get { background: var(--yl-get); }
.method-post { background: var(--yl-post); }
.method-put { background: var(--yl-put); }
.method-delete { background: var(--yl-delete); }
.method-patch { background: var(--yl-patch); }
.method-options, .method-head, .method-trace { background: var(--yl-other); }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; color: var(--yl-text-tertiary); background: transparent; border: none; border-radius: 6px; cursor: pointer; }
.icon-btn:hover { color: var(--yl-primary); background: var(--yl-hover); }

/* 授权提示条 */
.auth-banner { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 12.5px; color: #925e1f; background: #fdf7e9; border: 1px solid #f3e3bd; border-radius: 10px; }
.auth-banner.is-authorized { color: #1d7a4f; background: #eef9f2; border-color: #cdeedd; }
.auth-banner-text { flex: 1; }
.auth-banner-state { font-size: 12px; opacity: 0.85; }
.auth-banner-btn { padding: 2px 10px; font-size: 12px; font-weight: 500; color: inherit; background: rgba(255, 255, 255, 0.7); border: 1px solid currentColor; border-radius: 5px; cursor: pointer; }
.auth-banner-btn:hover { background: #fff; }

/* 参数编辑 */
.param-group { margin-bottom: 16px; }
.param-group:last-child { margin-bottom: 0; }
.param-group-title { font-size: 13px; font-weight: 600; color: var(--yl-text); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.group-num { font-size: 11px; font-weight: 500; color: var(--yl-text-tertiary); background: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 10px; padding: 0 7px; line-height: 16px; }
.param-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.param-row:last-child { margin-bottom: 0; }
.param-label { display: flex; flex-direction: column; gap: 2px; width: 200px; flex-shrink: 0; }
.param-name { font-family: var(--yl-font-mono); font-size: 12.5px; font-weight: 500; color: var(--yl-text); word-break: break-all; }
.param-type { font-family: var(--yl-font-mono); font-size: 11px; color: var(--yl-text-tertiary); }
.param-type--global { color: var(--yl-primary); }
.param-input { flex: 1; }
.param-description { font-size: 12px; color: var(--yl-text-tertiary); flex: 1; }
.required-star { color: #dc4c4c; font-style: normal; margin-left: 2px; }
.row-remove { flex-shrink: 0; }
.add-header-row { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--yl-border); }
.header-key-input { width: 200px; flex-shrink: 0; }
.add-header-btn { flex-shrink: 0; }
.header-tip { margin: 12px 0 0; font-size: 12px; line-height: 1.6; color: var(--yl-text-tertiary); }
.auth-header-hint { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--yl-text-tertiary); }
.content-type-badge { font-size: 11px; font-weight: 400; font-family: var(--yl-font-mono); color: var(--yl-text-tertiary); }
.required-badge { font-size: 11px; font-weight: 500; color: #b4463c; background: #fdeceb; border-radius: 4px; padding: 1px 6px; }

/* 请求体编辑器 */
.body-editor-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.body-editor-head .param-group-title { margin-bottom: 0; }
.body-editor-actions { display: flex; gap: 4px; }
.json-editor :deep(textarea) { font-family: var(--yl-font-mono); font-size: 12.5px; line-height: 1.7; color: #263042; background: #fbfcfe; border: 1px solid var(--yl-border); border-radius: 8px; padding: 12px 14px; transition: border-color 0.15s, box-shadow 0.15s; }
.json-editor :deep(textarea):focus { border-color: var(--yl-primary); box-shadow: 0 0 0 3px rgba(79, 107, 237, 0.12); outline: none; }

/* 发送栏 */
.send-bar { display: flex; align-items: center; gap: 12px; margin: 4px 0 16px; flex-wrap: wrap; }
.send-btn { min-width: 128px; height: 38px; font-size: 14px; font-weight: 500; }
.shortcut-hint { font-size: 12px; color: var(--yl-text-tertiary); }
.shortcut-hint kbd { display: inline-block; padding: 1px 5px; font-family: var(--yl-font-mono); font-size: 11px; background: var(--yl-bg); border: 1px solid var(--yl-border); border-bottom-width: 2px; border-radius: 4px; }

/* 高级设置 */
.advanced { margin-bottom: 16px; border: 1px solid var(--yl-border); border-radius: 10px; background: var(--yl-bg); overflow: hidden; }
.advanced :deep(.el-collapse-item__header) { padding: 0 18px; height: 44px; background: transparent; border-bottom: none; }
.advanced :deep(.el-collapse-item__wrap) { background: transparent; border-bottom: none; }
.advanced :deep(.el-collapse-item__content) { padding: 0 18px 16px; }
.advanced-title { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--yl-text-secondary); }

/* 响应区 */
.response-section { padding-top: 14px; }
.response-statusbar { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--yl-border); }
.response-status { font-family: var(--yl-font-mono); font-size: 14px; font-weight: 700; }
.response-status.status-success { color: #1d7a4f; }
.response-status.status-warning { color: #b5791f; }
.response-status.status-danger { color: #c2433a; }
.response-status.status-info { color: var(--yl-text-secondary); }
.response-meta { font-family: var(--yl-font-mono); font-size: 12px; color: var(--yl-text-tertiary); }
.response-actions { margin-left: auto; }
.response-tabs { margin-top: 4px; }
.response-tabs :deep(.el-tabs__item) { height: 38px; line-height: 38px; font-size: 13px; }
.response-pre { margin: 0 0 4px; background: #fbfcfe; border: 1px solid var(--yl-border); padding: 14px 16px; border-radius: 8px; font-size: 12.5px; line-height: 1.7; max-height: 480px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--yl-font-mono); color: #263042; }

/* 历史 */
.history-empty { text-align: center; color: var(--yl-text-tertiary); padding: 24px; font-size: 13px; }
.history-toolbar { display: flex; justify-content: flex-end; margin-bottom: 4px; }
.history-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 10px; border: none; border-bottom: 1px solid var(--yl-border); border-radius: 6px; background: transparent; font-size: 12.5px; cursor: pointer; text-align: left; }
.history-item:hover { background: var(--yl-hover); }
.history-method { width: 48px; flex-shrink: 0; font-family: var(--yl-font-mono); font-size: 11px; font-weight: 700; }
.text-get { color: var(--yl-get); }
.text-post { color: var(--yl-post); }
.text-put { color: var(--yl-put); }
.text-delete { color: var(--yl-delete); }
.text-patch { color: var(--yl-patch); }
.history-path { flex: 1; color: var(--yl-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--yl-font-mono); font-size: 12px; }
.history-status { font-family: var(--yl-font-mono); font-size: 12px; font-weight: 600; }
.history-status.is-ok { color: #1d7a4f; }
.history-status.is-fail { color: #c2433a; }
.history-time { color: var(--yl-text-tertiary); font-size: 12px; flex-shrink: 0; }
</style>

<!-- JSON 语法高亮颜色（亮色背景，全局非 scoped） -->
<style>
.json-highlight .json-key { color: #9a3ea8; }
.json-highlight .json-string { color: #1d7a4f; }
.json-highlight .json-number { color: #b5791f; }
.json-highlight .json-boolean { color: #2b6cb0; }
.json-highlight .json-null { color: #8a94a6; }
</style>
