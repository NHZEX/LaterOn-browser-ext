import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { KEYS, EPOCH, enqueue, execute, registerMessages } from "../../src/storage/coordinator";

declare global {
  var LaterOnCollection: { KEYS: typeof KEYS; EPOCH: typeof EPOCH; enqueue: typeof enqueue; execute: typeof execute };
}

export default defineUnlistedScript(() => {
  registerMessages();
  globalThis.LaterOnCollection = { KEYS, EPOCH, enqueue, execute };
});
