package com.apidoc4j.starter.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 接口文档二级分组标记
 *
 * <p>标注在控制器类上，表示该控制器下全部接口归入同一分组；标注在方法上可单独覆盖类级配置，
 * 因此同一个控制器内的不同接口可以归入不同分组。</p>
 *
 * <p>由 {@link com.apidoc4j.starter.customizer.ApiGroupCustomizer} 写入 OpenAPI 扩展
 * {@code x-group}，供 apidoc4j 侧栏渲染「tag → 二级分组 → 接口」三级导航。</p>
 *
 * <p>{@code x-group} 属于 OpenAPI 允许的厂商扩展，Swagger UI 等标准工具会直接忽略，
 * 不会影响默认文档的分组和展示。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface ApiGroup {

    /**
     * 分组名称
     *
     * <p>方法级留空表示该接口不参与二级分组，直接挂在一级 tag 下。</p>
     */
    String value();
}
