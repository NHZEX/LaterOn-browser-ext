// Bundle real module exports for execution in a VM with browser boundary fixtures.
const { buildSync } = require("esbuild");
const { resolve } = require("node:path");

module.exports = (file, globalName = "backgroundModule") => buildSync({
  entryPoints: [resolve(__dirname, "../..", file)],
  bundle: true, write: false, format: "iife", globalName,
  platform: "browser", target: "esnext", keepNames: true, loader: { ".css": "text" }
}).outputFiles[0].text;
