# 使用指南

## 适用场景

已经用 springdoc 生成 OpenAPI 文档，但不想继续用 Swagger UI 或 knife4j 的项目：

- Swagger UI 的接口详情与调试交互偏弱
- knife4j 停止维护，且其 UI 依赖的 springdoc 版本停留在 2.x

apilens 只替换 UI 层，`/v3/api-docs` 仍由 springdoc 生成，接入前后接口文档内容不变。

## 演进与生态

| 时间 | 事件 |
| --- | --- |
| 2010 | Swagger 项目启动，用于描述 REST API |
| 2014 | Swagger 2.0 规范发布 |
| 2015 | 规范捐给 Linux 基金会，OpenAPI Initiative 成立 |
| 2017 | OpenAPI 3.0 发布，规范正式更名 |
| 2019 | springdoc 出现，直接面向 OpenAPI 3 |
| 2021 | OpenAPI 3.1 发布，Schema 对齐 JSON Schema 2020-12 |
| 2025-09 | OpenAPI 3.2 发布，向后兼容 3.1 |
| 2026-10 | springdoc 3.2.0 发布，加入 MCP 支持 |

四者的关系：

- **OpenAPI**：规范，定义文档的结构，与语言、框架无关
- **Swagger**：工具品牌（Swagger UI、Editor、Codegen）；Swagger 2.0 是 OpenAPI 2.0 的旧名
- **springdoc**：OpenAPI 规范在 Spring 的实现，扫描 controller 生成 `/v3/api-docs`
- **apilens**：只做 UI，读取 `/v3/api-docs` 的 JSON 渲染页面

## 协议约定

apilens 读取的是 OpenAPI 文档，不读取 springdoc 的内部模型，也不读取 knife4j 的私有配置。

### 版本

| 文档版本 | 行为 |
| --- | --- |
| 3.1.x | 完整解析，Schema 按 JSON Schema 2020-12 处理 |
| 3.0.x | 加载并在页面顶部提示，按 3.1 语义渲染 |
| 3.2.x | 按 3.1 语义渲染，3.2 新增字段暂不展示 |
| 2.0 | 拒绝，提示迁移到 springdoc 3.x |

### 字段

| 展示内容 | 读取字段 |
| --- | --- |
| 文档标题与版本 | `info.title`、`info.version`、`info.description` |
| 分组 | `tags`、`operation.tags` |
| 接口 | `paths`、`operation.summary`、`operation.description`、`operation.deprecated` |
| 参数 | `parameters[]`（`in` 取 `path`、`query`、`header`、`cookie`） |
| 请求体 | `requestBody.content`，当前只取 `application/json` |
| 鉴权 | `components.securitySchemes`、`operation.security` |
| 服务地址 | `servers` |
| 响应 | `responses[].content`，当前只取 `application/json` |

### 扩展

`x-` 前缀是 OpenAPI 规范预留的扩展位。apilens 只读取 `x-order`：

- tag 上：`"x-order": 1`
- operation 上：`"x-order": 33`

值小的排在前面。knife4j 通过 `@ApiOperationSupport(order)` 把注解值写入该字段；没有该字段时，分组按名称、接口按路径排序。

## 环境要求

| 项 | 版本 |
| --- | --- |
| Java | 17+ |
| Spring Boot | 4.x |
| springdoc | 3.1.x |

springdoc 由使用方引入，apilens 只依赖它的 `/v3/api-docs` 端点。

## 单体应用接入

### 依赖

```xml
<dependency>
    <groupId>tech.youlai</groupId>
    <artifactId>apilens-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

### 访问

启动后访问 `http://localhost:8000/doc.html`，服务端 302 跳转到 `/apilens/index.html`，页面从 `/v3/api-docs` 读取文档。

### 安全白名单

使用 Spring Security 时，放行入口与静态资源：

```yaml
security:
  permit-all-urls:
    - /doc.html
    - /apilens/**
    - /v3/api-docs/**
```

### 配置

```yaml
apilens:
  doc:
    enabled: true        # 关闭自动配置
    path: /doc.html      # 入口路径
    production: false    # true 时入口返回 404
```

`apilens.doc.api-docs-path` 与 `apilens.doc.title` 为预留字段，当前版本不生效：页面固定请求 `/v3/api-docs`，标题取文档的 `info.title`。

## 网关聚合

适用于 Spring Cloud Gateway（WebFlux），从注册中心拉取多个服务的文档。

### 依赖

```xml
<dependency>
    <groupId>tech.youlai</groupId>
    <artifactId>apilens-gateway-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

网关需自带 `spring-cloud-starter-loadbalancer`，否则 `lb://` 无法解析服务名。

### 配置

```yaml
apilens:
  doc:
    gateway:
      services:
        - system-service
        - auth-service
      api-docs-path: /v3/api-docs
```

### 端点

| 路径 | 说明 |
| --- | --- |
| `/v3/api-docs/swagger-config` | 服务列表，供页面展示服务下拉 |
| `/v3/api-docs/{serviceName}` | 指定服务的原始文档 |
| `/v3/api-docs/aggregate` | 并行拉取所有服务并合并 |

合并规则：`paths` 加服务名前缀避免冲突，`tags` 按名称去重，`components.schemas` 合并，`openapi` 与 `info` 取第一个有效文档。单个服务拉取失败不影响其他服务。

## 排序

排序优先级：

1. `x-order` 升序
2. 未声明时分组按名称、接口按路径

`youlai-boot` 这类没有写 `order` 的项目会走第二条，顺序稳定可预期；需要固定顺序时在方法上加 `@ApiOperationSupport(order = n)`。

## MCP 与 AI 调用

springdoc 3.2.0 起提供 MCP 支持，把 `@RestController` 的接口转成 AI 可调用的工具：

- `/mcp`：MCP 协议端点，Claude Desktop、Cursor 等客户端连接
- `/mcp-ui`：开发者仪表盘，查看工具、手工调用、审批变更操作
- `@McpToolDescription`：为 AI 提供独立的接口描述
- 默认将 POST/PUT/DELETE 视为 mutating，需要人工确认

需要额外引入 `springdoc-openapi-starter-webmvc-mcp`，并依赖 Spring AI。

apilens 当前不读取 MCP 元数据。`/mcp-ui` 与文档界面是两套入口：前者面向 AI 调用，后者面向人阅读和调试。

后续可基于 OAS 元数据扩展的方向（尚未实现）：

- 接口详情展示对应的 MCP 工具名、描述、是否 mutating
- 生成 MCP 客户端配置片段
- 复用参数与示例元数据生成工具调用示例

## 设计目标

apilens 的界面完全由 OAS 元数据驱动，不维护独立的接口数据源。以下为规划能力，当前实现见[当前限制](#当前限制)：

- 按 tag 浏览、搜索、快捷键切换接口
- 接口收藏与最近访问
- 参数与 Schema 按规范字段渲染，包含类型、格式、约束、示例
- 在线调试按参数生成请求，支持认证方案与文件上传
- 响应按状态码展示模型与示例，保留请求历史
- 生成 cURL 与常见语言代码片段

界面优先保证信息密度与可读性：一屏内能看到分组、路径、方法与摘要，详情页不靠折叠面板堆叠。

## 本地开发

```bash
cd apilens-core/frontend
pnpm install
pnpm dev
```

页面地址 `http://localhost:3100/apilens/`，`/v3/api-docs` 与 `/api/` 代理到 `http://localhost:8000`。开发时需要先启动提供文档的后端。

## 当前限制

- 请求体只支持 `application/json`，`multipart/form-data` 与 `application/x-www-form-urlencoded` 暂不支持
- 响应只按 `application/json` 展示，非 JSON 响应按文本输出
- 网关 starter 未提供 `/doc.html` 跳转，只能直接访问 `/apilens/index.html`
- `production=true` 只关闭 `/doc.html` 入口，静态资源与 `/v3/api-docs` 仍可访问
- Maven 构建尚未集成前端，打包前需要先执行 `pnpm build`
