import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import { publishLocal } from "./scripts/publish-local.mjs";

const projectRoot = new URL("./", import.meta.url);
const { manifest_version: manifestVersion, ...manifest } = JSON.parse(readFileSync(new URL("manifest.json", projectRoot), "utf8"));
const require = createRequire(import.meta.url);
const xmlPackage = dirname(require.resolve("@xmldom/xmldom/package.json"));
const zipPackage = dirname(require.resolve("@zip.js/zip.js"));

export default defineConfig({
  entrypointsDir: "wxt/entrypoints",
  modulesDir: "wxt/modules",
  publicDir: "wxt/public",
  modules: ["@wxt-dev/module-vue"],
  imports: false,
  manifestVersion,
  targetBrowsers: ["chrome"],
  manifest: ({ mode }) => {
    const { key, ...storeManifest } = manifest;
    return mode === "store" ? storeManifest : manifest;
  },
  zip: { artifactTemplate: "StaySide-{{version}}{{modeSuffix}}.zip", zipSources: false },
  hooks: {
    "vite:build:extendConfig"(entries, config) {
      if (entries.some(entry => entry.type === "unlisted-style" && entry.name === "translation")) {
        // Keep the insertCSS contract while WXT compiles the standalone stylesheet.
        config.build.rollupOptions.output.assetFileNames = "[name].[ext]";
      }
    },
    "build:publicAssets"(_, assets) {
      assets.push(
        { absoluteSrc: fileURLToPath(new URL("LICENSE", projectRoot)), relativeDest: "LICENSE" },
        { absoluteSrc: resolve(xmlPackage, "LICENSE"), relativeDest: "LICENSE.xmldom.txt" },
        { absoluteSrc: resolve(zipPackage, "LICENSE"), relativeDest: "LICENSE.zip.js.txt" }
      );
    },
    "zip:extension:done"(wxt, archive) {
      // Store packages omit the local identity and must not replace a local installation.
      if (wxt.config.mode === "store") return;
      if (process.env.LATERON_PUBLISH !== "true") return;
      const directory = process.env.LATERON_RELEASE_DIR?.trim();
      if (!directory) throw new Error("LATERON_RELEASE_DIR is required when LATERON_PUBLISH=true");
      publishLocal({ archive, destination: resolve(wxt.config.root, directory) });
    }
  }
});
