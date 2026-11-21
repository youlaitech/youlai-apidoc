<script setup lang="ts">
/**
 * 在线运行抽屉
 *
 * 文档主视图保持只读；点击「调试」从右侧展开本抽屉：
 * 鉴权 / Path / Query / Headers / Cookie / Body 可编辑，发送后在下方查看真实返回结果。
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
const showBodyComments = ref(false);
const editorComments = computed(() => (showBodyComments.value ? schemaComments.value : {}));
function resetBody() {
  requestBodyText.value = requestBody.value?.example
    ? JSON.stringify(requestBody.value.example, null, 2)
    : generateExampleJson(requestBody.value?.schema, props.doc);
}

function initRows() {
  pathRows.value = params.value.filter((p) => p.in === "path").map(toRow);
  queryRows.value = params.value.filter((p) => p.in === "query").map(toRow);
  headerRows.value = params.value.filter((p) => p.in === "header").map(toRow);
  cookieRows.value = params.value.filter((p) => p.in === "cookie").map(toRow);
  resetBody();
  responseStatus.value = null;
  responseBody.value = "";
  responseHeaders.value = "";
  responseTime.value = null;
  responseTab.value = "body";
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
const responseTab = ref<"body" | "headers">("body");
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
      :class="{ 'is-open': open }"
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
        <button class="ad-icon-btn" title="关闭 (Esc)" aria-label="关闭在线运行" @click="emit('close')">
          <el-icon><Close /></el-icon>
        </button>
      </div>

      <!-- 请求行 -->
      <div class="dd-req">
        <span class="ad-method" :class="'ad-method--' + method.toLowerCase()">{{ method.toUpperCase() }}</span>
        <span class="dd-path" :title="path">{{ path }}</span>
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
        <button ref="sendBtnRef" class="send-btn" :disabled="sending" @click="sendRequest">
          <el-icon class="send-ico" :class="{ spin: sending }">
            <Loading v-if="sending" />
            <Promotion v-else />
          </el-icon>
          {{ sending ? "发送中" : "发送" }}
        </button>
      </div>

      <div class="dd-body">
        <!-- 鉴权 -->
        <section v-if="securityNames.length" class="dd-sec">
          <div class="dd-sec-title">鉴权</div>
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
            <button class="link-btn" @click="emit('open-settings', 'auth')">一键获取令牌</button>
          </p>
        </section>

        <!-- Path 参数 -->
        <section v-if="pathRows.length" class="dd-sec">
          <div class="dd-sec-title">Path 参数</div>
          <div v-for="(row, i) in pathRows" :key="i" class="dd-row is-fixed">
            <code class="dd-fixed-key">{{ row.key }}<span class="dd-required" title="必填" aria-label="必填">*</span></code>
            <el-input v-model="row.value" class="dd-val" placeholder="路径参数值" />
          </div>
        </section>

        <!-- Query 参数 -->
        <section class="dd-sec" :class="{ 'is-empty': !queryRows.length }">
          <div class="dd-sec-title">Query 参数</div>
          <div v-for="(row, i) in queryRows" :key="i" class="dd-row">
            <el-checkbox v-model="row.enabled" class="dd-check" :disabled="row.required" />
            <span class="dd-required" :aria-label="row.required ? '必填' : undefined">{{ row.required ? "*" : "" }}</span>
            <el-input v-model="row.key" class="dd-key" placeholder="参数名" />
            <el-input v-model="row.value" class="dd-val" placeholder="参数值" />
            <button
              class="ad-icon-btn dd-del"
              :disabled="row.required"
              :title="row.required ? '必填参数不可移除' : '移除'"
              @click="queryRows.splice(i, 1)"
            >
              <el-icon><Delete /></el-icon>
            </button>
          </div>
          <button class="dd-add" @click="queryRows.push({ key: '', value: '', enabled: true, required: false })">
            <el-icon><Plus /></el-icon>添加参数
          </button>
        </section>

        <!-- Headers -->
        <section
          class="dd-sec"
          :class="{ 'is-empty': !headerRows.length && !enabledGlobals.length && !Object.keys(authHeaders).length }"
        >
          <div class="dd-sec-title">Headers</div>
          <div v-if="enabledGlobals.length" class="dd-global">
            <span class="dd-global-label">全局生效</span>
            <button
              v-for="(h, i) in enabledGlobals"
              :key="i"
              class="gh-chip"
              :title="`${h.key}: ${h.value}`"
              @click="emit('open-settings', 'headers')"
            >
              <span class="gh-key">{{ h.key }}</span>
              <span class="gh-val">{{ h.value || "—" }}</span>
            </button>
            <button class="link-btn" @click="emit('open-settings', 'headers')">管理</button>
          </div>
          <div v-for="(row, i) in headerRows" :key="i" class="dd-row">
            <el-checkbox v-model="row.enabled" class="dd-check" :disabled="row.required" />
            <span class="dd-required" :aria-label="row.required ? '必填' : undefined">{{ row.required ? "*" : "" }}</span>
            <el-input v-model="row.key" class="dd-key" placeholder="Header 名" />
            <el-input v-model="row.value" class="dd-val" placeholder="Header 值" />
            <button
              class="ad-icon-btn dd-del"
              :disabled="row.required"
              :title="row.required ? '必填参数不可移除' : '移除'"
              @click="headerRows.splice(i, 1)"
            >
              <el-icon><Delete /></el-icon>
            </button>
          </div>
          <button class="dd-add" @click="headerRows.push({ key: '', value: '', enabled: true, required: false })">
            <el-icon><Plus /></el-icon>添加参数
          </button>
          <p v-if="Object.keys(authHeaders).length" class="dd-tip">
            授权头 {{ Object.keys(authHeaders).join("、") }} 将在发送时自动附加。
          </p>
        </section>

        <!-- Cookie -->
        <section v-if="cookieRows.length" class="dd-sec">
          <div class="dd-sec-title">Cookie</div>
          <div v-for="(row, i) in cookieRows" :key="i" class="dd-row is-fixed">
            <code class="dd-fixed-key">
              {{ row.key }}<span v-if="row.required" class="dd-required" title="必填" aria-label="必填">*</span>
            </code>
            <span class="dd-cookie-val">{{ row.value || "—" }}</span>
          </div>
          <p class="dd-tip">浏览器禁止脚本设置 Cookie 请求头，此处仅展示。</p>
        </section>

        <!-- Body -->
        <section v-if="hasBody" class="dd-sec">
          <div class="dd-sec-title">
            Body
            <span class="ct-badge">application/json</span>
            <span v-if="requestBody?.required" class="req-tag is-required">必填</span>
          </div>
          <div class="editor-toolbar">
            <button class="tool-btn" @click="formatRequestBody"><el-icon><MagicStick /></el-icon>格式化</button>
            <button class="tool-btn" @click="resetBody"><el-icon><RefreshLeft /></el-icon>重置示例</button>
            <button
              class="tool-btn"
              :class="{ active: showBodyComments }"
              :aria-pressed="showBodyComments"
              @click="showBodyComments = !showBodyComments"
            >
              <el-icon><Document /></el-icon>字段说明
            </button>
            <span class="editor-hint">Ctrl + Enter 发送</span>
          </div>
          <SchemaJsonEditor
            v-model="requestBodyText"
            :comments="editorComments"
            @submit="sendRequest"
          />
        </section>

      </div>

      <!-- 返回结果：固定在抽屉底部，请求配置滚动时仍可见 -->
      <section class="dd-result">
        <div class="dd-result-head">
          <span class="dd-result-title">返回结果</span>
          <template v-if="responseStatus !== null">
            <span class="live-status" :class="'status-' + statusType">{{ statusText }}</span>
            <span v-if="responseTime !== null" class="live-meta">{{ responseTime }} ms</span>
            <span v-if="responseSize" class="live-meta">{{ responseSize }}</span>
            <button class="tool-btn dd-copy-resp" @click="copyText(responseBody, '响应体已复制')">
              <el-icon><CopyDocument /></el-icon>复制
            </button>
          </template>
        </div>
        <template v-if="responseStatus !== null">
          <div class="mini-tabs">
            <button :class="{ active: responseTab === 'body' }" @click="responseTab = 'body'">响应体</button>
            <button :class="{ active: responseTab === 'headers' }" @click="responseTab = 'headers'">响应头</button>
          </div>
          <div v-show="responseTab === 'body'">
            <pre class="resp-pre json-highlight" v-html="highlightedBody"></pre>
          </div>
          <div v-show="responseTab === 'headers'">
            <pre v-if="responseHeaders" class="resp-pre">{{ responseHeaders }}</pre>
            <div v-else class="mini-empty">该记录未保存响应头</div>
          </div>
        </template>
        <div v-else class="dd-result-empty">
          <el-icon><Document /></el-icon>
          <span>点击「发送」按钮获取返回结果</span>
        </div>
      </section>
    </aside>
  </teleport>
</template>

<style scoped>
/* ===== 抽屉容器 ===== */
.debug-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); display: flex; flex-direction: column; background: var(--ad-bg); border-left: 1px solid var(--ad-border-soft); box-shadow: var(--ad-shadow-pop); z-index: 70; transform: translateX(103%); visibility: hidden; transition: transform 0.28s cubic-bezier(0.32, 0.72, 0.28, 1), visibility 0.28s; }
.debug-drawer.is-open { transform: translateX(0); visibility: visible; }
.debug-drawer:focus { outline: none; }
.dd-scrim { display: block; position: fixed; inset: 0; z-index: 65; background: transparent; }

.dd-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid var(--ad-border-soft); flex-shrink: 0; }
.dd-title { display: flex; align-items: center; gap: 7px; font-size: var(--ad-fs-card-title); font-weight: 600; color: var(--ad-text); }
.dd-title .el-icon { color: var(--ad-primary); font-size: 16px; }

.dd-req { display: flex; align-items: center; gap: 8px; padding: 12px 24px; border-bottom: 1px solid var(--ad-border-soft); background: var(--ad-bg-subtle); flex-shrink: 0; }
.dd-path { flex: 1; min-width: 0; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.send-timer { flex-shrink: 0; min-width: 28px; font-family: var(--ad-font-mono); font-size: 11px; font-variant-numeric: tabular-nums; color: var(--ad-text-tertiary); text-align: right; }
/* 发送 = 品牌时刻：渐变 + 品牌投影 + hover 上浮 1px */
.send-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 16px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-on-primary); background: var(--ad-primary-grad); border: none; border-radius: var(--ad-radius); cursor: pointer; box-shadow: var(--ad-brand-shadow); transition: box-shadow var(--ad-duration), transform var(--ad-duration); }
.send-btn:hover { box-shadow: var(--ad-brand-shadow-hover); transform: translateY(-1px); }
.send-btn:active { transform: translateY(0); }
.send-btn:disabled { cursor: default; opacity: 0.85; box-shadow: none; transform: none; }
.cancel-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-danger-text, var(--ad-delete)); background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius); cursor: pointer; transition: background var(--ad-duration), border-color var(--ad-duration); }
.cancel-btn:hover { background: var(--ad-danger-bg); border-color: color-mix(in srgb, var(--ad-danger) 35%, transparent); }
.send-ico { font-size: 14px; }
.send-ico.spin { animation: dd-spin 0.8s linear infinite; }
@keyframes dd-spin { to { transform: rotate(360deg); } }

.dd-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 24px 16px; }

/* ===== 分区 ===== */
.dd-sec { padding: 16px 0; border-bottom: 1px solid var(--ad-border-soft); }
.dd-sec:last-child { border-bottom: none; }
.dd-sec.is-empty { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; }
.dd-sec.is-empty .dd-sec-title { margin-bottom: 0; }
.dd-sec.is-empty .dd-add { margin-left: auto; }
.dd-sec-title { display: flex; align-items: center; gap: 8px; font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); margin-bottom: 10px; }
.dd-tip { margin: 9px 0 0; font-size: var(--ad-fs-aux); line-height: 1.6; color: var(--ad-text-tertiary); }
.ct-badge { font-size: var(--ad-fs-aux); font-family: var(--ad-font-mono); font-weight: 500; color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-sm); padding: 1px 7px; }
.req-tag { flex-shrink: 0; font-size: 11px; font-weight: 600; border-radius: var(--ad-radius-pill); padding: 1px 8px; line-height: 15px; }
.req-tag.is-required { color: var(--ad-warning-text); background: var(--ad-warning-bg); }

/* 鉴权 */
.dd-auth-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.dd-auth-row:last-of-type { margin-bottom: 0; }
.dd-auth-name { width: 108px; flex-shrink: 0; font-size: var(--ad-fs-aux); font-weight: 600; font-family: var(--ad-font-mono); color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 参数行 */
.dd-row { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.dd-check { flex-shrink: 0; height: auto; }
.dd-required { flex-shrink: 0; width: 7px; color: var(--ad-danger-text, var(--ad-danger)); font-weight: 700; }
.dd-fixed-key .dd-required { margin-left: 3px; }
.dd-key { width: 132px; flex-shrink: 0; }
.dd-val { flex: 1; min-width: 0; }
.dd-del { flex-shrink: 0; width: 26px; height: 26px; color: var(--ad-text-tertiary); }
.dd-del:hover { color: var(--ad-danger-text); background: var(--ad-danger-bg); }
.dd-row.is-fixed { gap: 10px; }
.dd-fixed-key { width: 132px; flex-shrink: 0; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-put); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-cookie-val { flex: 1; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.dd-add { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; padding: 4px 8px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-tertiary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration); }
.dd-add:hover { color: var(--ad-primary); background: var(--ad-primary-soft); }

/* 全局请求头 chips */
.dd-global { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; padding: 8px 10px; background: var(--ad-primary-soft); border: 1px dashed color-mix(in srgb, var(--ad-primary) 30%, transparent); border-radius: var(--ad-radius); }
.dd-global-label { font-size: 11px; font-weight: 600; color: var(--ad-primary); }
.gh-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; padding: 2px 10px; background: var(--ad-bg); border: 1px solid color-mix(in srgb, var(--ad-primary) 22%, transparent); border-radius: var(--ad-radius-pill); cursor: pointer; transition: background var(--ad-duration); }
.gh-chip:hover { background: var(--ad-hover); }
.gh-key { font-family: var(--ad-font-mono); font-size: 11px; font-weight: 600; color: var(--ad-primary); }
.gh-val { font-family: var(--ad-font-mono); font-size: 11px; color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: var(--ad-primary); background: transparent; border: none; cursor: pointer; padding: 2px 6px; border-radius: var(--ad-radius-sm); }
.link-btn:hover { background: var(--ad-primary-soft-2); }

/* 编辑器 */
.editor-toolbar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.tool-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration); }
.tool-btn:hover { color: var(--ad-primary); background: var(--ad-hover); }
.tool-btn.active { color: var(--ad-primary); background: var(--ad-primary-soft); }
.editor-hint { margin-left: auto; font-size: 11px; color: var(--ad-text-tertiary); font-family: var(--ad-font-mono); }

/* 返回结果：固定在底部，配置区滚动时仍可见 */
.dd-result { flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; max-height: min(240px, 38vh); overflow: hidden; padding: 12px 24px 16px; border-top: 1px solid var(--ad-border-soft); background: var(--ad-bg); }
.dd-result-head { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dd-result-title { font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); }
.dd-copy-resp { margin-left: auto; }
.live-status { font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); font-weight: 600; font-variant-numeric: tabular-nums; padding: 1px 10px; border-radius: var(--ad-radius-pill); }
.live-status.status-success { color: var(--ad-success-text); background: var(--ad-success-bg); }
.live-status.status-warning { color: var(--ad-warning-text); background: var(--ad-warning-bg); }
.live-status.status-danger { color: var(--ad-danger-text); background: var(--ad-danger-bg); }
.live-status.status-info { color: var(--ad-info-text); background: var(--ad-info-bg); }
.live-meta { font-family: var(--ad-font-mono); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--ad-text-tertiary); }
.dd-result .mini-tabs { flex-shrink: 0; margin-bottom: 8px; }
.mini-tabs { display: flex; gap: 2px; padding: 3px; background: var(--ad-bg-subtle); border-radius: var(--ad-radius); margin-bottom: 10px; width: fit-content; }
.mini-tabs button { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 13px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: background var(--ad-duration), color var(--ad-duration); }
.mini-tabs button.active { color: var(--ad-primary); background: var(--ad-bg); box-shadow: var(--ad-shadow-sm); font-weight: 600; }
.dd-result .resp-pre { max-height: 128px; }
.resp-pre { margin: 0; padding: 14px 16px; background: var(--ad-bg-code); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text); white-space: pre-wrap; word-break: break-word; max-height: 380px; overflow: auto; }
.mini-empty { padding: 22px 0; text-align: center; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.dd-result-empty { display: flex; align-items: center; gap: 8px; padding: 16px 0 4px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }

/* ===== 移动端：全屏 + 遮罩 ===== */
@media (max-width: 900px) {
  .debug-drawer { width: 100vw; border-left: none; }
  .dd-scrim { display: block; position: fixed; inset: 0; z-index: 65; background: var(--ad-scrim); }
  .dd-head { padding: 16px; }
  .dd-req { padding: 12px 16px; }
  .dd-body { padding: 8px 16px 24px; }
  .dd-key { width: 108px; }
  .dd-fixed-key { width: 108px; }
}
</style>