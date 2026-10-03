import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Keep upstream attribution inside the frontend embedded in every executable. */
export function licensePlugin(): Plugin {
  return {
    name: "open-source-notices",
    generateBundle() {
      for (const fileName of ["LICENSE", "UPSTREAM.md"]) {
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(new URL(`../../../${fileName}`, import.meta.url), "utf8"),
        });
      }
    },
  };
}
