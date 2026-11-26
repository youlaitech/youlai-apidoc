import type { ExportApi, ExportDocument, ExportField, ExportGroup } from "./export-model";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fieldTable(fields: ExportField[], withExample = false): string {
  if (!fields.length) return "";
  const head = withExample
    ? "<tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th><th>示例</th></tr>"
    : "<tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr>";
  const rows = fields
    .map((f) => {
      const cells = [
        `<td><code>${escapeHtml(f.name)}</code></td>`,
        `<td>${escapeHtml(f.type)}</td>`,
        `<td>${f.required ? "是" : "否"}</td>`,
        `<td>${escapeHtml(f.description) || "-"}</td>`,
      ];
      if (withExample) cells.push(`<td>${escapeHtml(f.example) || "-"}</td>`);
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return `<table>${head}${rows}</table>`;
}

function renderApi(api: ExportApi): string {
  const parts: string[] = [];
  const title = api.deprecated ? `${escapeHtml(api.summary)}（已废弃）` : escapeHtml(api.summary);
  parts.push(`<h3>${title}</h3>`);
  parts.push(`<p class="signature"><span class="method">${api.method}</span> ${escapeHtml(api.path)}</p>`);
  parts.push(`<p class="meta">完整地址：${escapeHtml(api.url)}</p>`);
  if (api.description) parts.push(`<p>${escapeHtml(api.description)}</p>`);

  for (const group of api.params) {
    parts.push(`<h4>${escapeHtml(group.title)}</h4>`);
    parts.push(fieldTable(group.fields, true));
  }

  if (api.body) {
    parts.push("<h4>请求体</h4>");
    parts.push(`<p class="meta">内容类型：${escapeHtml(api.body.contentType)}</p>`);
    parts.push(fieldTable(api.body.fields));
    if (api.body.example) parts.push(`<pre>${escapeHtml(api.body.example)}</pre>`);
  }

  if (api.responses.length) {
    parts.push("<h4>响应</h4>");
    const rows = api.responses
      .map((r) => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.description) || "-"}</td></tr>`)
      .join("");
    parts.push(`<table><tr><th>状态码</th><th>说明</th></tr>${rows}</table>`);
    for (const resp of api.responses) {
      if (!resp.fields.length && !resp.example) continue;
      parts.push(`<h5>${escapeHtml(resp.code)} 响应</h5>`);
      parts.push(fieldTable(resp.fields));
      if (resp.example) parts.push(`<pre>${escapeHtml(resp.example)}</pre>`);
    }
  }
  return parts.join("\n");
}

function renderGroup(group: ExportGroup): string {
  const parts: string[] = [];
  const heading = group.index ? `${group.index} ${group.name}` : group.name;
  parts.push(`<h2>${escapeHtml(heading)}</h2>`);
  if (group.description) parts.push(`<p>${escapeHtml(group.description)}</p>`);
  for (const section of group.sections) {
    if (section.title) parts.push(`<h3 class="section">${escapeHtml(section.title)}</h3>`);
    for (const api of section.apis) parts.push(renderApi(api));
  }
  return parts.join("\n");
}

function renderToc(doc: ExportDocument): string {
  const items: string[] = [];
  for (const group of doc.groups) {
    items.push(`<li class="toc-l1">${escapeHtml(group.index ? `${group.index} ${group.name}` : group.name)}</li>`);
    for (const section of group.sections) {
      if (section.title) items.push(`<li class="toc-l2">${escapeHtml(section.title)}</li>`);
      for (const api of section.apis) {
        items.push(`<li class="toc-l3">${escapeHtml(`${api.summary}（${api.method} ${api.path}）`)}</li>`);
      }
    }
  }
  return `<h2>目录</h2><ul class="toc">${items.join("")}</ul>`;
}

const STYLE = `
  @page { size: A4; margin: 2.2cm 2cm; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 10.5pt; color: #1f2329; line-height: 1.7; }
  h1 { font-size: 24pt; margin: 0 0 12pt; text-align: center; letter-spacing: 1pt; }
  h2 { font-size: 16pt; margin: 22pt 0 8pt; padding-bottom: 4pt; border-bottom: 1pt solid #d8dbe0; page-break-after: avoid; }
  h3 { font-size: 13pt; margin: 16pt 0 6pt; page-break-after: avoid; }
  h3.section { font-size: 12pt; color: #5b6270; }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  h5 { font-size: 10.5pt; margin: 10pt 0 4pt; color: #5b6270; page-break-after: avoid; }
  p { margin: 4pt 0; }
  .meta { color: #6b7280; font-size: 9pt; }
  .signature { font-family: Consolas, monospace; font-size: 10pt; background: #f6f8fa; padding: 6pt 8pt; }
  .method { color: #615ced; font-weight: bold; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; }
  th, td { border: 1pt solid #e1e4e8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: bold; }
  code { font-family: Consolas, monospace; font-size: 9pt; color: #b91c1c; }
  pre { font-family: Consolas, monospace; font-size: 9pt; background: #f6f8fa; border: 1pt solid #e1e4e8; padding: 6pt 8pt; line-height: 1.5; white-space: pre-wrap; }
  .cover { text-align: center; padding-top: 120pt; }
  .cover .subtitle { font-size: 12pt; color: #5b6270; margin-top: 8pt; }
  .cover .meta-line { font-size: 10pt; color: #6b7280; margin-top: 4pt; }
  ul.toc { list-style: none; padding-left: 0; }
  ul.toc li { margin: 2pt 0; }
  ul.toc .toc-l1 { font-weight: bold; margin-top: 6pt; }
  ul.toc .toc-l2 { padding-left: 12pt; color: #5b6270; }
  ul.toc .toc-l3 { padding-left: 26pt; color: #6b7280; font-size: 9.5pt; }
`;

/**
 * 生成 Word 可打开的 HTML 文档（.doc），不依赖第三方库
 *
 * @param doc 导出的文档模型
 */
export function renderWordHtml(doc: ExportDocument): string {
  const cover: string[] = ['<div class="cover">'];
  cover.push(`<h1>${escapeHtml(doc.title)}</h1>`);
  if (doc.version) cover.push(`<p class="subtitle">版本 ${escapeHtml(doc.version)}</p>`);
  if (doc.baseUrl) cover.push(`<p class="meta-line">环境地址：${escapeHtml(doc.baseUrl)}</p>`);
  cover.push(`<p class="meta-line">接口总数：${doc.apiCount} 个</p>`);
  cover.push(`<p class="meta-line">生成时间：${escapeHtml(doc.generatedAt)}</p>`);
  cover.push("</div>");
  const body = doc.groups.map((group) => renderGroup(group)).join("\n");
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>${STYLE}</style>
</head>
<body>
${cover.join("\n")}
<br style="page-break-before: always">
${renderToc(doc)}
<br style="page-break-before: always">
${body}
</body>
</html>`;
}
