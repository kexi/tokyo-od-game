// Node module hooks for running game code that imports assets the way Vite does (`import url from
// "…/concrete_albedo.jpg?url"`) under tsx: such an import becomes a module whose default export is the
// file's path. For the tools that build the decks outside the browser (scripts/expresswayLedger.ts
// probes the merged decks with the game's deck builder). Why not vitest or vite-node: the tool is a
// plain script (just update-expressway-ledger), and nothing it needs of an asset is more than its name.
// Use: pnpm exec tsx --import ./scripts/assetUrlHooks.mjs scripts/<name>.ts
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
const isAsset = (url) => /\\?url$/.test(url) || /\\.(jpe?g|png|ktx2|glb|webp)$/.test(url);
export async function load(url, context, next) {
  if (!isAsset(url)) return next(url, context);
  const path = new URL(url).pathname;
  return { format: "module", shortCircuit: true, source: "export default " + JSON.stringify(path) + ";" };
}
`)}`,
  import.meta.url,
);
