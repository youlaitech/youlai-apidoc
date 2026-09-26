# apilens 发布到 Maven Central 完整指南

## 前置信息

| 项目 | 值 |
|------|-----|
| groupId | `io.github.haoxianrui` |
| 验证方式 | GitHub 自动验证（个人账号） |
| 项目仓库 | `https://github.com/haoxianrui/youlai-apilens` |
| 分支 | `master` |
| 发布平台 | [Sonatype Central Portal](https://central.sonatype.com) |
| 发布插件 | `central-publishing-maven-plugin` 0.7.0 |

> **为什么是 `io.github.haoxianrui`？** 新版 Central Portal 仅支持 `io.github.<GitHub个人用户名>` 格式的 GitHub 验证，不支持组织名。使用 GitHub 账号登录后自动验证，零成本。

---

## 第一步：注册 Sonatype 账号并验证 Namespace

### 1.1 注册登录

1. 打开 https://central.sonatype.com
2. 点击右上角 **Sign In** → 选择 **GitHub** 登录（用 `haoxianrui` 账号）
3. 登录后点右上角头像 → **View Account**，确认账号信息

### 1.2 自动获取 Namespace

用 GitHub 账号登录后，Sonatype 会利用 GitHub 的 `github.io` 域名**自动验证**并分配 namespace：

- 自动分配的 namespace：`io.github.haoxianrui`
- 无需手动创建临时仓库或配置 DNS

在 **Publishing** → **Namespaces** 页面确认 `io.github.haoxianrui` 状态为 **Verified**。

> 如果没有自动出现，点击 **Add Namespace** 手动输入 `io.github.haoxianrui`，系统会自动识别并验证。

### 1.3 生成 User Token

1. Central Portal → 右上角头像 → **View Account**
2. 找到 **User Token** 区域，点击 **Generate User Token**
3. 复制生成的用户名和密码（只显示一次，妥善保存）

---

## 第二步：生成 GPG 签名密钥

Maven Central 要求所有发布构件必须经过 GPG 签名。

### 2.1 安装 GPG

- **Windows**：下载 [Gpg4win](https://gpg4win.org/) 安装
- **macOS**：`brew install gnupg`
- **Linux**：`apt install gnupg` / `yum install gnupg`

### 2.2 生成密钥

```bash
gpg --gen-key
```

交互式填写：

```
请选择密钥类型：RSA and RSA (default)
密钥长度：4096
密钥有效期：0（永不过期）
真实姓名：haoxianrui
电子邮件：youlaitech@163.com
备注：apilens signing key
密码：设置一个密码（务必记住）
```

### 2.3 查看密钥 ID 并上传公钥

```bash
# 查看密钥 ID
gpg --list-keys --keyid-format LONG

# 输出示例：
# pub   rsa4096/ABCDEF1234567890 2026-08-04 [SC]
# uid                 haoxianrui <youlaitech@163.com>

# 上传公钥到 keyserver（用上面显示的密钥 ID，即 / 后面的部分）
gpg --keyserver keyserver.ubuntu.com --send-keys ABCDEF1234567890

# 同时上传到另一个 keyserver 作为备份
gpg --keyserver keys.openpgp.org --send-keys ABCDEF1234567890

# 验证公钥已上传（可能需要等几分钟）
gpg --keyserver keyserver.ubuntu.com --search-keys youlaitech@163.com
```

---

## 第三步：配置 Maven settings.xml

编辑 `~/.m2/settings.xml`（Windows 路径：`C:\Users\你的用户名\.m2\settings.xml`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<settings>
  <servers>
    <!-- Central Portal 发布凭据（第一步生成的 User Token） -->
    <server>
      <id>central</id>
      <username>你的UserToken用户名</username>
      <password>你的UserToken密码</password>
    </server>
  </servers>

  <profiles>
    <profile>
      <id>gpg</id>
      <properties>
        <!-- GPG 密码，避免每次发布弹密码框 -->
        <gpg.passphrase>你的GPG密钥密码</gpg.passphrase>
      </properties>
    </profile>
  </profiles>

  <activeProfiles>
    <activeProfile>gpg</activeProfile>
  </activeProfiles>
</settings>
```

> **安全提醒**：`settings.xml` 包含敏感信息，不要提交到 Git 仓库。

---

## 第四步：创建 GitHub 仓库并推送代码

### 4.1 在 GitHub 创建仓库

1. 登录 GitHub → 进入 `haoxianrui` 个人账号
2. 点击 **New repository**
3. Repository name：`youlai-apilens`
4. 选择 **Public**
5. 不要勾选 "Add a README file"（本地已有代码）
6. 点击 **Create repository**

### 4.2 推送代码

```bash
cd d:/Project/youlai-admin/youlai-apilens

# 初始化 Git（如果还没有）
git init

# 添加所有文件
git add .

# 提交
git commit -m "feat: apilens initial release"

# 关联远程仓库并推送
git remote add origin https://github.com/haoxianrui/youlai-apilens.git
git push -u origin master
```

---

## 第五步：本地验证

发布前先确认编译、签名、javadoc 全部通过：

```bash
cd d:/Project/youlai-admin/youlai-apilens

# 完整验证（跳过测试）
mvn clean verify -DskipTests
```

> 父 POM 已配置 `<doclint>none</doclint>` 和 `<encoding>UTF-8</encoding>`，中文注释不会报错。

---

## 第六步：发布到 Maven Central

```bash
cd d:/Project/youlai-admin/youlai-apilens

mvn clean deploy -DskipTests
```

### 发布过程说明

1. Maven 编译所有模块（4 个）
2. 为每个模块生成 sources.jar 和 javadoc.jar
3. GPG 对每个构件（.jar、.pom、sources.jar、javadoc.jar）生成 .asc 签名文件
4. `central-publishing-maven-plugin` 将所有构件上传到 Central Portal
5. `autoPublish=true` 表示上传后自动进入审核队列

### 审核时间

- **首次发布**：需要人工审核，通常 1-2 个工作日
- **后续发布**：自动通过（`autoPublish=true`）

---

## 第七步：验证发布结果

发布成功后，可以在以下地址搜索到你的构件：

```
https://central.sonatype.com/artifact/io.github.haoxianrui/apilens-parent
https://central.sonatype.com/artifact/io.github.haoxianrui/apilens-spring-boot-starter
```

搜索生效可能需要几小时（CDN 同步延迟）。

---

## 使用方式（发布后）

### 单体应用

```xml
<dependency>
    <groupId>io.github.haoxianrui</groupId>
    <artifactId>apilens-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

### 微服务网关

```xml
<dependency>
    <groupId>io.github.haoxianrui</groupId>
    <artifactId>apilens-gateway-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

---

## 常见问题

### Q: GPG 签名报错 "No public key"

确保已上传公钥到 keyserver：
```bash
gpg --keyserver keyserver.ubuntu.com --send-keys <KEY_ID>
gpg --keyserver keys.openpgp.org --send-keys <KEY_ID>
```

### Q: deploy 返回 401 Unauthorized

检查 `~/.m2/settings.xml` 中 `<server>` 的 `<id>` 必须是 `central`（与 POM 中 `publishingServerId` 一致），username/password 是否为 Central Portal 生成的 User Token（不是 GitHub 账号密码）。

### Q: javadoc 报错 "错误: 编码GBK的不可映射字符"

父 POM 已配置 `<encoding>UTF-8</encoding>` 和 `<doclint>none</doclint>`，如仍报错检查 Maven 编译环境编码：
```bash
# Windows PowerShell 设置编码
$env:JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8"
mvn clean deploy -DskipTests
```

### Q: Namespace 没有自动验证

1. 确认是用 GitHub 账号登录 Central Portal（不是邮箱注册）
2. 手动到 **Namespaces** → **Add Namespace** 输入 `io.github.haoxianrui`
3. 系统会自动识别 GitHub 账号并验证

### Q: 发布后多久能搜索到

首次发布审核 1-2 个工作日，审核通过后搜索索引同步约 2 小时。

### Q: 后续版本如何发布

修改父 POM 中的 `<version>` 版本号，然后重新执行 `mvn clean deploy -DskipTests` 即可，后续版本自动通过审核。
