# apilens 发布到 Maven Central 完整指南

## 前置信息

| 项目 | 值 |
|------|-----|
| groupId | `tech.youlai` |
| 验证方式 | DNS TXT（域名 `youlai.tech`，阿里云云解析） |
| Namespace 状态 | Verified |
| 项目仓库 | `https://github.com/youlaitech/youlai-apilens` |
| 分支 | `master` |
| 发布平台 | [Sonatype Central Portal](https://central.sonatype.com) |
| 发布插件 | `central-publishing-maven-plugin` 0.7.0 |

> **为什么用 `tech.youlai`？** Maven Central 的 groupId 采用域名反转，`youlai.tech` 对应 `tech.youlai`。坐标归属组织，与发布者个人账号解耦；`io.github.haoxianrui`、`io.github.youlaitech` 虽然也已验证，但不作为发布坐标。

---

## 第一步：Namespace（已完成）

`tech.youlai` 已在 Central Portal → **Publishing** → **Namespaces** 中显示为 **Verified**，无需重复操作。

如需给新域名注册 namespace，流程是：

1. **View Namespaces** → **Add Namespace**，输入 `tech.youlai`，状态为 Unverified；
2. 点 **View ID** 复制 Verification Key；
3. 在阿里云 → 域名 `youlai.tech` → 解析设置中新增记录：

| 字段 | 值 |
|------|-----|
| 记录类型 | TXT |
| 主机记录 | `@`（必须是 `youlai.tech` 本身，不能写成子域） |
| 记录值 | 原样粘贴 Verification Key |
| TTL | 10 分钟 |

4. 用 `Resolve-DnsName youlai.tech -Type TXT` 或 `nslookup -type=TXT youlai.tech 223.5.5.5` 确认记录已生效；
5. 回到 Portal 点 **Verify Namespace**。TXT 未生效就点验证会缓存 NXDOMAIN，导致后续等待变长。

TXT 记录验证通过后建议保留，不影响其他解析记录。

---

## 第二步：生成 GPG 签名密钥

Maven Central 要求所有发布构件都带 GPG 签名。签名代表发布者个人，与 groupId 归属无关。

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
密钥类型：RSA and RSA (default)
密钥长度：4096
密钥有效期：0（永不过期）
真实姓名：haoxianrui
电子邮件：youlaitech@163.com
备注：apilens signing key
密码：设置一个密码（务必记住）
```

### 2.3 查看密钥 ID 并上传公钥

```bash
gpg --list-keys --keyid-format LONG

# 输出示例：
# pub   rsa4096/ABCDEF1234567890 2026-08-04 [SC]
# uid                 haoxianrui <youlaitech@163.com>

gpg --keyserver keyserver.ubuntu.com --send-keys ABCDEF1234567890
gpg --keyserver keys.openpgp.org --send-keys ABCDEF1234567890

# 验证公钥已上传（可能需要等几分钟）
gpg --keyserver keyserver.ubuntu.com --search-keys youlaitech@163.com
```

---

## 第三步：配置 Maven settings.xml

编辑 `~/.m2/settings.xml`（Windows：`C:\Users\你的用户名\.m2\settings.xml`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<settings>
  <servers>
    <!-- Central Portal 发布凭据（User Token，不是账号密码） -->
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

> **安全提醒**：`settings.xml` 含敏感信息，不要提交到 Git 仓库。

---

## 第四步：代码仓库

仓库已在组织下：`https://github.com/youlaitech/youlai-apilens`，默认分支 `master`。

如果本地 remote 未指向该地址：

```bash
cd d:/Project/youlai-admin/youlai-apilens
git remote set-url origin https://github.com/youlaitech/youlai-apilens.git
git push -u origin master
```

---

## 第五步：本地验证

发布前确认编译、签名、javadoc 全部通过：

```bash
cd d:/Project/youlai-admin/youlai-apilens
mvn clean verify -DskipTests
```

> 父 POM 已配置 `<doclint>none</doclint>` 和 `<encoding>UTF-8</encoding>`，中文注释不会报错。

---

## 第六步：发布到 Maven Central

```bash
cd d:/Project/youlai-admin/youlai-apilens
mvn clean deploy -DskipTests
```

发布过程：

1. 编译 4 个模块；
2. 为每个模块生成 `sources.jar` 和 `javadoc.jar`；
3. GPG 为 `.jar`、`.pom`、`sources.jar`、`javadoc.jar` 生成 `.asc` 签名；
4. `central-publishing-maven-plugin` 上传到 Central Portal；
5. `autoPublish=true`，上传后自动进入审核队列。

审核时长：首次发布人工审核通常 1-2 个工作日；后续版本自动通过。

---

## 第七步：验证发布结果

```text
https://central.sonatype.com/artifact/tech.youlai/apilens-parent
https://central.sonatype.com/artifact/tech.youlai/apilens-spring-boot-starter
```

搜索索引同步可能需要几小时。

---

## 使用方式（发布后）

### 单体应用

```xml
<dependency>
    <groupId>tech.youlai</groupId>
    <artifactId>apilens-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

### 微服务网关

```xml
<dependency>
    <groupId>tech.youlai</groupId>
    <artifactId>apilens-gateway-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

---

## 常见问题

### Q: GPG 签名报错 "No public key"

确保公钥已上传到 keyserver：

```bash
gpg --keyserver keyserver.ubuntu.com --send-keys <KEY_ID>
gpg --keyserver keys.openpgp.org --send-keys <KEY_ID>
```

### Q: deploy 返回 401 Unauthorized

检查 `~/.m2/settings.xml` 中 `<server>` 的 `<id>` 必须是 `central`（与 POM 的 `publishingServerId` 一致），username/password 是 Central Portal 生成的 User Token，不是 GitHub 或 Portal 账号密码。

### Q: javadoc 报错 "错误: 编码GBK的不可映射字符"

父 POM 已配置 `<encoding>UTF-8</encoding>` 和 `<doclint>none</doclint>`；如仍报错：

```powershell
$env:JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8"
mvn clean deploy -DskipTests
```

### Q: Namespace 验证一直 Pending

1. 用 `Resolve-DnsName youlai.tech -Type TXT` 确认记录已生效；
2. 确认主机记录是 `@`，记录值没有多余引号或空格；
3. TXT 未生效时点过验证的，等 NXDOMAIN 缓存过期后重新 Verify；
4. 仍失败发邮件给 `central-support@sonatype.com`，附上域名所有权证明。

### Q: Namespace 提示已被占用

可能是 OSSRH 时代注册过同名 namespace。按官方规则 OSSRH 与 Portal 不能同时激活，发邮件给 Central Support 处理。

### Q: 发布后多久能搜索到

首次发布审核 1-2 个工作日，审核通过后索引同步约 2 小时。

### Q: 后续版本如何发布

修改父 POM 的 `<version>` 后重新执行 `mvn clean deploy -DskipTests`，后续版本自动通过审核。
