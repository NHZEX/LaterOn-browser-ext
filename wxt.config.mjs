import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "wxt";
import { legacyAssets, projectRoot } from "./scripts/build-assets.mjs";
import { publishLocal } from "./scripts/publish-local.mjs";

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
  zip: { artifactTemplate: "LaterOn-{{version}}{{modeSuffix}}.zip", zipSources: false },
  hooks: {
    "build:publicAssets"(_, assets) {
      assets.push(...legacyAssets(root));
    },
    "zip:extension:done"(wxt, archive) {
      if (process.env.LATERON_PUBLISH !== "true") return;
      const directory = process.env.LATERON_RELEASE_DIR?.trim();
      if (!directory) throw new Error("LATERON_RELEASE_DIR is required when LATERON_PUBLISH=true");
      publishLocal({ archive, destination: resolve(wxt.config.root, directory) });
    }
  }
});
