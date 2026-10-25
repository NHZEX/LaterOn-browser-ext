import { createApp } from "vue";
import { useSidepanelControls } from "../../../src/sidepanel/useSidepanelControls";
import App from "./App.vue";

// 不等待语言或收藏存储：旧启动链仍先画缓存首屏，并提前注册 PING_SIDEPANEL 握手。
const app = createApp(App, { controls: useSidepanelControls() });
app.mount("#app");
function dispose(): void { window.removeEventListener("pagehide", dispose); app.unmount(); }
window.addEventListener("pagehide", dispose);
