const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { buildSync } = require("esbuild");

const root = resolve(__dirname, "../..");
// Compile actual compatibility entries in memory; standalone tests need no prior build.
const entries = [
  ...["url-utils", "collection-picker", "backup-core", "tab-navigation", "storage-coordinator", "storage-client", "theme"].map(entry =>
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

module.exports = (name) => scripts[name] ?? readFileSync(resolve(root, name), "utf8");
