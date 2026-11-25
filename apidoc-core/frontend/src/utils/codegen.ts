/**
 * 请求代码生成
 *
 * 文档视图「请求示例」（文档示例值）与调试抽屉「实际请求」（真实发送的参数）
 * 共用同一份 CodeOptions，生成多种语言可直接运行的请求代码。
 */

export interface CodeOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type CodeLang =
  | "curl"
  | "powershell"
  | "javascript"
  | "typescript"
  | "java"
  | "python"
  | "go"
  | "php"
  | "http";

export const CODE_LANGS: ReadonlyArray<{ value: CodeLang; label: string }> = [
  { value: "curl", label: "cURL" },
  { value: "powershell", label: "PowerShell" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "php", label: "PHP" },
  { value: "http", label: "HTTP" },
];

export function isCodeLang(value: string | null): value is CodeLang {
  return CODE_LANGS.some((lang) => lang.value === value);
}

/** 按语言分发；未知语言回退 cURL */
export function generateCode(lang: CodeLang, opts: CodeOptions): string {
  switch (lang) {
    case "powershell":
      return generatePowerShell(opts);
    case "javascript":
      return generateJavaScript(opts);
    case "typescript":
      return generateTsAxios(opts);
    case "java":
      return generateJavaRest(opts);
    case "python":
      return generatePython(opts);
    case "go":
      return generateGo(opts);
    case "php":
      return generatePhp(opts);
    case "http":
      return generateHttp(opts);
    default:
      return generateCurl(opts);
  }
}

/* ===================== 转义与格式化 ===================== */

/** C 系语言（JS/TS/Java/Go/JSON）双引号字符串字面量 */
function escapeDouble(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** PHP 单引号字符串：仅反斜杠与单引号需要转义 */
function escapeSingle(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** PowerShell 单引号字面量（不插值）：单引号成对 */
function psSingle(text: string): string {
  return text.replace(/'/g, "''");
}

/** bash 单引号内无法转义单引号，用 '\'' 拼接 */
function shellSingle(text: string): string {
  return text.replace(/'/g, "'\\''");
}

/** body 为 JSON 时压缩为单行，作为命令行参数更紧凑；非 JSON 原样返回 */
function compactBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body;
  }
}

/** 解析 JSON body；非 JSON 返回 null */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** 多行字面量整体缩进（首行保持，便于嵌在 `key: <literal>,` 之后） */
function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : pad + line))
    .join("\n");
}

function contentTypeOf(headers: Record<string, string>): string | undefined {
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type");
  return entry?.[1];
}

function entriesExceptContentType(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-type");
}

/* ===================== cURL ===================== */

/** bash / zsh cURL：单引号包裹，反斜杠换行 */
export function generateCurl(opts: CodeOptions): string {
  const parts: string[] = [`curl -X ${opts.method.toUpperCase()} '${shellSingle(opts.url)}'`];
  for (const [key, value] of Object.entries(opts.headers)) {
    parts.push(`  -H '${shellSingle(`${key}: ${value}`)}'`);
  }
  if (opts.body) {
    parts.push(`  -d '${shellSingle(compactBody(opts.body))}'`);
  }
  return parts.join(" \\\n");
}

/* ===================== PowerShell ===================== */

/** Invoke-RestMethod；Content-Type 必须走 -ContentType（PS 5.1 禁止经 -Headers 传入） */
function generatePowerShell(opts: CodeOptions): string {
  const lines: string[] = [];
  const headerEntries = entriesExceptContentType(opts.headers);
  if (headerEntries.length) {
    lines.push("$headers = @{");
    for (const [key, value] of headerEntries) {
      lines.push(`    "${key.replace(/"/g, '`"')}" = '${psSingle(value)}'`);
    }
    lines.push("}", "");
  }
  if (opts.body) {
    lines.push(`$body = '${psSingle(compactBody(opts.body))}'`, "");
  }
  const args = [`-Uri '${psSingle(opts.url)}'`, `-Method ${opts.method.charAt(0).toUpperCase()}${opts.method.slice(1).toLowerCase()}`];
  if (headerEntries.length) args.push("-Headers $headers");
  if (opts.body) args.push("-Body $body");
  const contentType = contentTypeOf(opts.headers);
  if (contentType) args.push(`-ContentType '${psSingle(contentType)}'`);
  lines.push(`$response = Invoke-RestMethod ${args.join(" ")}`, "$response | ConvertTo-Json -Depth 10");
  return lines.join("\n");
}

/* ===================== JavaScript / TypeScript ===================== */

/** 原生 fetch；JSON body 内嵌为对象字面量 */
function generateJavaScript(opts: CodeOptions): string {
  const lines: string[] = [`const response = await fetch("${escapeDouble(opts.url)}", {`, `  method: "${opts.method.toUpperCase()}",`];
  const headerEntries = Object.entries(opts.headers);
  if (headerEntries.length) {
    lines.push("  headers: {");
    for (const [key, value] of headerEntries) lines.push(`    "${escapeDouble(key)}": "${escapeDouble(value)}",`);
    lines.push("  },");
  }
  if (opts.body) {
    const parsed = parseJson(opts.body);
    const literal = parsed === undefined ? `"${escapeDouble(opts.body)}"` : indentBlock(JSON.stringify(parsed, null, 2), 2);
    lines.push(`  body: JSON.stringify(${literal}),`);
  }
  lines.push("});", "", "const data = await response.json();", "console.log(data);");
  return lines.join("\n");
}

/** axios 请求代码；body 为 JSON 时内嵌为对象字面量 */
export function generateTsAxios(opts: CodeOptions): string {
  const lines: string[] = [
    'import axios from "axios";',
    "",
    "const { data } = await axios.request({",
    `  method: "${opts.method.toLowerCase()}",`,
    `  url: "${escapeDouble(opts.url)}",`,
  ];
  const headerEntries = Object.entries(opts.headers);
  if (headerEntries.length) {
    lines.push("  headers: {");
    for (const [key, value] of headerEntries) lines.push(`    "${escapeDouble(key)}": "${escapeDouble(value)}",`);
    lines.push("  },");
  }
  if (opts.body) lines.push(`  data: ${opts.body},`);
  lines.push("});", "", "console.log(data);");
  return lines.join("\n");
}

/* ===================== Java ===================== */

/** RestTemplate 请求代码；body 走 text block（JDK 15+），无 body 时置 null */
export function generateJavaRest(opts: CodeOptions): string {
  const headerEntries = Object.entries(opts.headers);
  const hasBody = !!opts.body;
  const lines: string[] = ["RestTemplate restTemplate = new RestTemplate();", ""];
  if (headerEntries.length) {
    lines.push("HttpHeaders headers = new HttpHeaders();");
    for (const [key, value] of headerEntries) lines.push(`headers.set("${escapeDouble(key)}", "${escapeDouble(value)}");`);
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

/* ===================== Python ===================== */

/** JSON 值 → Python 字面量（true/false/null → True/False/None） */
function toPythonLiteral(value: unknown, indent = 0): string {
  const pad = "    ".repeat(indent);
  const inner = "    ".repeat(indent + 1);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  // JSON 字符串转义（\" \\ \n \uXXXX）与 Python 兼容
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const items = value.map((item) => `${inner}${toPythonLiteral(item, indent + 1)},`);
    return `[\n${items.join("\n")}\n${pad}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (!keys.length) return "{}";
  const items = keys.map((key) => `${inner}${JSON.stringify(key)}: ${toPythonLiteral(obj[key], indent + 1)},`);
  return `{\n${items.join("\n")}\n${pad}}`;
}

/** requests 请求代码；JSON body 走 json=，否则 data= 原始字符串 */
function generatePython(opts: CodeOptions): string {
  const lines: string[] = ["import requests", "", `url = "${escapeDouble(opts.url)}"`];
  const headerEntries = Object.entries(opts.headers);
  if (headerEntries.length) {
    lines.push("headers = {");
    for (const [key, value] of headerEntries) lines.push(`    "${escapeDouble(key)}": "${escapeDouble(value)}",`);
    lines.push("}");
  }
  const args = ["url"];
  if (headerEntries.length) args.push("headers=headers");
  if (opts.body) {
    const parsed = parseJson(opts.body);
    if (parsed === undefined) {
      lines.push(`data = ${JSON.stringify(opts.body)}`);
      args.push("data=data");
    } else {
      lines.push(`json = ${toPythonLiteral(parsed)}`);
      args.push("json=json");
    }
  }
  lines.push("", `response = requests.${opts.method.toLowerCase()}(${args.join(", ")})`, "", "print(response.status_code)", "print(response.text)");
  return lines.join("\n");
}

/* ===================== Go ===================== */

/** net/http 标准库；body 优先 raw string literal，含反引号时退回解释型字符串 */
function generateGo(opts: CodeOptions): string {
  const lines: string[] = ["package main", "", "import (", '\t"fmt"', '\t"io"', '\t"net/http"', '\t"strings"', ")", "", "func main() {"];
  if (opts.body) {
    const compact = compactBody(opts.body);
    const literal = compact.includes("`") ? JSON.stringify(compact) : `\`${compact}\``;
    lines.push(`\tbody := strings.NewReader(${literal})`);
  } else {
    lines.push("\tvar body io.Reader");
  }
  lines.push("", `\treq, _ := http.NewRequest("${opts.method.toUpperCase()}", "${escapeDouble(opts.url)}", body)`);
  for (const [key, value] of Object.entries(opts.headers)) {
    lines.push(`\treq.Header.Set("${escapeDouble(key)}", "${escapeDouble(value)}")`);
  }
  lines.push(
    "\tres, err := http.DefaultClient.Do(req)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer res.Body.Close()",
    "",
    "\tdata, _ := io.ReadAll(res.Body)",
    "\tfmt.Println(string(data))",
    "}"
  );
  return lines.join("\n");
}

/* ===================== PHP ===================== */

/** curl 扩展；Content-Type 已在 headers 中时不再重复 CURLOPT_ */
function generatePhp(opts: CodeOptions): string {
  const lines: string[] = ["<?php", "", `$ch = curl_init('${escapeSingle(opts.url)}');`, "", "curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);"];
  lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${opts.method.toUpperCase()}');`);
  const headerEntries = Object.entries(opts.headers);
  if (headerEntries.length) {
    lines.push("curl_setopt($ch, CURLOPT_HTTPHEADER, [");
    for (const [key, value] of headerEntries) lines.push(`    '${escapeSingle(`${key}: ${value}`)}',`);
    lines.push("]);");
  }
  if (opts.body) {
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, '${escapeSingle(compactBody(opts.body))}');`);
  }
  lines.push("", "$response = curl_exec($ch);", "curl_close($ch);", "", "echo $response;");
  return lines.join("\n");
}

/* ===================== HTTP ===================== */

/** 原始 HTTP 报文：请求行 + 头 + 空行 + body */
function generateHttp(opts: CodeOptions): string {
  let target = opts.url;
  let host = "";
  try {
    const u = new URL(opts.url);
    target = `${u.pathname || "/"}${u.search}`;
    host = u.host;
  } catch {
    // 非法 URL 时请求行退回完整地址
  }
  const lines: string[] = [`${opts.method.toUpperCase()} ${target} HTTP/1.1`];
  if (host) lines.push(`Host: ${host}`);
  for (const [key, value] of Object.entries(opts.headers)) lines.push(`${key}: ${value}`);
  if (opts.body) lines.push("", compactBody(opts.body));
  return lines.join("\n");
}
