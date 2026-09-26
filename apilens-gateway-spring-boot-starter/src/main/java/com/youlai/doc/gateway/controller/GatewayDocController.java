package com.apilens.doc.gateway.controller;

import com.apilens.doc.gateway.properties.GatewayDocProperties;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.*;

/**
 * 网关文档聚合控制器
 *
 * <p>在 Spring Cloud Gateway 上提供三个端点：</p>
 * <ul>
 *   <li>{@code GET /v3/api-docs/swagger-config} — 返回服务列表，供前端选择服务</li>
 *   <li>{@code GET /v3/api-docs/{serviceName}} — 返回指定服务的原始 OpenAPI JSON</li>
 *   <li>{@code GET /v3/api-docs/aggregate} — 并行拉取所有服务文档，合并后返回统一 OpenAPI 文档</li>
 * </ul>
 *
 * <p>合并策略：</p>
 * <ul>
 *   <li>paths：所有服务的 path 合并，key 冲突时后者覆盖</li>
 *   <li>tags：去重合并</li>
 *   <li>components.schemas：所有 schema 合并，key 冲突时后者覆盖</li>
 *   <li>info：使用第一个有效文档的 info</li>
 * </ul>
 *
 * <p>服务地址解析：通过 Gateway 的 {@code lb://service-name} 负载均衡 URI 拉取文档。
 * 网关本身已集成服务发现（Nacos/Eureka），WebClient 使用网关的 LoadBalancer 客户端。</p>
 *
 * @author youlai
 */
@RestController
public class GatewayDocController {

    private final GatewayDocProperties properties;
    private final WebClient webClient;

    public GatewayDocController(GatewayDocProperties properties) {
        this.properties = properties;
        // WebClient 不预设 baseUrl，每个请求动态拼接 lb://service-name + path
        this.webClient = WebClient.builder().build();
    }

    /**
     * 返回聚合服务列表
     *
     * <p>前端首次加载时调用此接口获取可用服务，展示服务选择下拉框。
     * 返回格式兼容 SpringDoc 的 swagger-config 结构。</p>
     */
    @GetMapping(value = "/v3/api-docs/swagger-config", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> swaggerConfig() {
        List<Map<String, String>> urls = new ArrayList<>();
        for (String service : properties.getServices()) {
            Map<String, String> url = new LinkedHashMap<>();
            url.put("name", service);
            url.put("url", "/v3/api-docs/" + service);
            urls.add(url);
        }

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("configUrl", "/v3/api-docs/swagger-config");
        config.put("urls", urls);
        return Mono.just(config);
    }

    /**
     * 获取单个服务的 OpenAPI JSON
     *
     * <p>通过 {@code lb://serviceName/apiDocsPath} 拉取原始文档，
     * 网关的 LoadBalancer 会解析服务名到实际实例地址。</p>
     *
     * @param serviceName 微服务名称
     * @return 该服务的 OpenAPI JSON 文档
     */
    @GetMapping(value = "/v3/api-docs/{serviceName}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> getServiceDoc(@PathVariable String serviceName) {
        String uri = "lb://" + serviceName + properties.getApiDocsPath();
        return webClient.get()
                .uri(uri)
                .retrieve()
                .bodyToMono(Map.class)
                .cast(Map.class);
    }

    /**
     * 聚合所有服务的 OpenAPI 文档
     *
     * <p>并行拉取所有服务的 /v3/api-docs，合并 paths/tags/schemas 后返回统一文档。
     * 任一服务拉取失败不影响其他服务，失败服务的接口不会出现在聚合文档中。</p>
     */
    @GetMapping(value = "/v3/api-docs/aggregate", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> getAggregatedDoc() {
        List<String> services = properties.getServices();
        if (services.isEmpty()) {
            return Mono.just(Collections.emptyMap());
        }

        // 并行拉取所有服务文档，onErrorResume 保证单个服务失败不中断整体
        return Flux.fromIterable(services)
                .flatMap(service -> fetchServiceDocSafely(service))
                .collectList()
                .map(this::mergeDocs);
    }

    /**
     * 拉取单个服务文档，失败时返回空 Map（不中断聚合流程）
     */
    private Mono<Map<String, Object>> fetchServiceDocSafely(String serviceName) {
        String uri = "lb://" + serviceName + properties.getApiDocsPath();
        return webClient.get()
                .uri(uri)
                .retrieve()
                .bodyToMono(Map.class)
                .cast(Map.class)
                .onErrorResume(e -> {
                    // 拉取失败时返回空文档，避免一个服务挂掉导致整个聚合失败
                    return Mono.just(Collections.emptyMap());
                });
    }

    /**
     * 合并多个 OpenAPI 文档
     *
     * <p>合并规则：</p>
     * <ol>
     *   <li>info：取第一个非空文档的 info</li>
     *   <li>paths：所有 paths 合并到同一个 Map，key 为 "/service-name/path" 避免冲突</li>
     *   <li>tags：按 name 去重合并</li>
     *   <li>components.schemas：合并所有 schema 定义</li>
     * </ol>
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> mergeDocs(List<Map<String, Object>> docs) {
        Map<String, Object> merged = new LinkedHashMap<>();
        Map<String, Object> mergedPaths = new LinkedHashMap<>();
        List<Map<String, Object>> mergedTags = new ArrayList<>();
        Set<String> tagNames = new HashSet<>();
        Map<String, Object> mergedSchemas = new LinkedHashMap<>();

        for (int i = 0; i < docs.size(); i++) {
            Map<String, Object> doc = docs.get(i);
            if (doc == null || doc.isEmpty()) continue;

            // info：取第一个有效文档的
            if (!merged.containsKey("info") && doc.containsKey("info")) {
                merged.put("info", doc.get("info"));
            }

            // paths：合并，path key 加服务名前缀避免不同服务相同 path 互相覆盖
            String serviceName = properties.getServices().get(i);
            Map<String, Object> paths = (Map<String, Object>) doc.getOrDefault("paths", Collections.emptyMap());
            for (Map.Entry<String, Object> entry : paths.entrySet()) {
                String pathKey = "/" + serviceName + entry.getKey();
                mergedPaths.put(pathKey, entry.getValue());
            }

            // tags：按 name 去重
            List<Map<String, Object>> tags = (List<Map<String, Object>>) doc.getOrDefault("tags", Collections.emptyList());
            for (Map<String, Object> tag : tags) {
                String name = (String) tag.get("name");
                if (name != null && !tagNames.contains(name)) {
                    tagNames.add(name);
                    mergedTags.add(tag);
                }
            }

            // components.schemas：合并
            Map<String, Object> components = (Map<String, Object>) doc.get("components");
            if (components != null) {
                Map<String, Object> schemas = (Map<String, Object>) components.get("schemas");
                if (schemas != null) {
                    mergedSchemas.putAll(schemas);
                }
            }
        }

        merged.put("openapi", "3.0.1");
        merged.put("paths", mergedPaths);
        if (!mergedTags.isEmpty()) {
            merged.put("tags", mergedTags);
        }
        if (!mergedSchemas.isEmpty()) {
            Map<String, Object> components = new LinkedHashMap<>();
            components.put("schemas", mergedSchemas);
            merged.put("components", components);
        }
        return merged;
    }
}
