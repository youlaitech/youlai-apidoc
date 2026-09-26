import axios from "axios";
import type { OpenAPIDocument, Schema } from "../types/openapi";

// SpringDoc 默认端点，可通过环境变量覆盖
const API_DOCS_PATH = (import.meta.env.VITE_API_DOCS_PATH as string) || "/v3/api-docs";

/** 请求 OpenAPI JSON 文档 */
export async function fetchOpenApiDoc(): Promise<OpenAPIDocument> {
  const res = await axios.get<OpenAPIDocument>(API_DOCS_PATH);
  return res.data;
}

/** 网关场景：请求指定服务的 OpenAPI JSON */
export async function fetchServiceDoc(service: string): Promise<OpenAPIDocument> {
  const res = await axios.get<OpenAPIDocument>(`${API_DOCS_PATH}/${service}`);
  return res.data;
}

/**
 * 解析 $ref 引用，从 components.schemas 中获取实际 Schema
 * ref 格式: "#/components/schemas/UserVO"
 */
export function resolveRef(ref: string, doc: OpenAPIDocument): any {
  if (!ref || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let target: any = doc;
  for (const part of parts) {
    if (!target || typeof target !== "object") return null;
    target = target[part];
  }
  return target;
}

/**
 * 获取 Schema 的类型描述文本，用于参数表格展示
 * 如 "string"、"array<UserVO>"、"integer(int64)"
 */
export function getSchemaType(schema: Schema | undefined, doc: OpenAPIDocument): string {
  if (!schema) return "unknown";
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    if (resolved?.title) return resolved.title;
    // 从 ref 路径提取类型名：#/components/schemas/UserVO → UserVO
    const parts = schema.$ref.split("/");
    return parts[parts.length - 1];
  }
  if (schema.type) {
    if (schema.type === "array" && schema.items) {
      return `array<${getSchemaType(schema.items, doc)}>`;
    }
    if (schema.type === "object") {
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `map<string, ${getSchemaType(schema.additionalProperties, doc)}>`;
      }
      return "object";
    }
    return schema.format ? `${schema.type}(${schema.format})` : schema.type;
  }
  if (schema.allOf) return schema.allOf.map((s) => getSchemaType(s, doc)).join(" & ");
  if (schema.oneOf) return schema.oneOf.map((s) => getSchemaType(s, doc)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map((s) => getSchemaType(s, doc)).join(" | ");
  return "unknown";
}

/** HTTP 方法对应的 Element Plus 标签颜色 */
export function getMethodTagType(method: string): "success" | "warning" | "danger" | "primary" | "info" {
  const map: Record<string, "success" | "warning" | "danger" | "primary" | "info"> = {
    get: "success",
    post: "warning",
    put: "primary",
    delete: "danger",
    patch: "info",
    options: "info",
    head: "info",
  };
  return map[method.toLowerCase()] || "info";
}

/**
 * 根据 Schema 生成示例 JSON，用于在线调试的请求体默认值
 */
export function generateExampleJson(schema: Schema | undefined, doc: OpenAPIDocument): string {
  if (!schema) return "{}";
  let resolved = schema;
  if (schema.$ref) {
    resolved = resolveRef(schema.$ref, doc) || schema;
  }
  const obj: Record<string, any> = {};
  if (resolved.properties) {
    for (const [name, prop] of Object.entries(resolved.properties)) {
      if (prop.example !== undefined) {
        obj[name] = prop.example;
      } else if (prop.default !== undefined) {
        obj[name] = prop.default;
      } else if (prop.type === "string") {
        obj[name] = "";
      } else if (prop.type === "integer" || prop.type === "number") {
        obj[name] = 0;
      } else if (prop.type === "boolean") {
        obj[name] = false;
      } else if (prop.type === "array") {
        obj[name] = [];
      } else if (prop.type === "object") {
        obj[name] = {};
      } else {
        obj[name] = null;
      }
    }
  }
  return JSON.stringify(obj, null, 2);
}
