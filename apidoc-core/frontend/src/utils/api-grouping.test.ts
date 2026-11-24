import { describe, expect, it } from "vitest";
import type { OpenAPIDocument } from "../types/openapi";
import { buildApiGroups } from "./api-grouping";

/**
 * 构造最小文档：每个路径一个 GET，便于断言分组结果
 */
function docOf(
  paths: Record<string, { tags?: string[]; "x-group"?: unknown }>,
  tags: Array<{ name: string; "x-order"?: number }> = []
): OpenAPIDocument {
  const built: Record<string, unknown> = {};
  for (const [path, op] of Object.entries(paths)) {
    built[path] = { get: { tags: op.tags, "x-group": op["x-group"], responses: {} } };
  }
  return { openapi: "3.1.0", paths: built, tags } as unknown as OpenAPIDocument;
}

describe("buildApiGroups", () => {
  it("把带分隔符的 tag 拆成主分组与二级分组", () => {
    const groups = buildApiGroups(
      docOf({
        "/a": { tags: ["13.工作流接口 / 定义"] },
        "/b": { tags: ["13.工作流接口 / 模型"] },
      })
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].index).toBe("13");
    expect(groups[0].name).toBe("工作流接口");
    expect(groups[0].entries.map((e) => (e.kind === "subgroup" ? e.name : ""))).toEqual([
      "定义",
      "模型",
    ]);
  });

  it("多个控制器写同一主分组时合并到一处", () => {
    const groups = buildApiGroups(
      docOf({
        "/a": { tags: ["01.认证中心 / 扫码登录"] },
        "/b": { tags: ["01.认证中心 / 短信登录"] },
        "/c": { tags: ["01.认证中心"] },
      })
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].apis).toHaveLength(3);
    expect(groups[0].entries.filter((e) => e.kind === "api")).toHaveLength(1);
    expect(groups[0].entries.filter((e) => e.kind === "subgroup")).toHaveLength(2);
  });

  it("x-group 优先于 tag 层级", () => {
    const groups = buildApiGroups(
      docOf({ "/a": { tags: ["01.认证中心 / 扫码登录"], "x-group": { name: "扩展分组" } } })
    );

    const entry = groups[0].entries[0];
    expect(entry.kind === "subgroup" && entry.name).toBe("扩展分组");
  });

  it("同一接口同时写了主分组和二级分组时保留二级分组", () => {
    const groups = buildApiGroups(
      docOf({ "/a": { tags: ["01.认证中心", "01.认证中心 / 扫码登录"] } })
    );

    const entry = groups[0].entries[0];
    expect(entry.kind === "subgroup" && entry.name).toBe("扫码登录");
  });

  it("按 x-order 排序，缺省值排在有值之后", () => {
    const groups = buildApiGroups(
      docOf({ "/a": { tags: ["甲"] }, "/b": { tags: ["乙"] } }, [
        { name: "乙", "x-order": 1 },
        { name: "甲", "x-order": 2 },
      ])
    );

    expect(groups.map((g) => g.name)).toEqual(["乙", "甲"]);
  });

  it("搜索时按 tag、二级分组名与接口路径过滤", () => {
    const doc = docOf({
      "/api/v1/users": { tags: ["02.用户接口"] },
      "/api/v1/roles": { tags: ["03.角色接口"] },
    });

    expect(buildApiGroups(doc, "用户").map((g) => g.name)).toEqual(["用户接口"]);
    expect(buildApiGroups(doc, "roles").map((g) => g.name)).toEqual(["角色接口"]);
    expect(buildApiGroups(doc, "不存在")).toHaveLength(0);
  });
});
