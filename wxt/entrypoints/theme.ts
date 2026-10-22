import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as settings from "../../src/settings/store";
import { resolveTheme } from "../../src/settings/shared";

function applyTheme(theme: unknown = "light"): void {
  const prefersDark = theme === "system" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(theme, prefersDark);
}

declare global {
  var LaterOnSettings: typeof settings & { readonly applyTheme: typeof applyTheme };
}

// Classic script: keep early initialization in library/settings and defer in the panel/picker.
export default defineUnlistedScript(() => {
  settings.get().then(current => applyTheme(current.theme));
  settings.watch(current => applyTheme(current.theme));
  if (window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      settings.get().then(current => { if (current.theme === "system") applyTheme("system"); });
    };
    if (media.addEventListener) media.addEventListener("change", onChange);
    else if (media.addListener) media.addListener(onChange);
  }
  globalThis.LaterOnSettings = { ...settings, applyTheme };
});
