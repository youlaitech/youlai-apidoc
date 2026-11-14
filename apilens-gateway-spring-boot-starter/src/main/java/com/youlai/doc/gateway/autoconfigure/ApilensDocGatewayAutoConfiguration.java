package com.apilens.doc.gateway.autoconfigure;

import com.apilens.doc.core.properties.ApilensDocProperties;
import com.apilens.doc.gateway.controller.GatewayDocController;
import com.apilens.doc.gateway.properties.GatewayDocProperties;
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
 * apilens 网关聚合自动配置类
 *
 * <p>当 Spring Cloud Gateway 应用引入此 starter 后，自动配置：</p>
 * <ul>
 *   <li>前端静态资源处理器 — /apilens/** 映射到 META-INF/resources/apilens/</li>
 *   <li>网关文档聚合控制器 — 提供服务列表、单服务文档、聚合文档端点</li>
 * </ul>
 *
 * <p>前提条件：classpath 中存在 WebFlux 相关类（Gateway 基于 WebFlux）。</p>
 *
 * @author youlai
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
@ConditionalOnClass(name = "org.springframework.web.reactive.DispatcherHandler")
@ConditionalOnProperty(prefix = "apilens.doc", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties({ApilensDocProperties.class, GatewayDocProperties.class})
public class ApilensDocGatewayAutoConfiguration implements WebFluxConfigurer {

    /**
     * 前端静态资源在 jar 包中的路径前缀
     */
    private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/apilens/";

    /**
     * 注册 WebFlux 静态资源处理器
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/apilens/**")
                .addResourceLocations(RESOURCE_LOCATION);
    }

    /**
     * 网关文档聚合控制器
     *
     * <p>提供 /v3/api-docs/swagger-config、/v3/api-docs/{service}、/v3/api-docs/aggregate 端点</p>
     */
    @Bean
    public GatewayDocController gatewayDocController(GatewayDocProperties properties, WebClient.Builder apilensWebClientBuilder) {
        return new GatewayDocController(properties, apilensWebClientBuilder);
    }

    /**
     * 文档聚合专用的负载均衡 WebClient 构建器
     *
     * <p>聚合时通过 lb://service-name 从注册中心拉取各服务文档，
     * 需要宿主网关引入 spring-cloud-starter-loadbalancer 才能解析服务名。</p>
     */
    @Bean("apilensWebClientBuilder")
    @LoadBalanced
    public WebClient.Builder apilensWebClientBuilder() {
        return WebClient.builder();
    }
}
