import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as itemEdit from "../../src/collection/item-edit";

declare global {
  var LaterOnItemEdit: typeof itemEdit;
}

export default defineUnlistedScript(() => {
  globalThis.LaterOnItemEdit = itemEdit;
});
