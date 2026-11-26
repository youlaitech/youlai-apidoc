<script setup lang="ts">
/**
 * 在线运行抽屉
 *
 * 文档主视图保持只读；点击「调试」从右侧展开本抽屉，采用「请求 / 响应」上下分栏：
 * - 上半区：Params / Body / Headers / Auth / Cookie 页签，鉴权与参数可编辑；
 * - 下半区：响应体 / 响应头 / 实际请求，响应区占满剩余高度，不再嵌套滚动条；
 * - 分隔条可拖拽调整比例，双击复位；「实际请求」展示本次真实发送的 URL、请求头与 body。
 * 请求头优先级：Content-Type → 全局请求头 → 接口 Header → 授权头。
 */
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import type { OpenAPIDocument, Operation, Schema } from "../types/openapi";
import { getSchemaType, getSchemaExample, getMediaTypeExample, generateExampleJson } from "../api/openapi";
import { highlightJson } from "../utils/json-highlight";
import { copyWithFeedback as copyText } from "../utils/copy";
import { getSchemaCommentMap } from "../utils/schema-comments";
import { trapTabKey } from "../utils/focus-trap";
import SchemaJsonEditor from "./SchemaJsonEditor.vue";
import RequestCodePanel from "./RequestCodePanel.vue";
import { authValues, setAuthValue } from "../stores/auth";
import { customHeaders, headerRecord } from "../stores/headers";
import { saveDebugHistory } from "../stores/debug-history";
import {
  securityNamesOf,
  isSecretScheme,
  buildAuthHeaders,
  buildAuthQuery,
  statusTextOf,
  statusTypeOf,
  formatBytes,
} from "../utils/request";

const props = defineProps<{
  open: boolean;
  method: string;
  path: string;
  operation: Operation;
  doc: OpenAPIDocument;
  baseUrl: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-settings", tab?: "auth" | "headers" | "base"): void;
}>();

/* ===================== 参数行 ===================== */

interface Row {
  key: string;
  value: string;
  enabled: boolean;
  required: boolean;
}

interface ParamInfo {
  name: string;
  in: string;
  required: boolean;
  description: string;
  type: string;
  example: unknown;
}

const params = computed<ParamInfo[]>(() =>
  (props.operation.parameters || []).map((p) => ({
    name: p.name,
    in: p.in,
    required: p.in === "path" || !!p.required,
    description: p.description || "",
    type: p.schema ? getSchemaType(p.schema, props.doc) : "string",
    example: p.example ?? getSchemaExample(p.schema) ?? "",
  }))
);

function initialValue(p: ParamInfo): string {
  const ex = p.example;
  if (ex === undefined || ex === null) return "";
  return typeof ex === "object" ? JSON.stringify(ex) : String(ex);
}
function toRow(p: ParamInfo): Row {
  return { key: p.name, value: initialValue(p), enabled: true, required: p.required };
}

const pathRows = ref<Row[]>([]);
const queryRows = ref<Row[]>([]);
const headerRows = ref<Row[]>([]);
const cookieRows = ref<Row[]>([]);

const requestBody = computed(() => {
  const rb = props.operation.requestBody;
  const json = rb?.content?.["application/json"];
  if (!json?.schema) return null;
  return {
    required: rb?.required || false,
    schema: json.schema as Schema,
    example: getMediaTypeExample(json),
  };
});
const hasBody = computed(() => !!requestBody.value && ["post", "put", "patch"].includes(props.method));
const schemaComments = computed(() =>
  requestBody.value ? getSchemaCommentMap(requestBody.value.schema, props.doc) : {}
);

const requestBodyText = ref("");
const showBodyComments = ref(true);
const editorComments = computed(() => (showBodyComments.value ? schemaComments.value : {}));
function resetBody() {
  const example = requestBody.value?.example;
  requestBodyText.value = example !== undefined
    ? JSON.stringify(example, null, 2)
    : generateExampleJson(requestBody.value?.schema, props.doc);
}

/** 本次真实发送的请求快照，供「实际请求」页签生成代码 */
interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function initRows() {
  pathRows.value = params.value.filter((p) => p.in === "path").map(toRow);
  queryRows.value = params.value.filter((p) => p.in === "query").map(toRow);
  headerRows.value = params.value.filter((p) => p.in === "header").map(toRow);
  cookieRows.value = params.value.filter((p) => p.in === "cookie").map(toRow);
  resetBody();
  responseStatus.value = null;
  responseHeaders.value = "";
  responseBody.value = "";
  responseTime.value = null;
  responseTab.value = "body";
  sentRequest.value = null;
  // 无参数有请求体的接口直接落到 Body 页签
  requestTab.value = hasBody.value && !params.value.length ? "body" : "params";
}

/* ===================== 鉴权 ===================== */

const securityNames = computed(() => securityNamesOf(props.operation, props.doc));
const securitySchemes = computed(() => props.doc.components?.securitySchemes || {});
const authDraft = reactive<Record<string, string>>({});

function initAuthDraft() {
  for (const name of securityNames.value) authDraft[name] = authValues.value[name] || "";
}
function isSecret(name: string): boolean {
  return isSecretScheme(securitySchemes.value[name]);
}
function authPlaceholder(name: string): string {
  const s = securitySchemes.value[name];
  if (s?.type === "oauth2" || s?.type === "openIdConnect") return "access_token，自动补 Bearer 前缀";
  if (s?.type === "http" || (s?.type === "apiKey" && s.scheme?.toLowerCase() === "bearer")) {
    return "访问令牌，不含 Bearer 前缀";
  }
  return "参数值";
}
function saveAuth(name: string) {
  setAuthValue(name, (authDraft[name] || "").trim());
}

const authHeaders = computed(() => buildAuthHeaders(securityNames.value, securitySchemes.value, authValues.value));
const authQuery = computed(() => buildAuthQuery(securityNames.value, securitySchemes.value, authValues.value));
const authorizedCount = computed(() => securityNames.value.filter((n) => authValues.value[n]).length);

/* ===================== 最终请求 ===================== */

const finalUrl = computed(() => {
  let url = props.path;
  for (const row of pathRows.value) {
    if (row.key) url = url.replace(`{${row.key}}`, encodeURIComponent(row.value));
  }
  const merged: Record<string, string> = {};
  for (const row of queryRows.value) {
    if (row.enabled && row.key.trim() && row.value !== "") merged[row.key.trim()] = row.value;
  }
  Object.assign(merged, authQuery.value);
  const qs = Object.entries(merged)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += `?${qs}`;
  return props.baseUrl + url;
});

const allHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {};
  if (hasBody.value) headers["Content-Type"] = "application/json";
  Object.assign(headers, headerRecord());
  for (const row of headerRows.value) {
    if (row.enabled && row.key.trim() && row.value) headers[row.key.trim()] = row.value;
  }
  Object.assign(headers, authHeaders.value);
  return headers;
});

const enabledGlobals = computed(() => customHeaders.value.filter((h) => h.enabled && h.key.trim()));

/* ===================== 发送与响应 ===================== */

const sending = ref(false);
const sendBtnRef = ref<HTMLButtonElement>();
const cancelBtnRef = ref<HTMLButtonElement>();
const responseStatus = ref<number | null>(null);
const responseHeaders = ref("");
const responseBody = ref("");
const responseTime = ref<number | null>(null);
const sentRequest = ref<SentRequest | null>(null);
const REQUEST_TIMEOUT_MS = 20_000;
const elapsedSeconds = ref(0);
let responseRequestId = 0;
let requestAbort: AbortController | null = null;
let requestTimer: number | undefined;
let elapsedTimer: number | undefined;
let requestTimedOut = false;

function stopElapsedTimer() {
  if (elapsedTimer !== undefined) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
}

function stopRequest() {
  requestAbort?.abort();
  requestAbort = null;
  if (requestTimer !== undefined) {
    window.clearTimeout(requestTimer);
    requestTimer = undefined;
  }
  stopElapsedTimer();
}

function clearResponse() {
  responseRequestId += 1;
  stopRequest();
  sending.value = false;
  responseStatus.value = null;
  responseHeaders.value = "";
  responseBody.value = "";
  responseTime.value = null;
  responseTab.value = "body";
  sentRequest.value = null;
}

function cancelRequest() {
  stopRequest();
}

async function sendRequest() {
  if (sending.value) return;
  clearResponse();
  const requestId = responseRequestId;
  sending.value = true;
  nextTick(() => cancelBtnRef.value?.focus());
  elapsedSeconds.value = 0;
  stopElapsedTimer();
  elapsedTimer = window.setInterval(() => {
    elapsedSeconds.value += 1;
  }, 1000);
  const controller = new AbortController();
  requestAbort = controller;
  requestTimedOut = false;
  requestTimer = window.setTimeout(() => {
    if (requestAbort === controller) {
      requestTimedOut = true;
      controller.abort();
    }
  }, REQUEST_TIMEOUT_MS);
  // 先记录实际请求，超时 / 网络失败时也能看到当时发出去的内容
  sentRequest.value = {
    method: props.method,
    url: finalUrl.value,
    headers: { ...allHeaders.value },
    body: hasBody.value ? requestBodyText.value : undefined,
  };
  const startTime = performance.now();
  try {
    const res = await axios.request({
      method: props.method,
      url: finalUrl.value,
      headers: allHeaders.value,
      data: hasBody.value ? requestBodyText.value : undefined,
      validateStatus: () => true,
      signal: controller.signal,
    });
    if (requestId !== responseRequestId) return;
    responseTime.value = Math.round(performance.now() - startTime);
    responseStatus.value = res.status;
    responseHeaders.value = JSON.stringify(res.headers, null, 2);
    responseBody.value = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
    responseTab.value = "body";
    // 首次拿到响应且用户未手动拖过分隔条：响应区自动多分一些高度
    if (!splitTouched.value) splitPct.value = SPLIT_AFTER_SEND;
    saveDebugHistory({
      method: props.method.toUpperCase(),
      path: props.path,
      status: res.status,
      time: new Date().toLocaleTimeString(),
    });
  } catch (e: any) {
    if (requestId !== responseRequestId) return;
    const canceled = axios.isCancel(e) || e?.code === "ERR_CANCELED";
    if (canceled) {
      if (requestTimedOut) {
        responseTime.value = Math.round(performance.now() - startTime);
        responseStatus.value = 0;
        responseHeaders.value = "";
        responseBody.value = `请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`;
        if (!splitTouched.value) splitPct.value = SPLIT_AFTER_SEND;
        saveDebugHistory({
          method: props.method.toUpperCase(),
          path: props.path,
          status: 0,
          time: new Date().toLocaleTimeString(),
        });
      } else {
        ElMessage.info("请求已取消");
      }
      return;
    }
    responseTime.value = Math.round(performance.now() - startTime);
    responseStatus.value = 0;
    responseBody.value = e.message || "请求失败";
    if (!splitTouched.value) splitPct.value = SPLIT_AFTER_SEND;
    saveDebugHistory({
      method: props.method.toUpperCase(),
      path: props.path,
      status: 0,
      time: new Date().toLocaleTimeString(),
    });
  } finally {
    if (requestAbort === controller) requestAbort = null;
    if (requestTimer !== undefined) {
      window.clearTimeout(requestTimer);
      requestTimer = undefined;
    }
    stopElapsedTimer();
    if (requestId === responseRequestId) {
      const active = document.activeElement;
      const restoreSendFocus =
        !active || active === document.body || active === cancelBtnRef.value || active === sendBtnRef.value;
      sending.value = false;
      if (restoreSendFocus) nextTick(() => sendBtnRef.value?.focus());
    }
  }
}

const statusText = computed(() => statusTextOf(responseStatus.value));
const statusType = computed(() => statusTypeOf(responseStatus.value));
const highlightedBody = computed(() => highlightJson(responseBody.value));
const responseSize = computed(() => formatBytes(responseBody.value));

function formatRequestBody() {
  try {
    requestBodyText.value = JSON.stringify(JSON.parse(requestBodyText.value), null, 2);
  } catch {
    ElMessage.error("JSON 格式有误，无法格式化");
  }
}

/* ===================== 页签 ===================== */

type RequestTab = "params" | "body" | "headers" | "auth" | "cookie";
const requestTab = ref<RequestTab>("params");

interface TabItem {
  key: RequestTab;
  label: string;
  badge?: string | number;
  /** 凭据配置状态点：on 已配置 / off 未配置 */
  dot?: "on" | "off";
}

const requestTabs = computed<TabItem[]>(() => {
  const tabs: TabItem[] = [];
  const paramCount = pathRows.value.length + queryRows.value.length;
  tabs.push({ key: "params", label: "Params", badge: paramCount || undefined });
  if (hasBody.value) {
    tabs.push({ key: "body", label: "Body" });
  }
  const headerCount = enabledGlobals.value.length + headerRows.value.length + Object.keys(authHeaders.value).length;
  tabs.push({ key: "headers", label: "Headers", badge: headerCount || undefined });
  if (securityNames.value.length) {
    tabs.push({ key: "auth", label: "Auth", dot: authorizedCount.value ? "on" : "off" });
  }
  if (cookieRows.value.length) tabs.push({ key: "cookie", label: "Cookie", badge: cookieRows.value.length });
  return tabs;
});

// 切换接口后当前页签可能已不存在（如 Body），回退到 Params
watch(requestTabs, (tabs) => {
  if (!tabs.some((t) => t.key === requestTab.value)) requestTab.value = "params";
});

type ResponseTab = "body" | "headers" | "request";
const responseTab = ref<ResponseTab>("body");
const responseTabs: Array<{ key: ResponseTab; label: string }> = [
  { key: "body", label: "响应体" },
  { key: "headers", label: "响应头" },
  { key: "request", label: "实际请求" },
];

/** 响应区右上角复制对象：实际请求页签由代码面板自带复制 */
const copyTarget = computed(() => {
  if (responseTab.value === "body") return responseBody.value;
  if (responseTab.value === "headers") return responseHeaders.value;
  return "";
});
const copyTip = computed(() => (responseTab.value === "body" ? "响应体已复制" : "响应头已复制"));

/* ===================== 上下分栏 ===================== */

const SPLIT_KEY = "apishow-debug-split";
const SPLIT_DEFAULT = 50;
const SPLIT_AFTER_SEND = 42;
const SPLIT_MIN = 20;
const SPLIT_MAX = 75;

function clampPct(value: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

function loadSplit(): number {
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    if (saved > 0) return clampPct(saved);
  } catch {
    // ignore
  }
  return SPLIT_DEFAULT;
}

/** 请求区高度占比（%）；响应区占剩余高度 */
const splitPct = ref(loadSplit());
const splitTouched = ref(false);
const dragging = ref(false);
const mainRef = ref<HTMLElement>();

function persistSplit() {
  try {
    localStorage.setItem(SPLIT_KEY, String(splitPct.value));
  } catch {
    // ignore
  }
}

function startDrag(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  splitTouched.value = true;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onDrag(e: PointerEvent) {
  if (!dragging.value || !mainRef.value) return;
  const rect = mainRef.value.getBoundingClientRect();
  splitPct.value = clampPct(((e.clientY - rect.top) / rect.height) * 100);
}

function endDrag() {
  if (!dragging.value) return;
  dragging.value = false;
  persistSplit();
}

/** 双击分隔条：恢复默认比例 */
function resetSplit() {
  splitPct.value = SPLIT_DEFAULT;
  splitTouched.value = false;
  persistSplit();
}

function nudgeSplit(delta: number) {
  splitTouched.value = true;
  splitPct.value = clampPct(splitPct.value + delta);
  persistSplit();
}

/* ===================== 生命周期 ===================== */

const drawerRef = ref<HTMLElement>();
let returnFocus: HTMLElement | null = null;

function focusDrawer() {
  nextTick(() => drawerRef.value?.focus());
}

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  // 抽屉内任意位置 Ctrl/Cmd + Enter 发送；编辑器内已处理时此处会被 sending 守卫拦下
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    sendRequest();
    return;
  }
  if (e.key === "Tab") trapTabKey(e, drawerRef.value);
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  initRows();
  initAuthDraft();
  if (props.open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusDrawer();
  }
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  stopRequest();
});

watch(() => [props.path, props.method], () => {
  clearResponse();
  initRows();
  initAuthDraft();
});
watch(
  () => props.open,
  (open) => {
    if (!open) {
      returnFocus?.focus();
      returnFocus = null;
      return;
    }
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearResponse();
    initAuthDraft();
    focusDrawer();
  }
);
// 全局设置里获取到令牌后，抽屉已打开时同步填充输入框
watch(
  () => authValues.value,
  () => {
    for (const name of securityNames.value) {
      const next = authValues.value[name] || "";
      if (authDraft[name] !== next) authDraft[name] = next;
    }
  },
  { deep: true }
);
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="dd-scrim" @click="emit('close')"></div>
    <aside
      ref="drawerRef"
      class="debug-drawer"
      :class="{ 'is-open': open, 'is-dragging': dragging }"
      :aria-hidden="!open"
      role="dialog"
      aria-modal="true"
      aria-label="在线运行"
      tabindex="-1"
    >
      <!-- 头部 -->
      <div class="dd-head">
        <div class="dd-title">
          <el-icon><VideoPlay /></el-icon>在线运行
        </div>
        <span class="dd-head-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 发送</span>
        <button class="ad-icon-btn" title="关闭 (Esc)" aria-label="关闭在线运行" @click="emit('close')">
          <el-icon><Close /></el-icon>
        </button>
      </div>

      <!-- 请求行：实时反映 Path / Query 填写后的最终地址 -->
      <div class="dd-req">
        <span class="ad-method" :class="'ad-method--' + method.toLowerCase()">{{ method.toUpperCase() }}</span>
        <span class="dd-path" :title="finalUrl">{{ finalUrl }}</span>
        <el-tooltip content="复制请求地址" placement="top">
          <button class="ad-icon-btn" aria-label="复制请求地址" @click="copyText(finalUrl, '请求地址已复制')">
            <el-icon><Link /></el-icon>
          </button>
        </el-tooltip>
        <span v-if="sending" class="send-timer" aria-hidden="true">{{ elapsedSeconds }}s</span>
        <button
          v-if="sending"
          ref="cancelBtnRef"
          type="button"
          class="cancel-btn"
          aria-label="取消请求"
          @click="cancelRequest"
        >
          <el-icon><Close /></el-icon>取消
        </button>
        <button ref="sendBtnRef" type="button" class="send-btn" :disabled="sending" @click="sendRequest">
          <el-icon class="send-ico" :class="{ spin: sending }">
            <Loading v-if="sending" />
            <Promotion v-else />
          </el-icon>
          {{ sending ? "发送中" : "发送" }}
        </button>
      </div>

      <div ref="mainRef" class="dd-main">
        <!-- ===== 上半区：请求配置 ===== -->
        <section class="dd-pane dd-pane--req" :style="{ flexBasis: splitPct + '%' }">
          <div class="dd-tabs" role="tablist" aria-label="请求配置">
            <button
              v-for="tab in requestTabs"
              :key="tab.key"
              type="button"
              role="tab"
              class="ad-tab"
              :class="{ active: requestTab === tab.key }"
              :aria-selected="requestTab === tab.key"
              @click="requestTab = tab.key"
            >
              {{ tab.label }}
              <span
                v-if="tab.badge !== undefined"
                class="ad-tab-badge"
                :class="{ 'is-warn': tab.key === 'body' }"
              >{{ tab.badge }}</span>
              <span
                v-else-if="tab.dot"
                class="ad-tab-dot"
                :class="'is-' + tab.dot"
                :title="tab.dot === 'on' ? '凭据已配置' : '凭据未配置'"
              ></span>
            </button>
          </div>

          <div class="dd-pane-body" :class="{ 'is-editor': requestTab === 'body' }">
            <!-- Params：Path + Query -->
            <template v-if="requestTab === 'params'">
              <div v-if="pathRows.length" class="dd-group">
                <div class="dd-group-title">
                  Path 参数
                  <span class="dd-group-tip">路径参数必填，自动替换到地址中</span>
                </div>
                <div v-for="(row, i) in pathRows" :key="i" class="dd-row is-fixed">
                  <code class="dd-fixed-key">{{ row.key }}<span class="dd-required" title="必填" aria-label="必填">*</span></code>
                  <el-input v-model="row.value" class="dd-val" placeholder="路径参数值" />
                </div>
              </div>

              <div class="dd-group">
                <div class="dd-group-title">Query 参数</div>
                <div v-for="(row, i) in queryRows" :key="i" class="dd-row">
                  <el-checkbox v-model="row.enabled" class="dd-check" :disabled="row.required" />
                  <span class="dd-required" :aria-label="row.required ? '必填' : undefined">{{ row.required ? "*" : "" }}</span>
                  <el-input v-model="row.key" class="dd-key" placeholder="参数名" />
                  <el-input v-model="row.value" class="dd-val" placeholder="参数值" />
                  <button
                    type="button"
                    class="ad-icon-btn dd-del"
                    :disabled="row.required"
                    :title="row.required ? '必填参数不可移除' : '移除'"
                    @click="queryRows.splice(i, 1)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </div>
                <div v-if="!queryRows.length" class="dd-empty">暂无 Query 参数</div>
                <button
                  type="button"
                  class="dd-add"
                  @click="queryRows.push({ key: '', value: '', enabled: true, required: false })"
                >
                  <el-icon><Plus /></el-icon>添加参数
                </button>
              </div>
            </template>

            <!-- Body -->
            <template v-else-if="requestTab === 'body'">
              <div class="editor-toolbar">
                <span class="ct-badge">application/json</span>
                <button type="button" class="tool-btn" @click="formatRequestBody"><el-icon><MagicStick /></el-icon>格式化</button>
                <button type="button" class="tool-btn" @click="resetBody"><el-icon><RefreshLeft /></el-icon>重置示例</button>
                <button
                  type="button"
                  class="tool-btn"
                  :class="{ active: showBodyComments }"
                  :aria-pressed="showBodyComments"
                  @click="showBodyComments = !showBodyComments"
                >
                  <el-icon><Document /></el-icon>字段说明
                </button>
              </div>
              <SchemaJsonEditor
                v-model="requestBodyText"
                :comments="editorComments"
                @submit="sendRequest"
              />
            </template>

            <!-- Headers：全局 + 接口 + 授权 -->
            <template v-else-if="requestTab === 'headers'">
              <div v-if="enabledGlobals.length" class="dd-global">
                <span class="dd-global-label">全局生效</span>
                <button
                  v-for="(h, i) in enabledGlobals"
                  :key="i"
                  type="button"
                  class="gh-chip"
                  :title="`${h.key}: ${h.value}`"
                  @click="emit('open-settings', 'headers')"
                >
                  <span class="gh-key">{{ h.key }}</span>
                  <span class="gh-val">{{ h.value || "—" }}</span>
                </button>
                <button type="button" class="link-btn" @click="emit('open-settings', 'headers')">管理</button>
              </div>
              <div v-for="(row, i) in headerRows" :key="i" class="dd-row">
                <el-checkbox v-model="row.enabled" class="dd-check" :disabled="row.required" />
                <span class="dd-required" :aria-label="row.required ? '必填' : undefined">{{ row.required ? "*" : "" }}</span>
                <el-input v-model="row.key" class="dd-key" placeholder="Header 名" />
                <el-input v-model="row.value" class="dd-val" placeholder="Header 值" />
                <button
                  type="button"
                  class="ad-icon-btn dd-del"
                  :disabled="row.required"
                  :title="row.required ? '必填参数不可移除' : '移除'"
                  @click="headerRows.splice(i, 1)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </div>
              <button
                type="button"
                class="dd-add"
                @click="headerRows.push({ key: '', value: '', enabled: true, required: false })"
              >
                <el-icon><Plus /></el-icon>添加 Header
              </button>
              <p v-if="Object.keys(authHeaders).length" class="dd-tip">
                授权头 {{ Object.keys(authHeaders).join("、") }} 将在发送时自动附加，可在「Auth」页签配置。
              </p>
            </template>

            <!-- Auth -->
            <template v-else-if="requestTab === 'auth'">
              <div v-for="name in securityNames" :key="name" class="dd-auth-row">
                <span class="dd-auth-name" :title="name">{{ name }}</span>
                <el-input
                  v-model="authDraft[name]"
                  :type="isSecret(name) ? 'password' : 'text'"
                  :show-password="isSecret(name)"
                  :placeholder="authPlaceholder(name)"
                  @change="saveAuth(name)"
                />
              </div>
              <p class="dd-tip">
                凭据全局共享，与「全局设置 → 授权」同步保存。
                <button type="button" class="link-btn" @click="emit('open-settings', 'auth')">一键获取令牌</button>
              </p>
            </template>

            <!-- Cookie -->
            <template v-else-if="requestTab === 'cookie'">
              <div v-for="(row, i) in cookieRows" :key="i" class="dd-row is-fixed">
                <code class="dd-fixed-key">
                  {{ row.key }}<span v-if="row.required" class="dd-required" title="必填" aria-label="必填">*</span>
                </code>
                <span class="dd-cookie-val">{{ row.value || "—" }}</span>
              </div>
              <p class="dd-tip">浏览器禁止脚本设置 Cookie 请求头，此处仅展示。</p>
            </template>
          </div>
        </section>

        <!-- 分隔条 -->
        <div
          class="dd-divider"
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整请求与响应区域比例，双击恢复默认"
          aria-valuenow="Math.round(splitPct)"
          tabindex="0"
          title="拖拽调整比例 · 双击恢复默认"
          @pointerdown="startDrag"
          @pointermove="onDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @dblclick="resetSplit"
          @keydown.up.prevent="nudgeSplit(-3)"
          @keydown.down.prevent="nudgeSplit(3)"
        ></div>

        <!-- ===== 下半区：响应 ===== -->
        <section class="dd-pane dd-pane--resp">
          <div class="dd-resp-head">
            <template v-if="responseStatus !== null">
              <span class="live-status" :class="'status-' + statusType">{{ statusText }}</span>
              <span v-if="responseTime !== null" class="live-meta">{{ responseTime }} ms</span>
              <span v-if="responseSize" class="live-meta">{{ responseSize }}</span>
            </template>
            <div class="dd-tabs dd-resp-tabs" role="tablist" aria-label="响应内容">
              <button
                v-for="tab in responseTabs"
                :key="tab.key"
                type="button"
                role="tab"
                class="ad-tab"
                :class="{ active: responseTab === tab.key }"
                :aria-selected="responseTab === tab.key"
                @click="responseTab = tab.key"
              >
                {{ tab.label }}
              </button>
            </div>

            <button
              v-if="copyTarget"
              type="button"
              class="tool-btn dd-copy"
              @click="copyText(copyTarget, copyTip)"
            >
              <el-icon><CopyDocument /></el-icon>复制
            </button>
          </div>

          <div class="dd-resp-body">
            <template v-if="responseTab === 'request'">
              <RequestCodePanel
                v-if="sentRequest"
                is-fill
                copy-tip="实际请求代码已复制"
                :method="sentRequest.method"
                :url="sentRequest.url"
                :headers="sentRequest.headers"
                :body="sentRequest.body"
              />
              <div v-else class="dd-resp-empty">
                <el-icon><Postcard /></el-icon>
                <span>发送请求后，在此查看实际发出的地址、请求头与 Body</span>
              </div>
            </template>
            <div v-else class="dd-resp-scroll">
              <div v-if="sending && responseStatus === null" class="dd-resp-empty">
                <el-icon class="is-spin"><Loading /></el-icon>
                <span>请求发送中… {{ elapsedSeconds }}s</span>
              </div>
              <template v-else-if="responseTab === 'body'">
                <pre v-if="responseBody" class="resp-pre json-highlight" v-html="highlightedBody"></pre>
                <div v-else-if="responseStatus !== null" class="dd-resp-empty"><span>（空响应体）</span></div>
                <div v-else class="dd-resp-empty">
                  <el-icon><Document /></el-icon>
                  <span>点击「发送」查看响应与实际请求</span>
                </div>
              </template>
              <template v-else>
                <pre v-if="responseHeaders" class="resp-pre">{{ responseHeaders }}</pre>
                <div v-else-if="responseStatus !== null" class="dd-resp-empty"><span>（无响应头）</span></div>
                <div v-else class="dd-resp-empty">
                  <el-icon><Document /></el-icon>
                  <span>点击「发送」查看响应与实际请求</span>
                </div>
              </template>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </teleport>
</template>

<style scoped>
/* ===== 抽屉容器 ===== */
.debug-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(820px, 100vw); display: flex; flex-direction: column; background: var(--ad-bg); border-left: 1px solid var(--ad-border-soft); box-shadow: var(--ad-shadow-pop); z-index: 70; transform: translateX(103%); visibility: hidden; transition: transform 0.28s cubic-bezier(0.32, 0.72, 0.28, 1), visibility 0.28s; }
.debug-drawer.is-open { transform: translateX(0); visibility: visible; }
.debug-drawer:focus { outline: none; }
/* 拖拽分隔条期间：禁止选中文本，光标全局保持 */
.debug-drawer.is-dragging, .debug-drawer.is-dragging * { user-select: none !important; cursor: row-resize !important; }
.dd-scrim { display: block; position: fixed; inset: 0; z-index: 65; background: transparent; }

.dd-head { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-bottom: 1px solid var(--ad-border-soft); flex-shrink: 0; }
.dd-title { display: flex; align-items: center; gap: 7px; font-size: var(--ad-fs-card-title); font-weight: 600; color: var(--ad-text); }
.dd-title .el-icon { color: var(--ad-primary); font-size: 16px; }
.dd-head-hint { margin-left: auto; font-size: 11px; color: var(--ad-text-tertiary); }
.dd-head-hint kbd { padding: 1px 5px; font-family: var(--ad-font-mono); font-size: 10px; color: var(--ad-text-secondary); background: var(--ad-bg-subtle); border: 1px solid var(--ad-border); border-radius: var(--ad-radius-sm); }

/* 请求行 */
.dd-req { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--ad-border-soft); background: var(--ad-bg-subtle); flex-shrink: 0; }
.dd-path { flex: 1; min-width: 0; font-family: var(--ad-font-mono); font-size: var(--ad-fs-secondary); color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.send-timer { flex-shrink: 0; min-width: 28px; font-family: var(--ad-font-mono); font-size: 11px; font-variant-numeric: tabular-nums; color: var(--ad-text-tertiary); text-align: right; }
/* 发送 = 品牌时刻：渐变 + 品牌投影 + hover 上浮 1px */
.send-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 18px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-on-primary); background: var(--ad-primary-grad); border: none; border-radius: var(--ad-radius); cursor: pointer; box-shadow: var(--ad-brand-shadow); transition: box-shadow var(--ad-duration), transform var(--ad-duration); }
.send-btn:hover { box-shadow: var(--ad-brand-shadow-hover); transform: translateY(-1px); }
.send-btn:active { transform: translateY(0); }
.send-btn:disabled { cursor: default; opacity: 0.85; box-shadow: none; transform: none; }
.cancel-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-danger-text, var(--ad-delete)); background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius); cursor: pointer; transition: background var(--ad-duration), border-color var(--ad-duration); }
.cancel-btn:hover { background: var(--ad-danger-bg); border-color: color-mix(in srgb, var(--ad-danger) 35%, transparent); }
.send-ico { font-size: 14px; }
.send-ico.spin { animation: dd-spin 0.8s linear infinite; }
@keyframes dd-spin { to { transform: rotate(360deg); } }
.is-spin { animation: dd-spin 0.8s linear infinite; }

/* ===== 上下分栏 ===== */
.dd-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dd-pane { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.dd-pane--req { flex-grow: 0; flex-shrink: 0; }
.dd-pane--resp { flex: 1 1 0; background: var(--ad-bg-code); }
.dd-tabs { display: flex; align-items: stretch; gap: 2px; flex-shrink: 0; padding: 0 12px; border-bottom: 1px solid var(--ad-border-soft); background: var(--ad-bg); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.dd-tabs::-webkit-scrollbar { display: none; }
.dd-pane-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 20px 16px; background: var(--ad-bg); }
/* Body 页签：编辑器吃满剩余高度，滚动只发生在编辑器内部 */
.dd-pane-body.is-editor { display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.dd-pane-body.is-editor .editor-toolbar { flex-shrink: 0; }

/* 分隔条 */
.dd-divider { position: relative; flex-shrink: 0; height: 7px; background: var(--ad-bg-main); border-top: 1px solid var(--ad-border-soft); border-bottom: 1px solid var(--ad-border-soft); cursor: row-resize; touch-action: none; }
.dd-divider::after { content: ""; position: absolute; left: 50%; top: 50%; width: 40px; height: 3px; transform: translate(-50%, -50%); border-radius: var(--ad-radius-pill); background: var(--ad-border-strong); transition: background var(--ad-duration), width var(--ad-duration); }
.dd-divider:hover::after, .dd-divider:focus-visible::after, .is-dragging .dd-divider::after { width: 64px; background: var(--ad-primary); }

/* ===== 请求区分组 ===== */
.dd-group { padding: 2px 0 12px; }
.dd-group + .dd-group { padding-top: 12px; border-top: 1px dashed var(--ad-border-soft); }
.dd-group-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); }
.dd-group-tip { font-size: 11px; font-weight: 400; color: var(--ad-text-tertiary); }
.dd-tip { margin: 10px 0 0; font-size: var(--ad-fs-aux); line-height: 1.6; color: var(--ad-text-tertiary); }
.dd-empty { display: flex; align-items: center; justify-content: center; height: 76px; margin-top: 8px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); border: 1px dashed var(--ad-border); border-radius: var(--ad-radius); }
.ct-badge { flex-shrink: 0; font-size: var(--ad-fs-aux); font-family: var(--ad-font-mono); font-weight: 500; color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-sm); padding: 2px 8px; }

/* 鉴权 */
.dd-auth-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.dd-auth-row:last-of-type { margin-bottom: 0; }
.dd-auth-name { width: 120px; flex-shrink: 0; font-size: var(--ad-fs-aux); font-weight: 600; font-family: var(--ad-font-mono); color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 参数行 */
.dd-row { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.dd-row:last-of-type { margin-bottom: 0; }
.dd-check { flex-shrink: 0; height: auto; }
.dd-required { flex-shrink: 0; width: 7px; color: var(--ad-danger-text, var(--ad-danger)); font-weight: 700; }
.dd-fixed-key .dd-required { margin-left: 3px; }
.dd-key { width: 180px; flex-shrink: 0; }
.dd-val { flex: 1; min-width: 0; }
.dd-del { flex-shrink: 0; width: 26px; height: 26px; color: var(--ad-text-tertiary); }
.dd-del:hover { color: var(--ad-danger-text); background: var(--ad-danger-bg); }
.dd-row.is-fixed { gap: 10px; }
.dd-fixed-key { width: 180px; flex-shrink: 0; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-put); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-cookie-val { flex: 1; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.dd-add { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; padding: 4px 8px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-tertiary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration); }
.dd-add:hover { color: var(--ad-primary); background: var(--ad-primary-soft); }

/* 全局请求头 chips */
.dd-global { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; padding: 8px 10px; background: var(--ad-primary-soft); border: 1px dashed color-mix(in srgb, var(--ad-primary) 30%, transparent); border-radius: var(--ad-radius); }
.dd-global-label { font-size: 11px; font-weight: 600; color: var(--ad-primary); }
.gh-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; padding: 2px 10px; background: var(--ad-bg); border: 1px solid color-mix(in srgb, var(--ad-primary) 22%, transparent); border-radius: var(--ad-radius-pill); cursor: pointer; transition: background var(--ad-duration); }
.gh-chip:hover { background: var(--ad-hover); }
.gh-key { font-family: var(--ad-font-mono); font-size: 11px; font-weight: 600; color: var(--ad-primary); }
.gh-val { font-family: var(--ad-font-mono); font-size: 11px; color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: var(--ad-primary); background: transparent; border: none; cursor: pointer; padding: 2px 6px; border-radius: var(--ad-radius-sm); vertical-align: middle; }
.link-btn:hover { background: var(--ad-primary-soft-2); }

/* 编辑器工具条 */
.editor-toolbar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.tool-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration); }
.tool-btn:hover { color: var(--ad-primary); background: var(--ad-hover); }
.tool-btn.active { color: var(--ad-primary); background: var(--ad-primary-soft); }

/* ===== 响应区 ===== */
.dd-resp-head { display: flex; align-items: center; gap: 10px; flex-shrink: 0; height: 41px; padding: 0 12px 0 20px; background: var(--ad-bg); border-bottom: 1px solid var(--ad-border-soft); }

.dd-resp-tabs { flex: 1; min-width: 0; padding: 0; border-bottom: none; background: transparent; }
.dd-copy { flex-shrink: 0; }
.live-status { flex-shrink: 0; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); font-weight: 600; font-variant-numeric: tabular-nums; padding: 2px 10px; border-radius: var(--ad-radius-pill); }
.live-status.status-success { color: var(--ad-success-text); background: var(--ad-success-bg); }
.live-status.status-warning { color: var(--ad-warning-text); background: var(--ad-warning-bg); }
.live-status.status-danger { color: var(--ad-danger-text); background: var(--ad-danger-bg); }
.live-status.status-info { color: var(--ad-info-text); background: var(--ad-info-bg); }
.live-meta { flex-shrink: 0; font-family: var(--ad-font-mono); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--ad-text-tertiary); }

.dd-resp-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dd-resp-scroll { flex: 1; min-height: 0; overflow: auto; }
/* 响应体：占满响应区高度，由外层统一滚动，不再嵌套限高 */
.resp-pre { margin: 0; padding: 12px 20px 16px; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text); white-space: pre-wrap; word-break: break-word; }
.dd-resp-empty { flex: 1; min-height: 72px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }

/* ===== 移动端：全屏 + 遮罩 ===== */
@media (max-width: 900px) {
  .debug-drawer { width: 100vw; border-left: none; }
  .dd-scrim { display: block; position: fixed; inset: 0; z-index: 65; background: var(--ad-scrim); }
  .dd-head { padding: 12px 16px; }
  .dd-head-hint { display: none; }
  .dd-req { padding: 10px 16px; }
  .dd-pane-body { padding: 12px 16px 16px; }
  .dd-key, .dd-fixed-key { width: 128px; }
  .dd-auth-name { width: 96px; }
}
</style>
