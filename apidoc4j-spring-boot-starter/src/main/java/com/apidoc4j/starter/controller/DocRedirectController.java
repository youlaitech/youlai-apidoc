package com.apidoc4j.starter.controller;

import com.apidoc4j.core.properties.Apidoc4jProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

/**
 * 文档入口跳转控制器
 *
 * <p>将用户配置的文档路径（默认 /doc.html）重定向到前端静态资源入口
 * /apidoc4j/index.html，前端 SPA 从该页面启动并加载 OpenAPI JSON。</p>
 *
 * <p>当 {@code apidoc4j.doc.production=true} 时直接返回 404，隐藏文档入口。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
@RestController
public class DocRedirectController {

    private final Apidoc4jProperties properties;

    public DocRedirectController(Apidoc4jProperties properties) {
        this.properties = properties;
    }

    /**
     * 文档入口 — 重定向到前端页面
     *
     * <p>路径支持属性占位符，可在 application.yml 中通过 apidoc4j.doc.path 自定义（默认 /doc.html）。</p>
     */
    @GetMapping("${apidoc4j.doc.path:/doc.html}")
    public ResponseEntity<Void> docEntry(HttpServletRequest request) {
        // 生产环境关闭文档
        if (properties.isProduction()) {
            return ResponseEntity.notFound().build();
        }

        // 构建前端页面完整路径，保留 context-path
        String contextPath = request.getContextPath();
        String redirectUrl = contextPath + "/apidoc4j/index.html";

        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(redirectUrl))
                .build();
    }
}
