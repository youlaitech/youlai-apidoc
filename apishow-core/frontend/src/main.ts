import { Buffer } from "buffer";
import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
// 自托管可变字体：Inter 正文 / Sora 展示数字（禁外网请求）
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "./styles.css";
import {
  ArrowDown,
  ArrowLeft,
  CircleCheck,
  CircleClose,
  Close,
  CopyDocument,
  Delete,
  Document,
  Download,
  EditPen,
  Expand,
  Fold,
  Folder,
  InfoFilled,
  Key,
  Link,
  Loading,
  Lock,
  MagicStick,
  Moon,
  Picture,
  Plus,
  Postcard,
  Promotion,
  Refresh,
  RefreshLeft,
  Right,
  Search,
  Setting,
  Sunny,
  Tickets,
  VideoPlay,
  View,
} from "@element-plus/icons-vue";
import App from "./App.vue";
import { applyTheme } from "./stores/ui";

// swagger-parser 的 dereference 调用 Buffer.isBuffer，浏览器没有该全局
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

// 首帧前应用主题，避免暗色偏好下闪现亮色
applyTheme();

const app = createApp(App);
app.use(ElementPlus);
// 全局注册模板用到的图标，避免整包进入首屏
for (const [name, component] of Object.entries({
  ArrowDown,
  ArrowLeft,
  CircleCheck,
  CircleClose,
  Close,
  CopyDocument,
  Delete,
  Document,
  Download,
  EditPen,
  Expand,
  Fold,
  Folder,
  InfoFilled,
  Key,
  Link,
  Loading,
  Lock,
  MagicStick,
  Moon,
  Picture,
  Plus,
  Postcard,
  Promotion,
  Refresh,
  RefreshLeft,
  Right,
  Search,
  Setting,
  Sunny,
  Tickets,
  VideoPlay,
  View,
})) {
  app.component(name, component);
}
app.mount("#app");
