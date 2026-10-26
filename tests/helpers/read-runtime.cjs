const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { buildSync } = require("esbuild");
const sourcePath = require("./source-path.cjs");

const root = resolve(__dirname, "../..");
// Compile actual compatibility entries in memory; standalone tests need no prior build.
const entries = [
  ...["url-utils", "collection-picker", "collection-filter", "item-edit", "item-state", "backup-core", "tab-navigation", "storage-coordinator", "storage-client", "theme"].map(entry =>
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
  if (name === "sidepanel.html") return require("./library-page.cjs")(undefined, "sidepanel").html;
  if (name === "sidepanel-page.js") return require("./library-page.cjs")(undefined, "sidepanel").script;
  if (name === "library.html") return require("./library-page.cjs")().html;
  if (name === "library-page.js") return require("./library-page.cjs")().script;
  return scripts[name] ?? readFileSync(sourcePath(name), "utf8");
};
