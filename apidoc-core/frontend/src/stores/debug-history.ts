/**
 * 调试请求历史：仅记录接口、状态与时间，localStorage 持久化（最新在前，上限 10 条）。
 * 用于「访问记录」定位最近调试过的接口，不保存响应体。
 */
import { ref } from "vue";

export interface DebugHistoryEntry {
  method: string;
  path: string;
  status: number;
  time: string;
}

const HISTORY_KEY = "apidoc-history";
const HISTORY_MAX = 10;

function isEntry(value: unknown): value is DebugHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.method === "string" &&
    typeof entry.path === "string" &&
    typeof entry.status === "number" &&
    typeof entry.time === "string"
  );
}

function load(): DebugHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    const entries = list
      .filter(isEntry)
      .slice(0, HISTORY_MAX)
      .map(({ method, path, status, time }) => ({ method, path, status, time }));
    // 清掉旧版本写入的响应体
    const normalized = JSON.stringify(entries);
    if (raw && raw !== normalized) localStorage.setItem(HISTORY_KEY, normalized);
    return entries;
  } catch {
    return [];
  }
}

/**
 * 调试请求历史，最新一条在前
 */
export const debugHistory = ref<DebugHistoryEntry[]>(load());

/**
 * 追加一条请求记录，超出上限裁掉最旧
 */
export function saveDebugHistory(entry: DebugHistoryEntry) {
  debugHistory.value.unshift(entry);
  if (debugHistory.value.length > HISTORY_MAX) debugHistory.value = debugHistory.value.slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(debugHistory.value));
  } catch {
    // ignore
  }
}

/**
 * 清空全部请求记录
 */
export function clearDebugHistory() {
  debugHistory.value = [];
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}
