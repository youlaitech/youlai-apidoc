import type { ExportApi, ExportDocument, ExportField, ExportGroup } from "./export-model";

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "-";
}

function fieldTable(fields: ExportField[], withExample = false): string[] {
  if (!fields.length) return [];
  const head = withExample ? "| 字段 | 类型 | 必填 | 说明 | 示例 |" : "| 字段 | 类型 | 必填 | 说明 |";
  const split = withExample ? "| --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- |";
  const rows = fields.map((f) => {
    const base = `| \`${cell(f.name)}\` | ${cell(f.type)} | ${f.required ? "是" : "否"} | ${cell(f.description)}`;
    return withExample ? `${base} | ${cell(f.example)} |` : `${base} |`;
  });
  return [head, split, ...rows, ""];
}

function codeBlock(code: string, lang = "json"): string[] {
  if (!code) return [];
  return ["```" + lang, code, "```", ""];
}

function renderApi(api: ExportApi, level: string): string[] {
  const lines: string[] = [];
  const title = api.deprecated ? `${api.summary}（已废弃）` : api.summary;
  lines.push(`${level} ${title}`, "");
  lines.push(`\`${api.method} ${api.path}\``, "");
  lines.push(`完整地址：${api.url}`, "");
  if (api.description) lines.push(api.description, "");

  for (const group of api.params) {
    lines.push(`**${group.title}**`, "");
    lines.push(...fieldTable(group.fields, true));
    lines.push("");
  }

  if (api.body) {
    lines.push("**请求体**", "");
    lines.push(`内容类型：\`${api.body.contentType}\``, "");
    lines.push(...fieldTable(api.body.fields));
    if (api.body.example) {
      lines.push("请求示例", "");
      lines.push(...codeBlock(api.body.example));
    }
  }

  if (api.responses.length) {
    lines.push("**响应**", "");
    lines.push("| 状态码 | 说明 |", "| --- | --- |");
    for (const resp of api.responses) {
      lines.push(`| ${cell(resp.code)} | ${cell(resp.description)} |`);
    }
    lines.push("");
    for (const resp of api.responses) {
      if (!resp.fields.length && !resp.example) continue;
      lines.push(`${level.replace("###", "####")} ${resp.code} 响应`, "");
      lines.push(...fieldTable(resp.fields));
      if (resp.example) lines.push(...codeBlock(resp.example));
    }
  }
  return lines;
}

function renderGroup(group: ExportGroup): string[] {
  const lines: string[] = [];
  const heading = group.index ? `${group.index} ${group.name}` : group.name;
  lines.push(`## ${heading}`, "");
  if (group.description) lines.push(group.description, "");
  for (const section of group.sections) {
    if (section.title) lines.push(`### ${section.title}`, "");
    const apiLevel = section.title ? "####" : "###";
    for (const api of section.apis) {
      lines.push(...renderApi(api, apiLevel), "");
    }
  }
  return lines;
}

function renderToc(doc: ExportDocument): string[] {
  const lines = ["## 目录", ""];
  for (const group of doc.groups) {
    lines.push(`- ${group.index ? `${group.index} ` : ""}${group.name}`);
    for (const section of group.sections) {
      if (section.title) lines.push(`  - ${section.title}`);
      for (const api of section.apis) {
        lines.push(`    - ${api.summary}（${api.method} ${api.path}）`);
      }
    }
  }
  lines.push("");
  return lines;
}

/**
 * 生成 Markdown 文档
 *
 * @param doc 导出的文档模型
 */
export function renderMarkdown(doc: ExportDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`, "");
  const meta: string[] = [];
  if (doc.version) meta.push(`版本 ${doc.version}`);
  if (doc.baseUrl) meta.push(`环境 ${doc.baseUrl}`);
  meta.push(`生成时间 ${doc.generatedAt}`);
  meta.push(`接口 ${doc.apiCount} 个`);
  lines.push(`> ${meta.join(" · ")}`, "");
  lines.push(...renderToc(doc));
  for (const group of doc.groups) {
    lines.push(...renderGroup(group), "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
