import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
  type Scene,
} from "three";
import type { AppliedRegulations, StopLine } from "./regulations";
import { leftOf, type RoadGraph, type Segment } from "./roads";

export type LightState = "green" | "yellow" | "red";

/** A place where traffic on one segment, in one direction, must obey a signal or stop sign. */
export type Approach = {
  id: number;
  seg: Segment;
  dir: 1 | -1; // travel direction (1 = from → to), the TrafficAI convention
  at: number; // stop position along that travel direction
  kind: "signal" | "stop";
  controller: Controller | null;
  axis: 0 | 1;
  /** Stop line across the whole carriageway, for crossing tests. */
  a: Vector3;
  b: Vector3;
  travel: Vector3; // unit travel direction at the stop line
};

type Controller = { id: number; offset: number; nodes: number[] };

// Signal plan (seconds). Shorter than real Tokyo cycles (100–140 s) to keep the game moving.
const GREEN = [20, 15] as const;
const YELLOW = 3; // 施行令 第2条: stop unless unable to stop safely
const ALL_RED = 2;
export const CYCLE = GREEN[0] + GREEN[1] + 2 * (YELLOW + ALL_RED);

/** Phase of one axis of a two-phase signal at `seconds` (axis 1 starts after axis 0 clears). */
export function lightState(seconds: number, offset: number, axis: 0 | 1): LightState {
  const t = (((seconds + offset) % CYCLE) + CYCLE) % CYCLE;
  const local = t - (axis === 0 ? 0 : GREEN[0] + YELLOW + ALL_RED);
  if (local >= 0 && local < GREEN[axis]) return "green";
  if (local >= 0 && local < GREEN[axis] + YELLOW) return "yellow";
  return "red";
}

const SIGNAL_SNAP = 25; // OSM signal node → GSI junction node (m)
const CLUSTER = 30; // junction nodes this close share one controller (dual carriageways)
const SIGNAL_HEIGHT = 5.2;

const LAMP_ON: Record<LightState, Color> = {
  green: new Color(0x19e6b4),
  yellow: new Color(0xffc21a),
  red: new Color(0xff2a1a),
};
const LAMP_OFF = new Color(0x1d2226);
const UP = new Vector3(0, 1, 0);

/**
 * Traffic signals (OSM positions, snapped to junctions) and 一時停止 (JARTIC) for the current
 * road graph: per-approach state for the law checks and the AI, plus their 3D models.
 */
export class TrafficControl {
  approaches: Approach[] = [];
  private bySegment = new Map<number, Approach[]>();
  private meshes: InstancedMesh[] = [];
  private lamps: InstancedMesh | null = null;
  private lampOwners: { approach: Approach; colour: LightState }[] = [];
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {}

  rebuild(graph: RoadGraph | null, regs: AppliedRegulations | null): void {
    this.clear();
    if (!graph || !regs) return;
    const signalled = this.buildSignals(graph, regs);
    this.buildStops(graph, regs, signalled);
    for (const ap of this.approaches) {
      const list = this.bySegment.get(ap.seg.id) ?? [];
      list.push(ap);
      this.bySegment.set(ap.seg.id, list);
    }
    this.buildModels(graph);
    this.update(this.time);
  }

  /** Advance signal phases (seconds) and repaint lamps. */
  update(seconds: number): void {
    this.time = seconds;
    const lamps = this.lamps;
    if (!lamps) return;
    this.lampOwners.forEach(({ approach, colour }, i) =>
      lamps.setColorAt(i, this.state(approach) === colour ? LAMP_ON[colour] : LAMP_OFF),
    );
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }

  state(ap: Approach): LightState {
    return ap.controller ? lightState(this.time, ap.controller.offset, ap.axis) : "green";
  }

  /** Next approach on this segment ahead of a car at travel distance `s`. */
  nextStop(seg: Segment, dir: 1 | -1, s: number): { approach: Approach; dist: number } | null {
    let best: { approach: Approach; dist: number } | null = null;
    for (const ap of this.bySegment.get(seg.id) ?? []) {
      if (ap.dir !== dir) continue;
      const dist = ap.at - s;
      if (dist < -0.5 || (best && dist >= best.dist)) continue;
      best = { approach: ap, dist };
    }
    return best;
  }

  /** Stop lines crossed by a move from `prev` to `cur` in their direction of travel. */
  crossed(prev: Vector3, cur: Vector3): Approach[] {
    const mx = cur.x - prev.x;
    const mz = cur.z - prev.z;
    return this.approaches.filter((ap) => {
      const isForward = mx * ap.travel.x + mz * ap.travel.z > 0;
      return isForward && segmentsIntersect(prev, cur, ap.a, ap.b);
    });
  }

  /** The closest approach ahead of the player within `range` metres, for the HUD. */
  ahead(pos: Vector3, forward: Vector3, range = 45): { approach: Approach; dist: number } | null {
    let best: { approach: Approach; dist: number } | null = null;
    const mid = new Vector3();
    for (const ap of this.approaches) {
      if (forward.dot(ap.travel) < 0.7) continue;
      mid.copy(ap.a).add(ap.b).multiplyScalar(0.5);
      const dx = mid.x - pos.x;
      const dz = mid.z - pos.z;
      const along = dx * ap.travel.x + dz * ap.travel.z;
      const across = Math.abs(dx * ap.travel.z - dz * ap.travel.x);
      const isInLane = across < ap.seg.line.width / 2 + 2;
      if (!isInLane || along < -1 || along > range || (best && along >= best.dist)) continue;
      best = { approach: ap, dist: Math.max(0, along) };
    }
    return best;
  }

  signalCount(): number {
    return new Set(this.approaches.filter((a) => a.controller).map((a) => a.controller?.id)).size;
  }

  clear(): void {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as Material).dispose();
      m.dispose();
    }
    this.meshes = [];
    this.lamps = null;
    this.lampOwners = [];
    this.approaches = [];
    this.bySegment.clear();
  }

  // ---------- construction ----------

  private nodePos(graph: RoadGraph, node: number): Vector3 | null {
    const id = graph.nodes.get(node)?.[0];
    if (id === undefined) return null;
    const seg = graph.segments[id];
    return (seg.from === node ? seg.pts[0] : seg.pts[seg.pts.length - 1]).clone();
  }

  /** Signals: snap OSM nodes to junctions, cluster them, and create one approach per entry. */
  private buildSignals(graph: RoadGraph, regs: AppliedRegulations): Set<string> {
    const junctions: { node: number; pos: Vector3 }[] = [];
    for (const [node, ids] of graph.nodes) {
      if (ids.length < 3) continue;
      const pos = this.nodePos(graph, node);
      if (pos) junctions.push({ node, pos });
    }
    const signalled = new Set<number>();
    for (const s of regs.signals) {
      let best: { node: number; pos: Vector3 } | null = null;
      let bestD = SIGNAL_SNAP;
      for (const j of junctions) {
        const d = Math.hypot(j.pos.x - s.x, j.pos.z - s.z);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best) signalled.add(best.node);
    }
    // Union nearby signalled junctions (divided roads give 2–4 GSI nodes per crossing).
    const list = junctions.filter((j) => signalled.has(j.node));
    const group = new Map<number, number>();
    const root = (n: number): number => {
      let r = n;
      while (group.get(r) !== r) r = group.get(r) ?? r;
      return r;
    };
    for (const j of list) group.set(j.node, j.node);
    for (let i = 0; i < list.length; i++)
      for (let k = i + 1; k < list.length; k++)
        if (list[i].pos.distanceTo(list[k].pos) < CLUSTER) group.set(root(list[i].node), root(list[k].node));
    // Phase offsets hash the junction's lon/lat (node ids change on every rebuild), so lights
    // keep their phase when the graph is rebuilt around the player.
    const nodeHash = (node: number) => {
      const seg = graph.segments[graph.nodes.get(node)?.[0] ?? 0];
      const i = seg.from === node ? 0 : seg.line.coords.length - 2;
      const h =
        Math.imul(Math.round(seg.line.coords[i] * 1e4), 73856093) ^
        Math.imul(Math.round(seg.line.coords[i + 1] * 1e4), 19349663);
      return h >>> 0;
    };
    const controllers = new Map<number, Controller>();
    for (const j of list) {
      const r = root(j.node);
      const c = controllers.get(r) ?? { id: r, offset: Infinity, nodes: [] };
      c.nodes.push(j.node);
      c.offset = Math.min(c.offset, nodeHash(j.node) % CYCLE);
      controllers.set(r, c);
    }

    const taken = new Set<string>();
    for (const c of controllers.values()) {
      const members = new Set(c.nodes);
      const entries: { seg: Segment; node: number; dir: 1 | -1; bearing: Vector3 }[] = [];
      for (const node of c.nodes) {
        for (const id of graph.nodes.get(node) ?? []) {
          const seg = graph.segments[id];
          const other = seg.from === node ? seg.to : seg.from;
          if (members.has(other)) continue; // internal link between the controller's nodes
          const dir: 1 | -1 = seg.to === node ? 1 : -1;
          const isAllowed = seg.oneway === 0 || seg.oneway === dir;
          if (!isAllowed || seg.line.kind === "highway") continue;
          // Travel direction arriving at the node.
          const { dir: d } = graph.sample(seg, dir === 1 ? seg.length - 0.5 : 0.5);
          const bearing = d.clone().multiplyScalar(dir);
          entries.push({ seg, node, dir, bearing });
        }
      }
      if (entries.length === 0) continue;
      // Axis 0 follows the widest road through the crossing; roughly perpendicular entries get axis 1.
      const main = entries.reduce((a, b) => (b.seg.line.width > a.seg.line.width ? b : a));
      for (const e of entries) {
        const axis: 0 | 1 = Math.abs(e.bearing.dot(main.bearing)) >= Math.SQRT1_2 ? 0 : 1;
        const fromNode = this.clearance(graph, e.node, e.seg) + 5;
        const jartic = this.jarticStop(regs.stopLines, e.seg, e.dir, fromNode + 15);
        const back = jartic ?? fromNode;
        if (e.seg.length - back < 1) continue;
        const ap = this.approach(graph, e.seg, e.dir, e.seg.length - back, "signal", c, axis);
        this.approaches.push(ap);
        taken.add(`${e.seg.id}/${e.dir}`);
      }
    }
    return taken;
  }

  /** JARTIC stop line on this approach closest to the junction (distance from it), if any. */
  private jarticStop(lines: StopLine[], seg: Segment, dir: 1 | -1, maxBack: number): number | null {
    let best: number | null = null;
    for (const l of lines) {
      if (l.seg !== seg || l.dir !== dir) continue;
      const back = seg.length - l.at;
      if (back < 2 || back > maxBack) continue;
      if (best === null || back < best) best = back;
    }
    return best;
  }

  private buildStops(graph: RoadGraph, regs: AppliedRegulations, signalled: Set<string>): void {
    const seen = new Set<string>();
    for (const sign of regs.stopSigns) {
      const { seg, dir, at } = sign.line;
      const key = `${seg.id}/${dir}`;
      if (signalled.has(key) || seen.has(key)) continue;
      seen.add(key);
      this.approaches.push(this.approach(graph, seg, dir, Math.max(0.5, at), "stop", null, 0));
    }
  }

  private approach(
    graph: RoadGraph,
    seg: Segment,
    dir: 1 | -1,
    at: number,
    kind: Approach["kind"],
    controller: Controller | null,
    axis: 0 | 1,
  ): Approach {
    const along = dir === 1 ? at : seg.length - at;
    const { pos, dir: d } = graph.sample(seg, along);
    const travel = d.clone().multiplyScalar(dir);
    const half = seg.line.width / 2 + 1;
    return {
      id: this.approaches.length,
      seg,
      dir,
      at,
      kind,
      controller,
      axis,
      a: pos.clone().add(leftOf(travel, half)),
      b: pos.clone().add(leftOf(travel, -half)),
      travel,
    };
  }

  /** Distance from a junction node to the kerb line of the widest other road there. */
  private clearance(graph: RoadGraph, node: number, except: Segment): number {
    const widths = (graph.nodes.get(node) ?? [])
      .filter((id) => id !== except.id)
      .map((id) => graph.segments[id].line.width);
    return (widths.length ? Math.max(...widths) : except.line.width) / 2 + 1.5;
  }

  // ---------- models ----------

  private buildModels(graph: RoadGraph): void {
    const signals = this.approaches.filter((a) => a.kind === "signal");
    const poleGeo = new CylinderGeometry(0.09, 0.11, 1, 8).translate(0, 0.5, 0);
    const poleMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.3 });
    // ~1.3× life size (real heads: 30 cm lamps) so they read at driving distance on screen.
    const housingGeo = new BoxGeometry(1.65, 0.56, 0.32);
    const housingMat = new MeshStandardMaterial({ color: 0x5f666d, roughness: 0.7 });
    const lampGeo = new PlaneGeometry(0.42, 0.42);
    const lampMat = new MeshBasicMaterial({ toneMapped: false, side: DoubleSide });

    const poles = new InstancedMesh(poleGeo, poleMat, signals.length * 2);
    const housings = new InstancedMesh(housingGeo, housingMat, signals.length);
    const lamps = new InstancedMesh(lampGeo, lampMat, signals.length * 3);
    const o = new Object3D();
    let pole = 0;
    const ground = (p: Vector3) => this.groundAt(p.x, p.z) ?? 0;

    signals.forEach((ap, i) => {
      // Japanese practice: the head stands beyond the crossing on the far-left corner, facing
      // the stop line; horizontal housing with 青・黄・赤 from left to right.
      const node = ap.dir === 1 ? ap.seg.to : ap.seg.from;
      const nodePos = this.nodePos(graph, node) ?? ap.a;
      const far = this.clearance(graph, node, ap.seg) + 1;
      const half = ap.seg.line.width / 2;
      const base = nodePos
        .clone()
        .addScaledVector(ap.travel, far)
        .add(leftOf(ap.travel, half + 1.2));
      const head = nodePos
        .clone()
        .addScaledVector(ap.travel, far)
        .add(leftOf(ap.travel, half * 0.35));
      const g = ground(base);
      const yaw = Math.atan2(-ap.travel.x, -ap.travel.z); // face the oncoming driver
      o.position.set(base.x, g, base.z);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, SIGNAL_HEIGHT + 0.4, 1);
      o.updateMatrix();
      poles.setMatrixAt(pole++, o.matrix);
      // Horizontal arm from the pole out over the lane (the unit pole stretched sideways).
      const toHead = new Vector3(head.x - base.x, 0, head.z - base.z);
      const armLen = toHead.length();
      o.position.set(base.x, g + SIGNAL_HEIGHT + 0.25, base.z);
      o.quaternion.setFromUnitVectors(UP, toHead.normalize());
      o.scale.set(0.7, armLen, 0.7);
      o.updateMatrix();
      poles.setMatrixAt(pole++, o.matrix);
      o.position.set(head.x, g + SIGNAL_HEIGHT, head.z);
      o.rotation.set(0, yaw, 0);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      housings.setMatrixAt(i, o.matrix);
      const colours: LightState[] = ["green", "yellow", "red"];
      colours.forEach((colour, k) => {
        o.position.set(head.x, g + SIGNAL_HEIGHT, head.z);
        o.rotation.set(0, yaw, 0);
        // The face points back along -travel, so local −X is the driver's left: 青・黄・赤.
        o.translateX((k - 1) * 0.52);
        o.translateZ(0.17);
        o.updateMatrix();
        lamps.setMatrixAt(i * 3 + k, o.matrix);
        this.lampOwners.push({ approach: ap, colour });
      });
    });
    poles.count = pole;
    for (const mesh of [poles, housings, lamps]) {
      mesh.frustumCulled = false; // instances span the whole area
      mesh.castShadow = mesh === poles || mesh === housings;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    for (let i = 0; i < signals.length * 3; i++) lamps.setColorAt(i, LAMP_OFF);
    this.lamps = lamps;
  }
}

const cross = (ox: number, oz: number, ux: number, uz: number, vx: number, vz: number) =>
  (ux - ox) * (vz - oz) - (uz - oz) * (vx - ox);

/** Proper intersection of segments pq and ab on the ground plane (x, z). */
export function segmentsIntersect(p: Vector3, q: Vector3, a: Vector3, b: Vector3): boolean {
  const d1 = cross(a.x, a.z, b.x, b.z, p.x, p.z);
  const d2 = cross(a.x, a.z, b.x, b.z, q.x, q.z);
  const d3 = cross(p.x, p.z, q.x, q.z, a.x, a.z);
  const d4 = cross(p.x, p.z, q.x, q.z, b.x, b.z);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
