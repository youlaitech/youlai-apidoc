/**
 * cURL 命令生成工具
 *
 * 根据请求参数生成等效的 cURL 命令，方便复制到终端调试。
 */

interface CurlOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * 生成 cURL 命令字符串
 */
export function generateCurl(opts: CurlOptions): string {
  const parts: string[] = [`curl -X ${opts.method.toUpperCase()} '${opts.url}'`];

  for (const [key, value] of Object.entries(opts.headers)) {
    parts.push(`  -H '${key}: ${value}'`);
  }

  if (opts.body) {
    // 用单引号包裹 body，转义内部单引号
    const escapedBody = opts.body.replace(/'/g, "'\\''");
    parts.push(`  -d '${escapedBody}'`);
  }

  return parts.join(" \\\n");
}
