import { describe, expect, it } from "vitest";
import { CODE_LANGS, generateCode } from "./codegen";

const base = {
  method: "post",
  url: "https://api.example.com/v1/users?page=1&q=it's",
  headers: { "Content-Type": "application/json", Authorization: 'Bearer ab"cd' },
  body: '{\n  "name": "Tom\'s \\"quote\\"",\n  "enabled": true,\n  "tags": []\n}',
};

describe("generateCode", () => {
  it("每种语言都能生成且包含请求地址", () => {
    for (const lang of CODE_LANGS) {
      const code = generateCode(lang.value, base);
      expect(code).toContain("api.example.com");
      expect(code.length).toBeGreaterThan(20);
    }
  });

  it("未知语言回退 cURL", () => {
    expect(generateCode("unknown" as never, base)).toBe(generateCode("curl", base));
  });

  it("cURL：单引号转义、JSON body 压缩为单行、反斜杠换行", () => {
    const code = generateCode("curl", base);
    expect(code.split("\n")[0]).toBe("curl -X POST 'https://api.example.com/v1/users?page=1&q=it'\\''s' \\");
    expect(code).toContain("  -H 'Authorization: Bearer ab\"cd' \\");
    // body 内的单引号按 bash 规则转为 '\''，JSON 压缩为单行
    expect(code.endsWith(`  -d '{"name":"Tom'\\''s \\"quote\\"","enabled":true,"tags":[]}'`)).toBe(true);
  });

  it("PowerShell：单引号成对转义，Content-Type 走 -ContentType", () => {
    const code = generateCode("powershell", base);
    expect(code).toContain("-Uri 'https://api.example.com/v1/users?page=1&q=it''s' -Method Post");
    expect(code).not.toContain('"Content-Type" =');
    expect(code).toContain("-ContentType 'application/json'");
  });

  it("PowerShell：请求与输出语句之间不留空行", () => {
    const code = generateCode("powershell", { method: "get", url: base.url, headers: {} });
    expect(code).not.toContain("\n\n");
  });

  it("JavaScript：JSON body 内嵌为对象字面量", () => {
    const code = generateCode("javascript", base);
    expect(code).toContain('body: JSON.stringify({\n    "name": "Tom\'s \\"quote\\"",\n    "enabled": true,\n    "tags": []\n  }),');
  });

  it("Python：JSON 字面量转 True/None，非 JSON 走 data=", () => {
    const code = generateCode("python", { ...base, body: '{"enabled": true, "parent": null}' });
    expect(code).toContain('"enabled": True,');
    expect(code).toContain('"parent": None,');
    expect(code).toContain("requests.post(url, headers=headers, json=json)");
    const raw = generateCode("python", { ...base, body: "plain text" });
    expect(raw).toContain('data = "plain text"');
    expect(raw).toContain("requests.post(url, headers=headers, data=data)");
  });

  it("Go：含反引号的 body 退回解释型字符串", () => {
    expect(generateCode("go", base)).toContain('strings.NewReader(`{"name":');
    expect(generateCode("go", { ...base, body: "a`b" })).toContain('strings.NewReader("a`b")');
  });

  it("HTTP：请求行只含 path + query，Host 单独一行", () => {
    const code = generateCode("http", base);
    const lines = code.split("\n");
    // URL 规范化：' 在 query 中编码为 %27
    expect(lines[0]).toBe("POST /v1/users?page=1&q=it%27s HTTP/1.1");
    expect(lines[1]).toBe("Host: api.example.com");
    expect(lines[lines.length - 1]).toBe('{"name":"Tom\'s \\"quote\\"","enabled":true,"tags":[]}');
  });

  it("无 body 的 GET 请求", () => {
    const opts = { method: "get", url: "https://api.example.com/ping", headers: {} };
    expect(generateCode("curl", opts)).toBe("curl -X GET 'https://api.example.com/ping'");
    expect(generateCode("go", opts)).toContain("var body io.Reader");
    expect(generateCode("java", opts)).toContain("String body = null;");
  });
});
