import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Vector3, type Scene } from "three";
import type { AppliedRegulations } from "./regulations";
import { leftOf, type RoadGraph, type Segment } from "./roads";
import type { Approach } from "./trafficControl";

const STEP = 5; // metres between cross-sections (follows terrain folds closely enough)
const LIFT = 0.07; // above the terrain surface the physics collider and renderer share

type Builder = { pos: number[]; idx: number[] };

const asphalt = new MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.95, metalness: 0 });
const white = new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, emissive: 0x222222 });
const yellow = new MeshStandardMaterial({ color: 0xf2b705, roughness: 0.7, emissive: 0x221800 });

/**
 * Drivable-looking streets from GSI road centrelines: asphalt ribbons of the real carriageway
 * width, 車道外側線 / 中央線 markings (yellow = はみ出し禁止 on wide roads, dashed white on
 * narrower two-way roads), and 横断歩道 + 停止線 where JARTIC records them (synthesised at
 * junctions when the area has no JARTIC data).
 */
export class RoadSurface {
  private meshes: Mesh[] = [];

  constructor(
    private readonly scene: Scene,
    /** Height of the rendered ground at (x, z), or null if not loaded yet. */
    private readonly surfaceAt: (x: number, z: number) => number | null,
  ) {}

  rebuild(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null = null,
    approaches: Approach[] = [],
  ): void {
    this.clear();
    if (!graph) return;
    const isSurveyed = regs?.hasMarkings ?? false;
    const road: Builder = { pos: [], idx: [] };
    const lines: Builder = { pos: [], idx: [] };
    const centre: Builder = { pos: [], idx: [] };
    const junction = (node: number) => (graph.nodes.get(node)?.length ?? 0) >= 3;
    // Distance from a junction node to the kerb line of the widest crossing road.
    const clearance = (node: number) =>
      Math.max(...(graph.nodes.get(node) ?? []).map((id) => graph.segments[id].line.width)) / 2 + 1.5;

    for (const seg of graph.segments) {
      if (seg.line.kind === "highway") continue;
      const w = seg.line.width;
      // Markings stop behind the crosswalk (3 m) and stop line (+2 m) at each junction end.
      const startCut = junction(seg.from) ? Math.min(seg.length / 2, clearance(seg.from) + 6) : 0;
      const endCut = junction(seg.to) ? Math.min(seg.length / 2, clearance(seg.to) + 6) : 0;
      this.ribbon(road, graph, seg, 0, seg.length, 0, w, 0);
      const isMarked = w >= 5.5 && seg.length - startCut - endCut > 4;
      if (!isMarked) continue;
      // 車道外側線 on both sides.
      for (const side of [-1, 1])
        this.ribbon(lines, graph, seg, startCut, seg.length - endCut, side * (w / 2 - 0.4), 0.15, 0.01);
      if (seg.oneway !== 0) continue;
      if (w >= 9) this.ribbon(centre, graph, seg, startCut, seg.length - endCut, 0, 0.15, 0.01);
      else {
        for (let s = startCut; s + 5 <= seg.length - endCut; s += 10)
          this.ribbon(lines, graph, seg, s, s + 5, 0, 0.12, 0.01);
      }
      // 横断歩道 and 停止線 near each junction end.
      if (isSurveyed) continue;
      if (junction(seg.from) && seg.length > startCut + endCut)
        this.crossing(lines, graph, seg, clearance(seg.from) + 1.5, 1);
      if (junction(seg.to) && seg.length > startCut + endCut) {
        this.crossing(lines, graph, seg, seg.length - clearance(seg.to) - 1.5, -1);
      }
    }
    if (regs && isSurveyed) this.surveyed(lines, graph, regs, approaches);
    for (const [b, mat, order] of [
      [road, asphalt, 1],
      [lines, white, 2],
      [centre, yellow, 2],
    ] as const) {
      if (b.idx.length === 0) continue;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
      g.setIndex(b.idx);
      g.computeVertexNormals();
      const mesh = new Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = order;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  clear(): void {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
  }

  /** A strip `width` wide, centred `offset` metres left of the centreline, from s0 to s1. */
  private ribbon(
    b: Builder,
    graph: RoadGraph,
    seg: Segment,
    s0: number,
    s1: number,
    offset: number,
    width: number,
    extraLift: number,
  ): void {
    // 0.1, not more: 停止線 are 0.45 m deep and must not be dropped as degenerate.
    if (s1 - s0 < 0.1) return;
    const n = Math.max(1, Math.ceil((s1 - s0) / STEP));
    const base = b.pos.length / 3;
    const left = new Vector3();
    for (let i = 0; i <= n; i++) {
      const { pos, dir } = graph.sample(seg, s0 + ((s1 - s0) * i) / n);
      for (const edge of [offset + width / 2, offset - width / 2]) {
        leftOf(dir, edge, left);
        const x = pos.x + left.x;
        const z = pos.z + left.z;
        const y = this.surfaceAt(x, z);
        b.pos.push(x, (y ?? 0) + LIFT + extraLift, z);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      // Winding chosen so faces point up (+Y).
      b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /** JARTIC 横断歩道 (kerb-to-kerb pairs) and 停止線, plus lines at signal stops JARTIC lacks. */
  private surveyed(b: Builder, graph: RoadGraph, regs: AppliedRegulations, approaches: Approach[]): void {
    const u = new Vector3();
    const v = new Vector3();
    const c = new Vector3();
    for (const [p, q] of regs.crosswalks) {
      u.copy(q).sub(p).setY(0);
      const len = u.length();
      if (len < 2 || len > 60) continue;
      u.divideScalar(len);
      v.set(u.z, 0, -u.x); // along the road; u × v points up, which fixes the winding
      // 45 cm bars with 45 cm gaps, 4 m deep (道路標示 201).
      for (let t = 0.5; t <= len - 0.5; t += 0.9) {
        c.copy(p).addScaledVector(u, t);
        this.quad(b, c, u, v, 0.225, 2, 0.012);
      }
    }
    const lines = regs.stopLines.map((l) => ({ seg: l.seg, dir: l.dir, at: l.at }));
    for (const ap of approaches) {
      const isPainted = lines.some(
        (l) => l.seg === ap.seg && l.dir === ap.dir && Math.abs(l.at - ap.at) < 1.5,
      );
      if (!isPainted) lines.push({ seg: ap.seg, dir: ap.dir, at: ap.at });
    }
    for (const l of lines) {
      const w = l.seg.line.width;
      const s = l.dir === 1 ? l.at : l.seg.length - l.at;
      // Keep-left: the line covers the left half of its travel direction on two-way roads.
      const lane = l.seg.oneway === 0 ? l.dir * (w / 4) : 0;
      const span = l.seg.oneway === 0 ? w / 2 - 0.4 : w - 0.8;
      this.ribbon(b, graph, l.seg, s - 0.225, s + 0.225, lane, span, 0.012);
    }
  }

  /** Flat rectangle ±hu along `u` and ±hv along `v` around `c`, draped on the surface. */
  private quad(
    b: Builder,
    c: Vector3,
    u: Vector3,
    v: Vector3,
    hu: number,
    hv: number,
    extraLift: number,
  ): void {
    const base = b.pos.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = c.x + u.x * hu * su + v.x * hv * sv;
      const z = c.z + u.z * hu * su + v.z * hv * sv;
      b.pos.push(x, (this.surfaceAt(x, z) ?? 0) + LIFT + extraLift, z);
    }
    b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  /**
   * Zebra crossing (bars run along the road) plus a stop line on the approach lane.
   * `side` is +1 when the junction is at s = 0 (segment start), −1 when it is at the end.
   */
  private crossing(b: Builder, graph: RoadGraph, seg: Segment, at: number, side: 1 | -1): void {
    const w = seg.line.width;
    const depth = 3;
    for (let x = -w / 2 + 0.6; x <= w / 2 - 0.6; x += 0.9) {
      this.ribbon(b, graph, seg, at - depth / 2, at + depth / 2, x, 0.45, 0.012);
    }
    // 停止線 before the crosswalk, across the half whose traffic heads into the junction. That
    // traffic moves along −side·d, so its left (keep-left) half is −side · left(d).
    const stopAt = at + side * (depth / 2 + 2);
    const lane = seg.oneway === 0 ? -side * (w / 4) : 0;
    const span = seg.oneway === 0 ? w / 2 - 0.4 : w - 0.8;
    this.ribbon(b, graph, seg, stopAt - 0.225, stopAt + 0.225, lane, span, 0.012);
  }
}
