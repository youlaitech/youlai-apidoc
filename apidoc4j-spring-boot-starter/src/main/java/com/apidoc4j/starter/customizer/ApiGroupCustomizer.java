package com.apidoc4j.starter.customizer;

import com.apidoc4j.starter.annotation.ApiGroup;
import io.swagger.v3.oas.models.Operation;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.util.StringUtils;
import org.springframework.web.method.HandlerMethod;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把 {@link ApiGroup} 写入 OpenAPI 扩展 {@code x-group}
 *
 * <p>springdoc 会收集容器内所有 {@link OperationCustomizer} 并在生成每个接口时回调，
 * 因此业务代码只需要在控制器或方法上加一行 {@link ApiGroup}，
 * 无需在每个 {@code @Operation} 上重复书写扩展。</p>
 *
 * <p>取值优先级：方法级 {@link ApiGroup} &gt; 控制器类级 {@link ApiGroup}。
 * 方法级留空表示该接口显式不归入任何二级分组。</p>
 *
 * @author youlai
 * @since 0.1.0
 */
public class ApiGroupCustomizer implements OperationCustomizer {

    /**
     * 扩展名，apidoc4j 读取该字段生成二级分组
     */
    private static final String EXTENSION_NAME = "x-group";

    /**
     * 扩展内容中的分组名字段
     */
    private static final String GROUP_NAME = "name";

    @Override
    public Operation customize(Operation operation, HandlerMethod handlerMethod) {
        String group = resolveGroup(handlerMethod);
        if (StringUtils.hasText(group)) {
            Map<String, Object> value = new LinkedHashMap<>(2);
            value.put(GROUP_NAME, group.trim());
            operation.addExtension(EXTENSION_NAME, value);
        }
        return operation;
    }

    /**
     * 解析接口所属分组：方法级优先，其次控制器类级
     */
    private String resolveGroup(HandlerMethod handlerMethod) {
        ApiGroup methodAnnotation = handlerMethod.getMethodAnnotation(ApiGroup.class);
        if (methodAnnotation != null) {
            // 方法级声明优先，留空即表示不分组
            return methodAnnotation.value();
        }
        Class<?> beanType = handlerMethod.getBeanType();
        ApiGroup typeAnnotation = beanType.getAnnotation(ApiGroup.class);
        if (typeAnnotation == null) {
            // 兼容接口声明、代理类等场景
            typeAnnotation = handlerMethod.getMethod().getDeclaringClass().getAnnotation(ApiGroup.class);
        }
        return typeAnnotation == null ? null : typeAnnotation.value();
    }
}
