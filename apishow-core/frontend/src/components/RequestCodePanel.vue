<script setup lang="ts">
/**
 * 请求代码面板：语言页签 + 代码块 + 复制
 *
 * 文档视图「请求示例」与调试抽屉「实际请求」共用，语言选择写入 localStorage
 * 供下次打开沿用
 */
import { computed, ref, watch } from "vue";
import { CODE_LANGS, generateCode, isCodeLang, type CodeLang } from "../utils/codegen";
import { copyWithFeedback as copyText } from "../utils/copy";

const props = withDefaults(
  defineProps<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    /** 复制成功提示文案 */
    copyTip?: string;
    /** 填满父容器并由代码区自身滚动（父容器需为 flex 列） */
    isFill?: boolean;
  }>(),
  {
    body: undefined,
    copyTip: "请求代码已复制",
    isFill: false,
  }
);

// 语言选择存 localStorage，旧键只用于保留用户此前选过的语言
const LANG_KEY = "apishow-code-lang-v2";
const LEGACY_LANG_KEY = "apishow-code-lang";

function loadLang(): CodeLang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (isCodeLang(saved)) return saved;
    const legacy = localStorage.getItem(LEGACY_LANG_KEY);
    if (isCodeLang(legacy)) return legacy;
  } catch {
    // ignore
  }
  return "curl";
}

const lang = ref<CodeLang>(loadLang());

watch(lang, (value) => {
  try {
    localStorage.setItem(LANG_KEY, value);
  } catch {
    // ignore
  }
});

const code = computed(() =>
  generateCode(lang.value, {
    method: props.method,
    url: props.url,
    headers: props.headers,
    body: props.body,
  })
);
</script>

<template>
  <div class="rcp" :class="{ 'is-fill': isFill }">
    <div class="rcp-bar">
      <div class="ad-tabs" role="tablist" aria-label="请求代码语言">
        <button
          v-for="item in CODE_LANGS"
          :key="item.value"
          type="button"
          role="tab"
          class="ad-tab"
          :class="{ active: lang === item.value }"
          :aria-selected="lang === item.value"
          @click="lang = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <button type="button" class="tool-btn rcp-copy" @click="copyText(code, copyTip)">
        <el-icon><CopyDocument /></el-icon>复制
      </button>
    </div>
    <pre class="rcp-code">{{ code }}</pre>
  </div>
</template>

<style scoped>
.rcp { display: flex; flex-direction: column; min-width: 0; }
.rcp.is-fill { flex: 1; min-height: 0; }

/* 页签行：左侧语言横向滚动，右侧复制固定 */
.rcp-bar { display: flex; align-items: stretch; flex-shrink: 0; padding: 0 12px; border-bottom: 1px solid var(--ad-border-soft); }
.rcp-bar .ad-tabs { flex: 1; min-width: 0; }
.rcp-copy { align-self: center; flex-shrink: 0; margin-left: 8px; }
.tool-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; font-size: var(--ad-fs-aux); font-weight: 500; color: var(--ad-text-secondary); background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: color var(--ad-duration), background var(--ad-duration); }
.tool-btn:hover { color: var(--ad-primary); background: var(--ad-hover); }

.rcp-code {
  margin: 0; padding: 14px 16px; background: var(--ad-bg-code);
  font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; color: var(--ad-text);
  white-space: pre-wrap; word-break: break-all;
  max-height: 420px; overflow: auto;
}
.rcp.is-fill .rcp-code { flex: 1; min-height: 0; max-height: none; }
</style>
