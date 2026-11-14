import { Buffer } from "buffer";
import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "./styles.css";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import App from "./App.vue";

// swagger-parser 的 dereference 调用 Buffer.isBuffer，浏览器没有该全局
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

const app = createApp(App);
app.use(ElementPlus);
// 全局注册所有 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}
app.mount("#app");
