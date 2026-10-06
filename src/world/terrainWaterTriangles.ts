/** Keep triangles touching land; all corners and the centre must be wet to remove ground. */
export function dryTerrainTriangles(
  index: ArrayLike<number>,
  mask: Uint8Array | null,
  size: number,
  segments: number,
): Uint32Array {
  const hasMask = mask !== null;
  if (!hasMask) return new Uint32Array(index);
  const width = segments + 1;
  const isWet = (i: number, j: number) => {
    const px = Math.min(size - 1, Math.floor((i / segments) * size));
    const py = Math.min(size - 1, Math.floor((j / segments) * size));
    return mask[py * size + px] >= 128;
  };
  // Tuple arrays per face caused garbage collection during water changes; write the retained indices once.
  const kept = new Uint32Array(index.length);
  let count = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t],
      b = index[t + 1],
      c = index[t + 2];
    const ai = a % width,
      aj = Math.floor(a / width),
      bi = b % width,
      bj = Math.floor(b / width),
      ci = c % width,
      cj = Math.floor(c / width);
    const isOnWater =
      isWet(ai, aj) && isWet(bi, bj) && isWet(ci, cj) && isWet((ai + bi + ci) / 3, (aj + bj + cj) / 3);
    if (isOnWater) continue;
    kept[count++] = a;
    kept[count++] = b;
    kept[count++] = c;
  }
  const keptAll = count === kept.length;
  return keptAll ? kept : kept.slice(0, count);
}
