/**
 * 全局自定义请求头
 *
 * 跨所有接口共享，localStorage 持久化；支持启用/停用单条。
 * 兼容旧版 Record<string,string> 存储格式，自动迁移为条目数组。
 */
import { ref, computed } from "vue";

const STORAGE_KEY = "apidoc4j-custom-headers";

interface HeaderEntry {
  key: string;
  value: string;
  enabled: boolean;
}

function load(): HeaderEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(raw)) {
      return raw
        .filter((h) => h && typeof h.key === "string")
        .map((h) => ({ key: h.key, value: String(h.value ?? ""), enabled: h.enabled !== false }));
    }
    // 旧版对象格式迁移
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([key, value]) => ({ key, value: String(value), enabled: true }));
    }
    return [];
  } catch {
    return [];
  }
}

export const customHeaders = ref<HeaderEntry[]>(load());

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customHeaders.value));
  } catch {
    // localStorage 不可用时仅保留内存值
  }
}

export function addHeader(key: string, value: string) {
  const k = key.trim();
  if (!k) return;
  const existing = customHeaders.value.find((h) => h.key.toLowerCase() === k.toLowerCase());
  if (existing) {
    existing.value = value.trim();
    existing.enabled = true;
  } else {
    customHeaders.value.push({ key: k, value: value.trim(), enabled: true });
  }
  persist();
}

export function removeHeader(index: number) {
  customHeaders.value.splice(index, 1);
  persist();
}

export function updateHeader(index: number, patch: Partial<HeaderEntry>) {
  const target = customHeaders.value[index];
  if (!target) return;
  Object.assign(target, patch);
  persist();
}

export function clearHeaders() {
  customHeaders.value = [];
  persist();
}

/** 已启用的请求头数量 */
export const activeHeaderCount = computed(
  () => customHeaders.value.filter((h) => h.enabled && h.key.trim()).length
);

/** 汇总为请求头记录（仅启用且非空键） */
export function headerRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of customHeaders.value) {
    if (h.enabled && h.key.trim()) out[h.key.trim()] = h.value;
  }
  return out;
}