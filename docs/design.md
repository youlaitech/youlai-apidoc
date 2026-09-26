# apilens 设计方案

## 一、项目定位

apilens 是一组 **Spring Boot Starter**，作为 knife4j 的替代方案，为 SpringDoc 生成的 OpenAPI 3 JSON 提供自建的文档 UI。

**核心价值**：不依赖任何停更的第三方文档 UI，自建可控、轻量、可发布到 Maven 中央仓库。

**与 knife4j 的区别**：knife4j 维护了 12 个模块（OpenAPI2/3 × Jakarta/非Jakarta × WebMVC/WebFlux × 聚合），大量是历史兼容包袱。apilens 只做最新场景，不向后兼容。

## 二、模块划分

### 2.1 knife4j 的模块（参考但不照搬）

| knife4j 模块 | 说明 | apilens 是否需要 |
|-------------|------|---------------------|
| `knife4j-core` | 核心工具类、增强注解 | **是** → `apilens-core` |
| `knife4j-openapi3-ui` | 纯前端 webjar | **是** → 前端构建产物内嵌到 core |
| `knife4j-openapi3-jakarta-spring-boot-starter` | Spring Boot 3+ 单体（Jakarta） | **是** → `apilens-spring-boot-starter` |
| `knife4j-openapi3-spring-boot-starter` | Spring Boot 2.x 单体 | 否，已过时 |
| `knife4j-openapi2-*` | OpenAPI 2 / springfox | 否，已过时 |
| `knife4j-openapi3-webflux-*` | WebFlux 适配 | 否，SpringDoc 已统一处理 |
| `knife4j-aggregation-*` | Servlet 聚合中间件 | 否，用 Gateway 聚合替代 |
| `knife4j-gateway-spring-boot-starter` | Gateway 网关聚合 | **是** → `apilens-gateway-spring-boot-starter` |
| `knife4j-dependencies` | BOM 版本管理 | **是** → `apilens-dependencies` |

### 2.2 apilens 模块结构

```
apilens/                                     # 根项目（parent pom）
├── docs/                                        # 设计文档
├── apilens-dependencies/                    # BOM：统一版本管理
│   └── pom.xml
├── apilens-core/                            # 核心：前端静态资源 + 配置属性 + 工具类
│   ├── frontend/                               # 前端源码（独立 Vue3 项目）
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.ts
│   │       ├── App.vue
│   │       ├── types/openapi.ts
│   │       ├── api/openapi.ts
│   │       └── components/
│   │           ├── SchemaView.vue
│   │           └── ApiTester.vue
│   ├── src/main/java/com/apilens/doc/core/
│   │   ├── properties/ApilensDocProperties.java
│   │   └── util/OpenApiUtils.java
│   └── src/main/resources/
│       └── META-INF/resources/apilens/      # 前端构建产物
│           ├── index.html
│           └── assets/
├── apilens-spring-boot-starter/             # 单体应用 Starter
│   ├── src/main/java/com/apilens/doc/starter/
│   │   ├── autoconfigure/ApilensDocAutoConfiguration.java
│   │   └── controller/DocRedirectController.java
│   └── src/main/resources/
│       └── META-INF/spring/
│           └── AutoConfiguration.imports
├── apilens-gateway-spring-boot-starter/     # Gateway 网关聚合 Starter
│   ├── src/main/java/com/apilens/doc/gateway/
│   │   ├── autoconfigure/ApilensDocGatewayAutoConfiguration.java
│   │   ├── properties/ApilensDocGatewayProperties.java
│   │   └── controller/DocGatewayController.java
│   └── src/main/resources/
│       └── META-INF/spring/
│           └── AutoConfiguration.imports
└── pom.xml                                     # 父 POM
```

### 2.3 模块职责

| 模块 | artifactId | 职责 |
|------|-----------|------|
| **BOM** | `apilens-dependencies` | 统一管理所有版本（SpringDoc、Spring Boot、apilens 自身），使用方引一个 `dependencyManagement` 即可 |
| **核心** | `apilens-core` | 前端静态资源（webjar）+ 配置属性 + 工具类，不包含自动配置 |
| **单体 Starter** | `apilens-spring-boot-starter` | 单体 Spring Boot 4.x 应用使用，依赖 core，提供 AutoConfiguration + Controller |
| **网关 Starter** | `apilens-gateway-spring-boot-starter` | Spring Cloud Gateway 微服务场景使用，聚合多个服务的 OpenAPI JSON |

## 三、架构原理

### 3.1 单体场景

```
SpringDoc（运行时反射扫描）→ /v3/api-docs（OpenAPI JSON）
                                    ↓
apilens-spring-boot-starter → 前端页面请求 JSON → 渲染 /doc.html
```

### 3.2 微服务场景（Gateway 聚合）

```
微服务 A (SpringDoc) → /v3/api-docs
微服务 B (SpringDoc) → /v3/api-docs
微服务 C (SpringDoc) → /v3/api-docs
          ↓
apilens-gateway-spring-boot-starter
  │
  ├─ 聚合：请求各服务的 /v3/api-docs → 合并成一个 OpenAPI JSON
  │         合并策略：按 service name 分组到 tags，paths 加前缀
  │
  └─ 渲染：前端页面请求聚合后的 JSON → 渲染 /doc.html
```

### 3.3 数据流

```
用户浏览器
  │
  ├─ GET /doc.html           → starter 转发到 /apilens/index.html
  │
  ├─ GET /apilens/assets/* → 静态资源（JS/CSS）
  │
  ├─ GET /v3/api-docs         → 单体：SpringDoc 直接返回
  │                              网关：Gateway 聚合后返回
  │
  └─ GET /v3/api-docs/{service} → 网关场景：指定服务的 OpenAPI JSON
```

## 四、后端设计

### 4.1 父 POM

```xml
<groupId>io.github.haoxianrui</groupId>
<artifactId>apilens-parent</artifactId>
<version>1.0.0</version>
<packaging>pom</packaging>

<modules>
    <module>apilens-dependencies</module>
    <module>apilens-core</module>
    <module>apilens-spring-boot-starter</module>
    <module>apilens-gateway-spring-boot-starter</module>
</modules>
```

### 4.2 BOM（apilens-dependencies）

```xml
<groupId>io.github.haoxianrui</groupId>
<artifactId>apilens-dependencies</artifactId>
<version>1.0.0</version>
<packaging>pom</packaging>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>io.github.haoxianrui</groupId>
            <artifactId>apilens-core</artifactId>
            <version>${project.version}</version>
        </dependency>
        <dependency>
            <groupId>io.github.haoxianrui</groupId>
            <artifactId>apilens-spring-boot-starter</artifactId>
            <version>${project.version}</version>
        </dependency>
        <dependency>
            <groupId>io.github.haoxianrui</groupId>
            <artifactId>apilens-gateway-spring-boot-starter</artifactId>
            <version>${project.version}</version>
        </dependency>
        <!-- SpringDoc 版本 -->
        <dependency>
            <groupId>org.springdoc</groupId>
            <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
            <version>2.8.9</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### 4.3 apilens-core

**职责**：打包前端静态资源 + 配置属性 + 工具类，不含自动配置。

**依赖策略**：

| 依赖 | scope | 说明 |
|------|-------|------|
| `spring-boot-configuration-processor` | provided (optional) | 生成配置元数据 |
| `lombok` | provided | 编译期 |

**核心类**：

```java
// 配置属性
@Data
@ConfigurationProperties(prefix = "apilens.doc")
public class ApilensDocProperties {
    private boolean enabled = true;
    private String path = "/doc.html";
    private String apiDocsPath = "/v3/api-docs";
    private String title = "API 接口文档";
    private boolean production = false;
}
```

```java
// 工具类：$ref 解析等
public class OpenApiUtils {
    public static Object resolveRef(String ref, Map<String, Object> doc) { ... }
}
```

**静态资源**：`META-INF/resources/apilens/` 下的前端构建产物。Spring Boot 默认将 `classpath:/META-INF/resources/` 加入静态资源搜索路径，无需额外配置。

### 4.4 apilens-spring-boot-starter（单体）

**依赖**：

```xml
<dependencies>
    <dependency>
        <groupId>io.github.haoxianrui</groupId>
        <artifactId>apilens-core</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springdoc</groupId>
        <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-autoconfigure</artifactId>
        <scope>provided</scope>
    </dependency>
</dependencies>
```

**自动配置**：

```java
@AutoConfiguration
@ConditionalOnWebApplication
@ConditionalOnClass(OpenAPI.class)
@ConditionalOnProperty(prefix = "apilens.doc", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(ApilensDocProperties.class)
public class ApilensDocAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DocRedirectController docRedirectController(ApilensDocProperties properties) {
        return new DocRedirectController(properties);
    }
}
```

**Controller**：

```java
@Controller
public class DocRedirectController {

    private final ApilensDocProperties properties;

    @GetMapping("${apilens.doc.path:/doc.html}")
    public String doc() {
        if (properties.isProduction()) {
            return "forward:/apilens/404.html";
        }
        return "forward:/apilens/index.html";
    }
}
```

### 4.5 apilens-gateway-spring-boot-starter（微服务网关聚合）

**依赖**：

```xml
<dependencies>
    <dependency>
        <groupId>io.github.haoxianrui</groupId>
        <artifactId>apilens-core</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-gateway</artifactId>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-autoconfigure</artifactId>
        <scope>provided</scope>
    </dependency>
</dependencies>
```

**配置属性**：

```yaml
apilens:
  doc:
    gateway:
      enabled: true
      services:
        - name: system-service
          url: lb://system-service
          path: /v3/api-docs
        - name: order-service
          url: lb://order-service
          path: /v3/api-docs
      strategy: group-by-service  # group-by-service | prefix-path
```

**聚合逻辑**：

```java
@Controller
public class DocGatewayController {

    /**
     * 聚合所有服务的 OpenAPI JSON
     * GET /v3/api-docs/aggregated
     */
    @GetMapping("/v3/api-docs/aggregated")
    public ResponseEntity<Map<String, Object>> aggregated() {
        // 1. 并行请求各服务的 /v3/api-docs
        // 2. 合并 paths（加服务名前缀或 tag 分组）
        // 3. 合并 components/schemas
        // 4. 合并 tags（加服务名前缀）
        // 5. 返回合并后的 OpenAPI JSON
    }

    /**
     * 指定服务的 OpenAPI JSON（代理转发）
     * GET /v3/api-docs/{service}
     */
    @GetMapping("/v3/api-docs/{service}")
    public ResponseEntity<Map<String, Object>> serviceDoc(@PathVariable String service) {
        // 转发到对应服务的 /v3/api-docs
    }
}
```

**自动配置**：

```java
@AutoConfiguration
@ConditionalOnClass(ServerWebExchange.class)  // 仅 WebFlux（Gateway）环境
@ConditionalOnProperty(prefix = "apilens.doc.gateway", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(ApilensDocGatewayProperties.class)
public class ApilensDocGatewayAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DocGatewayController docGatewayController(ApilensDocGatewayProperties properties) {
        return new DocGatewayController(properties);
    }
}
```

### 4.6 与 knife4j 的对比

| 对比项 | knife4j | apilens |
|--------|---------|------------|
| 模块数量 | 12 个 | 4 个 |
| 支持 OpenAPI 2 | 是 | 否 |
| 支持 Spring Boot 2.x | 是 | 否 |
| 支持 WebFlux 独立 starter | 是（2 个） | 否，SpringDoc 已统一 |
| Jakarta 适配 | 独立模块 | 默认（只做 Jakarta） |
| 网关聚合 | 有 | 有 |
| 前端技术 | jQuery + Bootstrap | Vue3 + Element Plus |
| 依赖大小 | ~5MB | ~1MB |

## 五、前端设计

### 5.1 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue 3 | ^3.5 | 响应式框架 |
| Element Plus | ^2.8 | UI 组件库 |
| Vite | ^6.0 | 构建工具 |
| TypeScript | ^5.6 | 类型安全 |
| Axios | ^1.7 | HTTP 请求 |

### 5.2 页面布局

```
┌─────────────────────────────────────────────────────┐
│  标题栏：API 接口文档 v4.6.0  [联系作者]              │
├──────────────┬──────────────────────────────────────┤
│  搜索框       │  接口路径 + 方法标签                  │
│              │                                      │
│  ▸ 系统管理   │  接口摘要 / 描述                      │
│    GET  用户  │                                      │
│    POST 角色  │  [接口详情] [在线调试]                 │
│              │                                      │
│  ▸ 认证管理   │  ─── 接口详情 Tab ───                 │
│    POST 登录  │  请求参数表格                         │
│              │  请求体 Schema（树形表格）              │
│  ▸ 文件管理   │  响应 Schema + 示例                   │
│    POST 上传  │                                      │
│              │  ─── 在线调试 Tab ───                  │
│  [网关场景]   │  Base URL 输入                        │
│  服务下拉     │  Path / Query 参数输入                 │
│              │  请求体 JSON 编辑                     │
│              │  Authorization Token                 │
│              │  [发送请求]                           │
│              │  响应状态 / 响应体 / 响应头             │
└──────────────┴──────────────────────────────────────┘
```

**网关场景**：左侧顶部多一个服务下拉框，切换服务时请求 `/v3/api-docs/{service}` 或 `/v3/api-docs/aggregated`。

### 5.3 核心组件

#### App.vue（主页面）

- **左侧栏**：搜索框 + 按 `tag` 分组的接口列表（网关场景多一个服务选择下拉）
- **右侧栏**：接口详情 + 在线调试（Tab 切换）
- **数据流**：`onMounted` → `fetchOpenApiDoc()` → 渲染

#### SchemaView.vue（Schema 渲染）

- 输入：`Schema` 对象 + `OpenAPIDocument`（用于 `$ref` 解析）
- 功能：递归解析嵌套对象，用 `el-table` 树形展示
- 列：字段名、类型、必填、说明、示例值
- `$ref` 解析：`resolveRef("#/components/schemas/UserVO", doc)` → 从 `components.schemas` 中获取实际定义
- 深度限制：3 层，避免无限递归

#### ApiTester.vue（在线调试）

- **Path 参数**：从 URL 模板 `{id}` 替换为输入值
- **Query 参数**：拼接到 URL 查询串
- **请求体**：JSON 文本编辑器，根据 Schema 自动生成示例值
- **Auth**：Bearer Token 输入框
- **发送**：`axios.request()` → 展示状态码 + 响应体 + 响应头
- **响应展示**：`validateStatus: () => true`，不抛异常，显示任意状态码

### 5.4 OpenAPI 类型定义（types/openapi.ts）

```typescript
interface OpenAPIDocument {
  openapi: string;
  info: Info;
  paths: Record<string, PathItem>;
  components?: Components;
  tags?: Tag[];
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
}

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
  deprecated?: boolean;
}

interface Schema {
  type?: string;
  $ref?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: any[];
  description?: string;
  example?: any;
}
```

### 5.5 工具函数（api/openapi.ts）

| 函数 | 功能 |
|------|------|
| `fetchOpenApiDoc()` | 请求 `/v3/api-docs` 获取 OpenAPI JSON |
| `fetchServiceDoc(service)` | 网关场景：请求 `/v3/api-docs/{service}` 获取指定服务文档 |
| `fetchAggregatedDoc()` | 网关场景：请求 `/v3/api-docs/aggregated` 获取聚合文档 |
| `resolveRef(ref, doc)` | 解析 `$ref` 引用，返回实际 Schema 对象 |
| `getSchemaType(schema, doc)` | 获取类型描述文本（如 `array<UserVO>`） |
| `getMethodTagType(method)` | HTTP 方法对应的 Element Plus 标签颜色 |

### 5.6 Vite 构建配置

```typescript
export default defineConfig({
  plugins: [vue()],
  base: "/apilens/",
  build: {
    outDir: "../src/main/resources/META-INF/resources/apilens",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    port: 3100,
    proxy: {
      "/v3/api-docs": "http://localhost:8000",
    },
  },
});
```

## 六、使用方式

### 6.1 单体应用

**引入依赖**：

```xml
<dependency>
    <groupId>io.github.haoxianrui</groupId>
    <artifactId>apilens-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

**配置（可选）**：

```yaml
apilens:
  doc:
    enabled: true
    path: /doc.html
    title: 我的 API 文档
    production: false
```

**访问**：`http://localhost:8000/doc.html`

### 6.2 微服务网关

**Gateway 引入依赖**：

```xml
<dependency>
    <groupId>io.github.haoxianrui</groupId>
    <artifactId>apilens-gateway-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

**配置**：

```yaml
apilens:
  doc:
    gateway:
      enabled: true
      services:
        - name: system-service
          url: lb://system-service
        - name: order-service
          url: lb://order-service
```

**访问**：`http://gateway:8080/doc.html` → 左侧选择服务 → 查看对应服务接口文档

各微服务只需正常引入 SpringDoc 即可，无需引入 apilens：

```xml
<!-- 微服务端 -->
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
</dependency>
```

### 6.3 在 youlai-boot 中替换 knife4j

**移除**：
```xml
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
</dependency>
```

**替换为**：
```xml
<dependency>
    <groupId>io.github.haoxianrui</groupId>
    <artifactId>apilens-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

**清理**：
- 删除 `Knife4jOpenApiCustomizer.java`
- 删除 `application-dev.yml` / `application-prod.yml` 中的 `knife4j:` 配置块
- 删除安全路径中的 `/doc.html`
- `OpenApiConfig.java` 保留不动（`@Schema`/`@Operation` 注解全部保留）

### 6.4 在 youlai-cloud 中替换 knife4j 网关聚合

**Gateway 移除**：
```xml
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-gateway-spring-boot-starter</artifactId>
</dependency>
```

**替换为**：
```xml
<dependency>
    <groupId>io.github.haoxianrui</groupId>
    <artifactId>apilens-gateway-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

## 七、Maven 中央仓库发布

### 7.1 发布方式

OSSRH 已于 2025-06-30 停用，现在使用 **Sonatype Central Portal**（central.sonatype.com）。

### 7.2 发布步骤

| 步骤 | 操作 |
|------|------|
| 1. 注册账号 | [central.sonatype.com](https://central.sonatype.com) 注册账号 |
| 2. 验证 namespace | 申请 `io.github.haoxianrui` namespace，通过 DNS TXT 记录或 GitHub 仓库验证 |
| 3. 生成 GPG 密钥 | `gpg --gen-key`，导出公钥上传到 keyserver |
| 4. 配置父 POM | 添加 `central-publishing-maven-plugin` + GPG 签名插件 + Javadoc 插件 |
| 5. 发布 | `mvn deploy` → Central Portal 审核 → 上架 |

### 7.3 父 POM 发布配置

```xml
<distributionManagement>
    <snapshotRepository>
        <id>central</id>
        <url>https://central.sonatype.com/repository/maven-snapshots/</url>
    </snapshotRepository>
</distributionManagement>

<build>
    <plugins>
        <plugin>
            <groupId>org.sonatype.central</groupId>
            <artifactId>central-publishing-maven-plugin</artifactId>
            <version>0.7.0</version>
            <extensions>true</extensions>
            <configuration>
                <publishingServerId>central</publishingServerId>
                <autoPublish>true</autoPublish>
            </configuration>
        </plugin>

        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-gpg-plugin</artifactId>
            <version>3.2.7</version>
            <executions>
                <execution>
                    <id>sign-artifacts</id>
                    <phase>verify</phase>
                    <goals><goal>sign</goal></goals>
                </execution>
            </executions>
        </plugin>

        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-javadoc-plugin</artifactId>
            <version>3.10.1</version>
            <executions>
                <execution>
                    <id>attach-javadocs</id>
                    <goals><goal>jar</goal></goals>
                </execution>
            </executions>
        </plugin>

        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-source-plugin</artifactId>
            <version>3.3.1</version>
            <executions>
                <execution>
                    <id>attach-sources</id>
                    <goals><goal>jar-no-fork</goal></goals>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

### 7.4 settings.xml

`~/.m2/settings.xml` 中配置 Central Portal 凭据：

```xml
<servers>
    <server>
        <id>central</id>
        <username>your-username</username>
        <password>your-access-token</password>
    </server>
</servers>
```

## 八、开发工作流

### 8.1 前端开发

```bash
cd apilens/apilens-core/frontend
pnpm install
pnpm dev          # Vite dev server (端口 3100)，代理 /v3/api-docs 到 localhost:8000
pnpm build        # 构建到 ../src/main/resources/META-INF/resources/apilens/
```

### 8.2 后端开发

```bash
cd apilens
mvn clean install -DskipTests  # 安装全部模块到本地 ~/.m2

# 单体验证
cd ../youlai-boot
mvn spring-boot:run
# 访问 http://localhost:8000/doc.html

# 网关验证
cd ../youlai-cloud
# 启动 gateway + 各微服务
# 访问 http://localhost:8080/doc.html
```

### 8.3 发布

```bash
cd apilens
mvn clean deploy -DskipTests  # 发布全部模块到 Maven 中央仓库
```

## 九、功能清单

### 9.1 MVP（第一阶段）— 单体 Starter

- [ ] 父 POM + BOM 骨架
- [ ] `apilens-core`：前端静态资源 + 配置属性 + 工具类
- [ ] `apilens-spring-boot-starter`：AutoConfiguration + Controller
- [ ] 前端：OpenAPI JSON 获取和解析
- [ ] 前端：按 tag 分组的接口列表 + 搜索
- [ ] 前端：接口详情（路径、方法、参数表格、请求体 Schema、响应 Schema）
- [ ] 前端：$ref 引用解析
- [ ] 前端：Schema 树形表格渲染（支持嵌套对象）
- [ ] 前端：在线调试（Path/Query 参数、请求体 JSON、Bearer Token、响应展示）
- [ ] 在 youlai-boot 中替换 knife4j 验证

### 9.2 增强（第二阶段）— 网关 Starter

- [ ] `apilens-gateway-spring-boot-starter`：网关聚合 AutoConfiguration
- [ ] 聚合逻辑：并行请求各服务 /v3/api-docs → 合并 paths/tags/schemas
- [ ] 前端：服务下拉选择
- [ ] 前端：聚合文档展示
- [ ] 在 youlai-cloud 中替换 knife4j 网关聚合验证

### 9.3 增强（第三阶段）— UI 优化

- [ ] 暗黑模式
- [ ] 多语言（中/英）
- [ ] 接口排序（tag 级别 + 接口级别）
- [ ] Markdown 文档嵌入
- [ ] 全局搜索
- [ ] 响应缓存历史
- [ ] 导出 OpenAPI JSON

### 9.4 发布（第四阶段）

- [ ] GPG 签名配置
- [ ] Central Portal namespace 验证
- [ ] 首版发布到 Maven 中央仓库

## 十、技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 保留 SpringDoc | 是 | 项目已有 570+ 处 OpenAPI 注解，SpringDoc 负责生成 JSON，无需重写 |
| 保留 swagger-annotations | 是 | `@Schema`/`@Operation` 是 OpenAPI 标准，非 knife4j 私有 |
| 只支持 Spring Boot 4.x | 是 | knife4j 历史包袱太多，apilens 不向后兼容，只做 Jakarta |
| 不做 WebFlux 独立 starter | 是 | SpringDoc `webmvc-ui` 和 `webflux-ui` 仅依赖不同，UI 渲染逻辑完全一样，core 共享 |
| 前端用 Element Plus | 是 | 与 youlai 生态（vue3-element-admin）风格统一 |
| 构建产物内嵌 core | 是 | 一个 JAR 包含所有前端资源，引入即用，无需额外部署前端 |
| 静态资源路径用 `META-INF/resources` | 是 | Spring Boot 标准方式，无需自定义 ResourceHandler，零配置自动生效 |
| 发布到 Maven 中央仓库 | Central Portal | OSSRH 已停用，Central Portal 是唯一官方发布渠道 |
| 前端静态资源放在 core 而非 starter | 是 | 单体和网关共用同一套 UI，避免重复打包 |
