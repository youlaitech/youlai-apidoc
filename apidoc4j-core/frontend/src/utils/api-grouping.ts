import type { OpenAPIDocument, Operation } from "../types/openapi";
/** OpenAPI Path Item 上可能出现的 HTTP 方法键 */
export const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "options", "head"] as const;

export interface ApiItem {
  method: string;
  path: string;
  operation: Operation;
}

interface ApiSubgroupEntry {
  kind: "subgroup";
  name: string;
  apis: ApiItem[];
}

interface ApiDirectEntry {
  kind: "api";
  api: ApiItem;
}

type ApiGroupEntry = ApiSubgroupEntry | ApiDirectEntry;

interface ApiGroup {
  tag: string;
  /** tag 形如「01.认证中心」时提取的序号，无则空串 */
  index: string;
  /** 去掉序号后的分组名 */
  name: string;
  /** 当前分组下全部接口（搜索时为匹配结果），用于计数与首页预览 */
  apis: ApiItem[];
  /** 直属接口在前，二级分组随后 */
  entries: ApiGroupEntry[];
}

/**
 * 拆分分组序号与名称：「01.认证中心」→ index=01、name=认证中心
 */
function splitGroupIndex(tag: string): { index: string; name: string } {
  const match = tag.match(/^(\d+)[.、]\s*(.+)$/);
  return match ? { index: match[1], name: match[2] } : { index: "", name: tag };
}

function compareOrder(a?: number, b?: number): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

function sortApis(apis: ApiItem[]): ApiItem[] {
  return apis.sort(
    (a, b) =>
      compareOrder(a.operation["x-order"], b.operation["x-order"]) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method)
  );
}

/** 显式扩展优先：只认 x-group */
function explicitGroupName(api: ApiItem): string {
  const raw = api.operation["x-group"];
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw.name === "string") return raw.name.trim();
  return "";
}

/**
 * 支持用 tag 写层级：「01.认证中心 / 扫码登录」「01.认证中心 > 扫码登录」。
 * 返回一级目录与可选的二级分组。
 */
function splitTagPath(tag: string): { parent: string; subgroup: string } {
  const parts = tag.split(/\s*(?:\/|>|::)\s*/).filter(Boolean);
  if (parts.length < 2) return { parent: tag.trim(), subgroup: "" };
  return {
    parent: parts[0].trim(),
    subgroup: parts.slice(1).join(" / ").trim(),
  };
}

function entryMatches(api: ApiItem, keyword: string): boolean {
  return (
    api.path.toLowerCase().includes(keyword) ||
    !!api.operation.summary?.toLowerCase().includes(keyword) ||
    !!api.operation.operationId?.toLowerCase().includes(keyword)
  );
}

/**
 * 构建三级导航：tag → 二级分组 → 接口。
 * 二级分组仅由 x-group 或 tag 层级显式声明，
 * 不从摘要前缀推断，避免摘要文案影响目录结构。
 */
function buildEntries(apis: ApiItem[], tagSubgroupOf: (api: ApiItem) => string): ApiGroupEntry[] {
  const directEntries: ApiDirectEntry[] = [];
  const subgroupEntries: ApiSubgroupEntry[] = [];
  const subgroups = new Map<string, ApiSubgroupEntry>();
  for (const api of apis) {
    const name = explicitGroupName(api) || tagSubgroupOf(api);
    if (!name) {
      directEntries.push({ kind: "api", api });
      continue;
    }
    let subgroup = subgroups.get(name);
    if (!subgroup) {
      subgroup = { kind: "subgroup", name, apis: [] };
      subgroups.set(name, subgroup);
      subgroupEntries.push(subgroup);
    }
    subgroup.apis.push(api);
  }
  // 直属接口置顶，二级分组随后，避免折叠分组后相邻接口看起来属于该分组
  return [...directEntries, ...subgroupEntries];
}

function filterEntries(entries: ApiGroupEntry[], groupMatches: boolean, keyword: string): ApiGroupEntry[] {
  const result: ApiGroupEntry[] = [];
  for (const entry of entries) {
    if (groupMatches) {
      result.push(entry);
      continue;
    }
    if (entry.kind === "api") {
      if (entryMatches(entry.api, keyword)) result.push(entry);
      continue;
    }
    if (entry.name.toLowerCase().includes(keyword)) {
      result.push(entry);
      continue;
    }
    const apis = entry.apis.filter((api) => entryMatches(api, keyword));
    if (apis.length) result.push({ ...entry, apis });
  }
  return result;
}

/** 从 OpenAPI 文档生成侧栏分组；keyword 同时匹配 tag、二级分组名、接口摘要/路径/operationId */
export function buildApiGroups(doc: OpenAPIDocument | null | undefined, keyword = ""): ApiGroup[] {
  if (!doc?.paths) return [];
  const tagGroups = new Map<string, ApiItem[]>();
  const tagSubgroups = new WeakMap<ApiItem, string>();

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const api: ApiItem = { method, path, operation };
      const tags = new Set(operation.tags?.length ? operation.tags : ["default"]);
      const parents = new Set<string>();
      for (const rawTag of tags) {
        const { parent, subgroup } = splitTagPath(rawTag);
        if (parents.has(parent)) continue;
        parents.add(parent);
        if (subgroup) tagSubgroups.set(api, subgroup);
        if (!tagGroups.has(parent)) tagGroups.set(parent, []);
        tagGroups.get(parent)!.push(api);
      }
    }
  }

  const tagOrders = new Map<string, number>();
  for (const tag of doc.tags || []) {
    const parent = splitTagPath(tag.name).parent;
    if (typeof tag["x-order"] === "number" && !tagOrders.has(parent)) {
      tagOrders.set(parent, tag["x-order"]);
    }
  }

  const groups: ApiGroup[] = [];
  for (const [tag, apis] of tagGroups) {
    const sorted = sortApis(apis);
    groups.push({
      tag,
      ...splitGroupIndex(tag),
      apis: sorted,
      entries: buildEntries(sorted, (api) => tagSubgroups.get(api) || ""),
    });
  }
  groups.sort((a, b) => compareOrder(tagOrders.get(a.tag), tagOrders.get(b.tag)) || a.tag.localeCompare(b.tag, "zh-CN"));

  const kw = keyword.trim().toLowerCase();
  if (!kw) return groups;

  return groups
    .map((group) => {
      const entries = filterEntries(group.entries, group.tag.toLowerCase().includes(kw), kw);
      return {
        tag: group.tag,
        index: group.index,
        name: group.name,
        entries,
        apis: entries.flatMap((entry) => (entry.kind === "api" ? [entry.api] : entry.apis)),
      };
    })
    .filter((group) => group.apis.length > 0);
}
