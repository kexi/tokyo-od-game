import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
  type Matrix4,
  type Scene,
} from "three";
import {
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  cross,
  dot,
  float,
  fract,
  materialColor,
  materialRoughness,
  max,
  mix,
  normalize,
  normalView,
  positionWorld,
  select,
  smoothstep,
  texture,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import asphaltAlbedoUrl from "../../assets/road/textures/asphalt_albedo.jpg?url";
import asphaltNormalUrl from "../../assets/road/textures/asphalt_normal.jpg?url";
import asphaltRoughnessUrl from "../../assets/road/textures/asphalt_roughness.png?url";
import markingWearUrl from "../../assets/road/textures/marking_wear.png?url";
import { valueNoise } from "../render/shaderMath";
import { FrameWork } from "../game/frameWork";
import { roadGeometrySteps } from "./roadGeometrySteps";
import { updateRoadGeometry } from "./roadGeometry";
import { laneCentreOffset, laneLeftEdge, laneWidth as laneWidthOf, sectionOf } from "./laneChange";
import { SIGN, type AppliedRegulations, type LaneDirection } from "./regulations";
import { MARKING, planCrosswalk, planMarkings, planStopLine, type MarkingBar } from "./roadMarkings";
import { leftOf, type RoadGraph, type Segment } from "./roads";
import { StreetMaterial, type StreetBase } from "./streetLights";
import type { Approach } from "./trafficControl";
import { usesGroundSurface } from "./roadClass";

const STEP = 2.5; // metres between cross-sections; dense enough to hug the terrain mesh
// Wide carriageways are also split across their width: a single quad spanning 30 m sits
// tens of centimetres off the terrain in the middle, burying markings and letting the ground
// photo show through.
const ACROSS = 2.5;
const LIFT = 0.1; // asphalt above the terrain surface the collider and renderer share
const PAINT = 0.025; // markings above the asphalt

/**
 * `st`: per vertex the street cross-section for the wet shading (streetLights.ts): lateral offset
 * from the centreline (left +), half width, lane width, and where lanes are counted from.
 */
type SurfacePart = { geometry: BufferGeometry; material: StreetMaterial; order: number };

type Builder = { pos: number[]; idx: number[]; uv?: number[]; st: number[] };

// 密粒度アスファルト textures (scripts/textures/asphalt_textures.py; 1 tile = 4 m), laid in world
// XZ so every street shares one seamless surface without per-road UVs (the road geometry has none).
const ASPHALT_TILE = 4;
const asphaltMap = (url: string, isColour: boolean): Texture => {
  const t = new TextureLoader().load(url);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  if (isColour) t.colorSpace = SRGBColorSpace;
  return t;
};
const asphaltAlbedo = asphaltMap(asphaltAlbedoUrl, true);
const asphaltBumps = asphaltMap(asphaltNormalUrl, false);
const asphaltRough = asphaltMap(asphaltRoughnessUrl, false);
// marking_wear.png: on the asphalt's grid and stones; R wear, G grime (B, the glass beads, unused).
const markingWear = asphaltMap(markingWearUrl, false);
const worldUv = positionWorld.xz.div(ASPHALT_TILE);
/** `aStreet` (streetLights.ts): lateral offset (left +), half width, lane width, lane origin. */
const aStreet = attribute<"vec4">("aStreet", "vec4");

/**
 * Where tyres run, 0–1: ±0.85 m from each lane's centre, the band the wet shading puts its ruts in
 * (streetLights.ts hollow). 0 off the cross-section (the ◇ stripes carry no lane).
 */
function wheelPaths(): Node<"float"> {
  const laneWidth = max(aStreet.z, 1);
  const fromCentre = abs(fract(aStreet.x.sub(aStreet.w).div(laneWidth)).sub(0.5)).mul(laneWidth);
  const band = smoothstep(0.15, 0.45, abs(fromCentre.sub(0.85))).oneMinus();
  return select(aStreet.y.greaterThan(0.5), band, float(0));
}

/**
 * The asphalt's colour with what does not repeat every 4 m: a 30–250 m variation, the wheel paths
 * darker (rubber, polished stones) and the last 0.6 m by the kerb (路肩) lighter with dust, as
 * seen on Tokyo's streets. Shared by the asphalt and the worn paint over it.
 */
function asphaltColour(): Node<"vec3"> {
  const macro = valueNoise(positionWorld.xz.mul(0.033))
    .mul(0.6)
    .add(valueNoise(positionWorld.xz.mul(0.0041).add(7)).mul(0.4))
    .sub(0.5)
    .mul(0.14)
    .add(1);
  const kerb = select(
    aStreet.y.greaterThan(0.5),
    smoothstep(aStreet.y.sub(0.6), aStreet.y.sub(0.1), abs(aStreet.x)),
    float(0),
  );
  const shade = macro.mul(wheelPaths().mul(-0.07).add(1)).mul(kerb.mul(0.08).add(1));
  return texture(asphaltAlbedo, worldUv).rgb.mul(shade);
}

/**
 * The asphalt's maps in world XZ, as the WebGL version laid them (its vertex shader set the map
 * UVs to xz / 4). The normal map's tangent frame is the one three derived from those UVs: u along
 * world +x, v along +z; built here in view space from the geometry normal (the normal stage).
 */
function asphaltBase(): StreetBase {
  const n = normalView;
  const east = cameraViewMatrix.mul(vec4(1, 0, 0, 0)).xyz;
  const t = normalize(east.sub(n.mul(dot(n, east))));
  const b = cross(t, n);
  const bump = texture(asphaltBumps, worldUv).xyz.mul(2).sub(1);
  return {
    // The colour (no map on this material, so a vec3) times the albedo map, as map_fragment did.
    color: vec4(materialColor, 1).mul(vec4(asphaltColour(), 1)),
    // Tyres polish the wheel paths a little.
    roughness: materialRoughness.mul(texture(asphaltRough, worldUv).g).mul(wheelPaths().mul(-0.08).add(1)),
    normal: normalize(t.mul(bump.x).add(b.mul(bump.y)).add(n.mul(bump.z))),
  };
}

/**
 * Painted lines and bars worn to the asphalt under them: the mask's wear, three times as much in
 * the wheel paths (stop lines and crosswalk bars wear there first; lane lines lie between them),
 * and dust in the paint's texture. Why not a texture per marking: the lines are geometry from the
 * MarkingPlan (knowledge/road-redesign-plan.md 9), and one world-space mask serves them all.
 */
function paintBase(): StreetBase {
  const mask = texture(markingWear, worldUv);
  const wear = clamp(mask.r.mul(wheelPaths().mul(2).add(0.35)), 0, 0.85);
  const paint = vec3(materialColor as unknown as Node<"vec3">).mul(mask.g.mul(-0.12).add(1.04));
  return {
    color: vec4(mix(paint, asphaltColour(), wear), 1),
    roughness: mix(materialRoughness, texture(asphaltRough, worldUv).g, wear),
  };
}
const asphalt = new StreetMaterial("asphalt", {
  hasStreet: true,
  base: asphaltBase(),
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
});
// Paint gets wet and lies in the same puddles as the asphalt under it.
const white = new StreetMaterial("paint", {
  hasStreet: true,
  base: paintBase(),
  color: 0xf2f2ee,
  roughness: 0.7,
  emissive: 0x222222,
});
// 規制標示 (はみ出し禁止, 進路変更禁止, 最高速度) are yellow (命令 別表第六).
const YELLOW = 0xf2b705;
const yellow = new StreetMaterial("paint", {
  hasStreet: true,
  base: paintBase(),
  color: YELLOW,
  roughness: 0.7,
  emissive: 0x221800,
});
const digitMaterials = new Map<number, StreetMaterial>();

/** 規制標示「最高速度」(105): yellow numerals stretched along the lane so drivers can read them. */
function digitsMaterial(limit: number): StreetMaterial {
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
  m = new StreetMaterial("paint", {
    hasStreet: true,
    map,
    alphaTest: 0.5,
    roughness: 0.7,
    emissive: 0x221800,
  });
  digitMaterials.set(limit, m);
  return m;
}

const arrowMaterials = new Map<string, StreetMaterial>();

/**
 * 規制標示「進行方向別通行区分」(111 / 命令 別表第六): white arrows in each lane, 5 m long, stem from
 * the near end and a head for each direction the lane allows. The canvas is drawn as seen by the
 * approaching driver: up = farther along the lane.
 */
function arrowMaterial(set: readonly LaneDirection[]): StreetMaterial {
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
  m = new StreetMaterial("paint", {
    hasStreet: true,
    map,
    alphaTest: 0.5,
    roughness: 0.7,
    emissive: 0x222222,
  });
  arrowMaterials.set(key, m);
  return m;
}

/**
 * Streets from GSI road centrelines, draped on the terrain, with the markings MarkingPlan
 * (roadMarkings.ts) decides: 車道外側線, 中央線, 車線境界線, 横断歩道 and 停止線 (at JARTIC positions,
 * or synthesised at junction ends where the area has no JARTIC data). Drawn here as well: ◇ ahead
 * of crossings without signals, yellow 最高速度 numerals by the speed signs and the 進行方向別通行区分
 * arrows (標示, not 区画線: not in the plan yet).
 */
export class RoadSurface {
  private readonly meshes = new Map<StreetMaterial, Mesh>();
  /**
   * Whether the ground at a local (x, z) is cut away for the expressway (P9, groundCuts.ts): a
   * triangle whose middle is there is left out, so a street drawn over a cut does not lid it.
   */
  cutAt: ((x: number, z: number) => boolean) | null = null;

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
    if (!graph) {
      this.clear();
      return;
    }
    const steps = this.prepareSteps(graph, regs, approaches);
    let result = steps.next();
    while (!result.done) result = steps.next();
    for (const _ of this.installSteps(result.value)) {
      /* synchronous compatibility path */
    }
  }

  prepare(
    graph: RoadGraph,
    regs: AppliedRegulations | null,
    approaches: Approach[],
    work: FrameWork,
    surfaceAt = this.surfaceAt,
  ): Promise<SurfacePart[]> {
    const draft = new RoadSurface(this.scene, surfaceAt);
    return work.run(draft.prepareSteps(graph, regs, approaches));
  }

  private *prepareSteps(
    graph: RoadGraph,
    regs: AppliedRegulations | null,
    approaches: Approach[],
  ): Generator<void, SurfacePart[]> {
    const isSurveyed = regs?.hasMarkings ?? false;
    const road: Builder = { pos: [], idx: [], st: [] };
    const whites: Builder = { pos: [], idx: [], st: [] };
    const yellows: Builder = { pos: [], idx: [], st: [] };
    const digits = new Map<number, Builder>();
    const arrows = new Map<string, { set: LaneDirection[]; b: Builder }>();
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
      if (!usesGroundSurface(seg.line)) continue;
      const list = gaps.get(seg) ?? [];
      let start: number | null = null;
      for (let s = 0; s <= seg.length + 1.5; s += 1.5) {
        const checkpoint = s % 48 === 0;
        if (checkpoint) yield;
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
      yield;
    }

    for (const seg of graph.segments) {
      if (!usesGroundSurface(seg.line)) continue;
      // Asphalt to the GSI 幅員's edge: where it includes the pavement, PLATEAU's pavements sit on
      // top (pavements.ts); the lanes and their lines take the carriageway inside it.
      yield* this.ribbon(road, graph, seg, 0, seg.length, 0, seg.line.width, 0);
      const plan = planMarkings(graph, seg, regs);
      const cut = gaps.get(seg) ?? [];
      for (const l of plan.lines) {
        const b = l.colour === "yellow" ? yellows : whites;
        yield* this.longitudinal(b, graph, seg, l.from, l.to, l.offset, l.width, l.dash, cut);
      }
      yield* this.bars(whites, graph, seg, plan.bars);
    }
    if (regs && isSurveyed) yield* this.surveyed(whites, digits, graph, regs, approaches);
    if (regs) yield* this.laneArrows(arrows, graph, regs, approaches);
    const parts: Array<[Builder, StreetMaterial, number]> = [
      [road, asphalt, 1],
      [whites, white, 2],
      [yellows, yellow, 2],
    ];
    for (const [limit, b] of digits) parts.push([b, digitsMaterial(limit), 2]);
    for (const { set, b } of arrows.values()) parts.push([b, arrowMaterial(set), 2]);
    const prepared: SurfacePart[] = [];
    for (const [b, mat, order] of parts) {
      if (this.cutAt) b.idx = dropCut(b.pos, b.idx, this.cutAt);
      if (b.idx.length === 0) continue;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
      if (b.uv) g.setAttribute("uv", new BufferAttribute(new Float32Array(b.uv), 2));
      g.setAttribute("aStreet", new BufferAttribute(new Float32Array(b.st), 4));
      g.setIndex(b.idx);
      yield* roadGeometrySteps(g);
      prepared.push({ geometry: g, material: mat, order });
      yield;
    }
    return prepared;
  }

  *installSteps(parts: SurfacePart[]): Generator<void> {
    const used = new Set<StreetMaterial>();
    for (const { geometry: g, material: mat, order } of parts) {
      const mesh = this.meshes.get(mat) ?? new Mesh(new BufferGeometry(), mat);
      mesh.geometry = updateRoadGeometry(mesh.geometry, g);
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();
      mesh.scale.set(1, 1, 1);
      used.add(mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = order;
      this.scene.add(mesh);
      this.meshes.set(mat, mesh);
      yield;
    }
    for (const [mat, mesh] of this.meshes) {
      const obsolete = !used.has(mat);
      if (!obsolete) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(mat);
    }
  }

  clear(): void {
    for (const m of this.meshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes.clear();
  }

  reanchor(matrix: Matrix4): void {
    for (const mesh of this.meshes.values()) mesh.applyMatrix4(matrix);
  }

  /** A line along the street from s0 to s1, solid or dashed, interrupted at crosswalks. */
  private *longitudinal(
    b: Builder,
    graph: RoadGraph,
    seg: Segment,
    s0: number,
    s1: number,
    offset: number,
    width: number,
    dash: { length: number; gap: number } | null,
    cut: Array<[number, number]>,
  ): Generator<void> {
    const pieces: Array<[number, number]> = [];
    if (dash)
      for (let s = s0; s + 1 < s1; s += dash.length + dash.gap)
        pieces.push([s, Math.min(s + dash.length, s1)]);
    else pieces.push([s0, s1]);
    for (let [a, z] of pieces) {
      for (const [c0, c1] of cut) {
        const isInside = a >= c0 && z <= c1;
        if (isInside) a = z;
        else if (a < c0 && z > c1) {
          yield* this.ribbon(b, graph, seg, a, c0, offset, width, PAINT);
          a = c1;
        } else if (a < c1 && z > c1) a = c1;
        else if (a < c0 && z > c0) z = c0;
      }
      yield* this.ribbon(b, graph, seg, a, z, offset, width, PAINT);
    }
  }

  /** Painted strips across the street (停止線, 横断歩道 bars) from the plan. */
  private *bars(b: Builder, graph: RoadGraph, seg: Segment, bars: readonly MarkingBar[]): Generator<void> {
    for (const bar of bars) yield* this.ribbon(b, graph, seg, bar.from, bar.to, bar.offset, bar.width, PAINT);
  }

  /** A strip `width` wide, centred `offset` metres left of the centreline, from s0 to s1. */
  private *ribbon(
    b: Builder,
    graph: RoadGraph,
    seg: Segment,
    s0: number,
    s1: number,
    offset: number,
    width: number,
    extraLift: number,
    uv?: { u: [number, number]; flip: boolean },
  ): Generator<void> {
    // 0.1, not more: 停止線 are 0.45 m deep and must not be dropped as degenerate.
    if (s1 - s0 < 0.1) return;
    const n = Math.max(1, Math.ceil((s1 - s0) / STEP));
    const cols = Math.max(1, Math.ceil(width / ACROSS));
    const base = b.pos.length / 3;
    const left = new Vector3();
    for (let i = 0; i <= n; i++) {
      const checkpoint = i % 32 === 0;
      if (checkpoint) yield;
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
    // Lanes of a two-way street are counted out from the centreline, of a one-way from its right
    // edge line; the gutter (puddles) runs along the asphalt's edge.
    const isTwoWay = seg.oneway === 0;
    const half = seg.line.width / 2;
    const laneWidth = sectionOf(seg).laneWidth;
    const laneOrigin = isTwoWay ? 0 : -laneLeftEdge(seg);
    for (let i = 0; i <= n; i++)
      for (let k = 0; k <= cols; k++)
        b.st.push(offset + width / 2 - (width * k) / cols, half, laneWidth, laneOrigin);
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
  private *surveyed(
    b: Builder,
    digits: Map<number, Builder>,
    graph: RoadGraph,
    regs: AppliedRegulations,
    approaches: Approach[],
  ): Generator<void> {
    const signalStops = approaches.filter((a) => a.kind === "signal");
    for (const c of regs.crossings) {
      yield;
      yield* this.bars(b, graph, c.seg, planCrosswalk(c.seg, c.s));
      // 横断歩道又は自転車横断帯あり (210): ◇ about 30 m and 50 m ahead of crossings without signals.
      const isSignalled = signalStops.some(
        (a) => a.a.clone().add(a.b).multiplyScalar(0.5).distanceTo(c.pos) < 30,
      );
      if (isSignalled) continue;
      for (const dir of [1, -1] as const) {
        const oneway = c.seg.oneway;
        if (oneway !== 0 && oneway !== dir) continue;
        const lane = oneway === 0 ? dir * laneCentreOffset(c.seg, 0, 1) : 0;
        for (const back of [30, 50]) {
          const s = c.s - dir * back;
          if (s < 3 || s > c.seg.length - 3) continue;
          yield* this.diamond(b, graph, c.seg, s, lane);
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
      const s = l.dir === 1 ? l.at : l.seg.length - l.at;
      yield* this.bars(b, graph, l.seg, [planStopLine(l.seg, s, l.dir)]);
    }
    // 最高速度 numerals in each lane a few metres past the speed sign.
    for (const sign of regs.signs) {
      yield;
      if (sign.type !== SIGN.speed) continue;
      const seg = sign.seg;
      const lanes = seg.lanes;
      const laneWidth = laneWidthOf(seg, lanes);
      if (laneWidth < 2.2) continue; // too narrow for numerals
      const s0 = sign.s + sign.dir * 6;
      const s1 = s0 + sign.dir * 5;
      const [a, z] = s0 < s1 ? [s0, s1] : [s1, s0];
      if (a < 1 || z > seg.length - 1) continue;
      const builder = digits.get(sign.value) ?? { pos: [], idx: [], uv: [], st: [] };
      digits.set(sign.value, builder);
      for (let k = 0; k < lanes; k++) {
        // Lane centres measured left of the travel direction from the kerb side inwards.
        const offset = sign.dir * laneCentreOffset(seg, k, lanes);
        const width = Math.min(laneWidth - 0.6, 1.8);
        // u runs from the driver's left to right; v from near to far along the travel direction.
        const u: [number, number] = sign.dir === 1 ? [0, 1] : [1, 0];
        yield* this.ribbon(builder, graph, seg, a, z, offset, width, PAINT, { u, flip: sign.dir === -1 });
      }
    }
  }

  /**
   * 進行方向別通行区分 arrows in each lane of the designated approaches: ending 8 m before the stop
   * line and repeated 30 m further back, as typically painted.
   */
  private *laneArrows(
    arrows: Map<string, { set: LaneDirection[]; b: Builder }>,
    graph: RoadGraph,
    regs: AppliedRegulations,
    approaches: Approach[],
  ): Generator<void> {
    for (const use of regs.laneUse) {
      yield;
      const seg = use.seg;
      const n = use.lanes.length;
      const laneWidth = laneWidthOf(seg, n);
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
          const entry = arrows.get(key) ?? { set, b: { pos: [], idx: [], uv: [], st: [] } };
          arrows.set(key, entry);
          const offset = use.dir * laneCentreOffset(seg, k, n);
          const width = Math.min(laneWidth - 0.8, 1.4);
          const u: [number, number] = use.dir === 1 ? [0, 1] : [1, 0];
          yield* this.ribbon(entry.b, graph, seg, a, z, offset, width, PAINT, { u, flip: use.dir === -1 });
        }
      }
    }
  }

  /**
   * ◇ (210) centred at s, `offset` left of the centreline: one outline MARKING.diamondWidth across
   * (outer edge). Why not the two outlines of 別表第六's figure: the inner line is most likely the
   * figure's own outline of the painted band, not a second band (review W8).
   */
  private *diamond(b: Builder, graph: RoadGraph, seg: Segment, s: number, offset: number): Generator<void> {
    const { pos, dir } = graph.sample(seg, s);
    const corner = (along: number, across: number) =>
      pos
        .clone()
        .addScaledVector(dir, along)
        .add(leftOf(dir, offset + across));
    const line = MARKING.diamondLine;
    const across = (MARKING.diamondWidth - line) / 2;
    const along = across * (MARKING.diamondLength / MARKING.diamondWidth);
    const pts = [corner(along, 0), corner(0, across), corner(-along, 0), corner(0, -across)];
    for (let i = 0; i < 4; i++) yield* this.stripe(b, pts[i], pts[(i + 1) % 4], line);
  }

  /** Straight painted stripe between two points, draped on the surface. */
  private *stripe(b: Builder, p: Vector3, q: Vector3, width: number): Generator<void> {
    const d = q.clone().sub(p).setY(0).normalize();
    const side = leftOf(d, width / 2);
    const base = b.pos.length / 3;
    for (const c of [p, q]) {
      for (const sgn of [1, -1]) {
        const x = c.x + side.x * sgn;
        const z = c.z + side.z * sgn;
        b.pos.push(x, (this.surfaceAt(x, z) ?? 0) + LIFT + PAINT, z);
        b.st.push(0, 0, 1, 0); // no cross-section: the shading uses its noise alone
      }
    }
    b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    yield;
  }
}

/** The triangles of an index list whose middle is not cut away (`cut(x, z)`). */
function dropCut(pos: readonly number[], idx: number[], cut: (x: number, z: number) => boolean): number[] {
  const kept: number[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const x = (pos[a] + pos[b] + pos[c]) / 3;
    const z = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    if (!cut(x, z)) kept.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return kept;
}
