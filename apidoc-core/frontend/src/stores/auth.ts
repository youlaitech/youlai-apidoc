/**
 * 全局认证信息：按 securityScheme 名称保存，默认存 localStorage，取消记住后仅存 sessionStorage。
 */
import { ref } from "vue";

const STORAGE_KEY = "apidoc-auth-values";
const REMEMBER_KEY = "apidoc-auth-remember";
const LEGACY_TOKEN_KEY = "apidoc-auth-token";

function readRemember(): boolean {
  try {
    const saved = localStorage.getItem(REMEMBER_KEY);
    return saved === null ? true : saved === "true";
  } catch {
    return true;
  }
}

function parseValues(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

export const rememberAuth = ref(readRemember());

function load(): Record<string, string> {
  try {
    const localValues = parseValues(localStorage.getItem(STORAGE_KEY));
    const sessionValues = parseValues(sessionStorage.getItem(STORAGE_KEY));
    let values: Record<string, string>;

    if (rememberAuth.value) {
      // 默认记住授权后，兼容迁移旧版仅保存在当前标签页的凭据
      values = Object.keys(localValues).length ? localValues : sessionValues;
      sessionStorage.removeItem(STORAGE_KEY);
      if (Object.keys(values).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } else {
      values = sessionValues;
      if (!Object.keys(sessionValues).length && Object.keys(localValues).length) {
        values = localValues;
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(localValues));
      }
      // 未开启记住授权时迁移并清除旧版留在 localStorage 中的凭据
      localStorage.removeItem(STORAGE_KEY);
    }

    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy && !values.Authorization) values.Authorization = legacy;
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return values;
  } catch {
    return {};
  }
}

export const authValues = ref<Record<string, string>>(load());

function persist() {
  try {
    const target = rememberAuth.value ? localStorage : sessionStorage;
    const stale = rememberAuth.value ? sessionStorage : localStorage;
    target.setItem(STORAGE_KEY, JSON.stringify(authValues.value));
    stale.removeItem(STORAGE_KEY);
  } catch {
    // 存储不可用时只保留内存中的值
  }
}

/**
 * 切换授权保留范围，并把现有凭据迁移到对应的存储
 */
export function setAuthRemember(value: boolean) {
  rememberAuth.value = value;
  try {
    localStorage.setItem(REMEMBER_KEY, String(value));
  } catch {
    // 偏好无法持久化时仍按当前选择使用
  }
  persist();
}

/**
 * 保存指定 scheme 的认证值，空串表示清除
 */
export function setAuthValue(name: string, value: string) {
  if (value) {
    authValues.value[name] = value;
  } else {
    delete authValues.value[name];
  }
  persist();
}

/**
 * 清空全部认证信息
 */
export function clearAuthValues() {
  authValues.value = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // 忽略存储异常
  }
}
