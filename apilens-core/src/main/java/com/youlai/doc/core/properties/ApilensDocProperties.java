package com.apilens.doc.core.properties;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * apilens 文档配置属性
 *
 * <p>在 application.yml 中通过 apilens.doc 前缀配置：</p>
 * <pre>
 * youlai:
 *   doc:
 *     enabled: true
 *     path: /doc.html
 *     api-docs-path: /v3/api-docs
 *     title: API 接口文档
 *     production: false
 * </pre>
 *
 * @author youlai
 */
@Data
@ConfigurationProperties(prefix = "apilens.doc")
public class ApilensDocProperties {

    /**
     * 是否启用文档 UI，默认 true
     */
    private boolean enabled = true;

    /**
     * 文档页面访问路径，默认 /doc.html
     */
    private String path = "/doc.html";

    /**
     * OpenAPI JSON 数据源路径（SpringDoc 默认端点），默认 /v3/api-docs
     */
    private String apiDocsPath = "/v3/api-docs";

    /**
     * 文档页面标题，显示在浏览器标签页和页面顶部
     */
    private String title = "API 接口文档";

    /**
     * 生产环境保护开关，设为 true 时文档页面返回 404，默认 false
     */
    private boolean production = false;
}
