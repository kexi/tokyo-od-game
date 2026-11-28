/**
 * Page-side JS that counts the render pipelines three's WebGPU backend builds: it wraps
 * `renderer.backend.createRenderPipeline` once (three's Pipelines calls it once per new cache key),
 * so a pipeline built for the first time, or thrown away with its last render object and built
 * again, adds 1 to `window.__pipelines.n`, its page time (performance.now()) to `.at` and what it was
 * built for to `.kinds` (PIPELINE_KIND, same index). Evaluates to true once the wrap is in (false
 * while the page has no `window.__game.renderer` yet: call again). Used by memory-buildings.ts
 * (--counts) and shader-prebuild.ts.
 * Why not renderer.info: three keeps no count of the pipelines it builds; the wrap touches no game
 * code. Why the times as well: a window (the first 30 s of a drive, the second round a moment)
 * counts its own from them.
 */
export const COUNT_PIPELINES = `(() => {
  const backend = window.__game?.renderer?.backend;
  if (!backend || typeof backend.createRenderPipeline !== "function") return false;
  if (backend.__counted) return true;
  const c = (window.__pipelines ??= { n: 0, at: [], kinds: [] });
  window.__pipelineKind ??= ${PIPELINE_KIND_SOURCE()};
  const build = backend.createRenderPipeline.bind(backend);
  backend.createRenderPipeline = (...args) => {
    c.n++; c.at.push(performance.now()); c.kinds.push(window.__pipelineKind(args[0], window.__game));
    return build(...args);
  };
  backend.__counted = true;
  return true;
})()`;

/** The kinds a pipeline is counted under, for the shadow pass with "shadow:" in front. */
export const PIPELINE_KINDS = ["facade", "farFacade", "terrain", "road", "instanced", "other"] as const;

/**
 * What a render pipeline was built for, from three's render object: the near town's façade (a mesh
 * under the near tiles' group), the far skyline's façade, a terrain chunk, a road surface mesh, any
 * other InstancedMesh (street furniture, lamps, trees: #23's road instances), or other; "shadow:" in
 * front when it was built for the shadow pass. How the shadow pass is told: three draws it with one
 * override material that has isShadowPassMaterial, so `ro.material` is that and the object's own
 * material is not what the pipeline is for; the object (`ro.object`) is still the mesh. Why by the
 * object and not by the material: the game's materials carry no mark of their own, and the façade's
 * are made per mesh (facadeMaterial()), so a material cannot be looked up; the groups can.
 * Exported as a function for the tests; COUNT_PIPELINES puts its source in the page.
 */
export function pipelineKind(
  ro: { object?: unknown; material?: { isShadowPassMaterial?: boolean } } | undefined,
  game: unknown,
): string {
  type Node = { parent?: Node | null; isInstancedMesh?: boolean };
  type Game = {
    buildings?: { tiles?: { group?: Node }; far?: { group?: Node } | null };
    terrain?: { chunks?: Map<string, { mesh?: unknown }> };
    debug?: { roads?: { surface?: { meshes?: Map<unknown, unknown> } } };
  };
  const g = (game ?? {}) as Game;
  const object = ro?.object as Node | undefined;
  const isShadow = ro?.material?.isShadowPassMaterial === true;
  const prefix = isShadow ? "shadow:" : "";
  const nearGroup = g.buildings?.tiles?.group;
  const farGroup = g.buildings?.far?.group;
  for (let p: Node | null | undefined = object; p; p = p.parent) {
    const isNear = nearGroup !== undefined && p === nearGroup;
    if (isNear) return `${prefix}facade`;
    const isFar = farGroup !== undefined && p === farGroup;
    if (isFar) return `${prefix}farFacade`;
  }
  const chunks = g.terrain?.chunks?.values() ?? [];
  for (const chunk of chunks) {
    const isTerrain = chunk.mesh === object;
    if (isTerrain) return `${prefix}terrain`;
  }
  const roads = g.debug?.roads?.surface?.meshes?.values() ?? [];
  for (const mesh of roads) {
    const isRoad = mesh === object;
    if (isRoad) return `${prefix}road`;
  }
  const isInstanced = object?.isInstancedMesh === true;
  if (isInstanced) return `${prefix}instanced`;
  return `${prefix}other`;
}

/** pipelineKind's source, as page-side JS (the TS types are gone once tsx has loaded this file). */
function PIPELINE_KIND_SOURCE(): string {
  return pipelineKind.toString();
}

/** The pipelines of `kinds` whose time in `at` is inside [from, to), counted by kind. */
export function countKinds(
  at: readonly number[],
  kinds: readonly string[] | undefined,
  from: number,
  to: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < at.length; i++) {
    const isInside = at[i] >= from && at[i] < to;
    if (!isInside) continue;
    const kind = kinds?.[i] ?? "?";
    out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}
