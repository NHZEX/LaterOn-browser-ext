import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { togglePageTranslation } from "../../src/content/translation.js";

// Preserve the Promise result for the background's translation error feedback.
export default defineUnlistedScript(togglePageTranslation);
