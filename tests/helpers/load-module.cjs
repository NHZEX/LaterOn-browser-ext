// Execute real TypeScript modules and their imports without slicing business source.
const path = require("node:path");
const { buildSync } = require("esbuild");

module.exports = function loadModule(file) {
  const { outputFiles } = buildSync({ entryPoints: [path.resolve(__dirname, "../..", file)],
    bundle: true, write: false, format: "cjs", platform: "node" });
  const module = { exports: {} };
  new Function("module", "exports", outputFiles[0].text)(module, module.exports);
  return module.exports;
};
