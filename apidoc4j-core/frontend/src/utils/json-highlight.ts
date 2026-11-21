import { jsonLinePropertyKey, type SchemaCommentMap } from "./schema-comments";

/**
 * JSON 语法高亮工具
 *
 * 将 JSON 字符串转为带语法高亮标记的 HTML，用于 <pre> 展示。
 * 同时支持非 JSON 文本的展示（如纯文本错误信息）。
 */

/**
 * 将任意值格式化为带语法高亮的 HTML
 * @param raw 原始字符串或对象
 * @returns HTML 字符串，可直接用 v-html 渲染
 */
export function highlightJson(raw: string): string {
  const jsonStr = normalizeJson(raw);
  return jsonStr === null ? escapeHtml(raw) : highlightJsonSource(jsonStr);
}

/**
 * 在只读 JSON 示例的字段行尾追加 Schema 说明。
 * 注释仅存在于生成的 HTML 中，原始 raw 始终为可解析、可复制的纯 JSON。
 */
export function highlightJsonWithComments(raw: string, comments: SchemaCommentMap): string {
  const jsonStr = normalizeJson(raw);
  if (jsonStr === null) return escapeHtml(raw);
  return jsonStr
    .split("\n")
    .map((line) => {
      const key = jsonLinePropertyKey(line);
      const description = key ? comments[key] : undefined;
      const comment = description
        ? `<span class="json-schema-comment" title="${escapeHtml(description)}">  // ${escapeHtml(description)}</span>`
        : "";
      return highlightJsonSource(line) + comment;
    })
    .join("\n");
}

function normalizeJson(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
}

/** 高亮单段合法 JSON 文本，不修改其语义或空白 */
function highlightJsonSource(jsonStr: string): string {
  return jsonStr.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "json-key" : "json-string";
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${escapeHtml(match)}</span>`;
    }
  );
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * HTML 转义，v-html 渲染前对文本内容使用
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
