import { BufferAttribute, BufferGeometry } from "three";

/** Keep GPU buffers and geometry identity while the new road fits their reserved capacity. */
export function updateRoadGeometry(current: BufferGeometry, source: BufferGeometry): BufferGeometry {
  const index = source.getIndex()!;
  const names = Object.keys(source.attributes);
  const fits =
    current.getIndex() !== null &&
    current.getIndex()!.count >= index.count &&
    Object.keys(current.attributes).length === names.length &&
    names.every((name) => {
      const old = current.getAttribute(name),
        next = source.getAttribute(name);
      return old !== undefined && old.itemSize === next.itemSize && old.count >= next.count;
    });
  const target = fits ? current : new BufferGeometry();
  if (!fits) {
    // Buffers cannot be resized after upload. Reserve headroom for adjacent road tiles.
    const vertexCapacity = 2 ** Math.ceil(Math.log2(Math.max(1, source.getAttribute("position").count)));
    for (const name of names) {
      const size = source.getAttribute(name).itemSize;
      target.setAttribute(name, new BufferAttribute(new Float32Array(vertexCapacity * size), size));
    }
    const indexCapacity = 2 ** Math.ceil(Math.log2(Math.max(1, index.count)));
    target.setIndex(new BufferAttribute(new Uint32Array(indexCapacity), 1));
    current.dispose();
  }
  for (const name of names) {
    const attr = target.getAttribute(name) as BufferAttribute;
    const next = source.getAttribute(name);
    attr.array.set(next.array);
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, next.array.length);
    attr.needsUpdate = true;
  }
  const targetIndex = target.getIndex()!;
  targetIndex.array.set(index.array);
  targetIndex.clearUpdateRanges();
  targetIndex.addUpdateRange(0, index.count);
  targetIndex.needsUpdate = true;
  target.setDrawRange(0, index.count);
  // Reserved or stale vertices must not affect culling after an origin change.
  const lacksBounds = source.boundingBox === null || source.boundingSphere === null;
  if (lacksBounds) {
    source.computeBoundingBox();
    source.computeBoundingSphere();
  }
  target.boundingBox = source.boundingBox!.clone();
  target.boundingSphere = source.boundingSphere!.clone();
  return target;
}
