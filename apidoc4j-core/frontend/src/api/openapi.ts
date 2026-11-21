import axios from "axios";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIDocument, Schema } from "../types/openapi";

// SpringDoc 默认端点，可通过环境变量覆盖
const API_DOCS_PATH = (import.meta.env.VITE_API_DOCS_PATH as string) || "/v3/api-docs";

interface LoadedDocument {
  doc: OpenAPIDocument;
  /** 非 3.1 文档的提示信息，空串表示无提示 */
  warning: string;
}

/**
 * 校验文档协议版本：3.1 直接可用，3.0 降级渲染，其余拒绝
 */
function checkVersion(doc: OpenAPIDocument): string {
  const version = String(doc?.openapi ?? "");
  if (version.startsWith("3.1")) {
    return "";
  }
  if (version.startsWith("3.0")) {
    return "当前文档为 OpenAPI " + version + "，界面按 3.1 解析，部分字段可能显示不全；建议将 springdoc 升级到 3.x（默认输出 3.1）。";
  }
  if (version.startsWith("3.2")) {
    return "当前文档为 OpenAPI " + version + "，按 3.1 语义渲染，3.2 新增字段暂不展示。";
  }
  if (version.startsWith("2.") || version.startsWith("1.")) {
    throw new Error("不支持 Swagger " + version + "（OpenAPI 2）：本项目仅支持 OpenAPI 3.1，请迁移到 springdoc 3.x。");
  }
  throw new Error("无法识别的文档版本：" + (version || "缺失 openapi 字段"));
}

/**
 * 请求并解析 OpenAPI JSON 文档：$ref 内联（循环引用保留 $ref）、版本校验
 */
async function loadDocument(url: string): Promise<LoadedDocument> {
  const res = await axios.get(url, { validateStatus: () => true });
  if (res.status >= 400) {
    throw new Error("接口返回 " + res.status + "，请确认服务已启动且路径正确");
  }
  const warning = checkVersion(res.data);
  let doc: OpenAPIDocument;
  try {
    // 循环引用以 $ref 原样保留（circular: ignore），由渲染层处理，避免展开死循环
    doc = (await SwaggerParser.dereference(res.data, {
      dereference: { circular: "ignore" },
    })) as OpenAPIDocument;
  } catch (error) {
    // 解析器尚未声明支持 3.2，保留原文档，未内联的 $ref 由渲染层解析
    if (String(res.data?.openapi || "").startsWith("3.2")) {
      doc = res.data;
    } else {
      throw error;
    }
  }
  return { doc, warning };
}

/**
 * 请求单体应用的 OpenAPI 文档
 */
export function fetchOpenApiDoc(): Promise<LoadedDocument> {
  return loadDocument(API_DOCS_PATH);
}

/**
 * 网关场景：请求指定服务的 OpenAPI 文档
 */
export function fetchServiceDoc(service: string): Promise<LoadedDocument> {
  return loadDocument(`${API_DOCS_PATH}/${service}`);
}

/**
 * 解析循环引用场景下残留的 $ref（dereference 已内联普通引用）
 * ref 格式: "#/components/schemas/UserVO"
 */
export function resolveRef(ref: string | undefined, doc: OpenAPIDocument): Schema | null {
  if (!ref || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let target: unknown = doc;
  for (const part of parts) {
    if (!target || typeof target !== "object") return null;
    target = (target as Record<string, unknown>)[part];
  }
  return (target as Schema) ?? null;
}

/**
 * 取 Schema 的有效类型，兼容 3.1 的 type 数组写法
 */
function getSchemaTypes(schema: Schema | undefined): string[] {
  if (!schema?.type) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

/**
 * 第一个非 null 的基础类型，用于渲染与示例生成
 */
function primaryType(schema: Schema | undefined): string | undefined {
  return getSchemaTypes(schema).find((t) => t !== "null");
}

/**
 * 获取 Schema 的类型描述文本，用于参数表格展示
 * 如 "string"、"array<UserVO>"、"integer(int64)"、"string | null"
 */
export function getSchemaType(schema: Schema | undefined, doc: OpenAPIDocument): string {
  if (!schema) return "unknown";
  const types = getSchemaTypes(schema);
  const hasNull = types.includes("null");
  const main = primaryType(schema);

  if (!main && schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    if (resolved?.title) return resolved.title;
    // 从 ref 路径提取类型名：#/components/schemas/UserVO → UserVO
    const parts = schema.$ref.split("/");
    return parts[parts.length - 1];
  }

  let text: string;
  if (main === "array") {
    text = `array<${getSchemaType(schema.items, doc)}>`;
  } else if (main === "object") {
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      text = `map<string, ${getSchemaType(schema.additionalProperties, doc)}>`;
    } else {
      text = "object";
    }
  } else if (main) {
    text = schema.format ? `${main}(${schema.format})` : main;
  } else if (schema.allOf) {
    text = schema.allOf.map((s) => getSchemaType(s, doc)).join(" & ");
  } else if (schema.oneOf) {
    text = schema.oneOf.map((s) => getSchemaType(s, doc)).join(" | ");
  } else if (schema.anyOf) {
    text = schema.anyOf.map((s) => getSchemaType(s, doc)).join(" | ");
  } else {
    text = "unknown";
  }

  return hasNull ? `${text} | null` : text;
}

/**
 * 取单个示例值：example → examples[0] → default → enum[0]
 */
export function getSchemaExample(schema: Schema | undefined): unknown {
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  return undefined;
}

/**
 * 取媒体类型示例值
 */
export function getMediaTypeExample(mediaType: { example?: unknown; examples?: Record<string, { value?: unknown }> } | undefined): unknown {
  if (!mediaType) return undefined;
  if (mediaType.example !== undefined) return mediaType.example;
  const first = mediaType.examples ? Object.values(mediaType.examples)[0] : undefined;
  return first?.value;
}

// 示例生成的递归深度与属性数上限，防止超深/超大文档卡死页面
const MAX_EXAMPLE_DEPTH = 8;
const MAX_EXAMPLE_PROPERTIES = 24;

/**
 * 根据 Schema 递归生成示例 JSON，用于在线调试的请求体默认值
 * 处理 $ref（循环保护）、type 数组、allOf 合并、oneOf/anyOf 取首个分支、readOnly 跳过
 */
export function generateExampleJson(schema: Schema | undefined, doc: OpenAPIDocument): string {
  const value = buildExample(schema, doc, new Set(), 0);
  return JSON.stringify(value ?? {}, null, 2);
}

function buildExample(schema: Schema | undefined, doc: OpenAPIDocument, seen: Set<string>, depth: number): unknown {
  if (!schema || depth > MAX_EXAMPLE_DEPTH) return null;

  // 循环引用：同一次生成路径中重复出现直接终止
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return null;
    seen = new Set(seen);
    seen.add(schema.$ref);
  }
  let resolved: Schema | undefined = schema;
  if (schema.$ref) {
    resolved = resolveRef(schema.$ref, doc) ?? schema;
  }

  const preset = getSchemaExample(schema) ?? getSchemaExample(resolved);
  if (preset !== undefined) return preset;

  // allOf 合并各分支的生成结果
  if (resolved.allOf?.length) {
    const merged: Record<string, unknown> = {};
    for (const part of resolved.allOf) {
      const value = buildExample(part, doc, seen, depth + 1);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(merged, value);
      }
    }
    return merged;
  }

  // oneOf / anyOf 取第一个分支
  const union = resolved.oneOf ?? resolved.anyOf;
  if (union?.length) {
    return buildExample(union[0], doc, seen, depth + 1);
  }

  const type = primaryType(resolved);
  switch (type) {
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return resolved.items ? [buildExample(resolved.items, doc, seen, depth + 1)] : [];
    case "object": {
      const obj: Record<string, unknown> = {};
      if (resolved.properties) {
        const names = Object.keys(resolved.properties).slice(0, MAX_EXAMPLE_PROPERTIES);
        for (const name of names) {
          const prop = resolved.properties[name];
          // readOnly 字段属于响应侧，请求示例中跳过
          if (prop.readOnly) continue;
          obj[name] = buildExample(prop, doc, seen, depth + 1);
        }
      }
      return obj;
    }
    default:
      return null;
  }
}
