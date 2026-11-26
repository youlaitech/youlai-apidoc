package tech.youlai.apishow.spring.core.util;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

/**
 * 文档前端页面加载器
 *
 * <p>页面在 jar 包内固定为 {@code META-INF/resources/apishow/index.html}。
 * 页面里的资源引用是以 {@code /apishow/} 开头的绝对路径，应用配置了 context-path 后
 * 浏览器会按根路径请求，所以返回前需要补上前缀。原始文本只读一次并缓存，替换按请求做。</p>
 *
 * @author youlai
 * @since 0.4.0
 */
public final class DocPageLoader {

    /**
     * 页面在 jar 包中的路径
     */
    private static final String INDEX_PAGE = "META-INF/resources/apishow/index.html";

    /**
     * 页面里资源引用的绝对路径前缀，带前引号避免误伤正文
     */
    private static final String RESOURCE_PREFIX = "\"/apishow/";

    private static volatile String cachedHtml;

    private DocPageLoader() {
    }

    /**
     * 读取页面文本，按路径前缀重写资源引用
     *
     * @param pathPrefix 应用对外路径前缀，根路径传空串
     */
    public static String render(String pathPrefix) {
        String html = html();
        if (pathPrefix == null || pathPrefix.isEmpty() || "/".equals(pathPrefix)) {
            return html;
        }
        return html.replace(RESOURCE_PREFIX, "\"" + pathPrefix + "/apishow/");
    }

    /**
     * 页面原始文本，只读一次
     */
    private static String html() {
        String html = cachedHtml;
        if (html != null) {
            return html;
        }
        synchronized (DocPageLoader.class) {
            if (cachedHtml == null) {
                cachedHtml = read();
            }
            return cachedHtml;
        }
    }

    private static String read() {
        try (InputStream in = DocPageLoader.class.getClassLoader().getResourceAsStream(INDEX_PAGE)) {
            if (in == null) {
                throw new IllegalStateException("apishow 前端页面缺失：" + INDEX_PAGE);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("读取 apishow 前端页面失败", e);
        }
    }
}
