import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as backup from "../../src/backup/core";

declare global {
  var LaterOnBackup: typeof backup;
}

export default defineUnlistedScript(() => {
  globalThis.LaterOnBackup = backup;
});
