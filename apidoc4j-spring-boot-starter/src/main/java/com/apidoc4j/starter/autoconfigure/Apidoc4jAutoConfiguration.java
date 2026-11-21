package com.apidoc4j.starter.autoconfigure;

import com.apidoc4j.core.properties.Apidoc4jProperties;
import com.apidoc4j.starter.controller.DocRedirectController;
import com.apidoc4j.starter.customizer.ApiGroupCustomizer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * apidoc4j 单体应用自动配置类
 *
 * <p>当应用引入 {@code apidoc4j-spring-boot-starter} 后，此配置自动生效：</p>
 * <ul>
 *   <li>注册前端静态资源处理器 — 将 /apidoc4j/** 映射到 META-INF/resources/apidoc4j/</li>
 *   <li>注册 {@link DocRedirectController} — 访问 /doc.html 时重定向到前端入口页面</li>
 *   <li>注册 {@link ApiGroupCustomizer} — 把 {@code @ApiGroup} 写成二级分组扩展 {@code x-group}</li>
 * </ul>
 *
 * <p>可通过 {@code apidoc4j.doc.enabled=false} 关闭整个文档 UI。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "apidoc4j.doc", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(Apidoc4jProperties.class)
public class Apidoc4jAutoConfiguration implements WebMvcConfigurer {

    /**
     * 前端静态资源在 jar 包中的路径前缀
     */
    private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/apidoc4j/";

    /**
     * 注册静态资源处理器
     *
     * <p>显式注册 /apidoc4j/** 映射，宿主关闭默认静态资源映射
     * （spring.web.resources.add-mappings=false）时文档仍可访问。</p>
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/apidoc4j/**")
                .addResourceLocations(RESOURCE_LOCATION);
    }

    /**
     * 文档入口跳转控制器
     *
     * <p>用户访问 apidoc4j.doc.path（默认 /doc.html）时，重定向到前端页面 /apidoc4j/index.html</p>
     */
    @Bean
    public DocRedirectController docRedirectController(Apidoc4jProperties properties) {
        return new DocRedirectController(properties);
    }

    /**
     * 二级分组扩展定制器
     *
     * <p>把控制器/方法上的 {@code @ApiGroup} 写成 OpenAPI 扩展 {@code x-group}。
     * springdoc 会自动收集该类型的 Bean 并对每个接口回调，业务代码不需要自己注册。</p>
     *
     * <p>未引入 springdoc 时该 Bean 不创建，注解此时也没有意义。</p>
     */
    @Bean
    @ConditionalOnClass(name = "org.springdoc.core.customizers.OperationCustomizer")
    public ApiGroupCustomizer apiGroupCustomizer() {
        return new ApiGroupCustomizer();
    }
}
