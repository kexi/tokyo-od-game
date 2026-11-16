/**
 * Page-side JS that counts the render pipelines three's WebGPU backend builds: it wraps
 * `renderer.backend.createRenderPipeline` once (three's Pipelines calls it once per new cache key),
 * so a pipeline built for the first time, or thrown away with its last render object and built
 * again, adds 1 to `window.__pipelines.n` and its page time (performance.now()) to `.at`. Evaluates
 * to true once the wrap is in (false while the page has no `window.__game.renderer` yet: call again).
 * Used by memory-buildings.ts (--counts) and shader-prebuild.ts.
 * Why not renderer.info: three keeps no count of the pipelines it builds; the wrap touches no game
 * code. Why the times as well: a window (the first 30 s of a drive, the second round a moment)
 * counts its own from them.
 */
export const COUNT_PIPELINES = `(() => {
  const backend = window.__game?.renderer?.backend;
  if (!backend || typeof backend.createRenderPipeline !== "function") return false;
  if (backend.__counted) return true;
  const c = (window.__pipelines ??= { n: 0, at: [] });
  const build = backend.createRenderPipeline.bind(backend);
  backend.createRenderPipeline = (...args) => { c.n++; c.at.push(performance.now()); return build(...args); };
  backend.__counted = true;
  return true;
})()`;
