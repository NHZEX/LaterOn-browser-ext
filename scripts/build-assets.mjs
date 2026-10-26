import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const projectRoot = new URL("../", import.meta.url);
const specification = JSON.parse(readFileSync(new URL("runtime-files.json", import.meta.url), "utf8"));

export function legacyAssets(root) {
  return Object.entries(specification)
    .map(([destination, source]) => ({
      absoluteSrc: resolve(root, source),
      relativeDest: destination
    }));
}
