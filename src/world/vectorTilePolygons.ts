type Pt = { x: number; y: number };

/**
 * MVT rings → polygons (outer ring, then holes), each clipped to the tile square so the buffer
 * that neighbouring tiles share is not drawn twice. Outer rings are clockwise in tile space
 * (positive shoelace sum with y down), holes anticlockwise.
 */
export function polygonsOf(rings: Pt[][], extent: number): Pt[][][] {
  const polygons: Pt[][][] = [];
  for (const ring of rings) {
    const clipped = clipToSquare(ring, extent);
    const isDegenerate = clipped.length < 3;
    if (isDegenerate) continue;
    const isOuter = shoelace(ring) > 0;
    const startsPolygon = isOuter || polygons.length === 0;
    if (startsPolygon) polygons.push([clipped]);
    else polygons[polygons.length - 1].push(clipped);
  }
  return polygons;
}

const shoelace = (ring: Pt[]) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
};

/** Sutherland–Hodgman against [0, extent]². */
function clipToSquare(ring: Pt[], extent: number): Pt[] {
  let pts = ring;
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p.x >= 0, (a, b) => lerpAt(a, b, (0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= extent, (a, b) => lerpAt(a, b, (extent - a.x) / (b.x - a.x))],
    [(p) => p.y >= 0, (a, b) => lerpAt(a, b, (0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= extent, (a, b) => lerpAt(a, b, (extent - a.y) / (b.y - a.y))],
  ];
  for (const [inside, cut] of edges) {
    const next: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIn = inside(a);
      const bIn = inside(b);
      if (aIn) next.push(a);
      const crossesEdge = aIn !== bIn;
      if (crossesEdge) next.push(cut(a, b));
    }
    pts = next;
    const isEmpty = pts.length === 0;
    if (isEmpty) break;
  }
  // MVT rings repeat the first point at the end; drop it so triangulation sees a clean ring.
  const isClosingRepeat =
    pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y;
  if (isClosingRepeat) pts.pop();
  return pts;
}

const lerpAt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
