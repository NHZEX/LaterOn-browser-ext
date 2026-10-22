import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as navigation from "../../src/tabs/navigation";

declare global {
  var LaterOnTabs: typeof navigation;
}

export default defineUnlistedScript(() => {
  globalThis.LaterOnTabs = navigation;
});
