<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch, defineAsyncComponent } from "vue";
import type { OpenAPIDocument, Operation } from "./types/openapi";
import { fetchOpenApiDoc, fetchServiceDoc } from "./api/openapi";
import axios from "axios";
import { ElMessageBox } from "element-plus";
import ApiEndpoint from "./components/ApiEndpoint.vue";
import BrandLogo from "./components/BrandLogo.vue";
import CopyFallbackDialog from "./components/CopyFallbackDialog.vue";
import { authValues } from "./stores/auth";
import { activeHeaderCount } from "./stores/headers";
import { theme, toggleTheme } from "./stores/ui";
import { buildApiGroups, HTTP_METHODS, type ApiItem } from "./utils/api-grouping";
import { escapeHtml } from "./utils/json-highlight";
import { trapTabKey } from "./utils/focus-trap";
import { debugHistory, clearDebugHistory } from "./stores/debug-history";

const GlobalSettings = defineAsyncComponent(() => import("./components/GlobalSettings.vue"));
const OpenApiDialog = defineAsyncComponent(() => import("./components/OpenApiDialog.vue"));

/* ===================== 状态 ===================== */

const loading = ref(true);
const error = ref("");
const doc = ref<OpenAPIDocument | null>(null);
const keyword = ref("");
const protocolWarning = ref("");

// 网关服务列表
const gatewayServices = ref<string[]>([]);
const selectedService = ref<string>("");
const isGatewayMode = ref(false);

// 移动端侧栏抽屉
const mobileNav = ref(false);

/* ===================== 侧栏宽度 ===================== */

const SIDEBAR_WIDTH_KEY = "apidoc4j-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 296;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 480;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function loadSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

const sidebarWidth = ref(loadSidebarWidth());
const sidebarResizing = ref(false);
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = 0;

function persistSidebarWidth() {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
  } catch {
    // 忽略写入失败
  }
}

function stopSidebarResize() {
  sidebarResizing.value = false;
  window.removeEventListener("pointermove", onSidebarResizeMove);
  window.removeEventListener("pointerup", onSidebarResizeEnd);
  window.removeEventListener("pointercancel", onSidebarResizeEnd);
}

function onSidebarResizeStart(event: PointerEvent) {
  if (event.button !== 0 || sidebarResizing.value) return;
  sidebarResizeStartX = event.clientX;
  sidebarResizeStartWidth = sidebarWidth.value;
  sidebarResizing.value = true;
  window.addEventListener("pointermove", onSidebarResizeMove);
  window.addEventListener("pointerup", onSidebarResizeEnd);
  window.addEventListener("pointercancel", onSidebarResizeEnd);
  event.preventDefault();
}

function onSidebarResizeMove(event: PointerEvent) {
  sidebarWidth.value = clampSidebarWidth(sidebarResizeStartWidth + event.clientX - sidebarResizeStartX);
}

function onSidebarResizeEnd() {
  if (!sidebarResizing.value) return;
  stopSidebarResize();
  persistSidebarWidth();
}

function onSidebarResizeKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 32 : 16;
  let next = sidebarWidth.value;
  if (event.key === "ArrowLeft") next -= step;
  else if (event.key === "ArrowRight") next += step;
  else if (event.key === "Home") next = SIDEBAR_MIN_WIDTH;
  else if (event.key === "End") next = SIDEBAR_MAX_WIDTH;
  else return;

  event.preventDefault();
  sidebarWidth.value = clampSidebarWidth(next);
  persistSidebarWidth();
}

function resetSidebarWidth() {
  sidebarWidth.value = SIDEBAR_DEFAULT_WIDTH;
  persistSidebarWidth();
}

/* ===================== 接口选择 ===================== */

type SelectedApi = ApiItem;
const selectedApi = ref<SelectedApi | null>(null);
const mainRef = ref<HTMLElement>();

type SettingsTab = "auth" | "headers" | "base";
interface SettingsDialogHandle {
  open: (tab: SettingsTab) => void;
}

const securitySchemes = computed(() => doc.value?.components?.securitySchemes || {});
const hasAnyAuth = computed(() => Object.keys(authValues.value).length > 0);
const settingsRef = ref<SettingsDialogHandle>();
const settingsMounted = ref(false);
const pendingSettingsTab = ref<SettingsTab | null>(null);
const oasVersion = computed(() => doc.value?.openapi || "");

// 顶栏设置徽标：已配置授权数 + 启用请求头数
const settingsBadge = computed(() => Object.keys(authValues.value).length + activeHeaderCount.value);

function openSettings(tab: SettingsTab = "auth") {
  if (settingsRef.value) {
    settingsRef.value.open(tab);
    return;
  }
  pendingSettingsTab.value = tab;
  settingsMounted.value = true;
}

watch(
  settingsRef,
  (dialog) => {
    if (!dialog || !pendingSettingsTab.value) return;
    dialog.open(pendingSettingsTab.value);
    pendingSettingsTab.value = null;
  },
  { flush: "post" }
);

/* ===================== 搜索快捷键 ===================== */

const searchInputRef = ref();
function onGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (e.key === "Escape" && recentOpen.value && !target.closest(".el-overlay")) {
    e.preventDefault();
    closeRecent();
    return;
  }
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const editing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  // 弹窗内的按键优先交给弹窗，避免焦点跳到被遮挡的侧栏搜索框
  const inOverlay = !!target.closest(".el-overlay, .el-drawer, [role='dialog']");
  if (!editing && !inOverlay) {
    e.preventDefault();
    searchInputRef.value?.focus();
  }
}

/* ===================== 分组折叠记忆 ===================== */

const COLLAPSE_KEY = "apidoc4j-collapsed-tags";
const SUBGROUP_COLLAPSE_KEY = "apidoc4j-collapsed-subgroups";

function loadCollapsedSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

const collapsedTags = ref<Set<string>>(loadCollapsedSet(COLLAPSE_KEY));
const collapsedSubgroups = ref<Set<string>>(loadCollapsedSet(SUBGROUP_COLLAPSE_KEY));

function subgroupStateKey(tag: string, subgroup: string): string {
  return `${tag}::${subgroup}`;
}
function isTagCollapsed(tag: string): boolean {
  return !keyword.value.trim() && collapsedTags.value.has(tag);
}
function isSubgroupCollapsed(tag: string, subgroup: string): boolean {
  return !keyword.value.trim() && collapsedSubgroups.value.has(subgroupStateKey(tag, subgroup));
}
/**
 * 折叠状态写回 localStorage
 */
function persistCollapsedTags() {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedTags.value]));
  } catch {
    // 忽略写入失败
  }
}
function persistCollapsedSubgroups() {
  try {
    localStorage.setItem(SUBGROUP_COLLAPSE_KEY, JSON.stringify([...collapsedSubgroups.value]));
  } catch {
    // 忽略写入失败
  }
}

function toggleTag(tag: string) {
  if (collapsedTags.value.has(tag)) collapsedTags.value.delete(tag);
  else collapsedTags.value.add(tag);
  persistCollapsedTags();
}
function toggleSubgroup(tag: string, subgroup: string) {
  const key = subgroupStateKey(tag, subgroup);
  if (collapsedSubgroups.value.has(key)) collapsedSubgroups.value.delete(key);
  else collapsedSubgroups.value.add(key);
  persistCollapsedSubgroups();
}

/**
 * 首次进入全部分组折叠，避免接口多时首屏被菜单铺满
 */
function applyDefaultCollapse() {
  const INITIALIZED_KEY = "apidoc4j-collapse-initialized-2";
  try {
    if (localStorage.getItem(INITIALIZED_KEY)) return;
  } catch {
    return;
  }
  collapsedTags.value = new Set(groupedApis.value.map((group) => group.tag));
  persistCollapsedTags();
  try {
    localStorage.setItem(INITIALIZED_KEY, "1");
  } catch {
    // 忽略写入失败
  }
}

function expandAllGroups() {
  collapsedTags.value = new Set();
  persistCollapsedTags();
}

function collapseAllGroups() {
  collapsedTags.value = new Set(groupedApis.value.map((group) => group.tag));
  persistCollapsedTags();
}

function toggleAllGroups() {
  if (allGroupsCollapsed.value) expandAllGroups();
  else collapseAllGroups();
}

/* ===================== 接口总数 ===================== */

const totalApiCount = computed(() => {
  if (!doc.value?.paths) return 0;
  let count = 0;
  for (const pathItem of Object.values(doc.value.paths)) {
    for (const m of HTTP_METHODS) if (pathItem[m]) count++;
  }
  return count;
});

/* ===================== OpenAPI JSON 查看 / 下载 ===================== */

type OpenApiCommand = "view" | "download";
interface OpenApiDialogHandle {
  open: () => void;
  download: () => void;
}

const openApiRef = ref<OpenApiDialogHandle>();
const openApiMounted = ref(false);
const pendingOpenApiCommand = ref<OpenApiCommand | null>(null);

function runOpenApiCommand(command: OpenApiCommand) {
  if (!openApiRef.value) return;
  if (command === "view") openApiRef.value.open();
  else openApiRef.value.download();
}

function onOpenApiCommand(command: string) {
  if (command !== "view" && command !== "download") return;
  if (openApiRef.value) {
    runOpenApiCommand(command);
    return;
  }
  pendingOpenApiCommand.value = command;
  openApiMounted.value = true;
}

watch(
  openApiRef,
  (dialog) => {
    if (!dialog || !pendingOpenApiCommand.value) return;
    runOpenApiCommand(pendingOpenApiCommand.value);
    pendingOpenApiCommand.value = null;
  },
  { flush: "post" }
);

/* ===================== 分组列表 ===================== */

const groupedApis = computed(() => buildApiGroups(doc.value, keyword.value));

// 全部分组是否已折叠，决定目录按钮的图标与动作
const allGroupsCollapsed = computed(() => groupedApis.value.every((group) => collapsedTags.value.has(group.tag)));

const tagDescriptions = computed(() => {
  const map: Record<string, string> = {};
  if (doc.value?.tags) {
    for (const tag of doc.value.tags) {
      const parent = tag.name.split(/\s*(?:\/|>|::)\s*/)[0]?.trim() || tag.name;
      if (!map[parent] && tag.description) map[parent] = tag.description;
    }
  }
  return map;
});

/* ===================== 访问记录：最近调试调用过的接口 ===================== */

// 调试历史按接口去重，取最近 5 个，已下线的接口自动过滤
const recentEntries = computed(() => {
  const seen = new Set<string>();
  const out: Array<{ method: string; path: string; operation: Operation }> = [];
  for (const it of debugHistory.value) {
    const key = `${it.method} ${it.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const operation = (doc.value?.paths as Record<string, Record<string, Operation>>)?.[it.path]?.[it.method.toLowerCase()];
    if (operation) out.push({ method: it.method, path: it.path, operation });
    if (out.length >= 5) break;
  }
  return out;
});

const recentOpen = ref(false);
const recentPanelRef = ref<HTMLElement>();
let recentReturnFocus: HTMLElement | null = null;

function toggleRecent() {
  if (recentOpen.value) {
    closeRecent();
    return;
  }
  recentReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  recentOpen.value = true;
  nextTick(() => recentPanelRef.value?.focus());
}

function closeRecent() {
  recentOpen.value = false;
  recentReturnFocus?.focus();
  recentReturnFocus = null;
}

function onRecentKeydown(e: KeyboardEvent) {
  trapTabKey(e, recentPanelRef.value);
}

function goRecent(it: { method: string; path: string; operation: Operation }) {
  selectApi(it.method, it.path, it.operation);
  closeRecent();
}

async function clearRecent() {
  try {
    await ElMessageBox.confirm("清空后访问记录将无法恢复，是否继续？", "清空访问记录", {
      type: "warning",
      confirmButtonText: "清空",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  recentOpen.value = false;
  recentReturnFocus = null;
  clearDebugHistory();
  nextTick(() => searchInputRef.value?.focus());
}

/* ===================== 深链：hash 记录当前接口，刷新/分享不丢 ===================== */

/**
 * 选中接口写入 hash，返回首页时清除
 */
function syncHash(method?: string, path?: string) {
  const hash = method && path ? `#m=${method.toUpperCase()}&p=${encodeURIComponent(path)}` : "";
  history.replaceState(null, "", location.pathname + location.search + hash);
}

/**
 * 文档加载后从 hash 恢复选中接口；接口已不存在时静默忽略
 */
function applyHash() {
  if (!location.hash.startsWith("#m=")) return;
  const q = new URLSearchParams(location.hash.slice(1));
  const method = (q.get("m") || "").toLowerCase();
  const path = q.get("p") || "";
  if (!method || !path) return;
  const operation = (doc.value?.paths as Record<string, Record<string, Operation>>)?.[path]?.[method];
  if (operation) selectApi(method, path, operation);
}

/* ===================== 搜索命中高亮 ===================== */

/**
 * 按关键词标记首个命中片段，其余文本保持转义
 */
function highlightMatch(text: string): string {
  const kw = keyword.value.trim();
  if (!kw) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
  if (idx < 0) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, idx)) +
    "<mark>" + escapeHtml(text.slice(idx, idx + kw.length)) + "</mark>" +
    escapeHtml(text.slice(idx + kw.length))
  );
}

function highlightSummary(api: ApiItem): string {
  return highlightMatch(api.operation.summary || api.path);
}

/* ===================== 选择 / 导航 ===================== */

function revealActiveApi() {
  if (window.innerWidth <= 900) return;
  nextTick(() => {
    document.querySelector<HTMLElement>(".api-groups .api-item.active")?.scrollIntoView({ block: "nearest" });
  });
}

function selectApi(method: string, path: string, operation: Operation) {
  selectedApi.value = { method, path, operation };
  // 展开当前接口所在的分组与二级分组，避免选中后目录里看不到
  const group = groupedApis.value.find((item) => item.apis.some((api) => api.path === path && api.method === method));
  if (group) {
    collapsedTags.value.delete(group.tag);
    persistCollapsedTags();
    for (const entry of group.entries) {
      if (entry.kind === "subgroup" && entry.apis.some((api) => api.path === path && api.method === method)) {
        collapsedSubgroups.value.delete(subgroupStateKey(group.tag, entry.name));
      }
    }
    persistCollapsedSubgroups();
  }
  mainRef.value?.scrollTo({ top: 0 });
  syncHash(method, path);
  revealActiveApi();
  if (window.innerWidth <= 900) mobileNav.value = false;
}

function selectFirstInGroup(tag: string) {
  const group = groupedApis.value.find((item) => item.tag === tag);
  const first = group?.apis[0];
  if (!group || !first) return;
  collapsedTags.value.delete(tag);
  for (const entry of group.entries) {
    if (entry.kind === "subgroup" && entry.apis.includes(first)) {
      collapsedSubgroups.value.delete(subgroupStateKey(tag, entry.name));
    }
  }
  selectApi(first.method, first.path, first.operation);
}

function isActiveApi(api: SelectedApi): boolean {
  return selectedApi.value?.method === api.method && selectedApi.value?.path === api.path;
}

function goHome() {
  selectedApi.value = null;
  syncHash();
  mainRef.value?.scrollTo({ top: 0 });
  if (window.innerWidth <= 900) mobileNav.value = false;
}

/* ===================== 加载文档 ===================== */

interface SwaggerConfig {
  urls?: Array<{ name?: string }>;
}

// 快速切换网关服务时，只接受最后一次请求的结果
let docLoadSequence = 0;

async function loadDoc() {
  const sequence = ++docLoadSequence;
  loading.value = true;
  error.value = "";
  protocolWarning.value = "";
  try {
    const result =
      isGatewayMode.value && selectedService.value
        ? await fetchServiceDoc(selectedService.value)
        : await fetchOpenApiDoc();
    if (sequence !== docLoadSequence) return;
    doc.value = result.doc;
    protocolWarning.value = result.warning;
    applyDefaultCollapse();
    applyHash();
  } catch (e: unknown) {
    if (sequence !== docLoadSequence) return;
    error.value = e instanceof Error ? e.message : "获取文档失败";
  } finally {
    if (sequence === docLoadSequence) loading.value = false;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onGlobalKeydown);
  try {
    const res = await axios.get<SwaggerConfig>("/v3/api-docs/swagger-config");
    const services = (res.data.urls ?? [])
      .map((item) => (typeof item.name === "string" ? item.name.trim() : ""))
      .filter((name) => !!name);
    if (services.length) {
      isGatewayMode.value = true;
      gatewayServices.value = services;
      selectedService.value = services[0];
      return;
    }
  } catch {
    // swagger-config 不存在 → 单体模式
  }
  await loadDoc();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  stopSidebarResize();
});

watch(selectedService, () => {
  if (isGatewayMode.value) {
    selectedApi.value = null;
    loadDoc();
  }
});
</script>

<template>
  <div class="app-shell" :class="{ 'is-resizing': sidebarResizing }">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <button
          class="nav-toggle ad-icon-btn"
          title="目录"
          :aria-label="mobileNav ? '关闭目录' : '打开目录'"
          :aria-expanded="mobileNav"
          @click="mobileNav = !mobileNav"
        >
          <el-icon><Fold v-if="mobileNav" /><Expand v-else /></el-icon>
        </button>
        <button class="brand" title="返回首页" @click="goHome">
          <BrandLogo :logo="doc?.info?.['x-logo']" />
          <!-- 首屏文档未返回：标题与副标题位置用骨架占位，不显示兜底名 -->
          <span v-if="loading && !doc" class="brand-placeholder" aria-hidden="true">
            <span class="brand-placeholder-line brand-placeholder-name"></span>
            <span class="brand-placeholder-line brand-placeholder-sub"></span>
          </span>
          <span v-else class="brand-text">
            <span class="brand-name">{{ doc?.info?.title || "ApiDoc4j" }}</span>
            <span class="brand-sub">
              <template v-if="oasVersion">OpenAPI {{ oasVersion }}</template>
              <template v-if="doc?.info?.version"> · v{{ doc.info.version }}</template>
            </span>
          </span>
        </button>
      </div>
      <div class="topbar-right">
        <el-tooltip content="重新加载文档" placement="bottom">
          <button class="ad-icon-btn" aria-label="重新加载文档" :disabled="loading" @click="loadDoc">
            <el-icon><Refresh /></el-icon>
          </button>
        </el-tooltip>
        <el-tooltip :content="theme === 'dark' ? '切换亮色' : '切换暗色'" placement="bottom">
          <button class="ad-icon-btn" :aria-label="theme === 'dark' ? '切换亮色主题' : '切换暗色主题'" @click="toggleTheme">
            <el-icon><Sunny v-if="theme === 'dark'" /><Moon v-else /></el-icon>
          </button>
        </el-tooltip>
        <el-dropdown trigger="click" @command="onOpenApiCommand">
          <button class="openapi-btn" :disabled="!doc" title="查看或下载当前文档的 OpenAPI JSON">
            <el-icon><Document /></el-icon>
            <span class="openapi-label">OpenAPI JSON</span>
            <el-icon class="openapi-caret"><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="view"><el-icon><View /></el-icon>查看 JSON</el-dropdown-item>
              <el-dropdown-item command="download"><el-icon><Download /></el-icon>下载 JSON</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="settings-btn" @click="openSettings()">
          <el-icon><Setting /></el-icon>
          <span class="settings-label">全局设置</span>
          <span v-if="settingsBadge" class="settings-badge">{{ settingsBadge }}</span>
        </button>
      </div>
    </header>

    <div class="app-body" v-loading="loading">
      <!-- 移动端遮罩 -->
      <div v-if="mobileNav" class="nav-scrim" @click="mobileNav = false"></div>

      <!-- 侧栏 -->
      <aside
        class="sidebar"
        :class="{ 'is-open': mobileNav }"
        :style="{ '--sidebar-width': `${sidebarWidth}px` }"
      >
        <div
          class="sidebar-resizer"
          role="separator"
          aria-label="调整接口目录宽度"
          aria-orientation="vertical"
          :aria-valuemin="SIDEBAR_MIN_WIDTH"
          :aria-valuemax="SIDEBAR_MAX_WIDTH"
          :aria-valuenow="sidebarWidth"
          title="拖动调整宽度，双击恢复默认"
          tabindex="0"
          @pointerdown="onSidebarResizeStart"
          @dblclick="resetSidebarWidth"
          @keydown="onSidebarResizeKeydown"
        />
        <div class="sidebar-search">
          <el-input
            ref="searchInputRef"
            v-model="keyword"
            placeholder="搜索接口名称、路径"
            aria-label="搜索接口名称、路径"
            aria-keyshortcuts="/"
            clearable
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-tooltip
            v-if="groupedApis.length"
            :content="allGroupsCollapsed ? '展开全部' : '折叠全部'"
            placement="top"
            :show-after="400"
          >
            <el-button
              class="nav-toggle-all"
              :aria-label="allGroupsCollapsed ? '展开全部' : '折叠全部'"
              @click="toggleAllGroups"
            >
              <svg class="nav-toggle-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  v-if="allGroupsCollapsed"
                  d="M4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3ZM5 5V19H19V5H5ZM11 11V7H13V11H17V13H13V17H11V13H7V11H11Z"
                />
                <path
                  v-else
                  d="M4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3ZM5 5V19H19V5H5ZM7 11H17V13H7V11Z"
                />
              </svg>
            </el-button>
          </el-tooltip>
        </div>
        <div v-if="isGatewayMode && gatewayServices.length > 1" class="service-row">
          <el-select v-model="selectedService" class="service-select">
            <el-option v-for="svc in gatewayServices" :key="svc" :label="svc" :value="svc" />
          </el-select>
        </div>

        <nav class="api-groups" aria-label="接口目录">
          <section v-for="group in groupedApis" :key="group.tag" class="api-group">
            <button class="group-header" :aria-expanded="!isTagCollapsed(group.tag)" @click="toggleTag(group.tag)">
              <el-icon class="collapse-icon" :class="{ collapsed: isTagCollapsed(group.tag) }"><ArrowDown /></el-icon>
              <span class="group-index">{{ group.index }}</span>
              <span class="group-name" :title="group.name">{{ group.name }}</span>
              <span class="group-count">{{ group.apis.length }}</span>
            </button>
            <div v-show="!isTagCollapsed(group.tag)" class="group-items">
              <template
                v-for="entry in group.entries"
                :key="entry.kind === 'api' ? entry.api.method + entry.api.path : 'subgroup:' + entry.name"
              >
                <div v-if="entry.kind === 'subgroup'" class="subgroup">
                  <button
                    class="subgroup-header"
                    :aria-expanded="!isSubgroupCollapsed(group.tag, entry.name)"
                    @click="toggleSubgroup(group.tag, entry.name)"
                  >
                    <el-icon
                      class="subgroup-icon"
                      :class="{ collapsed: isSubgroupCollapsed(group.tag, entry.name) }"
                    ><ArrowDown /></el-icon>
                    <span class="subgroup-name" :title="entry.name">{{ entry.name }}</span>
                    <span class="subgroup-count">{{ entry.apis.length }}</span>
                  </button>
                  <div
                    v-show="!isSubgroupCollapsed(group.tag, entry.name)"
                    class="subgroup-items"
                  >
                    <button
                      v-for="api in entry.apis"
                      :key="api.method + api.path"
                      type="button"
                      class="api-item"
                      :class="{ active: isActiveApi(api) }"
                      :aria-current="isActiveApi(api) ? 'page' : undefined"
                      :title="api.path"
                      @click="selectApi(api.method, api.path, api.operation)"
                    >
                      <span class="ad-method ad-method--xs" :class="'ad-method--' + api.method.toLowerCase()">{{ api.method.toUpperCase() }}</span>
                      <span class="api-item-text">
                        <span class="api-summary" v-html="highlightSummary(api)"></span>
                        <span class="api-item-path" v-html="highlightMatch(api.path)"></span>
                      </span>
                    </button>
                  </div>
                </div>
                <button
                  v-else
                  type="button"
                  class="api-item"
                  :class="{ active: isActiveApi(entry.api) }"
                  :aria-current="isActiveApi(entry.api) ? 'page' : undefined"
                  :title="entry.api.path"
                  @click="selectApi(entry.api.method, entry.api.path, entry.api.operation)"
                >
                  <span class="ad-method ad-method--xs" :class="'ad-method--' + entry.api.method.toLowerCase()">{{ entry.api.method.toUpperCase() }}</span>
                  <span class="api-item-text">
                    <span class="api-summary" v-html="highlightSummary(entry.api)"></span>
                    <span class="api-item-path" v-html="highlightMatch(entry.api.path)"></span>
                  </span>
                </button>
              </template>
            </div>
          </section>
          <div v-if="keyword && !groupedApis.length" class="sidebar-empty">
            <span>没有匹配「{{ keyword }}」的接口</span>
            <button class="sidebar-empty-clear" @click="keyword = ''">清除搜索</button>
          </div>
        </nav>

        <div class="sidebar-bottom">
          <button class="sidebar-settings" @click="openSettings('auth')">
            <el-icon><Lock /></el-icon>
            <span class="ss-label">全局授权</span>
            <span class="ss-state" :class="{ 'is-on': hasAnyAuth }">{{ hasAnyAuth ? "已配置" : "未配置" }}</span>
          </button>
        </div>
      </aside>

      <!-- 主区 -->
      <main ref="mainRef" class="main">
        <el-alert v-if="protocolWarning" :title="protocolWarning" type="warning" show-icon :closable="false" class="protocol-alert" />
        <div v-if="error" class="error-panel">
          <el-result icon="error" title="文档加载失败" :sub-title="error">
            <template #extra><el-button type="primary" @click="loadDoc">重新加载</el-button></template>
          </el-result>
        </div>

        <div v-else-if="selectedApi" class="main-inner">
          <ApiEndpoint
            :method="selectedApi.method"
            :path="selectedApi.path"
            :operation="selectedApi.operation"
            :doc="doc!"
            @open-settings="openSettings"
          />
        </div>

        <div v-else-if="!loading && !error" class="home main-inner">
          <div class="home-hero">
            <div class="hero-glow"></div>
            <div class="hero-content">
              <span class="hero-eyebrow">API 接口文档</span>
              <h2 class="home-title">{{ doc?.info?.title || "API 接口文档" }}</h2>
              <p v-if="doc?.info?.description" class="home-desc">{{ doc.info.description }}</p>
              <div class="home-stats">
                <div class="stat"><b>{{ totalApiCount }}</b><span>接口</span></div>
                <div class="stat"><b>{{ groupedApis.length }}</b><span>分组</span></div>
                <div v-if="doc?.info?.version" class="stat"><b>{{ doc.info.version }}</b><span>版本</span></div>
                <div v-if="oasVersion" class="stat"><b>{{ oasVersion }}</b><span>OpenAPI</span></div>
              </div>
            </div>
          </div>

          <div class="home-section-title">接口分组</div>
          <div class="home-groups">
            <button
              v-for="(group, i) in groupedApis"
              :key="group.tag"
              class="home-group"
              :style="{ animationDelay: Math.min(i * 0.05, 0.3) + 's' }"
              :aria-label="`打开 ${group.name} 的第一个接口`"
              @click="selectFirstInGroup(group.tag)"
            >
              <div class="home-group-head">
                <span class="home-group-name">
                  <span v-if="group.index" class="home-group-index">{{ group.index }}</span>{{ group.name }}
                </span>
                <span class="home-group-count">{{ group.apis.length }}</span>
              </div>
              <div v-if="tagDescriptions[group.tag]" class="home-group-desc">{{ tagDescriptions[group.tag] }}</div>
              <ul class="home-group-list">
                <li v-for="api in group.apis.slice(0, 4)" :key="api.method + api.path">
                  <span class="ad-method ad-method--xs" :class="'ad-method--' + api.method.toLowerCase()">{{ api.method.toUpperCase() }}</span>
                  <span class="preview-name">{{ api.operation.summary || api.path }}</span>
                </li>
              </ul>
              <div class="home-group-more">打开第一个接口<el-icon><Right /></el-icon></div>
            </button>
          </div>
        </div>
      </main>
    </div>

    <GlobalSettings v-if="settingsMounted" ref="settingsRef" :schemes="securitySchemes" :doc="doc" />
    <OpenApiDialog v-if="openApiMounted" ref="openApiRef" :doc="doc" />
    <CopyFallbackDialog />

    <!-- 访问记录：右下角悬浮钮 + 向上弹出面板，点外部收起 -->
    <template v-if="recentEntries.length">
      <div v-if="recentOpen" class="recent-scrim" @click="closeRecent"></div>
      <div
        v-if="recentOpen"
        ref="recentPanelRef"
        class="recent-panel"
        role="dialog"
        aria-modal="true"
        aria-label="访问记录"
        tabindex="-1"
        @keydown="onRecentKeydown"
      >
        <div class="recent-panel-head">
          <span>访问记录</span>
          <button class="recent-clear" @click="clearRecent"><el-icon><Delete /></el-icon>清空</button>
        </div>
        <div class="recent-panel-list">
          <button
            v-for="it in recentEntries"
            :key="it.method + it.path"
            class="recent-row"
            :class="{ active: isActiveApi(it) }"
            :title="it.path"
            @click="goRecent(it)"
          >
            <span class="ad-method ad-method--xs" :class="'ad-method--' + it.method.toLowerCase()">{{ it.method.toUpperCase() }}</span>
            <span class="recent-row-text">
              <span class="recent-row-name">{{ it.operation.summary || it.path }}</span>
              <span class="recent-row-path">{{ it.path }}</span>
            </span>
          </button>
        </div>
      </div>
      <button class="recent-fab" title="访问记录" aria-label="访问记录" @click="toggleRecent">
        <el-icon><Tickets /></el-icon>
        <span class="fab-badge">{{ recentEntries.length }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.app-shell { height: 100vh; display: flex; flex-direction: column; background: var(--ad-bg-main); color: var(--ad-text); }
.app-shell.is-resizing { cursor: col-resize; user-select: none; }
.app-shell.is-resizing * { cursor: col-resize; }
.app-body { flex: 1; display: flex; overflow: hidden; position: relative; }

/* ===== 顶栏 ===== */
.topbar { height: var(--ad-header-h); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 16px; background: var(--ad-bg); border-bottom: 1px solid var(--ad-border-soft); z-index: 20; }
.topbar-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.topbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.nav-toggle { display: none; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 6px; background: transparent; border: none; border-radius: var(--ad-radius); cursor: pointer; transition: background var(--ad-duration); }
.brand:hover { background: var(--ad-hover); }
.openapi-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 11px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: 1px solid var(--ad-border); border-radius: var(--ad-radius); cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration), border-color var(--ad-duration); }
.openapi-btn:hover { color: var(--ad-primary); background: var(--ad-primary-soft); border-color: color-mix(in srgb, var(--ad-primary) 26%, transparent); }
.openapi-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.openapi-btn .el-icon { font-size: 14px; }
.openapi-caret { font-size: 11px !important; color: var(--ad-text-tertiary); }
/* 首屏骨架：高度与两行标题一致，文档返回后不产生上下位移 */
.brand-placeholder { display: flex; flex-direction: column; justify-content: center; gap: 6px; height: 35px; }
.brand-placeholder-line { display: block; background: var(--ad-bg-inset); border-radius: var(--ad-radius-sm); animation: brand-pulse 1.4s ease-in-out infinite; }
.brand-placeholder-name { width: 92px; height: 13px; }
.brand-placeholder-sub { width: 62px; height: 8px; border-radius: 3px; opacity: 0.7; }
@keyframes brand-pulse { 50% { opacity: 0.45; } }
.brand-text { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.brand-name { font-family: var(--ad-font-display); font-size: var(--ad-fs-card-title); font-weight: 600; color: var(--ad-text); letter-spacing: -0.01em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand-sub { font-family: var(--ad-font-mono); font-size: 11px; color: var(--ad-text-tertiary); line-height: 1.4; white-space: nowrap; }
.settings-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; font-size: var(--ad-fs-secondary); font-weight: 500; color: var(--ad-text-secondary); background: var(--ad-bg-subtle); border: 1px solid var(--ad-border); border-radius: var(--ad-radius); cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration), border-color var(--ad-duration); }
.settings-btn:hover { color: var(--ad-primary); background: var(--ad-primary-soft); border-color: color-mix(in srgb, var(--ad-primary) 26%, transparent); }
.settings-badge { font-size: 10px; font-weight: 600; color: var(--ad-on-primary); background: var(--ad-primary); border-radius: var(--ad-radius-pill); padding: 0 6px; line-height: 15px; }

/* ===== 侧栏 ===== */
.sidebar { position: relative; width: var(--sidebar-width, var(--ad-sidebar-w)); flex-shrink: 0; display: flex; flex-direction: column; background: var(--ad-bg-sidebar); border-right: 1px solid var(--ad-border-soft); overflow: visible; }
.sidebar-resizer { position: absolute; top: 0; right: -5px; bottom: 0; z-index: 15; width: 10px; cursor: col-resize; touch-action: none; }
.sidebar-resizer::after { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: transparent; border-radius: var(--ad-radius-pill); transform: translateX(-50%); transition: background var(--ad-duration); }
.sidebar-resizer:hover::after, .sidebar-resizer:focus-visible::after, .app-shell.is-resizing .sidebar-resizer::after { background: var(--ad-primary); }
.sidebar-resizer:focus-visible { outline: none; }
.sidebar-search { display: flex; align-items: center; gap: 8px; padding: 12px; }
.sidebar-search .el-input { flex: 1; min-width: 0; }
.service-row { padding: 0 12px 10px; }
.service-select { width: 100%; }
.nav-toggle-all { width: 34px; height: 34px; padding: 0; flex-shrink: 0; }
.nav-toggle-icon { width: 16px; height: 16px; }
.api-groups { flex: 1; overflow-y: auto; padding: 2px 8px 16px; }
.api-group { margin-bottom: 4px; }
.group-header { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; font-size: var(--ad-fs-aux); font-weight: 600; letter-spacing: 0.02em; color: var(--ad-text-secondary); background: var(--ad-bg-sidebar); border: none; border-radius: var(--ad-radius); cursor: pointer; user-select: none; text-align: left; transition: background var(--ad-duration), color var(--ad-duration); }
.group-header:hover { background: var(--ad-hover); color: var(--ad-text); }
.group-index { flex-shrink: 0; width: 20px; font-family: var(--ad-font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0; color: var(--ad-text-tertiary); opacity: 0.75; }
.group-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collapse-icon { font-size: 10px; color: var(--ad-text-tertiary); transition: transform var(--ad-duration); flex-shrink: 0; }
.collapse-icon.collapsed { transform: rotate(-90deg); }
.group-count { font-family: var(--ad-font-mono); font-size: 11px; font-weight: 500; color: var(--ad-text-tertiary); flex-shrink: 0; }
.group-items { padding: 0 0 4px; }
.subgroup { margin: 2px 0; }
.subgroup-header { display: flex; align-items: center; gap: 5px; width: 100%; padding: 5px 8px 5px 12px; font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-tertiary); background: transparent; border: none; border-radius: var(--ad-radius); cursor: pointer; user-select: none; text-align: left; transition: background var(--ad-duration), color var(--ad-duration); }
.subgroup-header:hover { color: var(--ad-text-secondary); background: var(--ad-hover); }
.subgroup-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subgroup-icon { font-size: 9px; flex-shrink: 0; transition: transform var(--ad-duration); }
.subgroup-icon.collapsed { transform: rotate(-90deg); }
.subgroup-count { flex-shrink: 0; font-family: var(--ad-font-mono); font-size: 10px; font-weight: 500; color: var(--ad-text-tertiary); }
.subgroup-items { margin-left: 15px; padding-left: 3px; border-left: 1px solid var(--ad-border-soft); }
.api-item { position: relative; display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 6px 8px; font: inherit; color: inherit; text-align: left; background: transparent; border: 0; border-radius: var(--ad-radius); cursor: pointer; transition: background var(--ad-duration); }
.api-item::before { content: ""; position: absolute; left: 2px; top: 6px; bottom: 6px; width: 2px; border-radius: 2px; background: transparent; transition: background var(--ad-duration); }
.api-item:hover { background: var(--ad-hover); }
.api-item.active { background: var(--ad-primary-soft); }
.api-item.active::before { background: var(--ad-primary); }
.api-item .ad-method { width: 46px; min-width: 46px; padding: 0 4px; margin-top: 1px; }
.api-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.api-summary { font-size: var(--ad-fs-secondary); font-weight: 500; line-height: 1.45; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ad-text); }
.api-item.active .api-summary { color: var(--ad-primary); font-weight: 600; }
.api-item-path { font-family: var(--ad-font-mono); font-size: 11px; line-height: 1.35; color: var(--ad-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad-method--xs { min-width: 40px; height: 18px; font-size: 10px; padding: 0 5px; }
/* 最近访问：FAB 悬浮钮 + 弹出面板，收起时仅右下角小圆钮 */
.recent-fab { position: fixed; right: 16px; bottom: 16px; z-index: 30; display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; color: var(--ad-text-secondary); background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: 50%; box-shadow: var(--ad-shadow-pop); cursor: pointer; transition: color var(--ad-duration), border-color var(--ad-duration), transform var(--ad-duration); }
.recent-fab:hover { color: var(--ad-primary); border-color: color-mix(in srgb, var(--ad-primary) 40%, transparent); transform: translateY(-1px); }
.recent-fab .el-icon { font-size: 17px; }
.fab-badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 16px; color: var(--ad-on-primary); background: var(--ad-primary); border-radius: var(--ad-radius-pill); padding: 0 4px; }
.recent-scrim { position: fixed; inset: 0; z-index: 40; background: transparent; }
.recent-panel { position: fixed; right: 16px; bottom: 64px; z-index: 41; display: flex; flex-direction: column; width: min(380px, calc(100vw - 32px)); max-height: min(420px, 60vh); background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: 12px; box-shadow: var(--ad-shadow-pop); overflow: hidden; }
.recent-panel:focus { outline: none; }
.recent-panel-head { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding: 10px 14px; border-bottom: 1px solid var(--ad-border-soft); font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-text); }
.recent-clear { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-tertiary); background: transparent; border: none; cursor: pointer; padding: 3px 8px; border-radius: 6px; transition: color var(--ad-duration), background var(--ad-duration); }
.recent-clear:hover { color: var(--ad-danger-text); background: var(--ad-danger-bg); }
.recent-panel-list { overflow-y: auto; padding: 6px; }
.recent-row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; text-align: left; background: transparent; border: none; border-radius: 8px; cursor: pointer; transition: background var(--ad-duration); }
.recent-row:hover { background: var(--ad-hover); }
.recent-row.active { background: var(--ad-primary-soft); }
.recent-row-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.recent-row-name { font-size: var(--ad-fs-secondary); color: var(--ad-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-row-path { font-family: var(--ad-font-mono); font-size: 11px; color: var(--ad-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sidebar-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 12px; text-align: center; font-size: var(--ad-fs-secondary); color: var(--ad-text-tertiary); }
.sidebar-empty-clear { font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-primary); background: transparent; border: none; cursor: pointer; padding: 3px 10px; border-radius: 6px; transition: background var(--ad-duration); }
.sidebar-empty-clear:hover { background: var(--ad-primary-soft); }
.api-summary :deep(mark), .api-item-path :deep(mark) { background: transparent; color: var(--ad-primary); font-weight: 600; }
.sidebar-bottom { flex-shrink: 0; border-top: 1px solid var(--ad-border-soft); background: var(--ad-bg-sidebar); }
.sidebar-settings { display: flex; align-items: center; gap: 7px; width: 100%; padding: 10px 16px; font-size: var(--ad-fs-secondary); color: var(--ad-text-secondary); background: transparent; border: none; cursor: pointer; text-align: left; transition: background var(--ad-duration); }
.sidebar-settings:hover { background: var(--ad-hover); }
.ss-label { flex: 1; }
.ss-state { font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); border-radius: var(--ad-radius-pill); padding: 0 8px; line-height: 18px; }
.ss-state.is-on { color: var(--ad-success-text); background: var(--ad-success-bg); }

/* ===== 主区 ===== */
.main { flex: 1; overflow-y: auto; padding: var(--ad-page-padding) var(--ad-page-padding) 64px; background: var(--ad-bg-main); }
.main-inner { max-width: 1000px; margin: 0 auto; }
.protocol-alert { margin-bottom: 16px; max-width: 1000px; margin-left: auto; margin-right: auto; }
.error-panel { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
@media (min-width: 1600px) { .main { padding: 24px 24px 64px; } }

/* ===== 首页：欢迎头卡（浅色表面 + 全站唯一纹理时刻） ===== */
.home-hero { position: relative; overflow: hidden; border-radius: var(--ad-radius-lg); padding: 24px 28px; margin-bottom: var(--ad-gap); background: var(--ad-bg); border: 1px solid var(--ad-border); box-shadow: var(--ad-shadow-sm); animation: ad-rise 0.4s var(--ad-ease) backwards; }
.home-hero::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(var(--ad-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--ad-grid-line) 1px, transparent 1px); background-size: 28px 28px; -webkit-mask-image: radial-gradient(120% 120% at 100% 0%, #000 0%, transparent 62%); mask-image: radial-gradient(120% 120% at 100% 0%, #000 0%, transparent 62%); pointer-events: none; }
.hero-glow { position: absolute; top: -80px; right: -60px; width: 300px; height: 300px; border-radius: 50%; background: radial-gradient(circle, var(--ad-hero-glow), transparent 68%); pointer-events: none; }
.hero-content { position: relative; }
.hero-eyebrow { display: inline-block; font-size: var(--ad-fs-aux); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ad-primary); margin-bottom: 10px; }
.home-title { font-family: var(--ad-font-display); font-size: 24px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.02em; line-height: 1.3; color: var(--ad-text); }
.home-desc { font-size: var(--ad-fs-secondary); line-height: 1.8; color: var(--ad-text-secondary); margin: 0 0 20px; max-width: 720px; white-space: pre-wrap; }
.home-stats { display: flex; flex-wrap: wrap; gap: 12px; }
.stat { display: flex; align-items: baseline; gap: 8px; padding: 10px 16px; background: var(--ad-bg-subtle); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); }
.stat b { font-family: var(--ad-font-display); font-size: var(--ad-fs-page-title); font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--ad-text); }
.stat span { font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.home-section-title { font-size: var(--ad-fs-card-title); font-weight: 600; color: var(--ad-text); margin-bottom: 12px; letter-spacing: -0.01em; animation: ad-rise 0.4s var(--ad-ease) 0.05s backwards; }
/* 分组卡等高：预览列表固定 4 行高度，查看全部行贴底，行内底边对齐 */
.home-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--ad-gap); }
.home-group { display: flex; flex-direction: column; background: var(--ad-bg); border: 1px solid var(--ad-border); border-radius: var(--ad-radius-lg); padding: 20px; cursor: pointer; text-align: left; box-shadow: var(--ad-shadow-sm); transition: border-color var(--ad-duration), box-shadow var(--ad-duration), transform var(--ad-duration); animation: ad-rise 0.4s var(--ad-ease) backwards; }
.home-group:hover { border-color: color-mix(in srgb, var(--ad-primary) 40%, transparent); box-shadow: var(--ad-shadow-hover); transform: translateY(-2px); }
.home-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.home-group-name { font-size: var(--ad-fs-card-title); font-weight: 600; color: var(--ad-text); letter-spacing: -0.01em; }
.home-group-index { margin-right: 6px; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-tertiary); }
.home-group-count { font-size: var(--ad-fs-aux); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ad-primary); background: var(--ad-primary-soft); border-radius: var(--ad-radius-pill); padding: 0 10px; line-height: 20px; }
.home-group-desc { font-size: var(--ad-fs-secondary); color: var(--ad-text-tertiary); margin-top: 6px; line-height: 1.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-group-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-height: calc(4 * 20px + 3 * 8px); }
.home-group-list li { display: flex; align-items: center; gap: 8px; min-width: 0; height: 20px; }
.preview-name { font-size: var(--ad-fs-secondary); color: var(--ad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-group-more { display: flex; align-items: center; gap: 3px; margin-top: auto; padding-top: 12px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-primary); }
.home-group-more .el-icon { transition: transform var(--ad-duration); }
.home-group:hover .home-group-more .el-icon { transform: translateX(2px); }

/* ===== 响应式 ===== */
.nav-scrim { display: none; }
@media (max-width: 900px) {
  .nav-toggle { display: inline-flex; }
  .sidebar { position: absolute; top: 0; bottom: 0; left: 0; z-index: 30; width: min(var(--sidebar-width, var(--ad-sidebar-w)), 84vw); transform: translateX(-100%); transition: transform 0.24s ease; box-shadow: var(--ad-shadow-pop); }
  .sidebar.is-open { transform: translateX(0); }
  .sidebar-resizer { display: none; }
  .nav-scrim { display: block; position: absolute; inset: 0; z-index: 25; background: var(--ad-scrim); }
  .main { padding: 16px 16px 56px; }
  .settings-label { display: none; }
  .settings-btn { padding: 0 9px; }
  .openapi-label { display: none; }
  .openapi-btn { padding: 0 8px; }
  .home-hero { padding: 20px; }
  .home-title { font-size: var(--ad-fs-page-title); }
}
</style>