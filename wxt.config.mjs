import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import { legacyAssets, projectRoot } from "./scripts/build-assets.mjs";

const root = fileURLToPath(projectRoot);
const { manifest_version: manifestVersion, ...manifest } = JSON.parse(readFileSync(new URL("manifest.json", projectRoot), "utf8"));

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
      assets.push(...legacyAssets(root));
    }
  }
});
