import type { Browser } from "wxt/browser";

// Chrome MV3 exposes the native API globally, including callback overloads.
// Keep its types separate from WXT's leading-slash asset URL helpers.
declare global {
  var chrome: typeof Browser;
}
