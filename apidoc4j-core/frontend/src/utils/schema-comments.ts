import type { OpenAPIDocument, Schema } from "../types/openapi";
import { resolveRef } from "../api/openapi";

/** 请求体当前层级字段名 → 字段说明；仅用于视图展示，不进入 JSON 文档 */
export type SchemaCommentMap = Record<string, string>;

function normalizeDescription(text: string | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * 收集请求体当前层级的字段说明，兼容 $ref 与 allOf 合并。
 * 嵌套字段暂不按键名扁平混入，避免不同层级的同名字段误匹配。
 */
export function getSchemaCommentMap(schema: Schema | undefined, doc: OpenAPIDocument): SchemaCommentMap {
  const comments: SchemaCommentMap = {};
  collectSchemaComments(schema, doc, new Set<string>(), comments);
  return comments;
}

function collectSchemaComments(
  schema: Schema | undefined,
  doc: OpenAPIDocument,
  seen: Set<string>,
  comments: SchemaCommentMap
): void {
  if (!schema) return;
  let target = schema;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return;
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return;
    seen = new Set(seen);
    seen.add(schema.$ref);
    target = resolved;
  }

  for (const part of target.allOf || []) {
    collectSchemaComments(part, doc, seen, comments);
  }
  for (const [name, property] of Object.entries(target.properties || {})) {
    const resolved = property.$ref ? resolveRef(property.$ref, doc) : undefined;
    const description = normalizeDescription(property.description || resolved?.description);
    if (description) comments[name] = description;
  }
}

/** 从两空格缩进的格式化 JSON 中解析根对象属性名；嵌套字段、数组值和普通文本返回 null */
export function jsonLinePropertyKey(line: string): string | null {
  const match = line.match(/^ {2}("(?:\\.|[^"\\])*")\s*:/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return null;
  }
}
