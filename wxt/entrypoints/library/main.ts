import { createApp } from "vue";
import { useLibraryControls } from "../../../src/library/useLibraryControls";
import App from "./App.vue";

async function main(): Promise<void> {
  await globalThis.LaterOnI18n?.getLanguage();
  const controls = useLibraryControls();
  createApp(App, { controls }).mount("#app");
}

void main();
