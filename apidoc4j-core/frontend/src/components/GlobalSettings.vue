<script setup lang="ts">
/**
 * 全局设置弹窗：授权、全局请求头、基础设置。
 * 授权凭据默认存 sessionStorage，勾选记住授权后存 localStorage。
 */
import { ref, reactive, computed, watch, nextTick } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { OpenAPIDocument, SecurityScheme } from "../types/openapi";
import { authValues, setAuthValue, clearAuthValues, rememberAuth, setAuthRemember } from "../stores/auth";
import {
  customHeaders,
  addHeader,
  removeHeader,
  updateHeader,
  clearHeaders,
  activeHeaderCount,
} from "../stores/headers";
import { globalBaseUrl, setGlobalBaseUrl, theme } from "../stores/ui";
import { resolveBaseUrl, isSecretScheme } from "../utils/request";
import {
  defaultTokenFetchConfig,
  loadTokenFetchConfig,
  saveTokenFetchConfig,
  clearTokenFetchConfig,
  fetchCaptcha,
  fetchToken,
  type TokenFetchConfig,
  type TokenFetchParam,
} from "../utils/tokenFetch";

const props = defineProps<{
  schemes: Record<string, SecurityScheme>;
  doc: OpenAPIDocument | null;
}>();

type Tab = "auth" | "headers" | "base";
const visible = ref(false);
const tab = ref<Tab>("auth");

/** 授权页当前段：fetch=一键获取令牌，manual=按 securitySchemes 手动粘贴 */
type AuthMode = "fetch" | "manual";
const authMode = ref<AuthMode>("fetch");
function switchMode(mode: AuthMode) {
  authMode.value = mode;
  // 切回获取段时预载验证码，省一次点击
  if (mode === "fetch") ensureCaptchas();
}

/* ===================== 授权 ===================== */

interface SchemeItem {
  name: string;
  scheme: SecurityScheme;
}
const schemeList = computed<SchemeItem[]>(() =>
  Object.entries(props.schemes || {}).map(([name, scheme]) => ({ name, scheme }))
);
const authValuesDraft = reactive<Record<string, string>>({});
const basicUsers = reactive<Record<string, string>>({});
const basicPasswords = reactive<Record<string, string>>({});

function isBasic(item: SchemeItem): boolean {
  return item.scheme.type === "http" && item.scheme.scheme?.toLowerCase() === "basic";
}
function isSecret(item: SchemeItem): boolean {
  return isSecretScheme(item.scheme);
}
function isBearerLike(item: SchemeItem): boolean {
  const t = item.scheme.type;
  return t === "oauth2" || t === "openIdConnect" || (t === "http" && item.scheme.scheme?.toLowerCase() !== "basic");
}
function schemeLocation(item: SchemeItem): string {
  if (item.scheme.type === "apiKey") return `${item.scheme.in || "header"} · ${item.scheme.name || item.name}`;
  if (item.scheme.type === "http") return `http · ${item.scheme.scheme || "bearer"}`;
  if (item.scheme.type === "oauth2") return "oauth2 · Authorization: Bearer";
  if (item.scheme.type === "openIdConnect") return "openIdConnect · Authorization: Bearer";
  return item.scheme.type;
}
function placeholder(item: SchemeItem): string {
  if (item.scheme.type === "apiKey" && item.scheme.in === "header") {
    return item.scheme.scheme?.toLowerCase() === "bearer" ? "粘贴 token，发送时自动补 Bearer 前缀" : "Header 值";
  }
  if (item.scheme.type === "apiKey") return "参数值";
  if (isBearerLike(item)) return "粘贴 access_token，发送时自动补 Bearer 前缀";
  return "access_token";
}
function saveAuth(item: SchemeItem) {
  let value = authValuesDraft[item.name] || "";
  if (isBasic(item)) {
    const user = basicUsers[item.name] || "";
    const password = basicPasswords[item.name] || "";
    value = user || password ? `${user}:${password}` : "";
  }
  setAuthValue(item.name, value.trim());
}
async function clearAuth() {
  try {
    await ElMessageBox.confirm("清除后需要重新填写或获取授权，是否继续？", "清除全部授权", {
      type: "warning",
      confirmButtonText: "清除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  clearAuthValues();
  for (const item of schemeList.value) {
    authValuesDraft[item.name] = "";
    basicUsers[item.name] = "";
    basicPasswords[item.name] = "";
  }
  ElMessage.success("已清除全部授权");
}
const configuredAuthCount = computed(() => Object.keys(authValues.value).length);

function onRememberAuthChange(value: boolean | string | number) {
  setAuthRemember(Boolean(value));
}

/* ===================== 一键获取令牌 ===================== */

/**
 * bearer 类方案才提供一键获取：oauth2/openIdConnect/http bearer/apiKey(header)+bearer
 */
function canFetchToken(item: SchemeItem): boolean {
  const t = item.scheme.type;
  if (t === "oauth2" || t === "openIdConnect") return true;
  if (t === "http") return item.scheme.scheme?.toLowerCase() !== "basic";
  return t === "apiKey" && (item.scheme.in || "header") === "header" && item.scheme.scheme?.toLowerCase() === "bearer";
}

// 一键获取的配置挂在首个 bearer 类方案下，成功后写入全部 bearer 类方案
const primaryItem = computed<SchemeItem | null>(() => schemeList.value.find((s) => canFetchToken(s)) || null);
const tfItem = computed<SchemeItem>(() => primaryItem.value as SchemeItem);
const fetchTargets = computed(() => schemeList.value.filter((s) => canFetchToken(s)).map((s) => s.name));

const advPanelRef = ref<HTMLElement>();
const tfConfigs = reactive<Record<string, TokenFetchConfig>>({});
const tfAdvOpen = reactive<Record<string, boolean>>({});
const tfCaptchaCfgOpen = reactive<Record<string, boolean>>({});
const tfLoading = reactive<Record<string, boolean>>({});
const usernameInputRef = ref<{ focus: () => void }>();
const passwordInputRef = ref<{ focus: () => void }>();
const credInvalid = reactive({ username: false, password: false });

interface FetchStatus {
  type: "success" | "error";
  text: string;
}
const tfStatus = reactive<Record<string, FetchStatus | null>>({});

function tfConfig(item: SchemeItem): TokenFetchConfig {
  if (!tfConfigs[item.name]) {
    const cfg =
      loadTokenFetchConfig(item.name, item.scheme, props.doc) || defaultTokenFetchConfig(item.scheme, props.doc);
    // 主流程固定展示账号/密码两栏，缺失时补齐（旧自定义配置可能改过参数表）
    for (const key of ["username", "password"]) {
      if (!cfg.params.some((p) => p.key === key)) cfg.params.push({ key, value: "" });
    }
    tfConfigs[item.name] = cfg;
  }
  return tfConfigs[item.name];
}
function credRow(item: SchemeItem, key: string): TokenFetchParam {
  return tfConfig(item).params.find((p) => p.key === key) as TokenFetchParam;
}
/**
 * 高级区只展示账号密码之外的附加参数，避免与主流程重复
 */
function extraParams(item: SchemeItem): TokenFetchParam[] {
  return tfConfig(item).params.filter((p) => p.key !== "username" && p.key !== "password");
}
function addParam(item: SchemeItem) {
  tfConfig(item).params.push({ key: "", value: "" });
  persistTf(item);
}
function removeParam(item: SchemeItem, p: TokenFetchParam) {
  const cfg = tfConfig(item);
  const i = cfg.params.indexOf(p);
  if (i >= 0) cfg.params.splice(i, 1);
  persistTf(item);
}
function persistTf(item: SchemeItem) {
  saveTokenFetchConfig(item.name, tfConfig(item));
}
function resetTf(item: SchemeItem) {
  tfConfigs[item.name] = defaultTokenFetchConfig(item.scheme, props.doc);
  clearTokenFetchConfig(item.name);
  const st = tfCaptchaState(item);
  st.id = "";
  st.image = "";
  st.code = "";
  st.error = "";
  tfStatus[item.name] = null;
  if (tfConfig(item).captcha.enabled) loadCaptcha(item);
  ElMessage.success("已按当前文档恢复默认配置");
}
async function toggleAdvanced(item: SchemeItem) {
  tfAdvOpen[item.name] = !tfAdvOpen[item.name];
  if (tfAdvOpen[item.name]) {
    // 展开后滚动到可见位置，避免用户以为没有内容
    await nextTick();
    advPanelRef.value?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/* ---------- 图形验证码（端点与参数字段可配置，提交后自动刷新） ---------- */

interface CaptchaState {
  id: string;
  image: string;
  code: string;
  loading: boolean;
  error: string;
}
const tfCaptchas = reactive<Record<string, CaptchaState>>({});
function tfCaptchaState(item: SchemeItem): CaptchaState {
  if (!tfCaptchas[item.name]) {
    tfCaptchas[item.name] = { id: "", image: "", code: "", loading: false, error: "" };
  }
  return tfCaptchas[item.name];
}
function tfBase(): string {
  // 开发环境走 Vite 代理，避免跨域
  if (import.meta.env.DEV) return "";
  return props.doc ? resolveBaseUrl(props.doc) : window.location.origin;
}
async function loadCaptcha(item: SchemeItem) {
  const st = tfCaptchaState(item);
  if (st.loading) return;
  st.loading = true;
  st.error = "";
  try {
    const cap = await fetchCaptcha(tfConfig(item), tfBase());
    st.id = cap.id;
    st.image = cap.image;
  } catch (e: any) {
    st.id = "";
    st.image = "";
    st.error = e?.message || "验证码加载失败";
  } finally {
    st.loading = false;
  }
}
/**
 * 显示验证码行并立即加载图片
 */
function enableCaptcha(item: SchemeItem) {
  tfConfig(item).captcha.enabled = true;
  persistTf(item);
  loadCaptcha(item);
}

/**
 * 隐藏验证码行并清空图片与输入状态
 */
function disableCaptcha(item: SchemeItem) {
  tfConfig(item).captcha.enabled = false;
  persistTf(item);
  const st = tfCaptchaState(item);
  st.id = "";
  st.image = "";
  st.code = "";
  st.error = "";
}
/**
 * 进入授权页时加载验证码：已开启则刷新一张新图，未开启则跳过
 */
function ensureCaptchas(refresh = false) {
  const item = primaryItem.value;
  if (!item || !tfConfig(item).captcha.enabled) return;
  if (refresh || !tfCaptchaState(item).image) loadCaptcha(item);
}
watch(tab, (t) => {
  if (t === "auth" && visible.value) ensureCaptchas();
});

function isSecretParam(key: string): boolean {
  return /password|pwd|secret/i.test(key);
}
function paramPlaceholder(key: string): string {
  if (/^username$/i.test(key)) return "如 admin";
  if (isSecretParam(key)) return "如 123456";
  if (/^grant_type$/i.test(key)) return "password";
  return "参数值";
}

function onCredInput(key: "username" | "password") {
  credInvalid[key] = false;
  const status = tfStatus[tfItem.value.name];
  if (status?.type === "error" && status.text.startsWith("请填写")) {
    const missing = [credInvalid.username ? "用户名" : "", credInvalid.password ? "密码" : ""].filter(Boolean);
    tfStatus[tfItem.value.name] = missing.length
      ? { type: "error", text: `请填写${missing.join("和")}` }
      : null;
  }
  persistTf(tfItem.value);
}

function validateCredentials(item: SchemeItem): boolean {
  credInvalid.username = !credRow(item, "username").value.trim();
  credInvalid.password = !credRow(item, "password").value.trim();
  if (!credInvalid.username && !credInvalid.password) return true;

  const missing = [credInvalid.username ? "用户名" : "", credInvalid.password ? "密码" : ""].filter(Boolean);
  tfStatus[item.name] = { type: "error", text: `请填写${missing.join("和")}` };
  nextTick(() => {
    (credInvalid.username ? usernameInputRef.value : passwordInputRef.value)?.focus();
  });
  return false;
}

async function fetchNow(item: SchemeItem) {
  if (tfLoading[item.name]) return;
  if (!validateCredentials(item)) return;
  const cfg = tfConfig(item);
  const st = tfCaptchaState(item);
  if (cfg.captcha.enabled && !st.code.trim()) {
    if (!st.image && !st.loading) loadCaptcha(item);
    tfStatus[item.name] = { type: "error", text: "请先输入验证码" };
    return;
  }
  if (cfg.captcha.enabled && !st.id) {
    loadCaptcha(item);
    tfStatus[item.name] = { type: "error", text: "验证码未加载，正在重试，请稍后再提交" };
    return;
  }
  tfLoading[item.name] = true;
  tfStatus[item.name] = null;
  try {
    const extra = cfg.captcha.enabled
      ? [
          { key: cfg.captcha.idKey.trim() || "captchaId", value: st.id },
          { key: cfg.captcha.codeKey.trim() || "captchaCode", value: st.code.trim() },
        ]
      : [];
    const token = await fetchToken(cfg, tfBase(), extra);
    for (const name of fetchTargets.value) {
      setAuthValue(name, token);
      authValuesDraft[name] = token;
    }
    // 切到手动填写，用户可直接看到「已配置」徽标确认写入结果
    authMode.value = "manual";
    tfStatus[item.name] = {
      type: "success",
      text: `令牌已写入 ${fetchTargets.value.join("、")}，关闭弹窗后所有接口自动携带`,
    };
  } catch (e: any) {
    const msg = e?.message || "获取令牌失败";
    if (!cfg.captcha.enabled && /验证码|captcha/i.test(msg)) {
      // 后端要求验证码：自动开启辅助并刷新图片，用户补填后重试即可
      cfg.captcha.enabled = true;
      persistTf(item);
      tfStatus[item.name] = { type: "error", text: `${msg}；已自动开启验证码辅助，请输入验证码后重试` };
    } else {
      tfStatus[item.name] = {
        type: "error",
        text: /验证码|captcha/i.test(msg) ? `${msg}；验证码已刷新，请重新输入` : msg,
      };
    }
  } finally {
    tfLoading[item.name] = false;
    // 验证码一次性：无论成败都刷新，避免复用已失效的图
    if (cfg.captcha.enabled) {
      st.code = "";
      loadCaptcha(item);
    }
  }
}

/* ===================== 全局请求头 ===================== */

const newKey = ref("");
const newValue = ref("");
function submitHeader() {
  if (!newKey.value.trim()) return;
  addHeader(newKey.value, newValue.value);
  newKey.value = "";
  newValue.value = "";
}
async function clearAllHeaders() {
  try {
    await ElMessageBox.confirm("清空后需要重新添加请求头，是否继续？", "清空全局请求头", {
      type: "warning",
      confirmButtonText: "清空",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  clearHeaders();
  ElMessage.success("已清空全局请求头");
}

/* ===================== 基础设置 ===================== */

const baseDraft = ref(globalBaseUrl.value);
function saveBase() {
  setGlobalBaseUrl(baseDraft.value);
}
function setTheme(value: "light" | "dark") {
  theme.value = value;
}

/* ===================== 打开 ===================== */

function open(target: Tab = "auth") {
  tab.value = target;
  baseDraft.value = globalBaseUrl.value;
  for (const item of schemeList.value) {
    const saved = authValues.value[item.name] || "";
    if (isBasic(item)) {
      const idx = saved.indexOf(":");
      basicUsers[item.name] = idx >= 0 ? saved.slice(0, idx) : saved;
      basicPasswords[item.name] = idx >= 0 ? saved.slice(idx + 1) : "";
      authValuesDraft[item.name] = saved;
    } else {
      authValuesDraft[item.name] = saved;
    }
  }
  // 初始段：待获取令牌时默认展示一键获取，已有凭据或无获取能力则直接手动填写
  authMode.value = primaryItem.value && !authValues.value[primaryItem.value.name] ? "fetch" : "manual";
  visible.value = true;
  // 打开授权页时刷新一张验证码，避免展示上次已失效的图
  if (target === "auth" && authMode.value === "fetch") ensureCaptchas(true);
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" title="全局设置" width="640px" :close-on-click-modal="false" class="gs-dialog" top="8vh">
    <div class="gs-tabs">
      <button :class="{ active: tab === 'auth' }" @click="tab = 'auth'">
        <el-icon><Lock /></el-icon>授权
        <span v-if="configuredAuthCount" class="gs-tab-n">{{ configuredAuthCount }}</span>
      </button>
      <button :class="{ active: tab === 'headers' }" @click="tab = 'headers'">
        <el-icon><Postcard /></el-icon>全局请求头
        <span v-if="activeHeaderCount" class="gs-tab-n">{{ activeHeaderCount }}</span>
      </button>
      <button :class="{ active: tab === 'base' }" @click="tab = 'base'">
        <el-icon><Setting /></el-icon>基础设置
      </button>
    </div>

    <!-- 授权：一键获取 / 手动填写 两段互斥切换 -->
    <div v-show="tab === 'auth'" class="gs-pane">
      <p class="gs-tip">凭据默认仅保留在当前标签页，发送时按接口授权声明自动附加。</p>
      <div class="gs-remember">
        <el-checkbox :model-value="rememberAuth" @change="onRememberAuthChange">在此浏览器记住授权</el-checkbox>
        <span>未勾选时关闭标签页即清除</span>
      </div>
      <div v-if="!schemeList.length" class="gs-empty">
        <el-icon><InfoFilled /></el-icon>
        <span>当前文档未声明 securitySchemes，无需授权。</span>
      </div>

      <template v-else>
        <div v-if="primaryItem" class="auth-seg">
          <button :class="{ active: authMode === 'fetch' }" @click="switchMode('fetch')">
            <el-icon><Key /></el-icon>一键获取
          </button>
          <button :class="{ active: authMode === 'manual' }" @click="switchMode('manual')">
            <el-icon><EditPen /></el-icon>手动填写
          </button>
        </div>

        <!-- 一键获取：bearer 类方案共用，成功后写入全部目标 -->
        <div v-if="primaryItem && authMode === 'fetch'" class="tf-fetch">
          <p v-if="fetchTargets.length > 1" class="tf-note">成功后同时写入 {{ fetchTargets.join("、") }}；也可切到「手动填写」按方案粘贴。</p>
          <div class="tf-cred">
            <el-input
              ref="usernameInputRef"
              v-model="credRow(tfItem, 'username').value"
              :class="{ 'is-invalid': credInvalid.username }"
              placeholder="用户名，如 admin"
              autocomplete="username"
              aria-required="true"
              :aria-invalid="credInvalid.username"
              @input="onCredInput('username')"
              @keyup.enter="fetchNow(tfItem)"
            />
            <el-input
              ref="passwordInputRef"
              v-model="credRow(tfItem, 'password').value"
              :class="{ 'is-invalid': credInvalid.password }"
              type="password"
              show-password
              placeholder="密码"
              autocomplete="current-password"
              aria-required="true"
              :aria-invalid="credInvalid.password"
              @input="onCredInput('password')"
              @keyup.enter="fetchNow(tfItem)"
            />
          </div>
          <div v-if="!tfConfig(tfItem).captcha.enabled" class="tf-captcha-entry">
            <button class="tf-captcha-toggle" title="系统登录使用图形验证码时开启，开启后需填写验证码才能获取令牌" @click="enableCaptcha(tfItem)">
              <el-icon><Picture /></el-icon>填写验证码
            </button>
            <span>系统登录使用图形验证码时开启</span>
          </div>
          <div v-if="tfConfig(tfItem).captcha.enabled" class="tf-captcha-row">
            <button
              class="tf-captcha-img"
              title="点击刷新验证码"
              :disabled="tfCaptchaState(tfItem).loading"
              @click="loadCaptcha(tfItem)"
            >
              <el-icon v-if="tfCaptchaState(tfItem).loading" class="spin"><Loading /></el-icon>
              <img v-else-if="tfCaptchaState(tfItem).image" :src="tfCaptchaState(tfItem).image" alt="验证码" />
              <span v-else class="tf-captcha-empty">{{ tfCaptchaState(tfItem).error ? "加载失败·点击重试" : "点击加载" }}</span>
            </button>
            <el-input
              v-model="tfCaptchaState(tfItem).code"
              class="tf-captcha-code"
              placeholder="验证码"
              @keyup.enter="fetchNow(tfItem)"
            />
            <button class="ad-icon-btn" title="刷新验证码" aria-label="刷新验证码" @click="loadCaptcha(tfItem)">
              <el-icon><Refresh /></el-icon>
            </button>
            <button class="ad-icon-btn" title="隐藏验证码" aria-label="隐藏验证码" @click="disableCaptcha(tfItem)">
              <el-icon><Close /></el-icon>
            </button>
          </div>
          <!-- 图片加载失败时给出配置入口，正常使用不出现 -->
          <p v-if="tfConfig(tfItem).captcha.enabled && tfCaptchaState(tfItem).error" class="tf-captcha-error">
            <span>{{ tfCaptchaState(tfItem).error }}</span>
            <button class="gs-link" @click="tfCaptchaCfgOpen[tfItem.name] = !tfCaptchaCfgOpen[tfItem.name]">验证码接口配置</button>
          </p>
          <!-- 验证码接口配置：内联在验证码行下方，仅失败路径可达 -->
          <div
            v-if="tfConfig(tfItem).captcha.enabled && (tfCaptchaState(tfItem).error || tfCaptchaCfgOpen[tfItem.name])"
            class="tf-captcha-cfg"
          >
            <div class="tf-grid">
              <label class="tf-label">验证码端点</label>
              <el-input class="cfg-span" v-model="tfConfig(tfItem).captcha.endpoint" placeholder="如 /captcha" @change="persistTf(tfItem)" />
              <label class="tf-label">验证码ID字段</label>
              <el-input v-model="tfConfig(tfItem).captcha.idKey" placeholder="captchaId" @change="persistTf(tfItem)" />
              <label class="tf-label">验证码字段</label>
              <el-input v-model="tfConfig(tfItem).captcha.codeKey" placeholder="captchaCode" @change="persistTf(tfItem)" />
            </div>
          </div>
          <button class="tf-submit" :disabled="tfLoading[tfItem.name]" @click="fetchNow(tfItem)">
            <el-icon :class="{ spin: tfLoading[tfItem.name] }"><Loading v-if="tfLoading[tfItem.name]" /><Key v-else /></el-icon>
            {{ tfLoading[tfItem.name] ? "获取中…" : "获取令牌" }}
          </button>
          <p
            v-if="tfStatus[tfItem.name]"
            class="tf-status"
            :class="'is-' + (tfStatus[tfItem.name]?.type || '')"
            role="status"
            aria-live="polite"
          >
            <el-icon><CircleCheck v-if="tfStatus[tfItem.name]?.type === 'success'" /><CircleClose v-else /></el-icon>
            <span>{{ tfStatus[tfItem.name]?.text }}</span>
          </p>
          <div class="tf-adv-bar">
            <button class="tf-toggle" @click="toggleAdvanced(tfItem)">
              <el-icon><Setting /></el-icon>
              {{ tfAdvOpen[tfItem.name] ? "收起高级设置" : "高级设置" }}
              <el-icon class="chev" :class="{ open: tfAdvOpen[tfItem.name] }"><ArrowDown /></el-icon>
            </button>
          </div>
        </div>

        <!-- 手动填写：按 securitySchemes 紧凑列表 -->
        <div v-else class="manual-list">
          <div v-for="item in schemeList" :key="item.name" class="scheme">
            <div class="scheme-head">
              <span class="scheme-name">{{ item.name }}</span>
              <span class="scheme-loc">{{ schemeLocation(item) }}</span>
              <span v-if="authValues[item.name]" class="scheme-on">已配置</span>
            </div>
            <div v-if="item.scheme.description" class="scheme-desc">{{ item.scheme.description }}</div>
            <template v-if="isBasic(item)">
              <el-input v-model="basicUsers[item.name]" placeholder="用户名" class="scheme-input" @change="saveAuth(item)" />
              <el-input v-model="basicPasswords[item.name]" type="password" show-password placeholder="密码" class="scheme-input" @change="saveAuth(item)" />
            </template>
            <el-input
              v-else
              v-model="authValuesDraft[item.name]"
              :type="isSecret(item) ? 'password' : 'text'"
              :show-password="isSecret(item)"
              :placeholder="placeholder(item)"
              class="scheme-input"
              clearable
              @change="saveAuth(item)"
            />
          </div>
        </div>

        <!-- 高级设置：获取段的自定义面板，展开后滚动到可见位置 -->
        <div v-if="primaryItem && authMode === 'fetch'" v-show="tfAdvOpen[tfItem.name]" ref="advPanelRef" class="tf-panel">
          <p class="tf-adv-tip">配置由 OpenAPI 文档自动推导，与实际接口不符时可在此调整。</p>
          <div class="tf-grid">
            <label class="tf-label">令牌端点</label>
            <el-input class="cfg-span" v-model="tfConfig(tfItem).endpoint" placeholder="如 /login 或 /oauth/token" @change="persistTf(tfItem)" />
            <label class="tf-label">请求方式</label>
            <el-select v-model="tfConfig(tfItem).method" @change="persistTf(tfItem)">
              <el-option label="POST" value="POST" />
              <el-option label="GET" value="GET" />
            </el-select>
            <label class="tf-label">Content-Type</label>
            <el-select v-model="tfConfig(tfItem).contentType" @change="persistTf(tfItem)">
              <el-option label="application/json" value="json" />
              <el-option label="x-www-form-urlencoded" value="form" />
            </el-select>
            <label class="tf-label">令牌字段路径</label>
            <el-input class="cfg-span" v-model="tfConfig(tfItem).tokenPath" placeholder="如 data.access_token，留空自动识别" @change="persistTf(tfItem)" />
          </div>
          <div class="tf-params">
            <div class="tf-params-head">
              <span class="tf-params-label">附加参数</span>
              <button class="gs-add-btn sm" @click="addParam(tfItem)">
                <el-icon><Plus /></el-icon>添加参数
              </button>
            </div>
            <div v-for="(p, i) in extraParams(tfItem)" :key="i" class="tf-prow">
              <el-input v-model="p.key" placeholder="参数名" @input="persistTf(tfItem)" />
              <el-input
                v-model="p.value"
                :type="isSecretParam(p.key) ? 'password' : 'text'"
                :show-password="isSecretParam(p.key)"
                :placeholder="paramPlaceholder(p.key)"
                @input="persistTf(tfItem)"
              />
              <button class="ad-icon-btn" title="移除参数" aria-label="移除参数" @click="removeParam(tfItem, p)">
                <el-icon><Delete /></el-icon>
              </button>
            </div>
          </div>
          <div class="tf-foot">
            <button class="gs-link" @click="resetTf(tfItem)"><el-icon><RefreshLeft /></el-icon>恢复默认</button>
          </div>
        </div>

        <div class="gs-pane-foot">
          <button class="gs-link danger" @click="clearAuth"><el-icon><Delete /></el-icon>清除全部授权</button>
        </div>
      </template>
    </div>

    <!-- 全局请求头 -->
    <div v-show="tab === 'headers'" class="gs-pane">
      <p class="gs-tip">对所有接口生效，可单条启用/停用；Authorization 等凭据请在「授权」页配置。</p>
      <div class="hdr-table">
        <div v-if="customHeaders.length" class="hdr-row hdr-head">
          <span class="hdr-col-on">启用</span>
          <span class="hdr-col-key">名称</span>
          <span class="hdr-col-val">值</span>
          <span class="hdr-col-act"></span>
        </div>
        <div v-if="!customHeaders.length" class="gs-empty small">
          <span>暂无全局请求头，在下方添加横切头（如 X-Tenant-Id）。</span>
        </div>
        <div v-for="(h, i) in customHeaders" :key="i" class="hdr-row">
          <span class="hdr-col-on">
            <el-checkbox :model-value="h.enabled" @change="(v: any) => updateHeader(i, { enabled: !!v })" />
          </span>
          <span class="hdr-col-key">
            <el-input :model-value="h.key" placeholder="Header 名称" @input="(v: string) => updateHeader(i, { key: v })" />
          </span>
          <span class="hdr-col-val">
            <el-input :model-value="h.value" placeholder="Header 值" @input="(v: string) => updateHeader(i, { value: v })" />
          </span>
          <span class="hdr-col-act">
            <button class="ad-icon-btn" title="删除" aria-label="删除请求头" @click="removeHeader(i)"><el-icon><Delete /></el-icon></button>
          </span>
        </div>
        <div class="hdr-row hdr-add">
          <span class="hdr-col-on"></span>
          <span class="hdr-col-key">
            <el-input v-model="newKey" placeholder="如 X-Tenant-Id" @keyup.enter="submitHeader" />
          </span>
          <span class="hdr-col-val">
            <el-input v-model="newValue" placeholder="如 1001" @keyup.enter="submitHeader" />
          </span>
          <span class="hdr-col-act">
            <button class="gs-add-btn" :disabled="!newKey.trim()" @click="submitHeader"><el-icon><Plus /></el-icon>添加</button>
          </span>
        </div>
      </div>
      <div v-if="customHeaders.length" class="gs-pane-foot">
        <button class="gs-link danger" @click="clearAllHeaders"><el-icon><Delete /></el-icon>清空全部</button>
      </div>
    </div>

    <!-- 基础设置 -->
    <div v-show="tab === 'base'" class="gs-pane">
      <div class="base-grid">
        <div class="base-field">
          <label class="base-label">全局 Base URL</label>
          <p class="base-hint">覆盖文档 servers[0]；留空使用文档声明或当前站点。</p>
          <el-input v-model="baseDraft" placeholder="例如 http://localhost:8000" clearable @change="saveBase" @clear="saveBase">
            <template #prefix><el-icon><Link /></el-icon></template>
          </el-input>
        </div>
        <div class="base-field">
          <label class="base-label">外观主题</label>
          <div class="theme-seg">
            <button :class="{ active: theme === 'light' }" @click="setTheme('light')"><el-icon><Sunny /></el-icon>亮色</button>
            <button :class="{ active: theme === 'dark' }" @click="setTheme('dark')"><el-icon><Moon /></el-icon>暗色</button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" @click="visible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 弹窗限高，内容区滚动（滚动条走全站自绘样式） */
:global(.gs-dialog) { max-height: 86vh; display: flex; flex-direction: column; }
:global(.gs-dialog .el-dialog__body) { max-height: 64vh; overflow-y: auto; }

/* 授权段切换：一键获取 / 手动填写 */
.auth-seg { display: inline-flex; gap: 3px; padding: 3px; margin-bottom: 12px; background: var(--ad-bg-subtle); border-radius: var(--ad-radius); }
.auth-seg button { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 14px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: background var(--ad-duration), color var(--ad-duration); }
.auth-seg button:hover { color: var(--ad-text); }
.auth-seg button.active { color: var(--ad-primary); background: var(--ad-bg); box-shadow: var(--ad-shadow-sm); font-weight: 600; }

.gs-tabs { display: flex; gap: 4px; padding: 3px; background: var(--ad-bg-subtle); border-radius: var(--ad-radius); margin-bottom: 16px; }
.gs-tabs button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: background var(--ad-duration), color var(--ad-duration); }
.gs-tabs button:hover { color: var(--ad-text); }
.gs-tabs button.active { color: var(--ad-primary); background: var(--ad-bg); box-shadow: var(--ad-shadow-sm); font-weight: 600; }
.gs-tab-n { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ad-on-primary); background: var(--ad-primary); border-radius: var(--ad-radius-pill); padding: 0 6px; line-height: 15px; }
.gs-pane { min-height: 160px; }
.gs-tip { margin: 0 0 8px; font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text-tertiary); }
.gs-remember { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.gs-empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 36px 0; font-size: var(--ad-fs-secondary); color: var(--ad-text-tertiary); }
.gs-empty.small { padding: 20px 0; }
.gs-pane-foot { display: flex; justify-content: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ad-border-soft); }
.gs-link { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
.gs-link:hover { background: var(--ad-hover); }
.gs-link.danger { color: var(--ad-danger-text); }
.gs-link.danger:hover { background: var(--ad-danger-bg); }

/* 授权：手动填写段紧凑行 */
.scheme { padding: 12px 0; border-bottom: 1px solid var(--ad-border-soft); }
.scheme:last-of-type { border-bottom: none; }
.scheme-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.scheme-name { font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); }
.scheme-loc { font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); font-family: var(--ad-font-mono); }
.scheme-on { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--ad-success-text); background: var(--ad-success-bg); border-radius: var(--ad-radius-pill); padding: 1px 8px; }
.scheme-desc { font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); margin-bottom: 8px; line-height: 1.6; }
.scheme-desc code { font-family: var(--ad-font-mono); font-size: 11px; color: var(--ad-text-secondary); background: var(--ad-bg-subtle); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius-sm); padding: 0 4px; }
.scheme-input { margin-bottom: 8px; }
.scheme-input:last-child { margin-bottom: 0; }

/* 一键获取令牌：主流程 */
.tf-note { margin: 0 0 10px; font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); line-height: 1.6; }
.tf-cred { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.tf-cred .el-input.is-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--ad-danger) inset; }
/* 获取令牌 = 品牌时刻：渐变 + 品牌投影 + hover 上浮 1px */
.tf-submit { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 36px; margin-top: 2px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-on-primary); background: var(--ad-primary-grad); border: none; border-radius: var(--ad-radius); cursor: pointer; box-shadow: var(--ad-brand-shadow); transition: box-shadow var(--ad-duration), transform var(--ad-duration), opacity var(--ad-duration); }
.tf-submit:hover { box-shadow: var(--ad-brand-shadow-hover); transform: translateY(-1px); }
.tf-submit:active { transform: translateY(0); }
.tf-submit:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; transform: none; }
.tf-submit .spin { animation: tf-spin 0.9s linear infinite; }
@keyframes tf-spin { to { transform: rotate(360deg); } }
.tf-status { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; font-size: var(--ad-fs-aux); line-height: 1.6; }
.tf-status .el-icon { margin-top: 2px; flex-shrink: 0; }
.tf-status.is-success { color: var(--ad-success-text); }
.tf-status.is-error { color: var(--ad-danger-text); }
.tf-adv-bar { display: flex; justify-content: flex-end; gap: 2px; margin-top: 6px; }
.tf-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.tf-toggle:hover { color: var(--ad-primary); background: var(--ad-hover); }
.tf-toggle .chev { transition: transform var(--ad-duration); }
.tf-toggle .chev.open { transform: rotate(180deg); }

/* 验证码入口：虚线边框 + 主色浅底，明确是可点按钮而非提示文本 */
.tf-captcha-entry { display: flex; align-items: center; gap: 8px; margin: -2px 0 10px; }
.tf-captcha-entry span { font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.tf-captcha-toggle { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-primary); background: var(--ad-primary-soft); border: 1px dashed color-mix(in srgb, var(--ad-primary) 50%, transparent); border-radius: var(--ad-radius); cursor: pointer; transition: background var(--ad-duration), border-color var(--ad-duration); }
.tf-captcha-toggle:hover { background: color-mix(in srgb, var(--ad-primary) 16%, transparent); border-color: var(--ad-primary); }

/* 验证码行 */
.tf-captcha-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tf-captcha-img { width: 120px; height: 40px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 0; background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius); cursor: pointer; overflow: hidden; transition: border-color var(--ad-duration); }
.tf-captcha-img:hover { border-color: var(--ad-primary); }
.tf-captcha-img:disabled { cursor: wait; }
.tf-captcha-img img { width: 100%; height: 100%; object-fit: contain; }
.tf-captcha-img .spin { animation: tf-spin 0.9s linear infinite; color: var(--ad-text-tertiary); }
.tf-captcha-empty { font-size: 11px; color: var(--ad-text-tertiary); padding: 0 4px; }
.tf-captcha-code { flex: 1; min-width: 0; }
.tf-captcha-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; font-size: var(--ad-fs-aux); line-height: 1.5; color: var(--ad-danger-text); }
/* 验证码接口配置：内联面板，仅在加载失败或点行内设置图标时出现 */
.tf-captcha-cfg { margin-bottom: 8px; padding: 10px; background: var(--ad-bg-subtle); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); }

/* 高级设置 */
.tf-panel { margin-top: 12px; padding: 12px; background: var(--ad-bg-subtle); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); }
.tf-adv-tip { margin: 0 0 10px; font-size: var(--ad-fs-aux); line-height: 1.6; color: var(--ad-text-tertiary); }
.tf-grid { display: grid; grid-template-columns: 88px 1fr 88px 1fr; gap: 8px 10px; align-items: center; }
.tf-grid .cfg-span { grid-column: 2 / -1; }
.tf-label { font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-secondary); }
.tf-params { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--ad-border-soft); display: flex; flex-direction: column; gap: 6px; }
.tf-params-head { display: flex; align-items: center; justify-content: space-between; }
.tf-params-label { font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-tertiary); }
.tf-prow { display: flex; align-items: center; gap: 6px; }
.tf-prow .el-input:first-child { width: 160px; flex-shrink: 0; }
.tf-prow .el-input:nth-child(2) { flex: 1; }
.tf-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 10px; }
.gs-add-btn { display: inline-flex; align-items: center; gap: 3px; height: 32px; padding: 0 10px; font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-primary); background: var(--ad-primary-soft); border: none; border-radius: var(--ad-radius); cursor: pointer; transition: background var(--ad-duration); }
.gs-add-btn.sm { height: 24px; padding: 0 8px; font-size: 11px; gap: 2px; }
.gs-add-btn:hover { background: var(--ad-primary-soft-2); }
.gs-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 请求头表格 */
.hdr-table { display: flex; flex-direction: column; gap: 6px; }
.hdr-row { display: flex; align-items: center; gap: 8px; }
.hdr-head { font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-tertiary); padding: 0 2px 2px; }
.hdr-col-on { width: 40px; flex-shrink: 0; display: flex; justify-content: center; }
.hdr-col-key { width: 200px; flex-shrink: 0; }
.hdr-col-val { flex: 1; min-width: 0; }
.hdr-col-act { width: 64px; flex-shrink: 0; display: flex; justify-content: flex-end; }
.hdr-add { margin-top: 4px; padding-top: 10px; border-top: 1px dashed var(--ad-border-soft); }

/* 基础设置 */
.base-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.base-field { padding: 6px 0 18px; }
.base-field:last-child { padding-bottom: 0; }
.base-label { display: block; font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); margin-bottom: 5px; }
.base-hint { margin: 0 0 10px; font-size: var(--ad-fs-aux); line-height: 1.6; color: var(--ad-text-tertiary); }
.theme-seg { display: inline-flex; gap: 3px; padding: 3px; background: var(--ad-bg-subtle); border-radius: var(--ad-radius); }
.theme-seg button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 18px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: background var(--ad-duration), color var(--ad-duration); }
.theme-seg button.active { color: var(--ad-primary); background: var(--ad-bg); box-shadow: var(--ad-shadow-sm); font-weight: 600; }
</style>