import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// 构建产物直接输出到 core 模块的静态资源目录
// Spring Boot 会自动将 META-INF/resources 下的文件作为静态资源提供服务
const outputDir = resolve(__dirname, "../src/main/resources/META-INF/resources/apilens");

export default defineConfig({
  plugins: [vue()],
  // 静态资源前缀，与后端 META-INF/resources/apilens/ 对应
  base: "/apilens/",
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    port: 3100,
    proxy: {
      // 开发时代理到后端 SpringDoc 端点
      "/v3/api-docs": "http://localhost:8000",
    },
  },
});
