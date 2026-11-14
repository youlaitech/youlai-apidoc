/** OpenAPI 3.1 文档 TypeScript 类型定义（只定义渲染用到的部分） */

export interface OpenAPIDocument {
  /** 规范版本，目标为 3.1.x（如 "3.1.0"） */
  openapi: string;
  info: Info;
  /** Schema Object 默认使用的 JSON Schema 方言 URI（3.1 新增） */
  jsonSchemaDialect?: string;
  servers?: Server[];
  paths?: Record<string, PathItem>;
  /** 由服务端主动发起的回调接口（3.1 新增） */
  webhooks?: Record<string, PathItem>;
  components?: Components;
  security?: SecurityRequirement[];
  tags?: Tag[];
  externalDocs?: ExternalDocumentation;
}

export interface Info {
  title: string;
  description?: string;
  version?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; url?: string };
}

export interface Server {
  url: string;
  description?: string;
  variables?: Record<string, { default?: string; enum?: string[]; description?: string }>;
}

export interface ExternalDocumentation {
  url: string;
  description?: string;
}

export interface Tag {
  name: string;
  description?: string;
  externalDocs?: ExternalDocumentation;
  /** knife4j 排序扩展，值小的在前 */
  "x-order"?: number;
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
  options?: Operation;
  head?: Operation;
  trace?: Operation;
  servers?: Server[];
  parameters?: Parameter[];
}

export interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
  callbacks?: Record<string, unknown>;
  security?: SecurityRequirement[];
  servers?: Server[];
  deprecated?: boolean;
  externalDocs?: ExternalDocumentation;
  /** knife4j 排序扩展，值小的在前 */
  "x-order"?: number;
}

export interface Parameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: Schema;
  example?: unknown;
  /** 3.1 的示例列表（JSON Schema 2020-12），通常为空 */
  examples?: unknown[];
  content?: Record<string, MediaType>;
}

export interface RequestBody {
  description?: string;
  content?: Record<string, MediaType>;
  required?: boolean;
}

export interface Response {
  description?: string;
  headers?: Record<string, { description?: string; schema?: Schema }>;
  content?: Record<string, MediaType>;
  links?: Record<string, unknown>;
}

export interface MediaType {
  schema?: Schema;
  /** 兼容字段：swagger-core 在 3.1 文档里仍可能输出单数 example */
  example?: unknown;
  examples?: Record<string, { summary?: string; description?: string; value?: unknown }>;
  encoding?: Record<string, unknown>;
}

/**
 * OpenAPI 3.1 的 Schema Object = JSON Schema 2020-12 + OpenAPI 子集。
 * 与 3.0 的关键差异：
 * - type 可为数组，如 ["string", "null"]，nullable 关键字被移除
 * - $ref 可与 description、example 等兄弟关键字共存
 * - example 被examples 取代，但工具链仍常见输出单数 example
 * - exclusiveMinimum/Maximum 从布尔改为数字
 */
export interface Schema {
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  example?: unknown;
  examples?: unknown[];
  $ref?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  prefixItems?: Schema[];
  required?: string[];
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  not?: Schema;
  additionalProperties?: Schema | boolean;
  minProperties?: number;
  maxProperties?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  /** 仅 3.0，3.1 由 type 数组表达，保留以便兼容 3.0 输入的展示 */
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
}

export interface Components {
  schemas?: Record<string, Schema>;
  parameters?: Record<string, Parameter>;
  requestBodies?: Record<string, RequestBody>;
  responses?: Record<string, Response>;
  headers?: Record<string, { description?: string; schema?: Schema }>;
  securitySchemes?: Record<string, SecurityScheme>;
}

export interface SecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS";
  scheme?: string;
  bearerFormat?: string;
  in?: "query" | "header" | "cookie";
  name?: string;
  description?: string;
  deprecated?: boolean;
}

export interface SecurityRequirement {
  [key: string]: string[];
}
