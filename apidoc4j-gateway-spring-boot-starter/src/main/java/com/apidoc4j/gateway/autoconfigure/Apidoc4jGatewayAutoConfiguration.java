package com.apidoc4j.gateway.autoconfigure;

import com.apidoc4j.core.properties.Apidoc4jProperties;
import com.apidoc4j.gateway.controller.GatewayDocController;
import com.apidoc4j.gateway.controller.GatewayDocRedirectController;
import com.apidoc4j.gateway.properties.GatewayDocProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.web.reactive.config.ResourceHandlerRegistry;
import org.springframework.web.reactive.config.WebFluxConfigurer;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * apidoc4j 网关聚合自动配置类
 *
 * <p>当 Spring Cloud Gateway 应用引入此 starter 后，自动配置：</p>
 * <ul>
 *   <li>前端静态资源处理器 — /apidoc4j/** 映射到 META-INF/resources/apidoc4j/</li>
 *   <li>文档入口跳转 — /doc.html 重定向到 /apidoc4j/index.html</li>
 *   <li>网关文档聚合控制器 — 提供服务列表、单服务文档、聚合文档端点</li>
 * </ul>
 *
 * <p>前提条件：classpath 中存在 Spring Cloud Gateway 的 RouteLocator（仅网关应用激活，
 * 普通 WebFlux 应用不会注册这些端点）。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
@ConditionalOnClass(name = "org.springframework.cloud.gateway.route.RouteLocator")
@ConditionalOnProperty(prefix = "apidoc4j.doc", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties({Apidoc4jProperties.class, GatewayDocProperties.class})
public class Apidoc4jGatewayAutoConfiguration implements WebFluxConfigurer {

    /**
     * 前端静态资源在 jar 包中的路径前缀
     */
    private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/apidoc4j/";

    /**
     * 注册 WebFlux 静态资源处理器
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/apidoc4j/**")
                .addResourceLocations(RESOURCE_LOCATION);
    }

    /**
     * 文档入口跳转控制器
     *
     * <p>提供 /doc.html（可配）到 /apidoc4j/index.html 的重定向。</p>
     */
    @Bean
    public GatewayDocRedirectController gatewayDocRedirectController(
            Apidoc4jProperties properties,
            @Value("${spring.webflux.base-path:}") String basePath) {
        return new GatewayDocRedirectController(properties, basePath);
    }

    /**
     * 网关文档聚合控制器
     *
     * <p>提供 /v3/api-docs/swagger-config、/v3/api-docs/{service}、/v3/api-docs/aggregate 端点</p>
     */
    @Bean
    public GatewayDocController gatewayDocController(GatewayDocProperties properties, WebClient.Builder apidoc4jWebClientBuilder) {
        return new GatewayDocController(properties, apidoc4jWebClientBuilder);
    }

    /**
     * 文档聚合专用的负载均衡 WebClient 构建器
     *
     * <p>聚合时通过 lb://service-name 从注册中心拉取各服务文档，
     * 需要宿主网关引入 spring-cloud-starter-loadbalancer 才能解析服务名。</p>
     */
    @Bean("apidoc4jWebClientBuilder")
    @LoadBalanced
    public WebClient.Builder apidoc4jWebClientBuilder() {
        return WebClient.builder();
    }
}
