import { createApp } from "vue";
import { ready } from "../../../src/shared/i18n";
import App from "./App.vue";

async function main(): Promise<void> {
  await ready;
  createApp(App).mount("#app");
}

void main();
