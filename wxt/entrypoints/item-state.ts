import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as itemState from "../../src/collection/item-state";

declare global {
  var LaterOnItemState: typeof itemState;
}

export default defineUnlistedScript(() => {
  globalThis.LaterOnItemState = itemState;
});
