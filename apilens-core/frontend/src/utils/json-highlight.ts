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
  let jsonStr = raw;
  // 尝试解析再格式化，确保输出是规范 JSON
  try {
    jsonStr = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // 非 JSON 文本，转义后直接返回
    return escapeHtml(raw);
  }

  // 用正则匹配 JSON 语法元素，包裹 <span> 标签
  return jsonStr.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        // 字符串或 key
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
