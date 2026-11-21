<script setup lang="ts">
/**
 * 接口文档视图（只读）+ 在线运行抽屉入口
 *
 * 主视图专注文档：参数说明与示例、请求体示例/Schema、请求示例代码、响应定义；
 * 请求地址条右侧「调试」按钮展开右侧抽屉进行真实发送
 */
import { ref, computed, defineAsyncComponent } from "vue";
import type { OpenAPIDocument, Operation, Schema } from "../types/openapi";
import {
  getSchemaType,
  getSchemaExample,
  getMediaTypeExample,
  generateExampleJson,
} from "../api/openapi";
import { highlightJson, highlightJsonWithComments } from "../utils/json-highlight";
import { getSchemaCommentMap } from "../utils/schema-comments";
import { generateCurl } from "../utils/curl";
import { generateTsAxios, generateJavaRest } from "../utils/codegen";
import { copyWithFeedback as copyText } from "../utils/copy";
import { authValues } from "../stores/auth";
import { activeHeaderCount, headerRecord } from "../stores/headers";
import {
  resolveBaseUrl,
  securityNamesOf,
  buildAuthHeaders,
  buildAuthQuery,
  formatExample,
} from "../utils/request";
import SchemaView from "./SchemaView.vue";

const DebugDrawer = defineAsyncComponent(() => import("./DebugDrawer.vue"));

const props = defineProps<{
  method: string;
  path: string;
  operation: Operation;
  doc: OpenAPIDocument;
}>();

const emit = defineEmits<{
  (e: "open-settings", tab?: "auth" | "headers" | "base"): void;
}>();

/* ===================== 文档派生数据 ===================== */

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
    // 路径参数天然必填，不依赖文档是否正确标注 required
    required: p.in === "path" || !!p.required,
    description: p.description || "",
    type: p.schema ? getSchemaType(p.schema, props.doc) : "string",
    example: p.example ?? getSchemaExample(p.schema) ?? "",
  }))
);

const pathParams = computed(() => params.value.filter((p) => p.in === "path"));
const queryParams = computed(() => params.value.filter((p) => p.in === "query"));
const headerParams = computed(() => params.value.filter((p) => p.in === "header"));
// 浏览器禁止脚本设置 Cookie 请求头，cookie 参数仅展示
const cookieParams = computed(() => params.value.filter((p) => p.in === "cookie"));

const requestBody = computed(() => {
  const rb = props.operation.requestBody;
  const json = rb?.content?.["application/json"];
  if (!json?.schema) return null;
  return {
    required: rb?.required || false,
    description: rb?.description || "",
    schema: json.schema as Schema,
    example: getMediaTypeExample(json),
  };
});

const responses = computed(() => {
  const r = props.operation.responses;
  if (!r) return [];
  return Object.entries(r).map(([code, resp]) => ({
    code,
    description: resp.description || "",
    schema: resp.content?.["application/json"]?.schema as Schema | undefined,
    example: getMediaTypeExample(resp.content?.["application/json"]),
  }));
});

const hasBody = computed(() => !!requestBody.value && ["post", "put", "patch"].includes(props.method));

/* ===================== 请求地址 ===================== */

const baseUrl = computed(() => resolveBaseUrl(props.doc));

// 路径分段：高亮 {param}
const pathSegments = computed(() =>
  props.path
    .split(/(\{[^}]+\})/g)
    .filter(Boolean)
    .map((text) => ({ text, isParam: /^\{.+\}$/.test(text) }))
);

/* ===================== 授权 ===================== */

const securityNames = computed(() => securityNamesOf(props.operation, props.doc));
const securitySchemes = computed(() => props.doc.components?.securitySchemes || {});
const authHeaders = computed(() => buildAuthHeaders(securityNames.value, securitySchemes.value, authValues.value));
const authQuery = computed(() => buildAuthQuery(securityNames.value, securitySchemes.value, authValues.value));
const authorizedCount = computed(() => securityNames.value.filter((n) => authValues.value[n]).length);

/* ===================== 示例 cURL（文档示例值，非调试值） ===================== */

const bodyExampleText = computed(() => {
  if (!requestBody.value) return "";
  return requestBody.value.example
    ? JSON.stringify(requestBody.value.example, null, 2)
    : generateExampleJson(requestBody.value.schema, props.doc);
});
const bodyExampleHtml = computed(() =>
  highlightJsonWithComments(
    bodyExampleText.value,
    requestBody.value ? getSchemaCommentMap(requestBody.value.schema, props.doc) : {}
  )
);

const exampleUrl = computed(() => {
  let url = props.path;
  for (const p of pathParams.value) {
    const ex = formatExample(p.example);
    if (ex) url = url.replace(`{${p.name}}`, encodeURIComponent(ex));
  }
  const merged: Record<string, string> = {};
  for (const p of queryParams.value) {
    const ex = p.example;
    if (ex === undefined || ex === null || ex === "") continue;
    merged[p.name] = typeof ex === "object" ? JSON.stringify(ex) : String(ex);
  }
  Object.assign(merged, authQuery.value);
  const qs = Object.entries(merged)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += `?${qs}`;
  return baseUrl.value + url;
});

const exampleHeaders = computed<Record<string, string>>(() => {
  const headers: Record<string, string> = {};
  if (hasBody.value) headers["Content-Type"] = "application/json";
  Object.assign(headers, headerRecord());
  for (const p of headerParams.value) {
    const ex = formatExample(p.example);
    if (ex) headers[p.name] = ex;
  }
  Object.assign(headers, authHeaders.value);
  return headers;
});

const curlText = computed(() =>
  generateCurl({
    method: props.method,
    url: exampleUrl.value,
    headers: exampleHeaders.value,
    body: hasBody.value ? bodyExampleText.value : undefined,
  })
);

/* ===================== 请求示例语言切换 ===================== */

type ExampleLang = "curl" | "ts" | "java";
const exampleLang = ref<ExampleLang>("curl");
const codeText = computed(() => {
  const opts = {
    method: props.method,
    url: exampleUrl.value,
    headers: exampleHeaders.value,
    body: hasBody.value ? bodyExampleText.value : undefined,
  };
  if (exampleLang.value === "ts") return generateTsAxios(opts);
  if (exampleLang.value === "java") return generateJavaRest(opts);
  return curlText.value;
});

/* ===================== 视图状态 ===================== */

const debugOpen = ref(false);
const debugMounted = ref(false);
const bodyView = ref<"example" | "schema">("example");

function openDebug() {
  debugMounted.value = true;
  debugOpen.value = true;
}

function statusClass(code: string): string {
  if (code.startsWith("2")) return "is-success";
  if (code.startsWith("4")) return "is-warning";
  if (code.startsWith("5")) return "is-danger";
  return "is-other";
}
</script>

<template>
  <div class="endpoint">
    <!-- 接口标题 -->
    <header class="ep-head">
      <div class="ep-crumb">
        <el-icon class="crumb-ico"><Folder /></el-icon>
        <span>{{ operation.tags?.join(" / ") || "default" }}</span>
      </div>
      <div class="ep-title-row">
        <h2 class="ep-title">{{ operation.summary || path }}</h2>
        <span v-if="operation.deprecated" class="ep-deprecated">已废弃</span>
        <div class="ep-head-actions">
          <el-tooltip content="复制路径" placement="top">
            <button class="ad-icon-btn" aria-label="复制接口路径" @click="copyText(path, '路径已复制')">
              <el-icon><CopyDocument /></el-icon>
            </button>
          </el-tooltip>
        </div>
      </div>
      <p v-if="operation.description" class="ep-desc">{{ operation.description }}</p>
    </header>

    <!-- 请求地址条 + 调试入口 -->
    <div class="req-bar">
      <span class="ad-method ad-method--lg" :class="'ad-method--' + method.toLowerCase()">{{ method.toUpperCase() }}</span>
      <div class="req-url" :title="exampleUrl">
        <span class="req-base">{{ baseUrl }}</span>
        <span class="req-path">
          <span v-for="(seg, i) in pathSegments" :key="i" :class="{ 'is-param': seg.isParam }">{{ seg.text }}</span>
        </span>
      </div>
      <el-tooltip content="复制请求地址（含示例参数）" placement="top">
        <button class="ad-icon-btn" aria-label="复制请求地址" @click="copyText(exampleUrl, '请求地址已复制')">
          <el-icon><Link /></el-icon>
        </button>
      </el-tooltip>
      <button class="debug-btn" @click="openDebug">
        <el-icon><VideoPlay /></el-icon>调试
      </button>
    </div>

    <!-- 授权提示 -->
    <div v-if="securityNames.length" class="auth-strip" :class="{ 'is-on': authorizedCount > 0 }">
      <el-icon><Lock /></el-icon>
      <span class="auth-strip-text">此接口需要授权（{{ securityNames.join("、") }}）</span>
      <span class="auth-strip-state">{{ authorizedCount ? `已配置 ${authorizedCount}/${securityNames.length}` : "未配置" }}</span>
      <button class="auth-strip-btn" @click="emit('open-settings', 'auth')">{{ authorizedCount ? "修改授权" : "去授权" }}</button>
    </div>

    <!-- 请求参数（只读文档） -->
    <section v-if="params.length" class="ep-card">
      <div class="card-head">
        <h3 class="card-title">请求参数</h3>
        <span class="card-count">{{ params.length }} 个参数</span>
      </div>
      <div class="card-body">
        <div v-for="group in [
          { title: 'Path 参数', list: pathParams },
          { title: 'Query 参数', list: queryParams },
          { title: 'Header 参数', list: headerParams },
          { title: 'Cookie 参数', list: cookieParams },
        ]" :key="group.title">
          <div v-if="group.list.length" class="pgroup">
            <div class="pgroup-title">{{ group.title }}</div>
            <div v-for="p in group.list" :key="p.name" class="drow">
              <div class="dline">
                <code class="dname">{{ p.name }}<span v-if="p.required" class="required-mark" title="必填" aria-label="必填">*</span></code>
                <span class="dtype">{{ p.type }}</span>
                <span v-if="p.description" class="ddesc">{{ p.description }}</span>
                <span v-if="!p.required" class="req-tag is-optional">可选</span>
              </div>
              <div v-if="formatExample(p.example)" class="dexample">
                <span class="dex-label">示例:</span>
                <code class="dex-val">{{ formatExample(p.example) }}</code>
              </div>
            </div>
            <p v-if="group.title === 'Cookie 参数'" class="pgroup-tip">浏览器禁止脚本设置 Cookie 请求头，此处仅展示。</p>
            <p v-if="group.title === 'Header 参数' && Object.keys(authHeaders).length" class="pgroup-tip">
              授权头 {{ Object.keys(authHeaders).join("、") }} 将在发送时自动附加。
            </p>
          </div>
        </div>

        <!-- 全局请求头入口 -->
        <div class="global-row">
          <el-icon class="global-ico"><Setting /></el-icon>
          <span class="global-label">全局请求头</span>
          <span class="global-state" :class="{ 'is-on': activeHeaderCount > 0 }">
            {{ activeHeaderCount ? `${activeHeaderCount} 个生效` : "未设置" }}
          </span>
          <span class="global-hint">Authorization 请在「授权」中配置；其他请求头对所有接口生效，如 X-Tenant-Id</span>
          <button class="link-btn" @click="emit('open-settings', 'headers')">
            {{ activeHeaderCount ? "管理" : "设置" }}<el-icon><Right /></el-icon>
          </button>
        </div>
      </div>
    </section>

    <!-- 请求体（只读示例 / Schema） -->
    <section v-if="hasBody" class="ep-card">
      <div class="card-head">
        <h3 class="card-title">请求体</h3>
        <span class="ct-badge">application/json</span>
        <span v-if="requestBody?.required" class="req-tag is-required">必填</span>
        <div class="card-head-right">
          <div class="mini-seg">
            <button :class="{ active: bodyView === 'example' }" @click="bodyView = 'example'">示例</button>
            <button :class="{ active: bodyView === 'schema' }" @click="bodyView = 'schema'">Schema</button>
          </div>
        </div>
      </div>
      <div class="card-body">
        <p v-if="requestBody?.description" class="card-desc">{{ requestBody.description }}</p>
        <template v-if="bodyView === 'example'">
          <div class="editor-toolbar">
            <span class="editor-hint left">调试时可在抽屉中编辑请求体</span>
            <button class="tool-btn" @click="copyText(bodyExampleText, '请求体示例已复制')">
              <el-icon><CopyDocument /></el-icon>复制
            </button>
          </div>
          <pre class="resp-pre json-highlight" v-html="bodyExampleHtml"></pre>
        </template>
        <SchemaView v-else :schema="requestBody!.schema" :doc="doc" />
      </div>
    </section>

    <!-- 请求示例（cURL / TypeScript / Java） -->
    <section class="ep-card">
      <div class="card-head">
        <h3 class="card-title">请求示例</h3>
        <span class="ct-badge" title="由文档示例值和当前全局配置生成，不代表调试结果">文档示例</span>
        <div class="card-head-right">
          <div class="mini-seg">
            <button :class="{ active: exampleLang === 'curl' }" @click="exampleLang = 'curl'">cURL</button>
            <button :class="{ active: exampleLang === 'ts' }" @click="exampleLang = 'ts'">TypeScript</button>
            <button :class="{ active: exampleLang === 'java' }" @click="exampleLang = 'java'">Java</button>
          </div>
          <button class="tool-btn" @click="copyText(codeText, '请求代码已复制')">
            <el-icon><CopyDocument /></el-icon>复制
          </button>
        </div>
      </div>
      <div class="card-body">
        <pre class="curl-block">{{ codeText }}</pre>
      </div>
    </section>

    <!-- 响应定义 -->
    <section v-if="responses.length" class="ep-card">
      <div class="card-head">
        <h3 class="card-title">返回响应</h3>
      </div>
      <div class="card-body">
        <div v-for="resp in responses" :key="resp.code" class="doc-resp">
          <div class="doc-resp-head">
            <span class="status-pill" :class="statusClass(resp.code)">{{ resp.code }}</span>
            <span class="doc-resp-desc">{{ resp.description }}</span>
          </div>
          <div class="doc-resp-grid" :class="{ 'single': !resp.schema || !formatExample(resp.example) }">
            <div v-if="resp.schema" class="dr-col">
              <div class="dr-col-label">Schema</div>
              <SchemaView :schema="resp.schema" :doc="doc" />
            </div>
            <div v-if="formatExample(resp.example)" class="dr-col">
              <div class="dr-col-label">示例</div>
              <pre class="resp-pre json-highlight" v-html="highlightJson(formatExample(resp.example))"></pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 在线运行抽屉 -->
    <DebugDrawer
      v-if="debugMounted"
      :open="debugOpen"
      :method="method"
      :path="path"
      :operation="operation"
      :doc="doc"
      :base-url="baseUrl"
      @close="debugOpen = false"
      @open-settings="(tab) => emit('open-settings', tab)"
    />
  </div>
</template>

<style scoped>
.endpoint { display: flex; flex-direction: column; gap: var(--ad-gap); }
/* 入场 stagger：backwards fill 不覆盖 hover 位移 */
.endpoint > * { animation: ad-rise 0.4s var(--ad-ease) backwards; }
.endpoint > *:nth-child(2) { animation-delay: 0.05s; }
.endpoint > *:nth-child(3) { animation-delay: 0.1s; }
.endpoint > *:nth-child(4) { animation-delay: 0.15s; }
.endpoint > *:nth-child(n + 5) { animation-delay: 0.2s; }

/* 标题 */
.ep-head { padding: 2px 2px 0; }
.ep-crumb { display: flex; align-items: center; gap: 5px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); margin-bottom: 8px; }
.crumb-ico { font-size: 13px; }
.ep-title-row { display: flex; align-items: center; gap: 10px; }
.ep-title { font-family: var(--ad-font-display); font-size: var(--ad-fs-page-title); font-weight: 600; letter-spacing: -0.02em; margin: 0; color: var(--ad-text); line-height: 1.3; }
.ep-deprecated { font-size: 11px; font-weight: 600; color: var(--ad-danger-text); background: var(--ad-danger-bg); border-radius: var(--ad-radius-pill); padding: 2px 10px; }
.ep-head-actions { margin-left: auto; display: flex; gap: 4px; }
.ep-desc { font-size: var(--ad-fs-secondary); color: var(--ad-text-secondary); margin: 10px 0 0; white-space: pre-wrap; line-height: 1.8; }

/* 请求地址条 */
.req-bar { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius-lg); box-shadow: var(--ad-shadow-sm); }
.req-url { flex: 1; min-width: 0; display: flex; align-items: center; height: 36px; padding: 0 12px; background: var(--ad-bg-subtle); border-radius: var(--ad-radius); overflow: hidden; }
.req-base { flex-shrink: 0; max-width: 46%; font-family: var(--ad-font-mono); font-size: var(--ad-fs-secondary); color: var(--ad-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-path { flex: 1; min-width: 0; font-family: var(--ad-font-mono); font-size: var(--ad-fs-secondary); color: var(--ad-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-path .is-param { color: var(--ad-primary); font-weight: 600; }
/* 调试 = 品牌时刻：渐变 + 品牌投影 + hover 上浮 1px */
.debug-btn { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 18px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-on-primary); background: var(--ad-primary-grad); border: none; border-radius: var(--ad-radius); cursor: pointer; box-shadow: var(--ad-brand-shadow); transition: box-shadow var(--ad-duration), transform var(--ad-duration); }
.debug-btn:hover { box-shadow: var(--ad-brand-shadow-hover); transform: translateY(-1px); }
.debug-btn:active { transform: translateY(0); }
.debug-btn .el-icon { font-size: 15px; }

/* 授权条 */
.auth-strip { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: var(--ad-fs-secondary); color: var(--ad-warning-text); background: var(--ad-warning-bg); border: 1px solid color-mix(in srgb, var(--ad-warning) 24%, transparent); border-radius: var(--ad-radius); }
.auth-strip.is-on { color: var(--ad-success-text); background: var(--ad-success-bg); border-color: color-mix(in srgb, var(--ad-success) 24%, transparent); }
.auth-strip-text { flex: 1; }
.auth-strip-state { opacity: 0.85; font-size: var(--ad-fs-aux); }
.auth-strip-btn { padding: 2px 12px; font-size: var(--ad-fs-aux); font-weight: 600; color: inherit; background: var(--ad-bg); border: 1px solid currentColor; border-radius: var(--ad-radius-pill); cursor: pointer; transition: background var(--ad-duration); }
.auth-strip-btn:hover { background: var(--ad-hover); }

/* 卡片 */
.ep-card { background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius-lg); box-shadow: var(--ad-shadow-sm); overflow: hidden; }
.card-head { display: flex; align-items: center; gap: 9px; padding: 16px 20px; border-bottom: 1px solid var(--ad-border-soft); }
.card-title { font-size: var(--ad-fs-card-title); font-weight: 600; margin: 0; color: var(--ad-text); letter-spacing: -0.01em; }
.card-count { font-size: var(--ad-fs-aux); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-pill); padding: 1px 9px; line-height: 16px; }
.ct-badge { font-size: var(--ad-fs-aux); font-family: var(--ad-font-mono); color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-sm); padding: 1px 7px; }
.card-head-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.card-body { padding: 20px; }
.card-desc { font-size: var(--ad-fs-secondary); color: var(--ad-text-tertiary); margin: 0 0 12px; line-height: 1.7; }

/* 参数文档行 */
.pgroup { margin-bottom: 20px; }
.pgroup:last-child { margin-bottom: 0; }
.pgroup-title { display: flex; align-items: center; gap: 8px; font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-secondary); margin-bottom: 6px; letter-spacing: 0.01em; }
.pgroup-tip { margin: 10px 0 0; font-size: var(--ad-fs-aux); line-height: 1.6; color: var(--ad-text-tertiary); }
.drow { padding: 12px 0; border-bottom: 1px dashed var(--ad-border-soft); }
.drow:last-child { border-bottom: none; }
.dline { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
.dname { font-family: var(--ad-font-mono); font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-put); word-break: break-all; }
.required-mark { margin-left: 3px; color: var(--ad-danger-text); font-weight: 700; }
.dtype { font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.ddesc { font-size: var(--ad-fs-secondary); color: var(--ad-text-secondary); line-height: 1.6; }
.req-tag { flex-shrink: 0; margin-left: auto; font-size: 11px; font-weight: 600; border-radius: var(--ad-radius-pill); padding: 1px 8px; line-height: 15px; }
.req-tag.is-required { color: var(--ad-warning-text); background: var(--ad-warning-bg); }
.req-tag.is-optional { color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); }
.dexample { display: flex; align-items: baseline; gap: 7px; margin-top: 6px; }
.dex-label { font-size: 11px; color: var(--ad-text-tertiary); flex-shrink: 0; }
.dex-val { font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-secondary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-sm); padding: 1px 8px; word-break: break-all; }

/* 全局请求头入口行 */
.global-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding: 12px; background: var(--ad-bg-subtle); border: 1px dashed var(--ad-border-strong); border-radius: var(--ad-radius); }
.global-ico { font-size: 14px; color: var(--ad-primary); }
.global-label { font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); }
.global-state { font-size: 11px; font-weight: 600; color: var(--ad-text-tertiary); background: var(--ad-bg-inset); border-radius: var(--ad-radius-pill); padding: 1px 8px; line-height: 15px; }
.global-state.is-on { color: var(--ad-primary); background: var(--ad-primary-soft); }
.global-hint { flex: 1; min-width: 200px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); line-height: 1.5; }
.link-btn { display: inline-flex; align-items: center; gap: 2px; font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-primary); background: transparent; border: none; cursor: pointer; padding: 2px 6px; border-radius: var(--ad-radius-sm); }
.link-btn:hover { background: var(--ad-primary-soft); }
.link-btn .el-icon { font-size: 11px; }

/* 迷你分段 */
.mini-seg { display: inline-flex; gap: 2px; padding: 2px; background: var(--ad-bg-subtle); border-radius: var(--ad-radius); }
.mini-seg button { min-width: 52px; height: 24px; padding: 0 12px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: background var(--ad-duration), color var(--ad-duration); }
.mini-seg button.active { color: var(--ad-primary); background: var(--ad-bg); box-shadow: var(--ad-shadow-sm); font-weight: 600; }

/* 工具条 / 代码块 */
.editor-toolbar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.tool-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration); }
.tool-btn:hover { color: var(--ad-primary); background: var(--ad-hover); }
.editor-hint { margin-left: auto; font-size: 11px; color: var(--ad-text-tertiary); }
.editor-hint.left { margin-left: 0; margin-right: auto; }
.curl-block { margin: 0; padding: 14px 16px; background: var(--ad-bg-code); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text-secondary); white-space: pre-wrap; word-break: break-all; max-height: 260px; overflow: auto; }
.resp-pre { margin: 0; padding: 14px 16px; background: var(--ad-bg-code); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text); white-space: pre-wrap; word-break: break-word; max-height: 440px; overflow: auto; }

/* 响应定义 */
.doc-resp { padding: 12px 0; border-bottom: 1px solid var(--ad-border-soft); }
.doc-resp:first-child { padding-top: 0; }
.doc-resp:last-child { border-bottom: none; padding-bottom: 0; }
.doc-resp-head { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
.status-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 42px; height: 22px; padding: 0 10px; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); font-weight: 600; font-variant-numeric: tabular-nums; border-radius: var(--ad-radius-pill); }
.status-pill.is-success { color: var(--ad-success-text); background: var(--ad-success-bg); }
.status-pill.is-warning { color: var(--ad-warning-text); background: var(--ad-warning-bg); }
.status-pill.is-danger { color: var(--ad-danger-text); background: var(--ad-danger-bg); }
.status-pill.is-other { color: var(--ad-info-text); background: var(--ad-info-bg); }
.doc-resp-desc { font-size: var(--ad-fs-secondary); color: var(--ad-text-secondary); }
.doc-resp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ad-gap); align-items: start; }
.doc-resp-grid.single { grid-template-columns: 1fr; }
.dr-col { min-width: 0; }
.dr-col-label { font-size: var(--ad-fs-aux); font-weight: 600; letter-spacing: 0.04em; color: var(--ad-text-tertiary); margin-bottom: 7px; }
.dr-col .resp-pre { max-height: 360px; }

@media (max-width: 900px) {
  .doc-resp-grid { grid-template-columns: 1fr; }
  .req-base { max-width: 38%; }
  .global-hint { min-width: 100%; order: 5; }
}
</style>