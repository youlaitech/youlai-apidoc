/**
 * 一键获取令牌：优先从 OpenAPI 文档推导配置，所有端点与参数均可自定义。
 *
 * - oauth2：使用 flows 中声明的 tokenUrl，按 RFC 6749 密码模式提交表单。
 * - 其他方案：从文档中识别账号密码登录接口；无法识别时留空，由使用方在高级设置中填写。
 * - 非 oauth2 的令牌字段路径默认留空，自动识别常见响应结构，不绑定特定后端。
 *
 * 图形验证码：自动识别文档中的验证码端点与登录表单字段，也可完全手动配置。
 * 识别到验证码时默认开启，后端返回验证码错误时自动开启；配置按 scheme 名称保存到本机浏览器。
 */
import axios from "axios";
import type { OpenAPIDocument, Operation, Schema, SecurityScheme } from "../types/openapi";

export interface TokenFetchParam {
  key: string;
  value: string;
}

interface TokenFetchCaptchaConfig {
  /** 获取令牌时是否附加图形验证码 */
  enabled: boolean;
  /** 验证码图片端点（GET）；优先从文档识别，无法识别时需手动填写 */
  endpoint: string;
  /** 验证码缓存 ID 的参数名 */
  idKey: string;
  /** 用户输入验证码的参数名 */
  codeKey: string;
}

export interface TokenFetchConfig {
  endpoint: string;
  method: "POST" | "GET";
  contentType: "json" | "form";
  params: TokenFetchParam[];
  /** 令牌在响应中的字段路径（a.b.c）；空串表示自动识别 */
  tokenPath: string;
  /** 图形验证码辅助（登录需要验证码时自动开启） */
  captcha: TokenFetchCaptchaConfig;
}

const STORAGE_KEY = "apidoc-token-fetch-configs";

/** 解析 components.schemas 内的 $ref（文档通常已 dereference，此处兜底） */
function resolveSchema(schema: Schema | undefined, doc?: OpenAPIDocument | null): Schema | undefined {
  let cur = schema;
  const seen = new Set<string>();
  while (cur?.$ref && doc) {
    if (seen.has(cur.$ref)) return undefined;
    seen.add(cur.$ref);
    const parts = cur.$ref.replace(/^#\//, "").split("/");
    let target: unknown = doc;
    for (const part of parts) {
      if (!target || typeof target !== "object") return undefined;
      target = (target as Record<string, unknown>)[part];
    }
    cur = target as Schema | undefined;
  }
  return cur;
}

/**
 * 从文档识别图形验证码端点：优先 GET 且路径以 /captcha 结尾，
 * 其次 operationId 含 captcha，再次摘要含「验证码」（排除短信验证码）。
 */
function detectCaptchaEndpoint(doc?: OpenAPIDocument | null): string {
  if (!doc?.paths) return "";
  let best = "";
  let bestScore = 0;
  for (const [path, item] of Object.entries(doc.paths)) {
    if (/sms/i.test(path)) continue;
    const op = item?.get;
    if (!op) continue;
    let score = 0;
    if (/\/captcha$/i.test(path)) score = 3;
    else if (/captcha/i.test(op.operationId || "")) score = 2;
    else if (/验证码|captcha/i.test(op.summary || "")) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}

/** 登录请求体是否声明了 captcha 字段；有则返回推导出的参数名 */
function detectLoginCaptcha(
  doc: OpenAPIDocument | null | undefined,
  endpoint: string,
  method: string
): { idKey: string; codeKey: string } | null {
  if (!doc?.paths) return null;
  let path = endpoint.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const op = (doc.paths[path] as Record<string, Operation | undefined> | undefined)?.[method.toLowerCase()];
  const content = op?.requestBody?.content;
  if (!content) return null;
  const media = content["application/json"] || Object.values(content)[0];
  const schema = resolveSchema(media?.schema, doc);
  const props = schema?.properties;
  if (!props) return null;
  const keys = Object.keys(props).filter((k) => /captcha|verifycode|verificationcode/i.test(k));
  if (!keys.length) return null;
  const idKey = keys.find((k) => /id$/i.test(k)) || "captchaId";
  const codeKey = keys.find((k) => /(code|value|answer)$/i.test(k)) || "captchaCode";
  return { idKey, codeKey };
}

interface LoginEndpointMatch {
  endpoint: string;
  contentType: "json" | "form";
}

/**
 * 从 POST 接口中识别账号密码登录端点。
 * 综合路径、operationId、摘要和请求体字段评分，排除刷新、扫码、短信等非密码登录接口。
 */
function detectLoginEndpoint(doc?: OpenAPIDocument | null): LoginEndpointMatch | null {
  if (!doc?.paths) return null;
  let best: (LoginEndpointMatch & { score: number }) | null = null;
  for (const [path, item] of Object.entries(doc.paths)) {
    const op = item?.post;
    if (!op) continue;
    const text = `${path} ${op.operationId || ""} ${op.summary || ""}`;
    if (/logout|sign[ -]?out|refresh|captcha|qr[ -]?code|scan|sms|register|退出|登出|刷新|扫码|短信|注册/i.test(text)) {
      continue;
    }

    const content = op.requestBody?.content || {};
    const media = content["application/json"] || content["application/x-www-form-urlencoded"] || Object.values(content)[0];
    const keys = Object.keys(resolveSchema(media?.schema, doc)?.properties || {});
    const hasUsername = keys.some((key) => /^(username|userName|account|email|mobile)$/i.test(key));
    const hasPassword = keys.some((key) => /^(password|passwd|pwd)$/i.test(key));
    const loginHint = /(?:^|\/)login\/?$/i.test(path) || /login|sign[ -]?in/i.test(op.operationId || "") || /登录|登陆/.test(op.summary || "");
    const tokenHint = /(?:^|\/)token\/?$/i.test(path) || /token|令牌/i.test(`${op.operationId || ""} ${op.summary || ""}`);
    if (!loginHint && !tokenHint && !(hasUsername && hasPassword)) continue;

    let score = 0;
    if (loginHint) score += 5;
    if (tokenHint) score += 2;
    if (hasUsername) score += 3;
    if (hasPassword) score += 3;
    if (!best || score > best.score) {
      best = {
        endpoint: path,
        contentType: content["application/x-www-form-urlencoded"] && !content["application/json"] ? "form" : "json",
        score,
      };
    }
  }
  return best ? { endpoint: best.endpoint, contentType: best.contentType } : null;
}

/** 按认证方案与 OpenAPI 文档生成默认配置；未识别的端点留空，不作项目级假设 */
export function defaultTokenFetchConfig(scheme?: SecurityScheme, doc?: OpenAPIDocument | null): TokenFetchConfig {
  const oauth = scheme?.type === "oauth2";
  const tokenUrl = Object.values(scheme?.flows || {})
    .map((f) => f?.tokenUrl)
    .find(Boolean);
  const loginEndpoint = oauth ? null : detectLoginEndpoint(doc);
  const endpoint = tokenUrl || loginEndpoint?.endpoint || "";
  const captchaEndpoint = detectCaptchaEndpoint(doc);
  const loginCaptcha = detectLoginCaptcha(doc, endpoint, "POST");
  return {
    endpoint,
    method: "POST",
    contentType: oauth ? "form" : loginEndpoint?.contentType || "json",
    params: oauth
      ? [
          { key: "grant_type", value: "password" },
          { key: "username", value: "" },
          { key: "password", value: "" },
        ]
      : [
          { key: "username", value: "" },
          { key: "password", value: "" },
        ],
    tokenPath: oauth ? "access_token" : "",
    captcha: {
      // 文档识别到验证码端点或登录表单声明 captcha 字段时默认开启，与登录页的验证码输入习惯一致
      enabled: Boolean(captchaEndpoint || loginCaptcha),
      endpoint: captchaEndpoint,
      idKey: loginCaptcha?.idKey || "captchaId",
      codeKey: loginCaptcha?.codeKey || "captchaCode",
    },
  };
}

// 账号密码、客户端密钥等参数只留在内存，不写入浏览器存储
const SECRET_PARAM_KEY = /pass(word)?|pwd|secret|token|credential|api[-_]?key|access[-_]?key|authorization|cookie|session/i;

function clearSecretValues(cfg: TokenFetchConfig): boolean {
  let changed = false;
  for (const param of cfg.params) {
    if (SECRET_PARAM_KEY.test(param.key) && param.value) {
      param.value = "";
      changed = true;
    }
  }
  return changed;
}

function loadAll(): Record<string, TokenFetchConfig> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const all = parsed as Record<string, TokenFetchConfig>;
    let changed = false;
    for (const cfg of Object.values(all)) {
      if (cfg && Array.isArray(cfg.params) && clearSecretValues(cfg)) changed = true;
    }
    // 清理旧版本可能已经写入 localStorage 的密码
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return all;
  } catch {
    return {};
  }
}

/**
 * 读取已保存的自定义配置，未保存返回 null（使用文档推导的默认配置）。
 * 旧版本保存的配置缺少 captcha 字段时，按当前文档重新推导默认值合并。
 */
export function loadTokenFetchConfig(
  name: string,
  scheme?: SecurityScheme,
  doc?: OpenAPIDocument | null
): TokenFetchConfig | null {
  const saved = loadAll()[name];
  if (!saved) return null;
  const defaults = defaultTokenFetchConfig(scheme, doc);
  return {
    ...defaults,
    ...saved,
    params: Array.isArray(saved.params) ? saved.params : defaults.params,
    captcha: { ...defaults.captcha, ...(saved.captcha || {}) },
  };
}

export function saveTokenFetchConfig(name: string, cfg: TokenFetchConfig) {
  try {
    const all = loadAll();
    all[name] = {
      ...cfg,
      params: cfg.params.map((param) => ({
        ...param,
        value: SECRET_PARAM_KEY.test(param.key) ? "" : param.value,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage 不可用时仅保留内存配置
  }
}

export function clearTokenFetchConfig(name: string) {
  try {
    const all = loadAll();
    delete all[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 忽略存储异常
  }
}

/** 常见令牌字段路径，tokenPath 留空时按序尝试 */
const AUTO_PATHS = ["data.accessToken", "data.access_token", "data.token", "accessToken", "access_token", "token"];

function valueAtPath(data: unknown, path: string): string | null {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "string" && cur.trim()) return cur.trim();
  if (typeof cur === "number") return String(cur);
  return null;
}

/** 从响应中提取令牌：指定路径优先，留空自动识别；裸字符串响应直接视为令牌 */
function extractToken(data: unknown, tokenPath: string): string | null {
  if (typeof data === "string") return data.trim() || null;
  const path = tokenPath.trim();
  if (path) return valueAtPath(data, path);
  for (const p of AUTO_PATHS) {
    const t = valueAtPath(data, p);
    if (t) return t;
  }
  return null;
}

/** 常见响应包装与网关使用的成功业务码 */
const OK_CODES = new Set<unknown>(["00000", "200", "0", 0, 200]);

/** 拼接端点：绝对地址直连，相对路径基于 baseUrl */
function joinUrl(endpoint: string, baseUrl: string): string {
  return /^https?:\/\//i.test(endpoint) ? endpoint : baseUrl + endpoint;
}

/** 从 HTTP 错误响应提取后端 msg */
function httpErrorDetail(data: unknown): string {
  const body = data as { msg?: string; message?: string } | null;
  return body && typeof body === "object" ? body.msg || body.message || "" : "";
}

interface CaptchaImage {
  /** 验证码缓存 ID，登录时原样回传 */
  id: string;
  /** 可直接用于 <img src> 的图片地址（data URI） */
  image: string;
}

/**
 * 请求验证码端点（GET），支持 data 包装或裸对象；
 * 识别 captchaId/id 与 captchaBase64/captchaImage/image，base64 自动补 data URI 前缀。
 */
export async function fetchCaptcha(cfg: TokenFetchConfig, baseUrl: string): Promise<CaptchaImage> {
  const endpoint = cfg.captcha.endpoint.trim();
  if (!endpoint) throw new Error("未识别到验证码端点，请在高级设置中填写");
  const res = await axios.get(joinUrl(endpoint, baseUrl), { validateStatus: () => true, timeout: 15000 });
  if (res.status >= 400) {
    const detail = httpErrorDetail(res.data);
    throw new Error(`验证码端点返回 ${res.status}${detail ? "：" + detail : ""}`);
  }
  const data: unknown = res.data;
  if (data && typeof data === "object" && "code" in data) {
    const r = data as { code?: unknown; msg?: string; data?: unknown };
    if (!OK_CODES.has(r.code)) throw new Error(r.msg || `验证码业务码 ${String(r.code)}`);
  }
  const payload = (
    data && typeof data === "object" && "data" in data && (data as { data?: unknown }).data &&
    typeof (data as { data?: unknown }).data === "object"
      ? (data as { data: Record<string, unknown> }).data
      : data
  ) as Record<string, unknown> | null;
  const id = String(payload?.captchaId ?? payload?.id ?? "").trim();
  let image = String(payload?.captchaBase64 ?? payload?.captchaImage ?? payload?.image ?? "").trim();
  if (!id || !image) throw new Error("验证码响应缺少 captchaId / captchaBase64 字段，请检查验证码端点");
  if (!/^data:/i.test(image)) image = "data:image/png;base64," + image;
  return { id, image };
}

/**
 * 请求令牌端点并提取令牌；失败抛出带用户可读信息的 Error。
 * extraParams 为附加参数（如验证码），与自定义参数同名时以自定义参数为准。
 */
export async function fetchToken(
  cfg: TokenFetchConfig,
  baseUrl: string,
  extraParams: TokenFetchParam[] = []
): Promise<string> {
  const endpoint = cfg.endpoint.trim();
  if (!endpoint) throw new Error("未识别到令牌端点，请在高级设置中填写");
  const url = joinUrl(endpoint, baseUrl);
  const params: Record<string, string> = {};
  for (const p of extraParams) if (p.key.trim()) params[p.key.trim()] = p.value;
  for (const p of cfg.params) if (p.key.trim()) params[p.key.trim()] = p.value;

  const res = await axios.request({
    method: cfg.method,
    url,
    headers: {
      "Content-Type": cfg.contentType === "form" ? "application/x-www-form-urlencoded" : "application/json",
    },
    params: cfg.method === "GET" ? params : undefined,
    data:
      cfg.method === "POST"
        ? cfg.contentType === "form"
          ? new URLSearchParams(params).toString()
          : JSON.stringify(params)
        : undefined,
    validateStatus: () => true,
    timeout: 15000,
  });
  if (res.status >= 400) {
    const detail = httpErrorDetail(res.data);
    throw new Error(`令牌端点返回 ${res.status}${detail ? "：" + detail : ""}，请检查端点与参数`);
  }
  const data: unknown = res.data;
  if (data && typeof data === "object" && "code" in data) {
    const r = data as { code?: unknown; msg?: string };
    if (!OK_CODES.has(r.code)) throw new Error(r.msg || `业务码 ${String(r.code)}`);
  }
  const token = extractToken(data, cfg.tokenPath);
  if (!token) {
    throw new Error(`未能从响应提取令牌（路径：${cfg.tokenPath.trim() || "自动"}），请调整令牌字段路径`);
  }
  return token;
}