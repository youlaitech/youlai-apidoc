/**
 * 触发浏览器下载
 *
 * @param content 文本内容
 * @param filename 文件名（含扩展名）
 * @param mime MIME 类型
 */
export function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob(["\ufeff" + content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 文件名的安全处理：替换空白与路径分隔符
 *
 * @param name 原始名称
 */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
