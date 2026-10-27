import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { registerFolderPicker } from "../../src/content/folder-picker.js";

// WXT wraps the bundle in a function scope so repeated executeScript calls are safe.
export default defineUnlistedScript(registerFolderPicker);
