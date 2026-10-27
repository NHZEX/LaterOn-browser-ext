// Expose real module exports in JSDOM without restoring product UI globals.
// Only browser delivery boundaries (settings broadcasts and resource loading) are simulated.
const { buildSync } = require("esbuild");
const { resolve } = require("node:path");
const { outputFiles } = buildSync({
  stdin: { resolveDir: resolve(__dirname, "../.."), loader: "ts", contents: `
    import * as i18n from "./src/shared/i18n-runtime.ts";
    import { dialog } from "./src/ui/dialog.ts";
    import * as onboarding from "./src/ui/onboarding.ts";
    import { bindStorageFeedback } from "./src/storage/page-feedback";
    const settingsListeners = new Set();
    const changes = globalThis.chrome?.storage?.onChanged;
    if (changes) {
      const add = changes.addListener.bind(changes);
      const remove = changes.removeListener?.bind(changes);
      changes.addListener = listener => { settingsListeners.add(listener); add(listener); };
      changes.removeListener = listener => { settingsListeners.delete(listener); remove?.(listener); };
    }
    window.uiTest = { i18n: { ...i18n, async setLanguage(language) {
      await i18n.setLanguage(language);
      // A real chrome.storage write notifies other module graphs/pages as well.
      settingsListeners.forEach(listener => listener({ laterOnSettings: { newValue: { language } } }, "local"));
    } }, dialog, onboarding, bindStorageFeedback };
    // Unrelated page scenarios represent an existing user. Guide tests opt into
    // their own explicit seen/unseen fixture instead of stealing dialog focus.
    const local = globalThis.chrome?.storage?.local;
    if (local && !window.testOnboardingEnabled) {
      const get = local.get.bind(local);
      local.get = keys => keys === "laterOnOnboardingSeen"
        ? Promise.resolve({ laterOnOnboardingSeen: true }) : get(keys);
    }
    const append = document.head.append.bind(document.head);
    const appendChild = document.head.appendChild.bind(document.head);
    const loaded = node => {
      if (node instanceof HTMLLinkElement && node.rel === "stylesheet") {
        queueMicrotask(() => node.dispatchEvent(new Event(window.testUiResourceError ? "error" : "load")));
      }
    };
    document.head.append = (...nodes) => {
      append(...nodes);
      nodes.forEach(loaded);
    };
    document.head.appendChild = node => { appendChild(node); loaded(node); return node; };
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", target: "esnext"
});
module.exports = `if (!window.uiTest) { ${outputFiles[0].text}\n }`;
