import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { collectLicenses } from "./scripts/licenses.ts";

const require = createRequire(import.meta.url);
// three does not export ./package.json, so walk up from its CJS entry (build/three.cjs).
const dracoDir = join(dirname(require.resolve("three")), "..", "examples/jsm/libs/draco/gltf");
const DRACO_FILES = ["draco_decoder.wasm", "draco_wasm_wrapper.js"];

/**
 * DRACOLoader fetches its decoder by fixed file names from a folder, which hashed asset imports
 * cannot satisfy. Serve/emit the copies bundled with three so the decoder version always matches
 * the installed three.js (no CDN dependency, no vendored binaries in git).
 */
function dracoDecoder(): Plugin {
  return {
    name: "draco-decoder",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0].split("/draco/")[1];
        if (!name || !DRACO_FILES.includes(name)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.end(readFileSync(join(dracoDir, name)));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_LICENSES.txt",
        source: collectLicenses(import.meta.dirname),
      });
      for (const name of DRACO_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `draco/${name}`,
          source: readFileSync(join(dracoDir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/tokyo-od-game/
  base: process.env.BASE_PATH ?? "/tokyo-od-game/",
  plugins: [dracoDecoder()],
  // Module workers so the TTS worker can dynamic-import the Emscripten ES module from public/tts.
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
});
