import { describe, expect, it } from "vitest";
import type { OpenAPIDocument } from "../types/openapi";
import type { ApiGroup, ApiItem } from "./api-grouping";
import { buildExportDocument } from "./export-model";
import { renderMarkdown } from "./export-markdown";
import { renderWordHtml } from "./export-word";

const doc: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "订单接口", version: "1.0.0" },
};

const list: ApiItem = {
  method: "GET",
  path: "/orders",
  operation: {
    summary: "订单列表",
    parameters: [{ name: "page", in: "query", required: true, description: "页码", schema: { type: "integer" } }],
    responses: {
      "200": {
        description: "成功",
        content: {
          "application/json": {
            schema: { type: "object", properties: { id: { type: "integer", description: "订单号" } } },
          },
        },
      },
    },
  },
};

const detail: ApiItem = {
  method: "GET",
  path: "/orders/{id}",
  operation: {
    summary: "订单详情",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
    responses: {},
  },
};

const groups: ApiGroup[] = [
  {
    tag: "订单",
    index: "01",
    name: "订单",
    apis: [list, detail],
    entries: [{ kind: "subgroup", name: "查询", apis: [list, detail] }],
  },
];

describe("导出文档模型", () => {
  it("全部导出时保留分组、参数与完整地址", () => {
    const model = buildExportDocument(doc, groups, "https://api.example.com/");
    expect(model.apiCount).toBe(2);
    expect(model.groups[0].sections[0].title).toBe("查询");
    const api = model.groups[0].sections[0].apis[0];
    expect(api.url).toBe("https://api.example.com/orders");
    expect(api.params[0].fields[0].name).toBe("page");
  });

  it("按分组筛选时排除其它分组", () => {
    const model = buildExportDocument(doc, groups, "", { tags: ["其它"] });
    expect(model.apiCount).toBe(0);
    expect(model.groups).toHaveLength(0);
  });

  it("按接口 key 筛选时只保留匹配的接口", () => {
    const model = buildExportDocument(doc, groups, "", { apiKeys: ["GET /orders/{id}"] });
    expect(model.apiCount).toBe(1);
    expect(model.groups[0].sections[0].apis[0].summary).toBe("订单详情");
  });
});

describe("导出渲染", () => {
  it("Markdown 包含目录、字段表与接口地址", () => {
    const text = renderMarkdown(buildExportDocument(doc, groups, "https://api.example.com"));
    expect(text).toContain("# 订单接口");
    expect(text).toContain("## 目录");
    expect(text).toContain("| `page` | integer | 是 | 页码 |");
    expect(text).toContain("https://api.example.com/orders");
  });

  it("Word HTML 包含封面、分页与表格", () => {
    const html = renderWordHtml(buildExportDocument(doc, groups, "https://api.example.com"));
    expect(html).toContain('<div class="cover">');
    expect(html).toContain("@page");
    expect(html).toContain("page-break-before: always");
    expect(html).toContain("<table>");
    expect(html).toContain("GET /orders");
  });
});
