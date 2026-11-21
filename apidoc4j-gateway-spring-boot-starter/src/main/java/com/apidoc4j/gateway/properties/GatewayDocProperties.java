package com.apidoc4j.gateway.properties;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * 网关文档聚合配置属性
 *
 * <p>在 application.yml 中通过 apidoc4j.doc.gateway 前缀配置：</p>
 * <pre>
 * apidoc4j:
 *   doc:
 *     gateway:
 *       # 需要聚合的服务列表（服务名 = Gateway 路由的 serviceId）
 *       services:
 *         - system-service
 *         - order-service
 *       # 各服务的 api-docs 路径（默认 /v3/api-docs）
 *       api-docs-path: /v3/api-docs
 * </pre>
 *
 * @author youlai
 * @since 0.1.0
 */
@Data
@ConfigurationProperties(prefix = "apidoc4j.doc.gateway")
public class GatewayDocProperties {

    /**
     * 需要聚合文档的微服务列表
     *
     * <p>每个服务名对应 Spring Cloud Gateway 中配置的 route uri 的 serviceId，
     * 聚合控制器会通过 WebClient 并行拉取各服务的 OpenAPI JSON。</p>
     */
    private List<String> services = new ArrayList<>();

    /**
     * 各微服务的 api-docs 端点路径，默认 /v3/api-docs
     */
    private String apiDocsPath = "/v3/api-docs";
}
