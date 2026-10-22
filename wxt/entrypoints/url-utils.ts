import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as urlUtils from "../../src/shared/url-utils";

declare global {
  var LaterOnUrl: typeof urlUtils;
}

// Classic pages and importScripts consumers keep their existing synchronous API.
export default defineUnlistedScript(() => {
  globalThis.LaterOnUrl = urlUtils;
});
