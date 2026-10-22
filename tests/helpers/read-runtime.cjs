const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { buildSync } = require("esbuild");

const root = resolve(__dirname, "../..");
// Compile the actual compatibility entry in memory; standalone tests need no prior build.
const { outputFiles } = buildSync({
  stdin: {
    contents: 'import entry from "./wxt/entrypoints/url-utils"; entry.main();',
    resolveDir: root,
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "esnext"
});

module.exports = (name) => name === "url-utils.js"
  ? outputFiles[0].text
  : readFileSync(resolve(root, name), "utf8");
