import type { OpenAPIDocument, Schema } from "../types/openapi";
import type { ApiItem } from "./api-grouping";
import { getMediaTypeExample } from "../api/openapi";
import { formatExample } from "./request";

/** 导出的一个字段（参数、请求体字段、响应字段共用） */
export interface ExportField {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example: string;
}

/** 按位置分组的请求参数 */
export interface ExportParamGroup {
  title: string;
  fields: ExportField[];
}

/** 请求体内容 */
export interface ExportBody {
  contentType: string;
  fields: ExportField[];
  example: string;
}

/** 响应定义 */
export interface ExportResponse {
  code: string;
  description: string;
  fields: ExportField[];
  example: string;
}

/** 单个接口 */
export interface ExportApi {
  method: string;
  path: string;
  url: string;
  summary: string;
  description: string;
  deprecated: boolean;
  params: ExportParamGroup[];
  body?: ExportBody;
  responses: ExportResponse[];
}

/** 一个分组（保留二级分组作为小节标题） */
export interface ExportGroup {
  index: string;
  name: string;
  description: string;
  sections: ExportSection[];
}

export interface ExportSection {
  title: string;
  apis: ExportApi[];
}

/** 整份导出文档 */
export interface ExportDocument {
  title: string;
  version: string;
  baseUrl: string;
  generatedAt: string;
  groups: ExportGroup[];
  apiCount: number;
}

function schemaType(schema: Schema | undefined): string {
  if (!schema) return "-";
  const raw = Array.isArray(schema.type) ? schema.type.filter((t) => t !== "null").join("|") : schema.type;
  if (raw) return schema.format ? `${raw}(${schema.format})` : raw;
  if (schema.$ref) return schema.$ref.split("/").pop() || "object";
  if (schema.oneOf?.length) return "oneOf";
  if (schema.anyOf?.length) return "anyOf";
  if (schema.allOf?.length) return "allOf";
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return "-";
}

/** 只展开一层字段，嵌套结构交由示例表达，避免文档出现多层表格 */
function schemaFields(schema: Schema | undefined, doc: OpenAPIDocument | null): ExportField[] {
  const target = deref(schema, doc);
  if (!target?.properties) return [];
  const required = new Set(target.required || []);
  return Object.entries(target.properties).map(([name, raw]) => {
    const field = deref(raw, doc);
    return {
      name,
      type: schemaType(field),
      required: required.has(name),
      description: field?.description || "",
      example: field?.example === undefined ? "" : formatExample(field.example),
    };
  });
}

function deref(schema: Schema | undefined, doc: OpenAPIDocument | null): Schema | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  return doc?.components?.schemas?.[name] || schema;
}

function mediaSchema(op: ApiItem): Schema | undefined {
  const content = op.operation.requestBody?.content;
  if (!content) return undefined;
  const media = content["application/json"] || content[Object.keys(content)[0]];
  return media?.schema;
}

function paramGroups(op: ApiItem, doc: OpenAPIDocument | null): ExportParamGroup[] {
  const params = op.operation.parameters || [];
  const groups: ExportParamGroup[] = [];
  const labels: Array<{ key: "path" | "query" | "header"; title: string }> = [
    { key: "path", title: "Path 参数" },
    { key: "query", title: "Query 参数" },
    { key: "header", title: "Header 参数" },
  ];
  for (const label of labels) {
    const fields = params
      .filter((p) => p.in === label.key)
      .map((p) => {
        const schema = deref(p.schema, doc);
        return {
          name: p.name,
          type: schemaType(schema),
          required: !!p.required,
          description: p.description || "",
          example: p.example === undefined ? (schema?.example === undefined ? "" : formatExample(schema.example)) : formatExample(p.example),
        };
      });
    if (fields.length) groups.push({ title: label.title, fields });
  }
  return groups;
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function toExportApi(item: ApiItem, doc: OpenAPIDocument | null, baseUrl: string): ExportApi {
  const op = item.operation;
  const jsonContent = op.requestBody?.content?.["application/json"];
  const bodySchema = mediaSchema(item);
  const bodyExample = formatExample(getMediaTypeExample(jsonContent));
  const responses = Object.entries(op.responses || {}).map(([code, resp]) => {
    const media = resp.content?.["application/json"];
    const example = formatExample(getMediaTypeExample(media));
    return {
      code,
      description: resp.description || "",
      fields: schemaFields(media?.schema, doc),
      example: example === "{}" || example === "" ? "" : example,
    };
  });
  return {
    method: item.method.toUpperCase(),
    path: item.path,
    url: joinUrl(baseUrl, item.path),
    summary: op.summary || item.path,
    description: op.description || "",
    deprecated: !!op.deprecated,
    params: paramGroups(item, doc),
    body: jsonContent
      ? {
          contentType: "application/json",
          fields: schemaFields(bodySchema, doc),
          example: bodyExample === "{}" ? "" : bodyExample,
        }
      : undefined,
    responses,
  };
}

export interface ExportScope {
  /** 只导出指定分组的接口；空数组表示全部 */
  tags?: string[];
  /** 只导出指定接口，key 为 `METHOD path` */
  apiKeys?: string[];
}

/**
 * 构建导出的文档模型；范围为空时导出全部接口
 */
export function buildExportDocument(
  doc: OpenAPIDocument,
  groups: Array<{ tag: string; index: string; name: string; apis: ApiItem[]; entries: Array<{ kind: "api"; api: ApiItem } | { kind: "subgroup"; name: string; apis: ApiItem[] }> }>,
  baseUrl: string,
  scope: ExportScope = {}
): ExportDocument {
  const tagSet = new Set(scope.tags || []);
  const apiSet = new Set(scope.apiKeys || []);
  const exportGroups: ExportGroup[] = [];
  let apiCount = 0;

  for (const group of groups) {
    if (tagSet.size && !tagSet.has(group.tag)) continue;
    const sections: ExportSection[] = [];
    for (const entry of group.entries) {
      const items = entry.kind === "api" ? [entry.api] : entry.apis;
      const apis = items
        .filter((item) => !apiSet.size || apiSet.has(`${item.method.toUpperCase()} ${item.path}`))
        .map((item) => toExportApi(item, doc, baseUrl));
      if (!apis.length) continue;
      apiCount += apis.length;
      sections.push({ title: entry.kind === "api" ? "" : entry.name, apis });
    }
    if (!sections.length) continue;
    exportGroups.push({
      index: group.index,
      name: group.name,
      description: "",
      sections,
    });
  }

  return {
    title: doc.info?.title || "API 接口文档",
    version: doc.info?.version || "",
    baseUrl,
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    groups: exportGroups,
    apiCount,
  };
}
