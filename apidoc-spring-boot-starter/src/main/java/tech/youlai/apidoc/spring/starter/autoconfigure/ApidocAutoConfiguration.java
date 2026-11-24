package tech.youlai.apidoc.spring.starter.autoconfigure;

import tech.youlai.apidoc.spring.core.properties.ApidocProperties;
import tech.youlai.apidoc.spring.starter.controller.DocEntryController;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

/**
 * apidoc 单体应用自动配置类
 *
 * <p>当应用引入 {@code apidoc-spring-boot-starter} 后，此配置自动生效：</p>
 * <ul>
 *   <li>注册前端静态资源处理器 — 将 /apidoc/** 映射到 META-INF/resources/apidoc/</li>
 *   <li>注册 {@link DocEntryController} — 访问 /doc.html 时返回前端页面</li>
 * </ul>
 *
 * <p>可通过 {@code apidoc.enabled=false} 关闭整个文档 UI。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "apidoc", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(ApidocProperties.class)
public class ApidocAutoConfiguration implements WebMvcConfigurer {

    /**
     * 前端静态资源在 jar 包中的路径前缀
     */
    private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/apidoc/";

    /**
     * 注册静态资源处理器
     *
     * <p>显式注册 /apidoc/** 映射，宿主关闭默认静态资源映射
     * （spring.web.resources.add-mappings=false）时文档仍可访问。</p>
     *
     * <p>assets 下的文件名带内容 hash，可长期缓存；入口 HTML 不缓存，发版后立即生效。</p>
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/apidoc/assets/**")
                .addResourceLocations(RESOURCE_LOCATION + "assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
        registry.addResourceHandler("/apidoc/**")
                .addResourceLocations(RESOURCE_LOCATION)
                .setCacheControl(CacheControl.noStore());
    }

    /**
     * 文档入口控制器
     *
     * <p>访问 apidoc.path（默认 /doc.html）时返回前端页面。</p>
     */
    @Bean
    public DocEntryController docEntryController() {
        return new DocEntryController();
    }
}
