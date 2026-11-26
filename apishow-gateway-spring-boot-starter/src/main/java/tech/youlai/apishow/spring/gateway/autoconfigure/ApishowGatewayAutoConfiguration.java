package tech.youlai.apishow.spring.gateway.autoconfigure;

import tech.youlai.apishow.spring.core.properties.ApishowProperties;
import tech.youlai.apishow.spring.gateway.controller.GatewayDocController;
import tech.youlai.apishow.spring.gateway.controller.GatewayDocEntryController;
import tech.youlai.apishow.spring.gateway.properties.ApishowGatewayProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.http.CacheControl;
import org.springframework.web.reactive.config.ResourceHandlerRegistry;
import org.springframework.web.reactive.config.WebFluxConfigurer;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;

/**
 * apishow 网关聚合自动配置类
 *
 * <p>当 Spring Cloud Gateway 应用引入此 starter 后，自动配置：</p>
 * <ul>
 *   <li>前端静态资源处理器 — /apishow/** 映射到 META-INF/resources/apishow/</li>
 *   <li>文档入口 — /doc.html 返回前端页面</li>
 *   <li>网关文档聚合控制器 — 提供服务列表、单服务文档、聚合文档端点</li>
 * </ul>
 *
 * <p>前提条件：classpath 中存在 Spring Cloud Gateway 的 RouteLocator（仅网关应用激活，
 * 普通 WebFlux 应用不会注册这些端点）。</p>
 *
 * @author youlai
 * @since 0.4.0
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
@ConditionalOnClass(name = "org.springframework.cloud.gateway.route.RouteLocator")
@ConditionalOnProperty(prefix = "apishow", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties({ApishowProperties.class, ApishowGatewayProperties.class})
public class ApishowGatewayAutoConfiguration implements WebFluxConfigurer {

    /**
     * 前端静态资源在 jar 包中的路径前缀
     */
    private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/apishow/";

    /**
     * 注册 WebFlux 静态资源处理器
     *
     * <p>assets 下的文件名带内容 hash，可长期缓存；入口 HTML 不缓存，发版后立即生效。</p>
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/apishow/assets/**")
                .addResourceLocations(RESOURCE_LOCATION + "assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
        registry.addResourceHandler("/apishow/**")
                .addResourceLocations(RESOURCE_LOCATION)
                .setCacheControl(CacheControl.noStore());
    }

    /**
     * 文档入口控制器
     *
     * <p>访问 apishow.path（默认 /doc.html）时返回前端页面。</p>
     */
    @Bean
    public GatewayDocEntryController gatewayDocEntryController(
            @Value("${spring.webflux.base-path:}") String basePath) {
        return new GatewayDocEntryController(basePath);
    }

    /**
     * 网关文档聚合控制器
     *
     * <p>提供 /v3/api-docs/swagger-config、/v3/api-docs/{service}、/v3/api-docs/aggregate 端点</p>
     */
    @Bean
    public GatewayDocController gatewayDocController(ApishowGatewayProperties properties, WebClient.Builder apishowWebClientBuilder) {
        return new GatewayDocController(properties, apishowWebClientBuilder);
    }

    /**
     * 文档聚合专用的负载均衡 WebClient 构建器
     *
     * <p>聚合时通过 lb://service-name 从注册中心拉取各服务文档，
     * 需要宿主网关引入 spring-cloud-starter-loadbalancer 才能解析服务名。</p>
     */
    @Bean("apishowWebClientBuilder")
    @LoadBalanced
    public WebClient.Builder apishowWebClientBuilder() {
        return WebClient.builder();
    }
}
