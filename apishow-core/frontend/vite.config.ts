import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// 构建产物直接输出到 core 模块的静态资源目录
// Spring Boot 会自动将 META-INF/resources 下的文件作为静态资源提供服务
const outputDir = resolve(__dirname, "../src/main/resources/META-INF/resources/apishow");

export default defineConfig({
  plugins: [vue()],
  // 静态资源前缀，与后端 META-INF/resources/apishow/ 对应
  base: "/apishow/",
  // swagger-parser 引用了 Node 的 global 与 buffer
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 文件名带 hash：内容变更即换名，避免浏览器用缓存的旧 index.html 引到已清空的固定名资源
        entryFileNames: "assets/app.[hash].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",
      },
    },
  },
  server: {
    port: 3100,
    proxy: {
      // 开发时代理到后端 SpringDoc 端点
      "/v3/api-docs": "http://localhost:8000",
      // 在线调试的业务接口也走代理，带斜杠避免匹配到 /apishow/
      "/api/": "http://localhost:8000",
    },
  },
});
