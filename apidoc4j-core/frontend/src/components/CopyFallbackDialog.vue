<script setup lang="ts">
/**
 * 手动复制兜底弹窗：宿主环境禁止写入剪贴板时，
 * 展示已全选的文本供用户 Ctrl+C / ⌘C 复制。
 */
import { nextTick, ref, watch } from "vue";
import { fallbackVisible, fallbackText } from "../utils/copy";

const taRef = ref<HTMLTextAreaElement>();

watch(fallbackVisible, async (visible) => {
  if (visible) {
    await nextTick();
    taRef.value?.focus();
    taRef.value?.select();
  }
});
</script>

<template>
  <el-dialog v-model="fallbackVisible" title="手动复制" width="640px" top="10vh" append-to-body class="cf-dialog">
    <p class="cf-tip">
      当前环境禁止网页写入剪贴板。文本已全选，请按 <kbd>Ctrl</kbd>+<kbd>C</kbd>（macOS <kbd>⌘</kbd>+<kbd>C</kbd>）完成复制。
    </p>
    <textarea ref="taRef" class="cf-area" readonly :value="fallbackText" @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
    <template #footer>
      <el-button type="primary" @click="fallbackVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cf-tip { margin: 0 0 12px; font-size: var(--ad-fs-secondary); line-height: 1.7; color: var(--ad-text-secondary); }
.cf-tip kbd { display: inline-block; padding: 0 5px; font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-secondary); background: var(--ad-bg-subtle); border: 1px solid var(--ad-border-strong); border-bottom-width: 2px; border-radius: var(--ad-radius-sm); }
.cf-area { display: block; width: 100%; height: 280px; padding: 14px 16px; box-sizing: border-box; background: var(--ad-bg-code); color: var(--ad-text); border: 1px solid var(--ad-border-soft); border-radius: var(--ad-radius); font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); line-height: 1.7; resize: vertical; outline: none; transition: border-color var(--ad-duration), box-shadow var(--ad-duration); }
.cf-area:focus { border-color: var(--ad-primary); box-shadow: 0 0 0 1px var(--ad-primary) inset, 0 0 0 3px var(--ad-primary-soft) inset; }
</style>