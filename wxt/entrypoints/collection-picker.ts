import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as picker from "../../src/collection/picker";

declare global {
  var LaterOnPicker: typeof picker;
}

export default defineUnlistedScript(() => {
  globalThis.LaterOnPicker = picker;
});
