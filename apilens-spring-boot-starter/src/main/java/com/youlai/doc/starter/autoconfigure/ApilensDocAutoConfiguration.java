package com.apilens.doc.starter.autoconfigure;

import com.apilens.doc.core.properties.ApilensDocProperties;
import com.apilens.doc.starter.controller.DocRedirectController;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * apilens 单体应用自动配置类
 *
 * <p>当应用引入 {@code apilens-spring-boot-starter} 后，此配置自动生效：</p>
 * <ul>
 *   <li>注册前端静态资源处理器 — 将 /apilens/** 映射到 META-INF/resources/apilens/</li>
 *   <li>注册 {@link DocRedirectController} — 访问 /doc.html 时重定向到前端入口页面</li>
 * </ul>
 *
 * <p>可通过 {@code apilens.doc.enabled=false} 关闭整个文档 UI。</p>
 *
 * @author youlai
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "apilens.doc", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(ApilensDocProperties.class)
public class ApilensDocAutoConfiguration implements WebMvcConfigurer {

    /**
     * 前端静态资源在 jar 包中的路径前缀
     */
    private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/apilens/";

    /**
     * 注册静态资源处理器
     *
     * <p>Spring Boot 默认会serve META-INF/resources/ 下的内容，但显式注册
     * 可以确保 /apilens/** 路径正确映射，并控制缓存策略。</p>
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/apilens/**")
                .addResourceLocations(RESOURCE_LOCATION);
    }

    /**
     * 文档入口跳转控制器
     *
     * <p>用户访问 apilens.doc.path（默认 /doc.html）时，重定向到前端页面 /apilens/index.html</p>
     */
    @Bean
    public DocRedirectController docRedirectController(ApilensDocProperties properties) {
        return new DocRedirectController(properties);
    }
}
