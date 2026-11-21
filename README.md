# apidoc4j

Spring Boot Starter，为 springdoc 生成的 OpenAPI 文档提供自建 UI，替代 knife4j。

仓库：https://github.com/youlaitech/youlai-apidoc

## 背景

Swagger UI 的页面交互弱，knife4j 已停止维护。apidoc4j 只做 UI 层：不生成文档、不定义协议，输入始终是 springdoc 通过 `/v3/api-docs` 输出的 OpenAPI 文档。

## 协议

以 OpenAPI 规范为唯一依据。凡是规范没有定义的字段，apidoc4j 都不作为功能依赖；`x-` 扩展只在明确兼容生态习惯时读取。

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

`x-` 前缀是 OpenAPI 预留的扩展位。apidoc4j 读取两个扩展：

- `x-order`：knife4j 用于指定显示顺序，值小的在前，由 `@ApiOperationSupport(order)` 写入文档
- `x-group`：指定接口所属的二级分组，用于生成 `tag → 二级分组 → 接口` 三级导航

未声明 `x-order` 时，分组按名称、接口按路径排序。`tagsSorter`、`operationsSorter` 是 Swagger UI 的界面参数，不属于规范，apidoc4j 不读取。

## 模块

| 模块 | 说明 |
| --- | --- |
| `apidoc4j-dependencies` | 版本管理 BOM |
| `apidoc4j-core` | 前端静态资源、配置属性、工具类 |
| `apidoc4j-spring-boot-starter` | WebMvc 单体应用自动配置与 `/doc.html` 跳转 |
| `apidoc4j-gateway-spring-boot-starter` | Spring Cloud Gateway 文档聚合 |

## 构建

前端产物写入 `apidoc4j-core/src/main/resources/META-INF/resources/apidoc4j/`，再由 Maven 打进 JAR：

```bash
cd apidoc4j-core/frontend
pnpm install
pnpm build

cd ../..
mvn clean package
```

## 发布到 Maven Central

Maven Central 不允许覆盖已发布版本，发布前先按实际情况升版本：

```powershell
# 1. 升版本；若 0.1.1 已存在，换成下一个可用版本
mvn versions:set -DnewVersion=0.1.1 -DgenerateBackupPoms=false

# 2. 本地验证：编译、sources、javadoc、GPG 签名
mvn clean verify -DskipTests

# 3. 上传到 Central Portal
mvn clean deploy -DskipTests
```

`deploy` 只上传到 Central Portal，还需在 Portal 的 Deployments 中确认并点 **Publish**。
