package tech.youlai.apidoc.spring.core.properties;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * apidoc 文档配置属性
 *
 * <p>在 application.yml 中通过 apidoc 前缀配置：</p>
 * <pre>
 * apidoc:
 *   enabled: true
 *   path: /doc.html
 * </pre>
 *
 * @author youlai
 * @since 0.1.0
 */
@Data
@ConfigurationProperties(prefix = "apidoc")
public class ApidocProperties {

    /**
     * 文档入口默认路径，入口控制器的路径占位符与本类默认值共用此常量
     */
    public static final String DEFAULT_PATH = "/doc.html";

    /**
     * 是否启用文档 UI，默认 true
     */
    private boolean enabled = true;

    /**
     * 文档页面访问路径，默认 /doc.html
     */
    private String path = DEFAULT_PATH;
}
