package com.apilens.doc.core.util;

import java.util.Map;

/**
 * OpenAPI 文档工具类
 *
 * <p>提供 $ref 引用解析等通用方法，供 starter 和 gateway 模块共用。</p>
 *
 * @author youlai
 */
public final class OpenApiUtils {

    private OpenApiUtils() {
    }

    /**
     * 解析 OpenAPI $ref 引用，从文档根对象中获取实际定义
     *
     * <p>ref 格式示例：{@code #/components/schemas/UserVO}</p>
     *
     * @param ref $ref 字符串，如 "#/components/schemas/UserVO"
     * @param doc OpenAPI 文档根对象（通常是反序列化后的 Map）
     * @return ref 指向的对象，解析失败返回 null
     */
    @SuppressWarnings("unchecked")
    public static Object resolveRef(String ref, Map<String, Object> doc) {
        if (ref == null || !ref.startsWith("#/") || doc == null) {
            return null;
        }
        // 去掉 "#/" 前缀，按 "/" 分割逐层取值
        String[] parts = ref.substring(2).split("/");
        Object target = doc;
        for (String part : parts) {
            if (target instanceof Map) {
                target = ((Map<String, Object>) target).get(part);
            } else {
                return null;
            }
        }
        return target;
    }
}
