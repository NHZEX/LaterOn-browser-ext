import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { startBoot } from "../../src/sidepanel/boot";

// Independent of Vue and the page entry: the fallback must survive a failed page bundle.
export default defineUnlistedScript(startBoot);
