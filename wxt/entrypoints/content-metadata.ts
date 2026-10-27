import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { extractPageMetadataForShortcut } from "../../src/content/metadata";

// executeScript consumes the extracted object as its injection result.
export default defineUnlistedScript(extractPageMetadataForShortcut);
