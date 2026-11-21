/**
 * 请求派生工具：Base URL 解析、授权头/查询、状态文案
 *
 * 文档视图（示例 cURL）与调试抽屉（真实发送）共用同一套优先级与文案，
 * 保证两处展示与实际发送行为一致。
 */
import type { OpenAPIDocument, Operation, SecurityScheme } from "../types/openapi";
import { globalBaseUrl } from "../stores/ui";

/** 全局 Base URL 覆盖 → 文档 servers[0] → 开发兜底 → 当前站点 */
export function resolveBaseUrl(doc: OpenAPIDocument): string {
  if (globalBaseUrl.value) return globalBaseUrl.value;
  const server = doc.servers?.[0]?.url;
  if (server && /^https?:\/\//i.test(server)) return server.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://localhost:8000";
  return window.location.origin;
}

/** 接口生效的安全方案名：operation.security 优先（[] 表示显式公开），回退文档级 security */
export function securityNamesOf(operation: Operation, doc: OpenAPIDocument): string[] {
  const req = operation.security !== undefined ? operation.security : doc.security || [];
  return [...new Set(req.flatMap((r) => Object.keys(r)))];
}

/** 值需要按敏感输入展示（密码框）的方案：http/oauth2/openIdConnect 与 header 型 apiKey */
export function isSecretScheme(scheme: SecurityScheme | undefined): boolean {
  if (!scheme) return false;
  return (
    scheme.type === "http" ||
    scheme.type === "oauth2" ||
    scheme.type === "openIdConnect" ||
    (scheme.type === "apiKey" && (scheme.in || "header") === "header")
  );
}

/** 容忍粘贴带 "Bearer " 前缀的令牌，统一去掉前缀，避免发送时双重前缀 */
function bearerToken(raw: string): string {
  return raw.trim().replace(/^bearer\s+/i, "");
}

/**
 * 授权头：
 * - oauth2 / openIdConnect：knife4j Authorize 等价，统一附加 Authorization: Bearer <token>
 * - http：basic 编码 user:pass，其余按 Bearer
 * - apiKey(header)：scheme 声明 bearer 时补 Bearer 前缀，否则原值
 */
export function buildAuthHeaders(
  names: string[],
  schemes: Record<string, SecurityScheme>,
  values: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of names) {
    const scheme = schemes[name];
    const value = values[name];
    if (!scheme || !value) continue;
    if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
      headers.Authorization = `Bearer ${bearerToken(value)}`;
    } else if (scheme.type === "apiKey" && (scheme.in || "header") === "header") {
      const raw = value.trim();
      headers[scheme.name || name] = scheme.scheme?.toLowerCase() === "bearer" ? `Bearer ${bearerToken(raw)}` : raw;
    } else if (scheme.type === "http") {
      const mode = (scheme.scheme || "bearer").toLowerCase();
      headers[scheme.name || "Authorization"] = mode === "basic" ? `Basic ${btoa(value)}` : `Bearer ${bearerToken(value)}`;
    }
  }
  return headers;
}

/** 授权查询参数：apiKey(in=query) */
export function buildAuthQuery(
  names: string[],
  schemes: Record<string, SecurityScheme>,
  values: Record<string, string>
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const name of names) {
    const scheme = schemes[name];
    const value = values[name];
    if (scheme?.type === "apiKey" && scheme.in === "query" && value) query[scheme.name || name] = value;
  }
  return query;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Entity", 429: "Too Many Requests",
  500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
};

/** 0 表示网络层失败，null 表示尚未发送 */
export function statusTextOf(status: number | null): string {
  if (status === null) return "";
  if (status === 0) return "请求失败";
  const t = STATUS_TEXT[status];
  return `${status}${t ? " " + t : ""}`;
}

export function statusTypeOf(status: number | null): "success" | "warning" | "danger" | "info" {
  if (status === null) return "info";
  if (status === 0) return "danger";
  if (status < 300) return "success";
  if (status < 400) return "warning";
  return "danger";
}

export function formatBytes(text: string): string {
  if (!text) return "";
  const bytes = new Blob([text]).size;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** 示例值转展示文本（对象格式化 JSON） */
export function formatExample(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}