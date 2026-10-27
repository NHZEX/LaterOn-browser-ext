const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { buildSync } = require("esbuild");
const sourcePath = require("./source-path.cjs");

const root = resolve(__dirname, "../..");
// Compile real entries and native backend modules; standalone tests need no prior build.
const entries = [
  ["background-test-api.js", `
    import entry from "./wxt/entrypoints/background";
    import * as workflow from "./src/background/save-workflow";
    import * as collection from "./src/background/collection";
    import { purgeExpiredItems, ensureLegacyCleanup } from "./src/background/maintenance";
    import { claimPendingBatch } from "./src/background/project-picker";
    import { handleCommand } from "./src/background/index";
    import { execute } from "./src/storage/coordinator";
    entry.main();
    globalThis.backgroundTest = { ...workflow, ...collection, purgeExpiredItems, ensureLegacyCleanup, claimPendingBatch, handleCommand, execute };
  `],
  ["background.js", 'import entry from "./wxt/entrypoints/background"; entry.main();'],
  ["reading-position-background.js", 'import { registerReadingPosition } from "./src/background/reading-position"; registerReadingPosition();'],
  ["collection-backend.js", 'import * as api from "./src/storage/coordinator"; api.registerMessages(); globalThis.collectionBackend = api;'],
  ...["url-utils", "collection-filter", "item-edit", "item-state", "tab-navigation", "storage-client", "theme"].map(entry =>
    [`${entry}.js`, `import entry from "./wxt/entrypoints/${entry}"; entry.main();`])
];
const scripts = Object.fromEntries(entries.map(([name, contents]) => {
  const { outputFiles } = buildSync({
    stdin: {
      contents,
      resolveDir: root,
      loader: "ts"
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "esnext"
  });
  return [name, outputFiles[0].text];
}));

module.exports = (name) => {
  if (["i18n.js", "dialog.js", "onboarding.js"].includes(name)) return require("./ui-modules.cjs");
  if (["boot.js", "content-folder-picker.js", "content-metadata.js", "content-reading-position.js", "content-translation.js"].includes(name)) {
    return require("./library-page.cjs").script(name);
  }
  if (name === "sidepanel.html") return require("./library-page.cjs")(undefined, "sidepanel").html;
  if (name === "sidepanel-page.js") return require("./library-page.cjs")(undefined, "sidepanel").script;
  if (name === "library.html") return require("./library-page.cjs")().html;
  if (name === "library-page.js") return require("./library-page.cjs")().script;
  return scripts[name] ?? readFileSync(sourcePath(name), "utf8");
};
