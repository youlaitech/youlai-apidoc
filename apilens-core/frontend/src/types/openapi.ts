/** OpenAPI 3 文档 TypeScript 类型定义（只定义用到的部分） */

export interface OpenAPIDocument {
  openapi: string;
  info: Info;
  paths: Record<string, PathItem>;
  components?: Components;
  tags?: Tag[];
  security?: SecurityRequirement[];
}

export interface Info {
  title: string;
  description?: string;
  version?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; url?: string };
}

export interface Tag {
  name: string;
  description?: string;
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
  options?: Operation;
  head?: Operation;
}

export interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
  security?: SecurityRequirement[];
  deprecated?: boolean;
}

export interface Parameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: Schema;
  example?: any;
}

export interface RequestBody {
  description?: string;
  content?: Record<string, MediaType>;
  required?: boolean;
}

export interface Response {
  description?: string;
  content?: Record<string, MediaType>;
}

export interface MediaType {
  schema?: Schema;
  example?: any;
  examples?: Record<string, { summary?: string; value?: any }>;
}

export interface Schema {
  type?: string;
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: any[];
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  additionalProperties?: Schema | boolean;
  example?: any;
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  deprecated?: boolean;
}

export interface Components {
  schemas?: Record<string, Schema>;
  securitySchemes?: Record<string, SecurityScheme>;
}

export interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

export interface SecurityRequirement {
  [key: string]: string[];
}
