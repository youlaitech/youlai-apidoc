package tech.youlai.apishow.spring.gateway.controller;

import tech.youlai.apishow.spring.gateway.properties.ApishowGatewayProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
 *   <li>paths：所有服务的 path 合并，key 加 /服务名 前缀避免跨服务冲突</li>
 *   <li>tags：按 name 去重合并</li>
 *   <li>components.schemas：合并，同名 schema 后者覆盖</li>
 *   <li>openapi / info：取第一个有效文档的</li>
 * </ul>
 *
 * <p>服务地址解析：通过 Gateway 的 {@code lb://service-name} 负载均衡 URI 拉取文档。
 * 网关本身已集成服务发现（Nacos/Eureka），WebClient 使用网关的 LoadBalancer 客户端。</p>
 *
 * @author youlai
 * @since 0.4.0
 */
@Slf4j
@RestController
public class GatewayDocController {

    private static final ParameterizedTypeReference<Map<String, Object>> DOC_TYPE =
            new ParameterizedTypeReference<>() {};

    private final ApishowGatewayProperties properties;
    private final WebClient webClient;

    public GatewayDocController(ApishowGatewayProperties properties,
                                @Qualifier("apishowWebClientBuilder") WebClient.Builder webClientBuilder) {
        this.properties = properties;
        this.webClient = webClientBuilder.build();
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
        return webClient.get()
                .uri(serviceDocUri(serviceName))
                .retrieve()
                .bodyToMono(DOC_TYPE);
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
            // 没有配置服务时也返回合法的空文档，否则前端按缺失 openapi 字段报错
            return Mono.just(mergeDocs(Collections.emptyList()));
        }

        // 并行拉取所有服务文档，每个结果携带服务名，onErrorResume 保证单个服务失败不中断整体
        return Flux.fromIterable(services)
                .flatMap(service -> fetchServiceDocSafely(service)
                        .map(doc -> new AbstractMap.SimpleImmutableEntry<>(service, doc)))
                .collectList()
                .map(this::mergeDocs);
    }

    /**
     * 拉取单个服务文档，失败时返回空 Map（不中断聚合流程）
     *
     * <p>降级不抛异常，但必须留日志：否则聚合结果少一整块时无从判断是哪个服务。</p>
     */
    private Mono<Map<String, Object>> fetchServiceDocSafely(String serviceName) {
        return webClient.get()
                .uri(serviceDocUri(serviceName))
                .retrieve()
                .bodyToMono(DOC_TYPE)
                // 拉取失败时返回空文档，避免一个服务挂掉导致整个聚合失败
                .onErrorResume(e -> {
                    log.warn("拉取 {} 的 OpenAPI 文档失败，聚合结果将跳过该服务", serviceName, e);
                    return Mono.just(Collections.emptyMap());
                });
    }

    /**
     * 服务的 api-docs 拉取地址：lb 负载均衡 + 配置的文档路径
     */
    private String serviceDocUri(String serviceName) {
        return "lb://" + serviceName + properties.getApiDocsPath();
    }

    /**
     * 合并多个 OpenAPI 文档，规则见类注释的合并策略
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> mergeDocs(List<? extends Map.Entry<String, Map<String, Object>>> docs) {
        Map<String, Object> merged = new LinkedHashMap<>();
        Map<String, Object> mergedPaths = new LinkedHashMap<>();
        Map<String, Object> mergedTags = new LinkedHashMap<>();
        Map<String, Object> mergedSchemas = new LinkedHashMap<>();

        for (Map.Entry<String, Map<String, Object>> entry : docs) {
            Map<String, Object> doc = entry.getValue();
            if (doc == null || doc.isEmpty()) {
                continue;
            }

            // openapi / info：取第一个有效文档的
            if (!merged.containsKey("openapi") && doc.get("openapi") instanceof String openapi) {
                merged.put("openapi", openapi);
            }
            if (!merged.containsKey("info") && doc.containsKey("info")) {
                merged.put("info", doc.get("info"));
            }

            // paths：合并，path key 加服务名前缀避免不同服务相同 path 互相覆盖
            String serviceName = entry.getKey();
            Map<String, Object> paths = (Map<String, Object>) doc.getOrDefault("paths", Collections.emptyMap());
            for (Map.Entry<String, Object> pathEntry : paths.entrySet()) {
                String pathKey = "/" + serviceName + pathEntry.getKey();
                mergedPaths.put(pathKey, pathEntry.getValue());
            }

            // tags：按 name 去重，保留首个声明顺序
            List<Map<String, Object>> tags = (List<Map<String, Object>>) doc.getOrDefault("tags", Collections.emptyList());
            for (Map<String, Object> tag : tags) {
                String name = (String) tag.get("name");
                if (name != null) {
                    mergedTags.putIfAbsent(name, tag);
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

        // springdoc 3.1.x 默认输出 OpenAPI 3.1.0；聚合结果跟随第一个服务的文档，缺失时兜底
        merged.putIfAbsent("openapi", "3.1.0");
        merged.put("paths", mergedPaths);
        if (!mergedTags.isEmpty()) {
            merged.put("tags", new ArrayList<>(mergedTags.values()));
        }
        if (!mergedSchemas.isEmpty()) {
            Map<String, Object> components = new LinkedHashMap<>();
            components.put("schemas", mergedSchemas);
            merged.put("components", components);
        }
        return merged;
    }
}
