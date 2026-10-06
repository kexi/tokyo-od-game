import RAPIER from "@dimforge/rapier3d-compat";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  type InstancedMesh,
  type BufferGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { RoadInstances } from "./roadInstances";
import { FrameWork } from "../game/frameWork";
import { RoadPlates } from "./roadPlates";
import { PROP_GROUPS } from "../physics/groups";
import type { AppliedRegulations, Crossing, StopLine } from "./regulations";
import { HEAD_HANG, LAMP_GAP, PED_LAMP_Y, signalKit, type Part } from "./signalModels";
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
const BOX_LINK = 35; // links this short between junction nodes are inside one crossing
const BOX_RADIUS = 50; // …as long as the node is this close to the signalled one
const SIGNAL_HEIGHT = 5.2;

const LAMP_ON: Record<LightState, Color> = {
  green: new Color(0x19e6b4),
  yellow: new Color(0xffc21a),
  red: new Color(0xff2a1a),
};
const LAMP_OFF = new Color(0x1d2226);
const PED_ON = { stop: new Color(0xff3a24), go: new Color(0x19e6b4) };
// Heads are drawn larger than life (300 mm lenses) so they read at driving distance on screen.
const HEAD_SCALE = 1.3;
const PED_HEIGHT = 2.75; // pedestrian head centre above the pavement
const POLE_RADIUS = 0.13;

/** Walk phase for people crossing a street: go, flashing go (no new starters), or stop. */
export type PedLight = "go" | "flash" | "stop";
/**
 * A 歩行者用灯器 and the accessible signal's speaker on it: where it hangs, the walking direction
 * across the road from its kerb, which end of the crosswalk it is, and the crossing it serves.
 */
export type PedHead = { seg: Segment; near: Vector3; at: Vector3; across: Vector3; side: 1 | -1 };
const UP = new Vector3(0, 1, 0);

/**
 * Traffic signals (OSM positions, snapped to junctions) and 一時停止 (JARTIC) for the current
 * road graph: per-approach state for the law checks and the AI, plus their 3D models.
 */
/** First spot clear of every carriageway (poles stand on the pavement), or null. */
function clearSpot(graph: RoadGraph, candidates: Vector3[]): Vector3 | null {
  return candidates.find((p) => graph.carriagewaysAt(p, 0.3).length === 0) ?? null;
}

export class TrafficControl {
  approaches: Approach[] = [];
  private bySegment = new Map<number, Approach[]>();
  private meshes: InstancedMesh[] = [];
  private readonly instances = new RoadInstances();
  private lamps: InstancedMesh | null = null;
  private lampOwners: { approach: Approach; colour: LightState }[] = [];
  private pedLamps: { stop: InstancedMesh; go: InstancedMesh } | null = null;
  private pedOwners: PedHead[] = [];
  private plates: Mesh[] = [];
  private readonly platePool = new RoadPlates((p) => {
    p.geometry.dispose();
    for (const m of p.material as Material[]) if (m !== plateBack) m.dispose();
  });
  private body: RAPIER.RigidBody | null = null;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
  ) {}

  rebuild(graph: RoadGraph | null, regs: AppliedRegulations | null): void {
    for (const _ of this.rebuildSteps(graph, regs)) {
      /* synchronous compatibility path */
    }
  }

  rebuildAsync(graph: RoadGraph, regs: AppliedRegulations | null, work: FrameWork): Promise<void> {
    return work.run(this.rebuildSteps(graph, regs));
  }

  private *rebuildSteps(graph: RoadGraph | null, regs: AppliedRegulations | null): Generator<void | boolean> {
    yield* this.setNetwork(graph, regs);
  }

  setNetwork(graph: RoadGraph | null, regs: AppliedRegulations | null): Generator<void | boolean> {
    this.clear(true);
    if (!graph || !regs) {
      this.instances.end();
      this.platePool.end();
      return this.modelSteps(null, null);
    }
    const signalled = this.buildSignals(graph, regs);
    this.buildStops(graph, regs, signalled);
    for (const ap of this.approaches) {
      const list = this.bySegment.get(ap.seg.id) ?? [];
      list.push(ap);
      this.bySegment.set(ap.seg.id, list);
    }
    return this.modelSteps(graph, regs);
  }

  private *modelSteps(graph: RoadGraph | null, regs: AppliedRegulations | null): Generator<void | boolean> {
    if (!graph || !regs) return;
    yield* this.buildModels(graph, regs.crossings);
    yield* this.buildNamePlates(graph, regs.junctionNames);
    this.update(this.time);
    this.instances.end();
    this.platePool.end();
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
    const ped = this.pedLamps;
    if (!ped) return;
    const blinkOn = Math.floor(seconds * 2) % 2 === 0;
    this.pedOwners.forEach(({ seg, near }, i) => {
      const light = this.pedLight(seg, near) ?? "stop";
      ped.stop.setColorAt(i, light === "stop" ? PED_ON.stop : LAMP_OFF);
      const isGo = light === "go" || (light === "flash" && blinkOn);
      ped.go.setColorAt(i, isGo ? PED_ON.go : LAMP_OFF);
    });
    for (const m of [ped.stop, ped.go]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  state(ap: Approach): LightState {
    return ap.controller ? lightState(this.time, ap.controller.offset, ap.axis) : "green";
  }

  /**
   * The 歩行者用信号 for crossing `seg` near `near`, or null when no signal governs that spot.
   * Walkers cross with the other road's green; it flashes for the last 5 s of that green, when
   * nobody should start across.
   */
  pedLight(seg: Segment, near: Vector3): PedLight | null {
    let best: Approach | null = null;
    let bestD = 30;
    for (const ap of this.bySegment.get(seg.id) ?? []) {
      if (ap.kind !== "signal" || !ap.controller) continue;
      const d = Math.hypot((ap.a.x + ap.b.x) / 2 - near.x, (ap.a.z + ap.b.z) / 2 - near.z);
      if (d < bestD) {
        bestD = d;
        best = ap;
      }
    }
    if (!best?.controller) return null;
    const other: 0 | 1 = best.axis === 0 ? 1 : 0;
    const t = (((this.time + best.controller.offset) % CYCLE) + CYCLE) % CYCLE;
    const local = t - (other === 0 ? 0 : GREEN[0] + YELLOW + ALL_RED);
    if (local < 0 || local >= GREEN[other]) return "stop";
    return local < GREEN[other] - 5 ? "go" : "flash";
  }

  /**
   * The pedestrian heads whose walk light is green now (視覚障害者用付加装置 sound only then), for
   * the crosswalk calls in game/spatialAudio.ts.
   */
  forEachWalking(visit: (head: PedHead) => void): void {
    for (const h of this.pedOwners) if (this.pedLight(h.seg, h.near) === "go") visit(h);
  }

  /** Whether a pedestrian may start across `seg` at `near` now (null: no signal there). */
  mayCross(seg: Segment, near: Vector3): boolean | null {
    const light = this.pedLight(seg, near);
    return light === null ? null : light === "go";
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

  clear(reuse = false): void {
    if (reuse) this.platePool.begin();
    else this.platePool.clear();
    if (reuse) this.instances.begin();
    else this.instances.clear();
    // Geometry and materials belong to the shared signal kit: only the instances go.
    for (const m of this.meshes) {
      this.scene.remove(m);
    }
    this.meshes = [];
    this.lamps = null;
    this.lampOwners = [];
    this.pedLamps = null;
    this.pedOwners = [];
    for (const p of this.plates) {
      this.scene.remove(p);
    }
    this.plates = [];
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
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
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [node, ids] of graph.nodes) {
      if (ids.length < 3) continue;
      const pos = this.nodePos(graph, node);
      const hasPosition = pos !== null;
      if (!hasPosition) continue;
      junctions.push({ node, pos });
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);
    }
    const signalled = new Set<number>();
    for (const s of regs.signals) {
      // OSM tiles extend past the road graph; signals beyond every snap range cannot match.
      const isOutside =
        minX - s.x >= SIGNAL_SNAP ||
        s.x - maxX >= SIGNAL_SNAP ||
        minZ - s.z >= SIGNAL_SNAP ||
        s.z - maxZ >= SIGNAL_SNAP;
      if (isOutside) continue;
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

    // A big crossing is several GSI nodes joined by short links, and OSM often tags a signal at
    // only some of them. Every junction node of the same box belongs to the controller, so each
    // approach into the crossing faces a signal (and is checked for red).
    const claimed = new Set(list.map((j) => j.node));
    for (const c of controllers.values()) {
      const origin = this.nodePos(graph, c.nodes[0]);
      const queue = [...c.nodes];
      while (queue.length) {
        const node = queue.pop() as number;
        for (const id of graph.nodes.get(node) ?? []) {
          const seg = graph.segments[id];
          if (seg.length > BOX_LINK || seg.line.kind === "highway") continue;
          const other = seg.from === node ? seg.to : seg.from;
          if (claimed.has(other) || (graph.nodes.get(other)?.length ?? 0) < 3) continue;
          const at = this.nodePos(graph, other);
          if (!at || !origin || at.distanceTo(origin) > BOX_RADIUS) continue;
          claimed.add(other);
          c.nodes.push(other);
          queue.push(other);
        }
      }
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

  private *buildModels(graph: RoadGraph, crossings: Crossing[]): Generator<void | boolean> {
    const kit = signalKit();
    if (!kit) return;
    const signals = this.approaches.filter((a) => a.kind === "signal");
    const ground = (p: Vector3) => this.groundAt(p.x, p.z) ?? 0;
    const o = new Object3D();
    const poles: Array<{ pos: Vector3; height: number }> = [];
    const arms: Object3D["matrix"][] = [];
    const heads: Object3D["matrix"][] = [];
    const lamps: Object3D["matrix"][] = [];

    for (const ap of signals) {
      yield;
      // Japanese practice: the head stands beyond the crossing on the far-left corner, hung from
      // an arm over the lane and facing the stop line; 青・黄・赤 from left to right.
      const node = ap.dir === 1 ? ap.seg.to : ap.seg.from;
      const nodePos = this.nodePos(graph, node) ?? ap.a;
      const far = this.clearance(graph, node, ap.seg) + 1;
      const half = ap.seg.line.width / 2;
      const corner = nodePos
        .clone()
        .addScaledVector(ap.travel, far)
        .add(leftOf(ap.travel, half + 1.2));
      // The pole stands on the pavement: in a big junction box the corner by GSI widths can fall
      // in a crossing street's carriageway, so step further on and further out until it is clear.
      const base =
        clearSpot(graph, [
          corner,
          ...[2, 4, 6].map((k) => corner.clone().addScaledVector(ap.travel, k)),
          ...[1, 2, 3].map((k) => corner.clone().add(leftOf(ap.travel, k))),
          ...[1, 2, 3].map((k) =>
            corner
              .clone()
              .addScaledVector(ap.travel, k * 2)
              .add(leftOf(ap.travel, k)),
          ),
        ]) ?? corner;
      const head = nodePos
        .clone()
        .addScaledVector(ap.travel, far)
        .add(leftOf(ap.travel, half * 0.35));
      const g = ground(base);
      const armY = g + SIGNAL_HEIGHT + HEAD_HANG * HEAD_SCALE;
      poles.push({ pos: base.clone().setY(g), height: armY - g + 0.25 });
      const toHead = new Vector3(head.x - base.x, 0, head.z - base.z);
      o.position.set(base.x, armY, base.z);
      o.quaternion.setFromUnitVectors(UP, toHead.clone().normalize());
      o.scale.set(1, toHead.length() + 0.3, 1);
      o.updateMatrix();
      arms.push(o.matrix.clone());
      const yaw = Math.atan2(-ap.travel.x, -ap.travel.z); // face the oncoming driver
      o.position.set(head.x, g + SIGNAL_HEIGHT, head.z);
      o.rotation.set(0, yaw, 0);
      o.scale.setScalar(HEAD_SCALE);
      o.updateMatrix();
      heads.push(o.matrix.clone());
      (["green", "yellow", "red"] as LightState[]).forEach((colour, k) => {
        o.position.set(head.x, g + SIGNAL_HEIGHT, head.z);
        o.rotation.set(0, yaw, 0);
        // The face looks back along −travel, so local −X is the driver's left: 青・黄・赤.
        o.translateX((k - 1) * LAMP_GAP * HEAD_SCALE);
        o.translateZ(0.003);
        o.scale.setScalar(HEAD_SCALE);
        o.updateMatrix();
        lamps.push(o.matrix.clone());
        this.lampOwners.push({ approach: ap, colour });
      });
    }

    // 歩行者用灯器 at both ends of each crosswalk a signal governs, facing across the road.
    const pedHeads: Object3D["matrix"][] = [];
    const pedStops: Object3D["matrix"][] = [];
    const pedGos: Object3D["matrix"][] = [];
    for (const c of crossings) {
      yield;
      if (this.pedLight(c.seg, c.pos) === null) continue;
      const { dir } = graph.sample(c.seg, c.s);
      for (const side of [1, -1] as const) {
        // Beside the crosswalk (not in it), just behind the kerb — and never in a carriageway:
        // near a junction box the kerb by GSI width can be inside the crossing road.
        const across = leftOf(dir, -side); // from this kerb toward the far one
        const kerb = c.pos.clone().add(leftOf(dir, side * (c.seg.line.width / 2 + 0.9)));
        const at = clearSpot(graph, [
          kerb.clone().addScaledVector(dir, 3.2 * side),
          kerb.clone().addScaledVector(dir, -3.2 * side),
          kerb
            .clone()
            .add(leftOf(dir, side * 1.5))
            .addScaledVector(dir, 3.2 * side),
          kerb
            .clone()
            .add(leftOf(dir, side * 1.5))
            .addScaledVector(dir, -3.2 * side),
        ]);
        if (!at) continue;
        const g = ground(at);
        poles.push({ pos: at.clone().setY(g), height: PED_HEIGHT + 0.55 });
        // Face the people waiting on the far kerb; the head sits 0.3 m out from its pole.
        const yaw = Math.atan2(across.x, across.z);
        const headAt = at.clone().addScaledVector(across, 0.3);
        o.position.set(headAt.x, g + PED_HEIGHT, headAt.z);
        o.rotation.set(0, yaw, 0);
        o.scale.setScalar(1);
        o.updateMatrix();
        pedHeads.push(o.matrix.clone());
        for (const [y, list] of [
          [PED_LAMP_Y, pedStops],
          [-PED_LAMP_Y, pedGos],
        ] as const) {
          o.position.set(headAt.x, g + PED_HEIGHT + y, headAt.z);
          o.rotation.set(0, yaw, 0);
          o.translateZ(0.003);
          o.updateMatrix();
          list.push(o.matrix.clone());
        }
        this.pedOwners.push({
          seg: c.seg,
          near: c.pos,
          at: headAt.clone().setY(g + PED_HEIGHT),
          across,
          side,
        });
      }
    }

    // Poles: the unit pole stretched to height; solid for cars and people (not ground probes).
    const poleMatrices = poles.map(({ pos, height }) => {
      o.position.copy(pos);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, height, 1);
      o.updateMatrix();
      return o.matrix.clone();
    });
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const { pos, height } of poles) {
      yield;
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(height / 2, POLE_RADIUS)
          .setTranslation(pos.x, pos.y + height / 2, pos.z)
          .setCollisionGroups(PROP_GROUPS),
        this.body,
      );
    }

    yield* this.instancedPart(kit.pole, poleMatrices, true);
    yield* this.instancedPart(kit.arm, arms, true);
    yield* this.instancedPart(kit.head, heads, true);
    yield* this.instancedPart(kit.pedHead, pedHeads, true);
    const lampMesh = this.instanced(kit.lamp, kit.lens, lamps, false);
    for (let i = 0; i < lamps.length; i++) lampMesh.setColorAt(i, LAMP_OFF);
    this.lamps = lampMesh;
    yield true;
    const stop = this.instanced(kit.pedLamp, kit.pedStop, pedStops, false);
    const go = this.instanced(kit.pedLamp, kit.pedGo, pedGos, false);
    for (let i = 0; i < pedStops.length; i++) {
      stop.setColorAt(i, LAMP_OFF);
      go.setColorAt(i, LAMP_OFF);
    }
    this.pedLamps = { stop, go };
    yield true;
  }

  /**
   * 交差点名 plates: blue with white lettering (and the English name under it when OSM has one),
   * hung on each signal arm beside the head, facing the approaching driver.
   */
  private *buildNamePlates(graph: RoadGraph, names: AppliedRegulations["junctionNames"]): Generator<void> {
    if (names.length === 0) return;
    for (const ap of this.approaches) {
      yield;
      if (ap.kind !== "signal") continue;
      const node = ap.dir === 1 ? ap.seg.to : ap.seg.from;
      const nodePos = this.nodePos(graph, node);
      if (!nodePos) continue;
      let best: (typeof names)[number] | null = null;
      let bestD = 40;
      for (const n of names) {
        const d = Math.hypot(n.pos.x - nodePos.x, n.pos.z - nodePos.z);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) continue;
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
      const toHead = head.clone().sub(base).setY(0);
      const armLen = toHead.length();
      const { name, en } = best;
      const plate = this.platePool.take(`${name}\n${en}`, () => namePlate(name, en));
      const width = (plate.geometry as BoxGeometry).parameters.width;
      // Between the pole and the head when the arm is long enough, else above the head.
      const room = armLen - (0.58 * HEAD_SCALE + 0.3);
      const g = this.groundAt(base.x, base.z) ?? 0;
      const yaw = Math.atan2(-ap.travel.x, -ap.travel.z);
      if (room > width + 0.4) {
        const at = base.clone().addScaledVector(toHead.normalize(), room - width / 2);
        plate.position.set(at.x, g + SIGNAL_HEIGHT + 0.05, at.z);
      } else {
        plate.position.set(head.x, g + SIGNAL_HEIGHT + 0.95, head.z);
      }
      plate.rotation.y = yaw;
      this.scene.add(plate);
      this.plates.push(plate);
    }
  }

  private *instancedPart(
    part: Part,
    matrices: Object3D["matrix"][],
    castShadow: boolean,
  ): Generator<boolean> {
    for (const { geometry, material } of part) {
      this.instanced(geometry, material, matrices, castShadow);
      yield true;
    }
  }

  private instanced(
    geometry: BufferGeometry,
    material: Material,
    matrices: Object3D["matrix"][],
    castShadow: boolean,
  ): InstancedMesh {
    const mesh = this.instances.take(geometry, material, matrices.length);
    mesh.count = matrices.length;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false; // instances span the whole area
    mesh.castShadow = castShadow;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
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

// One texture per junction name, kept across rebuilds (names repeat as the player drives about).
const plateTextures = new Map<string, { texture: CanvasTexture; aspect: number }>();
const plateBack = new MeshStandardMaterial({ color: 0x8c9196, roughness: 0.6, metalness: 0.4 });

function namePlate(name: string, en: string): Mesh {
  const key = `${name}\n${en}`;
  let entry = plateTextures.get(key);
  if (!entry) {
    const h = 160;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const jp = `bold 84px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`;
    const latin = `600 34px "Noto Sans", "Helvetica Neue", Arial, sans-serif`;
    ctx.font = jp;
    const wJp = ctx.measureText(name).width;
    ctx.font = latin;
    const wEn = en ? ctx.measureText(en).width : 0;
    canvas.width = Math.max(260, Math.ceil(Math.max(wJp, wEn) + 70));
    canvas.height = h;
    ctx.fillStyle = "#1d4f9c"; // 案内標識 blue
    ctx.fillRect(0, 0, canvas.width, h);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.strokeRect(9, 9, canvas.width - 18, h - 18);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = jp;
    ctx.fillText(name, canvas.width / 2, en ? 66 : h / 2 + 2);
    if (en) {
      ctx.font = latin;
      ctx.fillText(en, canvas.width / 2, 126);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    entry = { texture, aspect: canvas.width / h };
    plateTextures.set(key, entry);
  }
  const height = 0.55;
  const face = new MeshStandardMaterial({ map: entry.texture, roughness: 0.5 });
  // BoxGeometry face order: +x, −x, +y, −y, +z (the face toward the driver), −z.
  const mesh = new Mesh(new BoxGeometry(height * entry.aspect, height, 0.04), [
    plateBack,
    plateBack,
    plateBack,
    plateBack,
    face,
    plateBack,
  ]);
  mesh.castShadow = true;
  return mesh;
}
