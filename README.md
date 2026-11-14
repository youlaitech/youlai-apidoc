# apilens

Spring Boot Starter，为 springdoc 生成的 OpenAPI 文档提供自建 UI，替代 knife4j。

## 背景

Swagger UI 的页面交互弱，knife4j 已停止维护。apilens 只做 UI 层：不生成文档、不定义协议，输入始终是 springdoc 通过 `/v3/api-docs` 输出的 OpenAPI 文档。

## 协议

以 OpenAPI 规范为唯一依据。凡是规范没有定义的字段，apilens 都不作为功能依赖；`x-` 扩展只在明确兼容生态习惯时读取。

### 支持的版本

| 版本 | 行为 |
| --- | --- |
| 3.1.x | 完整解析（JSON Schema 2020-12） |
| 3.0.x | 加载并提示，按 3.1 语义渲染 |
| 3.2.x | 按 3.1 语义渲染，新增字段暂不展示 |
| 2.0 | 拒绝，需迁移到 springdoc 3.x |

### 字段来源

| 展示内容 | 读取字段 |
| --- | --- |
| 分组 | `tags`、`operation.tags` |
| 接口 | `paths`、`operation.summary`、`operation.description`、`operation.deprecated` |
| 参数 | `parameters[]`、`requestBody` |
| 鉴权 | `components.securitySchemes`、`operation.security` |
| 服务地址 | `servers` |
| 响应 | `responses[].content` |

### 扩展字段

`x-` 前缀是 OpenAPI 预留的扩展位。apilens 只读取一个扩展：

- `x-order`：knife4j 用于指定显示顺序，值小的在前，由 `@ApiOperationSupport(order)` 写入文档

未声明 `x-order` 时，分组按名称、接口按路径排序。`tagsSorter`、`operationsSorter` 是 Swagger UI 的界面参数，不属于规范，apilens 不读取。

## 模块

| 模块 | 说明 |
| --- | --- |
| `apilens-dependencies` | 版本管理 BOM |
| `apilens-core` | 前端静态资源、配置属性、工具类 |
| `apilens-spring-boot-starter` | WebMvc 单体应用自动配置与 `/doc.html` 跳转 |
| `apilens-gateway-spring-boot-starter` | Spring Cloud Gateway 文档聚合 |

## 构建

前端产物写入 `apilens-core/src/main/resources/META-INF/resources/apilens/`，再由 Maven 打进 JAR：

```bash
cd apilens-core/frontend
pnpm install
pnpm build

cd ../..
mvn clean package
```

## 文档

- [使用指南](docs/guide.md)
- [发布到 Maven Central](docs/publish-to-maven-central.md)
