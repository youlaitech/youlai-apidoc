package tech.youlai.apidoc.spring.starter.controller;

import tech.youlai.apidoc.spring.core.properties.ApidocProperties;
import tech.youlai.apidoc.spring.core.util.DocPageLoader;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 文档入口控制器
 *
 * <p>访问配置的文档路径（默认 /doc.html）时直接返回前端页面，浏览器地址栏保持文档路径不变。
 * 页面资源固定在 /apidoc/ 下，与文档路径无关。</p>
 *
 * <p>本控制器属于文档 UI 自身，用 {@link Hidden} 排除在 OpenAPI 文档之外，
 * 否则会以控制器名生成一个多余的分组。</p>
 *
 * @author youlai
 * @since 0.2.0
 */
@Hidden
@RestController
public class DocEntryController {

    /**
     * 文档入口 — 返回前端页面
     *
     * <p>路径占位符的默认值与 {@link ApidocProperties#DEFAULT_PATH} 共用，
     * 避免配置类与实际映射各写一份。</p>
     */
    @GetMapping("${apidoc.path:" + ApidocProperties.DEFAULT_PATH + "}")
    public ResponseEntity<String> docEntry(HttpServletRequest request) {
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .body(DocPageLoader.render(request.getContextPath()));
    }
}
