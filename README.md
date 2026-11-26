# apishow

Spring Boot Starter，为 springdoc 生成的 OpenAPI 文档提供自建 UI，替代 knife4j。

文档：https://www.youlai.tech/docs/ecosystem/apishow/
仓库：https://github.com/youlaitech/youlai-apishow

## 背景

Swagger UI 的页面交互弱，knife4j 已停止维护。apishow 只做 UI 层：不生成文档、不定义协议，输入始终是 springdoc 通过 `/v3/api-docs` 输出的 OpenAPI 文档。

## 协议

以 OpenAPI 规范为唯一依据。凡是规范没有定义的字段，apishow 都不作为功能依赖；`x-` 扩展只在明确兼容生态习惯时读取。

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

`x-` 前缀是 OpenAPI 预留的扩展位。apishow 读取两个扩展：

- `x-order`：knife4j 用于指定显示顺序，值小的在前，由 `@ApiOperationSupport(order)` 写入文档
- `x-group`：指定接口所属的二级分组，用于生成 `tag → 二级分组 → 接口` 三级导航

未声明 `x-order` 时，分组按名称、接口按路径排序。`tagsSorter`、`operationsSorter` 是 Swagger UI 的界面参数，不属于规范，apishow 不读取。

## 模块

| 模块 | 说明 |
| --- | --- |
| `apishow-dependencies` | 版本管理 BOM，只管理 apishow 自身模块 |
| `apishow-core` | 前端静态资源、配置属性、工具类 |
| `apishow-spring-boot-starter` | WebMvc 单体应用自动配置与 `/doc.html` 入口 |
| `apishow-gateway-spring-boot-starter` | Spring Cloud Gateway 文档聚合 |

## 配置

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `apishow.enabled` | `true` | 关闭后不注册文档入口与静态资源 |
| `apishow.path` | `/doc.html` | 文档入口路径，页面资源固定在 `/apishow/` |

网关聚合在 `apishow.gateway` 下配置 `services`（聚合的服务名列表）与 `api-docs-path`（默认 `/v3/api-docs`）。

## 构建

前端产物写入 `apishow-core/src/main/resources/META-INF/resources/apishow/`，再由 Maven 打进 JAR：

```bash
cd apishow-core/frontend
pnpm install
pnpm test
pnpm build

cd ../..
mvn clean verify
```

## 发布到 Maven Central

Maven Central 不允许覆盖已发布版本，发布前先按实际情况升版本：

`versions:set` 只改继承父 POM 的模块，`apishow-dependencies` 不继承父 POM，需手动改它的 `<version>`，否则父 POM 的 BOM import 解析不到新版本。

```powershell
# 1. 升版本，取下一个未发布版本号
mvn versions:set "-DnewVersion=0.4.0" "-DgenerateBackupPoms=false"

# 2. 本地验证：测试、编译、sources、javadoc、GPG 签名
mvn clean verify

# 3. 上传到 Central Portal
mvn clean deploy
```

`deploy` 只上传到 Central Portal，还需在 Portal 的 Deployments 中确认并点 **Publish**。
