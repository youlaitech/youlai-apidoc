/**
 * 全局 UI 偏好：主题（亮/暗）与全局 Base URL
 *
 * 主题写入 localStorage 并同步 <html> 的 dark class；
 * Base URL 为空时回退到文档 servers[0] 或当前站点。
 */
import { ref, watch } from "vue";

const THEME_KEY = "apidoc-theme";
const BASEURL_KEY = "apidoc-base-url";

function loadTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export const theme = ref<"light" | "dark">(loadTheme());

export function applyTheme() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme.value === "dark");
}

export function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
}

watch(theme, (val) => {
  try {
    localStorage.setItem(THEME_KEY, val);
  } catch {
    // ignore
  }
  applyTheme();
});

function loadBaseUrl(): string {
  try {
    return localStorage.getItem(BASEURL_KEY) || "";
  } catch {
    return "";
  }
}

/** 全局 Base URL 覆盖；空串表示自动（文档 servers[0] / 当前站点） */
export const globalBaseUrl = ref<string>(loadBaseUrl());

export function setGlobalBaseUrl(value: string) {
  globalBaseUrl.value = value.trim().replace(/\/$/, "");
  try {
    if (globalBaseUrl.value) localStorage.setItem(BASEURL_KEY, globalBaseUrl.value);
    else localStorage.removeItem(BASEURL_KEY);
  } catch {
    // ignore
  }
}