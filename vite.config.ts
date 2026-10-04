import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * アセット管理 (assets.html) review hand-off, dev server only: POST /__asset-review writes the
 * review to .review/pending/<time>.json (+ a Markdown summary and the model snapshots) for the
 * asset-review skill; GET /__asset-review/responses returns what Claude reported back from
 * .review/done/*.response.json.
 */
function assetReview(): Plugin {
  const root = join(import.meta.dirname, ".review");
  return {
    name: "asset-review",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path.endsWith("/__asset-review/responses") && req.method === "GET") {
          const dir = join(root, "done");
          const out = existsSync(dir)
            ? readdirSync(dir)
                .filter((f) => f.endsWith(".response.json"))
                .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown[])
            : [];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(out));
          return;
        }
        if (!path.endsWith("/__asset-review") || req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          type Item = {
            asset: string;
            verdict: string;
            comment: string;
            generators: string[];
            pins: unknown[];
            snapshot?: string;
          };
          const review = JSON.parse(body) as { submittedAt: string; items: Item[] };
          const stamp = review.submittedAt.replace(/[:.]/g, "-");
          const dir = join(root, "pending");
          mkdirSync(join(dir, stamp), { recursive: true });
          const md = [`# アセットレビュー ${review.submittedAt}`, ""];
          review.items.forEach((item, i) => {
            if (item.snapshot?.startsWith("data:image/")) {
              const file = `${stamp}/${i + 1}.jpg`;
              writeFileSync(join(dir, file), Buffer.from(item.snapshot.split(",")[1], "base64"));
              item.snapshot = `.review/pending/${file}`;
            }
            md.push(`## ${item.asset} — ${item.verdict === "ok" ? "OK" : "要修正"}`, "");
            md.push(`- 生成スクリプト: ${item.generators.join(", ") || "—"}`);
            if (item.comment) md.push(`- 指示: ${item.comment}`);
            for (const pin of item.pins as Array<Record<string, unknown>>) {
              md.push(
                `- ピン ${pin.n}: ${pin.note || "(メモなし)"} ${JSON.stringify({ ...pin, n: undefined, note: undefined })}`,
              );
            }
            if (item.snapshot) md.push(`- スナップショット: ${item.snapshot}`);
            md.push("");
          });
          writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(review, null, 2));
          writeFileSync(join(dir, `${stamp}.md`), md.join("\n"));
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ file: `.review/pending/${stamp}.json` }));
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/tokyo-od-game/
  base: process.env.BASE_PATH ?? "/tokyo-od-game/",
  plugins: [dracoDecoder(), assetReview()],
  // Module workers so the TTS worker can dynamic-import the Emscripten ES module from public/tts.
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: join(import.meta.dirname, "index.html"),
        assets: join(import.meta.dirname, "assets.html"),
      },
    },
    chunkSizeWarningLimit: 4000,
  },
});
