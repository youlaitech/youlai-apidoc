/**
 * 全局认证信息
 *
 * 按 securityScheme 名称保存，所有接口共用；写入 localStorage，刷新不丢
 */
import { ref } from "vue";

const STORAGE_KEY = "apilens-auth-values";
const LEGACY_TOKEN_KEY = "apilens-auth-token";

export const authValues = ref<Record<string, string>>(load());

function load(): Record<string, string> {
  try {
    const saved: Record<string, string> = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    // 旧版本只保存一个 Bearer token，迁移到 Authorization
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy && !saved.Authorization) {
      saved.Authorization = legacy;
    }
    return saved;
  } catch {
    return {};
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authValues.value));
  } catch {
    // localStorage 不可用时只保留内存中的值
  }
}

/**
 * 清空全部认证信息
 */
export function clearAuthValues() {
  authValues.value = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略存储异常
  }
}
