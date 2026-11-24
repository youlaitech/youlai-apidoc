<script setup lang="ts">
/**
 * 品牌标志：优先使用 OpenAPI info.x-logo，加载失败时回退内置图标。
 */
import { computed, ref, watch } from "vue";
import type { XLogo } from "../types/openapi";
import { theme } from "../stores/ui";

const props = defineProps<{
  logo?: string | XLogo;
}>();

const normalized = computed<XLogo | null>(() => {
  const l = props.logo;
  if (typeof l === "string") return l.trim() ? { url: l.trim() } : null;
  if (l && typeof l === "object" && typeof l.url === "string" && l.url.trim()) return l;
  return null;
});

const imgFailed = ref(false);
watch(normalized, () => {
  imgFailed.value = false;
});

const imgSrc = computed(() => {
  const l = normalized.value;
  if (!l) return "";
  return theme.value === "dark" && l.darkUrl ? l.darkUrl : l.url;
});
watch(imgSrc, () => {
  imgFailed.value = false;
});

const tileStyle = computed(() =>
  normalized.value?.backgroundColor ? { background: normalized.value.backgroundColor } : undefined
);
</script>

<template>
  <span class="brand-logo" :class="{ 'has-img': normalized && !imgFailed }" :style="tileStyle">
    <img v-if="normalized && !imgFailed" :src="imgSrc" :alt="normalized.altText || 'logo'" @error="imgFailed = true" />
    <span v-else class="brand-logo-default" aria-hidden="true" />
  </span>
</template>

<style scoped>
.brand-logo { width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: var(--ad-radius); background: var(--ad-primary-grad); color: var(--ad-on-primary); box-shadow: var(--ad-brand-shadow); overflow: hidden; }
.brand-logo-default { width: 18px; height: 18px; background: currentColor; -webkit-mask: url("../assets/icons/api.svg") center / contain no-repeat; mask: url("../assets/icons/api.svg") center / contain no-repeat; }
.brand-logo.has-img { background: var(--ad-bg); box-shadow: none; border: 1px solid var(--ad-border); }
.brand-logo img { width: 100%; height: 100%; object-fit: contain; padding: 3px; box-sizing: border-box; }
</style>