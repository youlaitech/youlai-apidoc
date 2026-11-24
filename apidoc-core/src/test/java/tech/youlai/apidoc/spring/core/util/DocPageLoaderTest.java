package tech.youlai.apidoc.spring.core.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 文档页面加载与资源前缀重写
 */
class DocPageLoaderTest {

    @Test
    void renderKeepsAbsolutePathsWhenNoPrefix() {
        String html = DocPageLoader.render("");

        assertThat(html).contains("\"/apidoc/assets/");
    }

    @Test
    void renderRewritesResourcePathsWithPrefix() {
        String html = DocPageLoader.render("/app");

        assertThat(html).contains("\"/app/apidoc/assets/");
        assertThat(html).doesNotContain("\"/apidoc/assets/");
    }

    @Test
    void rootPrefixIsTreatedAsEmpty() {
        String html = DocPageLoader.render("/");

        assertThat(html).contains("\"/apidoc/assets/");
    }

    @Test
    void nullPrefixIsTreatedAsEmpty() {
        String html = DocPageLoader.render(null);

        assertThat(html).contains("\"/apidoc/assets/");
    }
}
