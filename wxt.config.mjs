import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import { inputHashes, legacyAssets, projectRoot, recordBuild } from "./scripts/build-assets.mjs";
import { validateArchive, validateBuild } from "./scripts/check-release.mjs";

const root = fileURLToPath(projectRoot);
const { manifest_version: manifestVersion, ...manifest } = JSON.parse(readFileSync(new URL("manifest.json", projectRoot), "utf8"));
const inputs = inputHashes(root);

export default defineConfig({
  entrypointsDir: "wxt/entrypoints",
  modulesDir: "wxt/modules",
  publicDir: "wxt/public",
  imports: false,
  manifestVersion,
  targetBrowsers: ["chrome"],
  manifest,
  zip: { artifactTemplate: "LaterOn-{{version}}.zip", zipSources: false },
  hooks: {
    "build:publicAssets"(_, assets) {
      if (assets.length) throw new Error("Runtime assets must use scripts/runtime-files.json");
      assets.push(...legacyAssets(root));
    },
    "build:done"(wxt) {
      if (wxt.config.mode !== "production") return;
      recordBuild(root, wxt.config.outDir, inputs);
      validateBuild(root, wxt.config.outDir);
    },
    "zip:extension:start"(wxt) {
      validateBuild(root, wxt.config.outDir);
    },
    "zip:extension:done"(wxt, archive) {
      validateArchive(root, wxt.config.outDir, archive);
    }
  }
});
