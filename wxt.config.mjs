import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "wxt";
import { publishLocal } from "./scripts/publish-local.mjs";

const projectRoot = new URL("./", import.meta.url);
const { manifest_version: manifestVersion, ...manifest } = JSON.parse(readFileSync(new URL("manifest.json", projectRoot), "utf8"));

export default defineConfig({
  entrypointsDir: "wxt/entrypoints",
  modulesDir: "wxt/modules",
  publicDir: "wxt/public",
  modules: ["@wxt-dev/module-vue"],
  imports: false,
  manifestVersion,
  targetBrowsers: ["chrome"],
  manifest,
  zip: { artifactTemplate: "LaterOn-{{version}}{{modeSuffix}}.zip", zipSources: false },
  hooks: {
    "vite:build:extendConfig"(entries, config) {
      if (entries.some(entry => entry.type === "unlisted-style" && entry.name === "translation")) {
        // Keep the insertCSS contract while WXT compiles the standalone stylesheet.
        config.build.rollupOptions.output.assetFileNames = "[name].[ext]";
      }
    },
    "build:publicAssets"(_, assets) {
      // Legal metadata keeps one authoritative source at the repository root.
      assets.push({ absoluteSrc: fileURLToPath(new URL("LICENSE", projectRoot)), relativeDest: "LICENSE" });
    },
    "zip:extension:done"(wxt, archive) {
      if (process.env.LATERON_PUBLISH !== "true") return;
      const directory = process.env.LATERON_RELEASE_DIR?.trim();
      if (!directory) throw new Error("LATERON_RELEASE_DIR is required when LATERON_PUBLISH=true");
      publishLocal({ archive, destination: resolve(wxt.config.root, directory) });
    }
  }
});
