import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  // Preserve the classic worker's global scope and synchronous listener setup.
  importScripts("background-runtime.js");
});
