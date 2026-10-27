import { createApp } from "vue";
import { useLibraryControls } from "../../../src/library/useLibraryControls";
import { ready } from "../../../src/shared/i18n";
import App from "./App.vue";

let alive = true;
let app: ReturnType<typeof createApp> | undefined;
window.addEventListener("pagehide", () => { alive = false; app?.unmount(); }, { once: true });

async function main(): Promise<void> {
  await ready;
  if (!alive) return;
  const controls = useLibraryControls();
  app = createApp(App, { controls });
  app.mount("#app");
}

void main();
