package com.apidoc4j.gateway.controller;

import com.apidoc4j.core.properties.Apidoc4jProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

/**
 * 文档入口跳转控制器
 *
 * <p>将用户配置的文档路径（默认 /doc.html）重定向到前端静态资源入口
 * /apidoc4j/index.html。</p>
 *
 * <p>当 {@code apidoc4j.doc.production=true} 时直接返回 404，隐藏文档入口。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
@RestController
public class GatewayDocRedirectController {

    private final Apidoc4jProperties properties;

    /**
     * WebFlux 的 base-path（spring.webflux.base-path），重定向地址需要带上
     */
    private final String basePath;

    public GatewayDocRedirectController(Apidoc4jProperties properties,
                                        @Value("${spring.webflux.base-path:}") String basePath) {
        this.properties = properties;
        this.basePath = basePath;
    }

    /**
     * 文档入口 — 重定向到前端页面
     *
     * <p>路径支持属性占位符，可在 application.yml 中通过 apidoc4j.doc.path 自定义（默认 /doc.html）。</p>
     */
    @GetMapping("${apidoc4j.doc.path:/doc.html}")
    public ResponseEntity<Void> docEntry() {
        // 生产环境关闭文档
        if (properties.isProduction()) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(basePath + "/apidoc4j/index.html"))
                .build();
    }
}
