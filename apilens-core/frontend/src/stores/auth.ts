/**
 * 全局 Auth Store — 管理认证 token，跨接口共享
 *
 * token 存储在 localStorage 中，切换接口/刷新页面不丢失。
 * 所有 ApiTester 实例共享同一个 token。
 */

const TOKEN_KEY = "apilens-auth-token";

/** 全局响应式 token */
import { ref } from "vue";
export const authToken = ref<string>(loadToken());

function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/** 保存 token 到 localStorage */
export function setToken(token: string) {
  authToken.value = token;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // localStorage 不可用时静默降级，token 仍保存在内存中
  }
}

/** 清除 token */
export function clearToken() {
  setToken("");
}
