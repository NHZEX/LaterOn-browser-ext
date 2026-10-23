import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import * as filter from "../../src/collection/filter";

declare global { var LaterOnFilter: typeof filter; }

export default defineUnlistedScript(() => { globalThis.LaterOnFilter = filter; });
