package com.apilens.doc.starter.controller;

import com.apilens.doc.core.properties.ApilensDocProperties;
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
 * /apilens/index.html，前端 SPA 从该页面启动并加载 OpenAPI JSON。</p>
 *
 * <p>当 {@code apilens.doc.production=true} 时直接返回 404，隐藏文档入口。</p>
 *
 * @author youlai
 */
@RestController
public class DocRedirectController {

    private final ApilensDocProperties properties;

    public DocRedirectController(ApilensDocProperties properties) {
        this.properties = properties;
    }

    /**
     * 文档入口 — 重定向到前端页面
     *
     * <p>通过 {@code @GetMapping("${apilens.doc.path:/doc.html}")} 动态绑定
     * 用户在 application.yml 中配置的 apilens.doc.path 路径（默认 /doc.html）。</p>
     *
     * <p>Spring 支持 {@code @GetMapping} 的路径中使用 ${} 属性占位符，
     * 在 Bean 初始化时从 Environment 解析实际值。</p>
     */
    @GetMapping("${apilens.doc.path:/doc.html}")
    public ResponseEntity<Void> docEntry(HttpServletRequest request) {
        // 生产环境关闭文档
        if (properties.isProduction()) {
            return ResponseEntity.notFound().build();
        }

        // 构建前端页面完整路径，保留 context-path
        String contextPath = request.getContextPath();
        String redirectUrl = contextPath + "/apilens/index.html";

        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(redirectUrl))
                .build();
    }
}
