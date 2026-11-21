package com.apidoc4j.core.properties;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * apidoc4j 文档配置属性
 *
 * <p>在 application.yml 中通过 apidoc4j.doc 前缀配置：</p>
 * <pre>
 * apidoc4j:
 *   doc:
 *     enabled: true
 *     path: /doc.html
 *     production: false
 * </pre>
 *
 * @author youlai
 * @since 0.1.0
 */
@Data
@ConfigurationProperties(prefix = "apidoc4j.doc")
public class Apidoc4jProperties {

    /**
     * 是否启用文档 UI，默认 true
     */
    private boolean enabled = true;

    /**
     * 文档页面访问路径，默认 /doc.html
     */
    private String path = "/doc.html";

    /**
     * 生产环境保护开关，设为 true 时文档页面返回 404，默认 false
     */
    private boolean production = false;
}
