import type { Object3D } from "three";

/**
 * Takes an object that will not be drawn again out of its parent and tells the renderer so: every
 * object in it (the root and all its descendants) gets `dispose()`, which only fires three's
 * `dispose` event. WebGPURenderer keeps one render object per object, material and pass in a set
 * (RenderObjects._renderObjects, three 0.186) and lets it go on that event alone; an object that is
 * only removed from the scene stays in that set for good, with its whole model (M1,
 * knowledge/memory-growth.md).
 *
 * Geometries, materials and textures are left alone: the caller disposes what is its own, before
 * calling this (disposeHuman for a pedestrian's own geometry), and what is shared stays usable.
 *
 * Why not dispatchEvent({ type: "dispose" }) here: Object3D.dispose() is three's own way to say it,
 * and keeps up if three ever does more on it. Why not dispose the materials (that would let go of
 * the render objects too): they are shared with the people and cars still about, whose render
 * objects and pipelines would be rebuilt on the next frame.
 */
export function retireObject(root: Object3D): void {
  root.removeFromParent();
  root.traverse((o) => o.dispose());
}
