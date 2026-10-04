import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
  type Scene,
} from "three";
import asphaltAlbedoUrl from "../../assets/road/textures/asphalt_albedo.jpg?url";
import asphaltNormalUrl from "../../assets/road/textures/asphalt_normal.jpg?url";
import asphaltRoughnessUrl from "../../assets/road/textures/asphalt_roughness.png?url";
import { SIGN, type AppliedRegulations, type LaneDirection } from "./regulations";
import { leftOf, type RoadGraph, type Segment } from "./roads";
import type { Approach } from "./trafficControl";

const STEP = 2.5; // metres between cross-sections; dense enough to hug the terrain mesh
// Wide carriageways are also split across their width: a single quad spanning 30 m sits
// tens of centimetres off the terrain in the middle, burying markings and letting the ground
// photo show through.
const ACROSS = 2.5;
const LIFT = 0.1; // asphalt above the terrain surface the collider and renderer share
const PAINT = 0.025; // markings above the asphalt
const LINE = 0.15; // 区画線 width (MLIT 区画線の設置基準: 0.10–0.20 m)
const DASH = 5; // dashed 中央線 / 車線境界線 in urban areas: 5 m painted, 5 m gap (same standard)

type Builder = { pos: number[]; idx: number[]; uv?: number[] };

// 密粒度アスファルト textures (scripts/textures/asphalt_textures.py; 1 tile = 4 m), laid in world
// XZ so every street shares one seamless surface without per-road UVs.
const ASPHALT_TILE = 4;
const asphaltMap = (url: string, isColour: boolean): Texture => {
  const t = new TextureLoader().load(url);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  if (isColour) t.colorSpace = SRGBColorSpace;
  return t;
};
const asphalt = new MeshStandardMaterial({
  color: 0xffffff,
  map: asphaltMap(asphaltAlbedoUrl, true),
  normalMap: asphaltMap(asphaltNormalUrl, false),
  roughnessMap: asphaltMap(asphaltRoughnessUrl, false),
  roughness: 1,
  metalness: 0,
});
asphalt.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    "#include <uv_vertex>",
    `#include <uv_vertex>
    vec2 worldUv = (modelMatrix * vec4(position, 1.0)).xz / ${ASPHALT_TILE.toFixed(1)};
    vMapUv = worldUv;
    vNormalMapUv = worldUv;
    vRoughnessMapUv = worldUv;`,
  );
};
const white = new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, emissive: 0x222222 });
// 規制標示 (はみ出し禁止, 進路変更禁止, 最高速度) are yellow (命令 別表第六).
const YELLOW = 0xf2b705;
const yellow = new MeshStandardMaterial({ color: YELLOW, roughness: 0.7, emissive: 0x221800 });
const digitMaterials = new Map<number, MeshStandardMaterial>();

/** 規制標示「最高速度」(105): yellow numerals stretched along the lane so drivers can read them. */
function digitsMaterial(limit: number): MeshStandardMaterial {
  let m = digitMaterials.get(limit);
  if (m) return m;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1024;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#f2b705";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 190px sans-serif";
    g.scale(1, 4.2);
    g.fillText(String(limit), 128, 1024 / 4.2 / 2);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  m = new MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.7, emissive: 0x221800 });
  digitMaterials.set(limit, m);
  return m;
}

const arrowMaterials = new Map<string, MeshStandardMaterial>();

/**
 * 規制標示「進行方向別通行区分」(111 / 命令 別表第六): white arrows in each lane, 5 m long, stem from
 * the near end and a head for each direction the lane allows. The canvas is drawn as seen by the
 * approaching driver: up = farther along the lane.
 */
function arrowMaterial(set: readonly LaneDirection[]): MeshStandardMaterial {
  const key = [...set].sort().join(",");
  let m = arrowMaterials.get(key);
  if (m) return m;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1024;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#f2f2ee";
    g.strokeStyle = "#f2f2ee";
    g.lineWidth = 34;
    g.lineCap = "butt";
    g.lineJoin = "miter";
    const head = (x: number, y: number, angle: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.beginPath();
      g.moveTo(0, -150);
      g.lineTo(62, 0);
      g.lineTo(-62, 0);
      g.closePath();
      g.fill();
      g.restore();
    };
    const cx = 128;
    const has = (d: LaneDirection) => set.includes(d);
    // Stem from the near end.
    const top = has("through") ? 190 : 520;
    g.beginPath();
    g.moveTo(cx, 1010);
    g.lineTo(cx, top);
    g.stroke();
    if (has("through")) head(cx, 190, 0);
    for (const [d, side, slant] of [
      ["left", -1, false],
      ["right", 1, false],
      ["slight_left", -1, true],
      ["slight_right", 1, true],
    ] as const) {
      if (!has(d)) continue;
      // A branch bending off the stem toward its side, the head pointing that way.
      const y = slant ? 470 : 560;
      const x = cx + side * (slant ? 70 : 80);
      g.beginPath();
      g.moveTo(cx, y + 120);
      g.quadraticCurveTo(cx, y, x, y - (slant ? 60 : 0));
      g.stroke();
      head(x, y - (slant ? 60 : 0), side * (slant ? Math.PI / 4 : Math.PI / 2));
    }
    if (has("reverse")) {
      g.beginPath();
      g.arc(cx - 50, 520, 50, 0, Math.PI, true);
      g.stroke();
      head(cx - 100, 560, Math.PI);
    }
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  m = new MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.7, emissive: 0x222222 });
  arrowMaterials.set(key, m);
  return m;
}

/**
 * Streets from GSI road centrelines with markings that follow 道路標識、区画線及び道路標示に関する
 * 命令 and JARTIC data: 車道外側線; 中央線 on two-way carriageways ≥5.5 m (yellow where JARTIC has
 * はみ出し禁止, otherwise white — solid for 4+ lanes or ≥6 m per direction, else dashed);
 * 車線境界線 where JARTIC lists 車両通行帯 (yellow where 進路変更禁止); 横断歩道 at JARTIC
 * positions with ◇ ahead of crossings without signals; 停止線; yellow 最高速度 numerals by the
 * speed signs. Junction crossings are synthesised only where the area has no JARTIC data.
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
    const whites: Builder = { pos: [], idx: [] };
    const yellows: Builder = { pos: [], idx: [] };
    const digits = new Map<number, Builder>();
    const arrows = new Map<string, { set: LaneDirection[]; b: Builder }>();
    const junction = (node: number) => (graph.nodes.get(node)?.length ?? 0) >= 3;
    // Distance from a junction node to the kerb line of the widest crossing road.
    const clearance = (node: number) =>
      Math.max(...(graph.nodes.get(node) ?? []).map((id) => graph.segments[id].line.width)) / 2 + 1.5;
    // Longitudinal lines stop at crosswalks.
    const gaps = new Map<Segment, Array<[number, number]>>();
    for (const c of regs?.crossings ?? []) {
      const list = gaps.get(c.seg) ?? [];
      list.push([c.s - 2.6, c.s + 2.6]);
      gaps.set(c.seg, list);
    }
    // …and where the street runs through another road's carriageway: big junctions are several
    // GSI nodes joined by short links, so the node-based cuts above miss most of the box.
    for (const seg of graph.segments) {
      if (seg.line.kind === "highway") continue;
      const list = gaps.get(seg) ?? [];
      let start: number | null = null;
      for (let s = 0; s <= seg.length + 1.5; s += 1.5) {
        const at = Math.min(s, seg.length);
        const { pos, dir } = graph.sample(seg, at);
        const isCrossing =
          s <= seg.length && graph.carriagewaysAt(pos, 0.5, seg).some((o) => Math.abs(o.dir.dot(dir)) < 0.85);
        if (isCrossing && start === null) start = at;
        if (!isCrossing && start !== null) {
          list.push([start - 1.5, at + 1]);
          start = null;
        }
      }
      if (list.length) gaps.set(seg, list);
    }

    for (const seg of graph.segments) {
      if (seg.line.kind === "highway") continue;
      const w = seg.line.width;
      // Markings stop behind the crosswalk and stop line at each junction end.
      const startCut = junction(seg.from) ? Math.min(seg.length / 2, clearance(seg.from) + 6) : 0;
      const endCut = junction(seg.to) ? Math.min(seg.length / 2, clearance(seg.to) + 6) : 0;
      this.ribbon(road, graph, seg, 0, seg.length, 0, w, 0);
      // 車道中央線 is for carriageways of 5.5 m or more (命令 別表第三).
      const isMarked = w >= 5.5 && seg.length - startCut - endCut > 4;
      if (!isMarked) continue;
      const s0 = startCut;
      const s1 = seg.length - endCut;
      const cut = gaps.get(seg) ?? [];
      const line = (b: Builder, offset: number, dashed: boolean) =>
        this.longitudinal(b, graph, seg, s0, s1, offset, dashed, cut);
      // 車道外側線 on both sides.
      for (const side of [-1, 1]) line(whites, side * (w / 2 - 0.4), false);
      const isTwoWay = seg.oneway === 0;
      const lanes = seg.lanes;
      if (isTwoWay) {
        const isSolid = lanes >= 2 || w / 2 >= 6;
        line(seg.noOvertake ? yellows : whites, 0, !seg.noOvertake && !isSolid);
      }
      // 車線境界線 between the lanes of each direction.
      if (lanes >= 2) {
        const span = isTwoWay ? w / 2 : w;
        const laneWidth = span / lanes;
        for (let k = 1; k < lanes; k++) {
          const offsets = isTwoWay ? [k * laneWidth, -k * laneWidth] : [-w / 2 + k * laneWidth];
          for (const o of offsets) line(seg.noLaneChange ? yellows : whites, o, !seg.noLaneChange);
        }
      }
      // Without JARTIC data, synthesise 横断歩道 + 停止線 at junction ends.
      if (isSurveyed) continue;
      if (junction(seg.from)) this.crossing(whites, graph, seg, clearance(seg.from) + 2, 1);
      if (junction(seg.to)) this.crossing(whites, graph, seg, seg.length - clearance(seg.to) - 2, -1);
    }
    if (regs && isSurveyed) this.surveyed(whites, digits, graph, regs, approaches);
    if (regs) this.laneArrows(arrows, graph, regs, approaches);
    const parts: Array<[Builder, MeshStandardMaterial, number]> = [
      [road, asphalt, 1],
      [whites, white, 2],
      [yellows, yellow, 2],
    ];
    for (const [limit, b] of digits) parts.push([b, digitsMaterial(limit), 2]);
    for (const { set, b } of arrows.values()) parts.push([b, arrowMaterial(set), 2]);
    for (const [b, mat, order] of parts) {
      if (b.idx.length === 0) continue;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
      if (b.uv) g.setAttribute("uv", new BufferAttribute(new Float32Array(b.uv), 2));
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

  /** A line along the street from s0 to s1, solid or dashed, interrupted at crosswalks. */
  private longitudinal(
    b: Builder,
    graph: RoadGraph,
    seg: Segment,
    s0: number,
    s1: number,
    offset: number,
    dashed: boolean,
    cut: Array<[number, number]>,
  ): void {
    const pieces: Array<[number, number]> = [];
    if (dashed) for (let s = s0; s + 1 < s1; s += 2 * DASH) pieces.push([s, Math.min(s + DASH, s1)]);
    else pieces.push([s0, s1]);
    for (let [a, z] of pieces) {
      for (const [c0, c1] of cut) {
        const isInside = a >= c0 && z <= c1;
        if (isInside) a = z;
        else if (a < c0 && z > c1) {
          this.ribbon(b, graph, seg, a, c0, offset, LINE, PAINT);
          a = c1;
        } else if (a < c1 && z > c1) a = c1;
        else if (a < c0 && z > c0) z = c0;
      }
      this.ribbon(b, graph, seg, a, z, offset, LINE, PAINT);
    }
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
    uv?: { u: [number, number]; flip: boolean },
  ): void {
    // 0.1, not more: 停止線 are 0.45 m deep and must not be dropped as degenerate.
    if (s1 - s0 < 0.1) return;
    const n = Math.max(1, Math.ceil((s1 - s0) / STEP));
    const cols = Math.max(1, Math.ceil(width / ACROSS));
    const base = b.pos.length / 3;
    const left = new Vector3();
    for (let i = 0; i <= n; i++) {
      const { pos, dir } = graph.sample(seg, s0 + ((s1 - s0) * i) / n);
      for (let k = 0; k <= cols; k++) {
        // From the left edge (offset + width/2) to the right edge.
        const edge = offset + width / 2 - (width * k) / cols;
        leftOf(dir, edge, left);
        const x = pos.x + left.x;
        const z = pos.z + left.z;
        const y = this.surfaceAt(x, z);
        b.pos.push(x, (y ?? 0) + LIFT + extraLift, z);
        if (uv && b.uv) {
          const along = i / n;
          b.uv.push(uv.u[0] + ((uv.u[1] - uv.u[0]) * k) / cols, uv.flip ? 1 - along : along);
        }
      }
    }
    const row = cols + 1;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < cols; k++) {
        const a = base + i * row + k;
        // Winding chosen so faces point up (+Y).
        b.idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
  }

  /** JARTIC 横断歩道 / 停止線 / speed numerals, plus stop lines at signals JARTIC lacks. */
  private surveyed(
    b: Builder,
    digits: Map<number, Builder>,
    graph: RoadGraph,
    regs: AppliedRegulations,
    approaches: Approach[],
  ): void {
    const signalStops = approaches.filter((a) => a.kind === "signal");
    for (const c of regs.crossings) {
      const w = c.seg.line.width;
      // 横断歩道 (201): 0.45 m bars with 0.45 m gaps across the carriageway, 4 m wide.
      const bars = Math.max(1, Math.floor((w - 0.6) / 0.9));
      const first = -((bars - 1) * 0.9) / 2;
      for (let i = 0; i < bars; i++)
        this.ribbon(b, graph, c.seg, c.s - 2, c.s + 2, first + i * 0.9, 0.45, PAINT);
      // 横断歩道又は自転車横断帯あり (210): ◇ about 30 m and 50 m ahead of crossings without signals.
      const isSignalled = signalStops.some(
        (a) => a.a.clone().add(a.b).multiplyScalar(0.5).distanceTo(c.pos) < 30,
      );
      if (isSignalled) continue;
      for (const dir of [1, -1] as const) {
        const oneway = c.seg.oneway;
        if (oneway !== 0 && oneway !== dir) continue;
        const lane = oneway === 0 ? dir * (w / 4) : 0;
        for (const back of [30, 50]) {
          const s = c.s - dir * back;
          if (s < 3 || s > c.seg.length - 3) continue;
          this.diamond(b, graph, c.seg, s, lane);
        }
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
      this.ribbon(b, graph, l.seg, s - 0.225, s + 0.225, lane, span, PAINT);
    }
    // 最高速度 numerals in each lane a few metres past the speed sign.
    for (const sign of regs.signs) {
      if (sign.type !== SIGN.speed) continue;
      const seg = sign.seg;
      const lanes = seg.lanes;
      const isTwoWay = seg.oneway === 0;
      const span = isTwoWay ? seg.line.width / 2 : seg.line.width;
      const laneWidth = span / lanes;
      if (laneWidth < 2.2) continue; // too narrow for numerals
      const s0 = sign.s + sign.dir * 6;
      const s1 = s0 + sign.dir * 5;
      const [a, z] = s0 < s1 ? [s0, s1] : [s1, s0];
      if (a < 1 || z > seg.length - 1) continue;
      const builder = digits.get(sign.value) ?? { pos: [], idx: [], uv: [] };
      digits.set(sign.value, builder);
      for (let k = 0; k < lanes; k++) {
        // Lane centres measured left of the travel direction from the kerb side inwards.
        const fromKerb = isTwoWay ? span - (k + 0.5) * laneWidth : seg.line.width / 2 - (k + 0.5) * laneWidth;
        const offset = sign.dir * fromKerb;
        const width = Math.min(laneWidth - 0.6, 1.8);
        // u runs from the driver's left to right; v from near to far along the travel direction.
        const u: [number, number] = sign.dir === 1 ? [0, 1] : [1, 0];
        this.ribbon(builder, graph, seg, a, z, offset, width, PAINT, { u, flip: sign.dir === -1 });
      }
    }
  }

  /**
   * 進行方向別通行区分 arrows in each lane of the designated approaches: ending 8 m before the stop
   * line and repeated 30 m further back, as typically painted.
   */
  private laneArrows(
    arrows: Map<string, { set: LaneDirection[]; b: Builder }>,
    graph: RoadGraph,
    regs: AppliedRegulations,
    approaches: Approach[],
  ): void {
    for (const use of regs.laneUse) {
      const seg = use.seg;
      const n = use.lanes.length;
      const isTwoWay = seg.oneway === 0;
      const span = isTwoWay ? seg.line.width / 2 : seg.line.width;
      const laneWidth = span / n;
      if (laneWidth < 2.2) continue;
      const stop = approaches.find((a) => a.seg === seg && a.dir === use.dir);
      // Travel distance of the stop line along the approach; without one, near the junction.
      const stopAt = stop ? stop.at : seg.length - 6;
      for (const back of [8, 38]) {
        const far = stopAt - back;
        const near = far - 5;
        if (near < 2) continue;
        // Segment coordinates (s grows from → to); travel −1 runs the other way.
        const [a, z] = use.dir === 1 ? [near, far] : [seg.length - far, seg.length - near];
        for (let k = 0; k < n; k++) {
          const set = use.lanes[k];
          const key = [...set].sort().join(",");
          const entry = arrows.get(key) ?? { set, b: { pos: [], idx: [], uv: [] } };
          arrows.set(key, entry);
          const fromKerb = isTwoWay
            ? span - (k + 0.5) * laneWidth
            : seg.line.width / 2 - (k + 0.5) * laneWidth;
          const offset = use.dir * fromKerb;
          const width = Math.min(laneWidth - 0.8, 1.4);
          const u: [number, number] = use.dir === 1 ? [0, 1] : [1, 0];
          this.ribbon(entry.b, graph, seg, a, z, offset, width, PAINT, { u, flip: use.dir === -1 });
        }
      }
    }
  }

  /** ◇ outline (210) centred at s, `offset` left of the centreline: 3 m long, 1.5 m wide. */
  private diamond(b: Builder, graph: RoadGraph, seg: Segment, s: number, offset: number): void {
    const { pos, dir } = graph.sample(seg, s);
    const corner = (along: number, across: number) =>
      pos
        .clone()
        .addScaledVector(dir, along)
        .add(leftOf(dir, offset + across));
    const pts = [corner(1.5, 0), corner(0, 0.75), corner(-1.5, 0), corner(0, -0.75)];
    for (let i = 0; i < 4; i++) this.stripe(b, pts[i], pts[(i + 1) % 4], LINE);
  }

  /** Straight painted stripe between two points, draped on the surface. */
  private stripe(b: Builder, p: Vector3, q: Vector3, width: number): void {
    const d = q.clone().sub(p).setY(0).normalize();
    const side = leftOf(d, width / 2);
    const base = b.pos.length / 3;
    for (const c of [p, q]) {
      for (const sgn of [1, -1]) {
        const x = c.x + side.x * sgn;
        const z = c.z + side.z * sgn;
        b.pos.push(x, (this.surfaceAt(x, z) ?? 0) + LIFT + PAINT, z);
      }
    }
    b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  /**
   * Zebra crossing (bars run along the road) plus a stop line on the approach lane.
   * `side` is +1 when the junction is at s = 0 (segment start), −1 when it is at the end.
   */
  private crossing(b: Builder, graph: RoadGraph, seg: Segment, at: number, side: 1 | -1): void {
    if (at < 4 || at > seg.length - 4) return;
    const w = seg.line.width;
    const depth = 4;
    const bars = Math.max(1, Math.floor((w - 0.6) / 0.9));
    const first = -((bars - 1) * 0.9) / 2;
    for (let i = 0; i < bars; i++) {
      this.ribbon(b, graph, seg, at - depth / 2, at + depth / 2, first + i * 0.9, 0.45, PAINT);
    }
    // 停止線 before the crosswalk, across the half whose traffic heads into the junction. That
    // traffic moves along −side·d, so its left (keep-left) half is −side · left(d).
    const stopAt = at + side * (depth / 2 + 2);
    const lane = seg.oneway === 0 ? -side * (w / 4) : 0;
    const span = seg.oneway === 0 ? w / 2 - 0.4 : w - 0.8;
    this.ribbon(b, graph, seg, stopAt - 0.225, stopAt + 0.225, lane, span, PAINT);
  }
}
