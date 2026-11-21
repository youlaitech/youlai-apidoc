/**
 * 请求代码生成
 *
 * 与 cURL 共用同一份参数（示例 URL / 请求头 / JSON body），
 * 生成可直接运行的 TypeScript (axios) 与 Java (RestTemplate) 请求代码。
 */

interface CodeOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function escapeDouble(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 生成 TypeScript axios 请求代码；body 为 JSON 时内嵌为对象字面量
 */
export function generateTsAxios(opts: CodeOptions): string {
  const lines: string[] = ['import axios from "axios";', "", "const { data } = await axios.request({", `  method: "${opts.method.toLowerCase()}",`, `  url: "${escapeDouble(opts.url)}",`];
  const headerEntries = Object.entries(opts.headers);
  if (headerEntries.length) {
    lines.push("  headers: {");
    for (const [key, value] of headerEntries) lines.push(`    "${key}": "${escapeDouble(value)}",`);
    lines.push("  },");
  }
  if (opts.body) lines.push(`  data: ${opts.body},`);
  lines.push("});", "", "console.log(data);");
  return lines.join("\n");
}

/**
 * 生成 Java RestTemplate 请求代码；body 走 text block（JDK 15+），无 body 时置 null
 */
export function generateJavaRest(opts: CodeOptions): string {
  const headerEntries = Object.entries(opts.headers);
  const hasBody = !!opts.body;
  const lines: string[] = ["RestTemplate restTemplate = new RestTemplate();", ""];
  if (headerEntries.length) {
    lines.push("HttpHeaders headers = new HttpHeaders();");
    for (const [key, value] of headerEntries) lines.push(`headers.set("${key}", "${escapeDouble(value)}");`);
    lines.push("");
  }
  if (hasBody) {
    // text block 中仅反斜杠需成对、连续三引号需逐个转义；双引号原样
    const safe = opts.body!.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
    const block = safe
      .split("\n")
      .map((line) => "    " + line)
      .join("\n");
    lines.push("String body = \"\"\"", block + "\"\";", "");
  } else {
    lines.push("String body = null;", "");
  }
  if (headerEntries.length) {
    lines.push("HttpEntity<String> entity = new HttpEntity<>(body, headers);", "");
  } else if (hasBody) {
    lines.push("HttpEntity<String> entity = new HttpEntity<>(body, null);", "");
  } else {
    lines.push("HttpEntity<String> entity = null;", "");
  }
  lines.push(
    "ResponseEntity<String> response = restTemplate.exchange(",
    `        "${escapeDouble(opts.url)}",`,
    `        HttpMethod.${opts.method.toUpperCase()},`,
    "        entity,",
    "        String.class",
    ");",
    "System.out.println(response.getBody());"
  );
  return lines.join("\n");
}
