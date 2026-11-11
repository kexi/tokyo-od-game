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
import { signalKit, type Part } from "./signalModels";
import {
  LAMP_COLOURS,
  LENS_Z_M,
  PED_HEAD,
  PUSH_BUTTON_BOX,
  SIGNAL_HEADS,
  VEHICLE_HEAD,
  WAIT_LAMP_COLOUR,
  arrowDirection,
  headHang,
  isArrow,
  lampLayout,
  type ArrowDirection,
  type LampColour,
} from "../signals/heads";
import { SIGNAL_MOUNTS } from "../signals/mounts";
import { PED_HEAD_CLEAR, PED_NEAR_POLE, SIGNAL_POLE_KERB } from "../signs/mountAssumptions";
import {
  groupsOf,
  hasRightArrow,
  junctionFacts,
  planForCrossing,
  planForJunction,
  saysOfPlan,
  type NightPlan,
} from "../signals/assign";
import { ScheduledRun } from "../signals/run";
import { UNTAGGED, type SignalRecord, type SignalTags } from "../signals/osmTags";
import {
  BUTTON_STAND_REACH_M,
  CROSSING_CLEAR_OF_JUNCTION_M,
  CROSSING_CLUSTER_M,
  CROSSING_HEAD_BEYOND_M,
  CROSSING_MATCH_M,
  CROSSING_ON_ROAD_M,
  CROSSING_OWN_CROSSWALK_M,
  CROSSING_STOP_BACK_M,
  CROSSING_STOP_RANGE_M,
  PED_LIGHT_REACH_M,
  SHARED_POLE_M,
  SIGNAL_SNAP_M,
} from "../signals/siting";
import { log } from "../log";
import {
  OnDemandRun,
  crossedBy,
  cycleTime,
  isDiagonal,
  permits,
  stepAt,
  type CompiledPlan,
  type GroupId,
  type MainAspect,
  type Movement,
  type Permission,
  type Step,
} from "../signals/plan";
import { leftOf, type RoadGraph, type Segment } from "./roads";
import { hasRoadside, isEnterable } from "./roadClass";
import { DeckOverhead, MAX_MARGIN, poleReachesDeck } from "./deckOverhead";

/**
 * What a signal's main lamps show: one of 施行令第2条's three colours, 黄・赤の点滅, or dark. Read by
 * the HUD and the lamp glow; whether a car may go is `permits`.
 */
export type LightState = LampColour | "flashingYellow" | "flashingRed" | "off";

/** A place where traffic on one segment, in one direction, must obey a signal or stop sign. */
export type Approach = {
  id: number;
  seg: Segment;
  dir: 1 | -1; // travel direction (1 = from → to), the TrafficAI convention
  at: number; // stop position along that travel direction
  kind: "signal" | "stop";
  /**
   * What the stop line is short of: a junction (the node at the segment's end; 一時停止 too), or
   * a 単路 crossing's crosswalk in the segment's middle (`node` is then the crosswalk's middle).
   */
  site: "junction" | "crossing";
  controller: Controller | null;
  axis: 0 | 1;
  /** The plan's signal group the approach's heads belong to (the plan's choice, assign.ts). */
  group: GroupId;
  /** The junction node the approach arrives at (for a 単路 crossing, the crosswalk's middle). */
  node: Vector3;
  /**
   * How far from `node` a car has left the junction: the controller's box plus 20 m, at least 25 m,
   * and always beyond the stop line (stop line distance plus 10 m) — a judgement at the line itself
   * would read every crossing as through.
   */
  exitM: number;
  /**
   * Metres from the stop line on to `node`, along the travel: the rest of the segment at a
   * junction, to the crosswalk's middle at a 単路 crossing. Why a field: readers that took the
   * node to be the segment's end (the autopilot's movement) were wrong at a crossing.
   */
  toNodeM: number;
  /**
   * Where the vehicle head hangs, on the ground under it (signals; null for 一時停止): the lamp
   * glow (streetLights.ts) reads it rather than working the placement out again.
   */
  head: Vector3 | null;
  /** The centreline point beyond the node the head and its pole are set out from (signals). */
  headBase: Vector3 | null;
  /** Stop line across the whole carriageway, for crossing tests. */
  a: Vector3;
  b: Vector3;
  travel: Vector3; // unit travel direction at the stop line
};

/**
 * One signal controller: its junction nodes, its 現示表 and the step it shows now. `step` is a cache
 * refreshed by TrafficControl.update for the controllers of the current network only: an Approach
 * kept from before a rebuild (streetLights.ts holds approaches between its own rebuilds) points at
 * a controller that is no longer updated, so its lamps and permits stay frozen until it is replaced.
 */
type Controller = {
  id: number;
  /** A junction's signal, or a 単路 (mid-block) crossing's. */
  kind: "junction" | "crossing";
  offset: number;
  /** The junction nodes (none for a 単路 crossing). */
  nodes: number[];
  /** A 単路 crossing's own crosswalks (its walk lights and button serve these only). */
  crosswalks: Crossing[];
  /** The plan running now: `day`, or `night`'s plan inside its window (T4). */
  plan: CompiledPlan;
  /** The plan outside any night window. */
  day: CompiledPlan;
  /** The plan inside a window of the day (夜間点滅, 夜間の押ボタン), or null. */
  night: NightPlan | null;
  /** Whether the night plan (or its way out) runs now (refreshed by update). */
  isNight: boolean;
  step: Step;
  /**
   * How the plan runs in time: a push button (OnDemandRun, a 単路 crossing's), or the clock with
   * the day's windows and the junction's walk buttons (ScheduledRun). Kept across rebuilds by the
   * controller's lon/lat key (TrafficControl.runs).
   */
  run: OnDemandRun | ScheduledRun;
  /** For each vehicle group, the walkers who cross its road (the plan's `walkers`, not diagonal). */
  walkersAcross: Map<GroupId, GroupId>;
  /** The running plan's diagonal walkers (歩車分離), or null. */
  diagonal: GroupId | null;
  /** Middle of the controller's nodes (a 単路 crossing: its crosswalk). */
  centre: Vector3;
  /** 音響式 by OSM traffic_signals:sound on the controller's own nodes: on, off, or not tagged. */
  sound: boolean | null;
};

/** The default plan (src/signals/plan.ts twoPhase), the compiled one assign.ts shares. */
const TWO_PHASE = planForJunction([]).plan;
/** The default plan's cycle (s). Plans with arrows run longer. */
export const CYCLE = TWO_PHASE.cycle;

const MAIN_LIGHT: Record<MainAspect, LightState> = {
  G: "green",
  Y: "yellow",
  R: "red",
  FY: "flashingYellow",
  FR: "flashingRed",
  off: "off",
};
/** The lamp a light shows (null: dark) and whether it blinks. */
const LAMP_OF: Record<LightState, { colour: LampColour | null; isFlashing: boolean }> = {
  green: { colour: "green", isFlashing: false },
  yellow: { colour: "yellow", isFlashing: false },
  red: { colour: "red", isFlashing: false },
  flashingYellow: { colour: "yellow", isFlashing: true },
  flashingRed: { colour: "red", isFlashing: true },
  off: { colour: null, isFlashing: false },
};
/** The lamp colour a light shows, steady or flashing (null when dark): the lamp glow's colour. */
export const lampColourOf = (light: LightState): LampColour | null => LAMP_OF[light].colour;

/**
 * For each vehicle group of `plan`, the walkers who cross its road at its crosswalks (diagonal
 * walkers have no crosswalk of their own: diagonalOf).
 */
const walkersAcrossOf = (plan: CompiledPlan): Map<GroupId, GroupId> =>
  new Map(
    Object.entries(plan.plan.walkers)
      .filter(([, w]) => !isDiagonal(w))
      .flatMap(([walkers, w]) => crossedBy(w).map((g) => [g, walkers] as const)),
  );
/** The diagonal walkers (歩車分離's 斜め横断) of `plan`, or null. */
const diagonalOf = (plan: CompiledPlan): GroupId | null =>
  Object.entries(plan.plan.walkers).find(([, w]) => isDiagonal(w))?.[0] ?? null;

/**
 * Main lamps of one axis of the default two-phase plan at `seconds` (compatibility: the plan is
 * src/signals/plan.ts twoPhase; TrafficControl reads each controller's own plan).
 */
export function lightState(seconds: number, offset: number, axis: 0 | 1): LightState {
  const step = stepAt(TWO_PHASE, cycleTime(seconds, offset, TWO_PHASE.cycle));
  return MAIN_LIGHT[step.main[axis === 0 ? "a" : "b"]];
}

// Where signals go (the OSM snap, the 単路 crossings' rules): src/signals/siting.ts.
const CLUSTER = 30; // junction nodes this close share one controller (dual carriageways)
const BOX_LINK = 35; // links this short between junction nodes are inside one crossing
const BOX_RADIUS = 50; // …as long as the node is this close to the signalled one

// Heads, their lamps, colours and how they are held up are declared in src/signals
// (knowledge/signal-system.md); heads are drawn larger than life (the mount's drawScale).
const LAMP_ON: Record<LampColour, Color> = {
  green: new Color(LAMP_COLOURS.vehicle.green),
  yellow: new Color(LAMP_COLOURS.vehicle.yellow),
  red: new Color(LAMP_COLOURS.vehicle.red),
};
const LAMP_OFF = new Color(LAMP_COLOURS.off);
const PED_ON = { stop: new Color(LAMP_COLOURS.pedestrian.red), go: new Color(LAMP_COLOURS.pedestrian.green) };
const WAIT_ON = new Color(WAIT_LAMP_COLOUR);
const VEHICLE_MOUNT = SIGNAL_MOUNTS[VEHICLE_HEAD.mount];
const PED_MOUNT = SIGNAL_MOUNTS[PED_HEAD.mount];
const SIGNAL_HEIGHT = VEHICLE_MOUNT.centreHeightM;
const HEAD_SCALE = VEHICLE_MOUNT.drawScale;
const HEAD_HANG = headHang(VEHICLE_HEAD);
/** The head over approaches whose group has a 右折矢印 step (src/signals/assign.ts). */
const RIGHT_ARROW_HEAD = SIGNAL_HEADS["vehicle-h3-right"];
const PED_HEIGHT = PED_MOUNT.centreHeightM; // pedestrian head centre above the pavement
const PED_LAMPS = lampLayout(PED_HEAD);
const POLE_RADIUS = 0.13;

/**
 * Walk phase for people crossing a street: go, flashing go (no new starters), stop, or dark (the
 * vehicle lamps flash; walkers then cross with care as at an unsignalled crosswalk, 施行令第2条).
 */
export type PedLight = "go" | "flash" | "stop" | "off";
/**
 * A 歩行者用灯器 and the accessible signal's speaker on it: where it hangs, the walking direction
 * across the road from its kerb, which end of the crosswalk it is, and the crossing it serves.
 */
export type PedHead = {
  seg: Segment;
  near: Vector3;
  at: Vector3;
  across: Vector3;
  side: 1 | -1;
  /** Whether its 視覚障害者用付加装置 sounds (OSM traffic_signals:sound, else the game's default: on). */
  sounds: boolean;
  /**
   * The call it makes at a 歩車分離 junction, where every crosswalk walks at once: one bird for all
   * (spatialAudio otherwise picks it by the walking direction). Null elsewhere.
   */
  bird: "piyo" | null;
};
/**
 * A 押ボタン箱 on a 単路 crossing's pole: the crossing it calls, the box's centre and the way its
 * face looks, and where a walker stands to press it.
 */
type ButtonBox = {
  seg: Segment;
  near: Vector3;
  at: Vector3;
  face: Vector3;
  stand: Vector3;
  controller: Controller;
  /** The walkers it calls (a 単路 crossing's run has one walk, so any group calls it). */
  walkers: GroupId;
};
const UP = new Vector3(0, 1, 0);

/**
 * Traffic signals (OSM positions, snapped to junctions) and 一時停止 (JARTIC) for the current
 * road graph: per-approach state for the law checks and the AI, plus their 3D models.
 */
/** One OSM signal record placed in the local frame, with its tags when the tiles carried them. */
type TaggedSignal = { pos: Vector3; record: SignalRecord | null };
/** One way across a 単路 crossing: its segment and direction, stop position and the crosswalk. */
type CrossingPlace = { seg: Segment; dir: 1 | -1; at: number; centre: Vector3; toNodeM: number };
/** A 単路 crossing that can have a controller: its OSM records, crosswalks and approaches. */
type CrossingPlan = {
  cluster: TaggedSignal[];
  centre: Vector3;
  places: CrossingPlace[];
  crosswalks: Crossing[];
};
/** Why 単路 crossings got no controller (the signal_crossings_skipped log). */
type CrossingSkips = { outside: number; noCrosswalk: number; nearJunction: number; noRoom: number };

/** A lon/lat hash, as the junction offsets use (stable across rebuilds and re-anchoring). */
const recordHash = (lon: number, lat: number): number =>
  (Math.imul(Math.round(lon * 1e4), 73856093) ^ Math.imul(Math.round(lat * 1e4), 19349663)) >>> 0;

/** First spot clear of every carriageway (poles stand on the pavement), or null. */
function clearSpot(graph: RoadGraph, candidates: Vector3[]): Vector3 | null {
  return candidates.find((p) => graph.carriagewaysAt(p, 0.3).length === 0) ?? null;
}

/**
 * A 車両用 signal pole as it stands: its foot (y = ground), the traffic its head faces, the arm's
 * height above the foot, and how far the foot is from that traffic's carriageway edge (at least;
 * the pole may have been stepped further out). Road signs hang on it (src/world/signs.ts, G4),
 * no lower than `minBottomM` above its foot: over the 歩行者用灯器 when one stands beside it.
 */
export type SignalPole = { pos: Vector3; travel: Vector3; armY: number; kerbM: number; minBottomM: number };
/** From the far-left corner spot of a 車両用 pole to its approach's carriageway edge, m. */
const POLE_KERB = SIGNAL_POLE_KERB.value;

export class TrafficControl {
  approaches: Approach[] = [];
  /** The 車両用 poles of the last build (one per signalled approach). */
  signalPoles: SignalPole[] = [];
  private bySegment = new Map<number, Approach[]>();
  private meshes: InstancedMesh[] = [];
  private readonly instances = new RoadInstances();
  private controllers: Controller[] = [];
  private lamps: InstancedMesh | null = null;
  private lampOwners: { approach: Approach; colour: LightState }[] = [];
  private arrowLamps: InstancedMesh | null = null;
  private arrowOwners: { approach: Approach; dir: ArrowDirection }[] = [];
  private pedLamps: { stop: InstancedMesh; go: InstancedMesh } | null = null;
  private pedOwners: PedHead[] = [];
  private buttons: ButtonBox[] = [];
  /** The records with an OSM traffic_signals:sound tag, for the crosswalks' 音響式 (buildModels). */
  private soundRecords: TaggedSignal[] = [];
  private waitLamps: InstancedMesh | null = null;
  /**
   * Every controller's run by its key (`x:` and a hash of a 単路 crossing's OSM nodes' lon/lat, `j:`
   * and the smallest node hash of a junction), kept across rebuilds: a walk under way must not snap
   * back to 赤, nor a night plan restart mid-change, when the network is rebuilt round the player.
   * The one place controller state outlives a rebuild.
   */
  private readonly runs = new Map<string, OnDemandRun | ScheduledRun>();
  /** Right-turn arrows the junctions' templates dropped (scramble, 時差式), for the summary log. */
  private droppedArrows = 0;
  private plates: Mesh[] = [];
  private readonly platePool = new RoadPlates((p) => {
    p.geometry.dispose();
    for (const m of p.material as Material[]) if (m !== plateBack) m.dispose();
  });
  private body: RAPIER.RigidBody | null = null;
  private time = 0;
  /** The game's time of day in minutes after midnight (night windows), or null: daytime. */
  private minute: number | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
  ) {}

  rebuild(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null,
    records: readonly SignalRecord[] = [],
  ): void {
    for (const _ of this.rebuildSteps(graph, regs, records)) {
      /* synchronous compatibility path */
    }
  }

  rebuildAsync(
    graph: RoadGraph,
    regs: AppliedRegulations | null,
    work: FrameWork,
    records: readonly SignalRecord[] = [],
  ): Promise<void> {
    return work.run(this.rebuildSteps(graph, regs, records));
  }

  private *rebuildSteps(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null,
    records: readonly SignalRecord[],
  ): Generator<void | boolean> {
    yield* this.setNetwork(graph, regs, records);
  }

  /**
   * The signals and stops of a new network. `records` are the OSM tags of `regs.signals`, index for
   * index (roadNetworkData.ts); without them every signal is read as before T3 (a junction's).
   */
  setNetwork(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null,
    records: readonly SignalRecord[] = [],
  ): Generator<void | boolean> {
    this.clear(true);
    if (!graph || !regs) {
      this.instances.end();
      this.platePool.end();
      this.runs.clear();
      return this.modelSteps(null, null);
    }
    const tagged = regs.signals.map((pos, i) => ({ pos, record: records[i] ?? null }));
    this.soundRecords = tagged.filter((t) => (t.record?.tags.sound ?? null) !== null);
    // The 単路 crossings are planned first: the records of those that get a controller stay out
    // of the junction snap, the others snap as before T3.
    const crossings = this.planCrossings(graph, regs, tagged);
    const signalled = this.buildSignals(graph, regs, tagged, crossings.byCrossing);
    this.buildCrossingSignals(graph, crossings.plans, crossings.skipped);
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

  /**
   * The game's time of day (minutes after midnight) for the plans that change at night (夜間点滅,
   * 夜間の押ボタン). Null: treated as daytime. Read at the next update.
   */
  setTimeOfDay(minute: number | null): void {
    this.minute = minute;
  }

  /**
   * Advance signal phases (seconds) and repaint lamps. `replay`: the clock is the replay's, which
   * jumps about; the runs are read at that time (what showed then, from their history) and not moved
   * on, so no plan changes and no push-button run starts in a replay.
   */
  update(seconds: number, replay = false): void {
    this.time = seconds;
    // One step lookup per controller per frame; state(), permits() and pedLight() read it there.
    for (const c of this.controllers) {
      if (!replay) this.advanceRun(c, seconds);
      this.refresh(c, seconds);
    }
    const lamps = this.lamps;
    if (!lamps) return;
    const blinkOn = Math.floor(seconds * 2) % 2 === 0;
    this.lampOwners.forEach(({ approach, colour }, i) => {
      const lamp = LAMP_OF[this.state(approach)];
      const isLit = lamp.colour === colour && (!lamp.isFlashing || blinkOn);
      lamps.setColorAt(i, isLit ? LAMP_ON[colour] : LAMP_OFF);
    });
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    const arrows = this.arrowLamps;
    if (arrows) {
      this.arrowOwners.forEach(({ approach, dir }, i) => {
        const isLit = approach.controller?.step.arrows[approach.group]?.includes(dir) ?? false;
        arrows.setColorAt(i, isLit ? LAMP_ON.green : LAMP_OFF);
      });
      if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
    }
    const ped = this.pedLamps;
    if (!ped) return;
    this.pedOwners.forEach(({ seg, near }, i) => {
      const light = this.pedLight(seg, near) ?? "stop";
      ped.stop.setColorAt(i, light === "stop" ? PED_ON.stop : LAMP_OFF);
      const isGo = light === "go" || (light === "flash" && blinkOn);
      ped.go.setColorAt(i, isGo ? PED_ON.go : LAMP_OFF);
    });
    for (const m of [ped.stop, ped.go]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const wait = this.waitLamps;
    if (!wait) return;
    this.buttons.forEach(({ controller, walkers }, i) => {
      const isWaiting = controller.run.isWaiting(walkers, seconds);
      wait.setColorAt(i, isWaiting ? WAIT_ON : LAMP_OFF);
    });
    if (wait.instanceColor) wait.instanceColor.needsUpdate = true;
  }

  /**
   * Move `c`'s run on to `seconds` (a push-button run moves itself on when read). A ScheduledRun
   * changes plans here only, at the moments plan.ts allows (run.ts).
   */
  private advanceRun(c: Controller, seconds: number): void {
    if (!(c.run instanceof ScheduledRun)) return;
    const template = c.run.advance(seconds, this.minute);
    if (template === null) return;
    log("signal_plan_switched", { controllerId: c.id, template, isNight: c.run.isNightAt(seconds) });
  }

  /** `c`'s step, plan, walkers and night flag at `seconds`, as its run shows them. */
  private refresh(c: Controller, seconds: number): void {
    c.step = c.run.stepAt(seconds);
    const plan = c.run instanceof ScheduledRun ? c.run.planAt(seconds) : c.plan;
    c.isNight = c.run instanceof ScheduledRun && c.run.isNightAt(seconds);
    if (plan === c.plan) return;
    c.plan = plan;
    c.walkersAcross = walkersAcrossOf(plan);
    c.diagonal = diagonalOf(plan);
  }

  /**
   * The colour of `ap`'s main lamps (compatibility for the HUD and the lamp glow: it says nothing of
   * arrows). Whether a car may go is `permits`.
   */
  state(ap: Approach): LightState {
    return ap.controller ? MAIN_LIGHT[ap.controller.step.main[ap.group] ?? "off"] : "green";
  }

  /**
   * 施行令第2条 for a vehicle on `ap` making `movement` (src/signals/plan.ts permits): the one test
   * the violation check, the autopilot and the traffic AI use. 一時停止 approaches answer `go`: their
   * stop is the stop-sign logic's, not a signal's.
   */
  permits(ap: Approach, movement: Movement): Permission {
    if (ap.kind !== "signal" || !ap.controller) return "go";
    return permits(ap.controller.step, ap.group, movement);
  }

  /** `permits` as it stood `agoS` seconds ago (the violation check's grace after an arrow goes out). */
  permitsBefore(ap: Approach, movement: Movement, agoS: number): Permission {
    const c = ap.controller;
    if (ap.kind !== "signal" || !c) return "go";
    // From what the run showed then (a plan change in between is read as it was).
    const before = c.run.stepBefore(this.time, agoS);
    return permits(before, ap.group, movement);
  }

  /** How many controllers run a plan with a 右折矢印 (for the network summary log). */
  rightArrowCount(): number {
    return this.controllers.filter((c) => groupsOf(c.day).some((g) => hasRightArrow(c.day, g))).length;
  }

  /**
   * Junction controllers by day plan template, and by night plan (`night:<template>`), for the
   * network summary log (T4).
   */
  planCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.controllers) {
      if (c.kind !== "junction") continue;
      out[c.day.plan.template] = (out[c.day.plan.template] ?? 0) + 1;
      if (!c.night) continue;
      const key = `night:${c.night.plan.plan.template}`;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  /** How many 単路 crossing controllers there are, and how many of them are push-button (the log). */
  crossingCounts(): { crossingSignals: number; pushButtons: number } {
    const crossings = this.controllers.filter((c) => c.kind === "crossing");
    const pushButtons = crossings.filter((c) => c.run instanceof OnDemandRun).length;
    return { crossingSignals: crossings.length, pushButtons };
  }

  /** Right-turn arrows the junctions' templates dropped in the last build (scramble, 時差式; T4). */
  droppedArrowCount(): number {
    return this.droppedArrows;
  }

  /**
   * The 歩行者用信号 for crossing `seg` near `near`, or null when no signal governs that spot.
   * Walkers cross with the other road's green; it flashes for the last 5 s of that green, when
   * nobody should start across.
   */
  pedLight(seg: Segment, near: Vector3): PedLight | null {
    const best = this.governing(seg, near);
    if (!best?.controller) return null;
    const walkers = best.controller.walkersAcross.get(best.group);
    return walkers === undefined ? "stop" : (best.controller.step.ped[walkers] ?? "stop");
  }

  /**
   * The walk light of the diagonal (歩車分離's 斜め横断) at the junction whose middle is nearest
   * `near` (within PED_LIGHT_REACH_M), or null where no scramble signal governs.
   */
  diagonalLight(near: Vector3): PedLight | null {
    const best = this.diagonalController(near);
    if (!best?.diagonal) return null;
    return best.step.ped[best.diagonal] ?? "stop";
  }

  /** The scramble controller whose middle is nearest `near` (within PED_LIGHT_REACH_M), or null. */
  private diagonalController(near: Vector3): Controller | null {
    let best: Controller | null = null;
    let bestD = PED_LIGHT_REACH_M;
    for (const c of this.controllers) {
      if (c.diagonal === null) continue;
      const d = Math.hypot(c.centre.x - near.x, c.centre.z - near.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * The signal approach on `seg` whose stop line is nearest `near` (within PED_LIGHT_REACH_M), if
   * any. A 単路 crossing's approaches count only at that crossing's own crosswalks: a junction
   * corner (or an unsignalled crosswalk) within reach of its stop line is not under its lights.
   */
  private governing(seg: Segment, near: Vector3): Approach | null {
    let best: Approach | null = null;
    let bestD = PED_LIGHT_REACH_M;
    for (const ap of this.bySegment.get(seg.id) ?? []) {
      if (ap.kind !== "signal" || !ap.controller) continue;
      const isOtherCrosswalk =
        ap.site === "crossing" &&
        !ap.controller.crosswalks.some(
          (c) => c.seg === seg && Math.hypot(c.pos.x - near.x, c.pos.z - near.z) < CROSSING_OWN_CROSSWALK_M,
        );
      if (isOtherCrosswalk) continue;
      const d = Math.hypot((ap.a.x + ap.b.x) / 2 - near.x, (ap.a.z + ap.b.z) / 2 - near.z);
      if (d < bestD) {
        bestD = d;
        best = ap;
      }
    }
    return best;
  }

  /**
   * The pedestrian heads whose walk light is green now and whose 視覚障害者用付加装置 sounds (OSM
   * traffic_signals:sound; untagged ones do, as before T3), for the crosswalk calls in
   * game/spatialAudio.ts.
   */
  forEachWalking(visit: (head: PedHead) => void): void {
    for (const h of this.pedOwners) if (h.sounds && this.pedLight(h.seg, h.near) === "go") visit(h);
  }

  /**
   * Where a walker about to cross `seg` at `near` from `kerb` stands to press the 押ボタン (the box
   * on that end's pole), or null when the crossing is not push-button or has no box on that side.
   */
  buttonStand(seg: Segment, near: Vector3, kerb: Vector3): Vector3 | null {
    let best: ButtonBox | null = null;
    let bestD = BUTTON_STAND_REACH_M;
    for (const b of this.buttons) {
      if (b.seg !== seg || b.near.distanceTo(near) > 1) continue;
      const d = Math.hypot(b.stand.x - kerb.x, b.stand.z - kerb.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best?.stand ?? null;
  }

  /**
   * A walker pressed the 押ボタン for crossing `seg` at `near`: a call to that crossing's
   * push-button run (nothing at a crossing that is not push-button). True when it was taken.
   */
  pressButton(seg: Segment, near: Vector3): boolean {
    const ap = this.governing(seg, near);
    const c = ap?.controller;
    if (!ap || !c) return false;
    const walkers = c.walkersAcross.get(ap.group);
    const isTaken = walkers !== undefined && c.run.call(walkers, this.time);
    if (isTaken) log("signal_button_pressed", { controllerId: c.id });
    return isTaken;
  }

  /**
   * Whether a pedestrian may start across `seg` at `near` now (null: no signal there, or its walk
   * lamps are dark while the vehicle lamps flash — then they cross as at an unsignalled crosswalk).
   */
  mayCross(seg: Segment, near: Vector3): boolean | null {
    const light = this.pedLight(seg, near);
    const isUnsignalled = light === null || light === "off";
    return isUnsignalled ? null : light === "go";
  }

  /**
   * Whether a pedestrian may start along the diagonal at the scramble junction near `near` now with
   * `needS` seconds of walking ahead (null: no scramble signal there, or its walk lamps are dark).
   */
  mayCrossDiagonal(near: Vector3, needS = 0): boolean | null {
    const light = this.diagonalLight(near);
    const isUnsignalled = light === null || light === "off";
    if (isUnsignalled) return null;
    if (light !== "go") return false;
    // Only with the walk left (青 and its flash) to get across: the traffic AI does not watch for
    // walkers, so one still on the diagonal at the vehicles' 青 would be in their way.
    const c = this.diagonalController(near);
    const left = c?.diagonal && c.run instanceof ScheduledRun ? c.run.walkLeftS(c.diagonal, this.time) : 0;
    return left >= needS;
  }

  /**
   * Next approach on this segment ahead of a car at travel distance `s` (negative: the car is that
   * far short of the segment, on the one before), of any kind, or only those `accept` takes.
   */
  nextStop(
    seg: Segment,
    dir: 1 | -1,
    s: number,
    accept: (ap: Approach) => boolean = () => true,
  ): { approach: Approach; dist: number } | null {
    let best: { approach: Approach; dist: number } | null = null;
    for (const ap of this.bySegment.get(seg.id) ?? []) {
      if (ap.dir !== dir || !accept(ap)) continue;
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

  /**
   * How many junction signal controllers there are (the network summary's `signals`, as before
   * T3; the 単路 crossings are counted apart, crossingCounts).
   */
  signalCount(): number {
    const junctions = this.approaches.filter((a) => a.controller && a.site === "junction");
    return new Set(junctions.map((a) => a.controller?.id)).size;
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
    this.arrowLamps = null;
    this.arrowOwners = [];
    this.controllers = [];
    this.pedLamps = null;
    this.pedOwners = [];
    this.signalPoles = [];
    this.buttons = [];
    this.waitLamps = null;
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

  /**
   * Signals: snap OSM nodes to junctions, cluster them, and create one approach per entry. Only
   * highway=traffic_signals records snap (as before T3), and not those `byCrossing` keeps: the
   * records of the 単路 crossings that get a controller of their own. A 単路 crossing that does not
   * (no crosswalk to match, say) leaves its signal nodes to snap as before, so no junction signal
   * the game had before T3 goes missing.
   */
  private buildSignals(
    graph: RoadGraph,
    regs: AppliedRegulations,
    tagged: readonly TaggedSignal[],
    byCrossing: ReadonlySet<TaggedSignal>,
  ): Set<string> {
    const junctions: { node: number; pos: Vector3 }[] = [];
    for (const [node, ids] of graph.nodes) {
      if (ids.length < 3) continue;
      const pos = this.nodePos(graph, node);
      if (pos) junctions.push({ node, pos });
    }
    const signalled = new Set<number>();
    const soundAt = new Map<number, boolean[]>();
    for (const t of tagged) {
      const tags = t.record?.tags ?? UNTAGGED;
      const isJunctionSignal = tags.junctionCapable && !byCrossing.has(t);
      if (!isJunctionSignal) continue;
      const s = t.pos;
      let best: { node: number; pos: Vector3 } | null = null;
      let bestD = SIGNAL_SNAP_M;
      for (const j of junctions) {
        const d = Math.hypot(j.pos.x - s.x, j.pos.z - s.z);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (!best) continue;
      signalled.add(best.node);
      if (tags.sound !== null) soundAt.set(best.node, [...(soundAt.get(best.node) ?? []), tags.sound]);
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
    // The offset is the smallest node hash modulo the plan's cycle, worked out once the plan is
    // chosen (below): for twoPhase that is the offset the game always used.
    const controllers = new Map<number, Controller>();
    const hashes = new Map<Controller, number[]>();
    for (const j of list) {
      const r = root(j.node);
      const c: Controller = controllers.get(r) ?? {
        id: r,
        kind: "junction" as const,
        offset: 0,
        nodes: [],
        crosswalks: [],
        plan: TWO_PHASE,
        day: TWO_PHASE,
        night: null,
        isNight: false,
        step: TWO_PHASE.plan.steps[0],
        run: new ScheduledRun(TWO_PHASE, null, 0, null),
        walkersAcross: walkersAcrossOf(TWO_PHASE),
        diagonal: null,
        centre: new Vector3(),
        sound: null,
      };
      c.nodes.push(j.node);
      // Any node of the junction tagged with sound decides it; "yes" wins over "no".
      const sounds = soundAt.get(j.node) ?? [];
      if (sounds.length > 0) c.sound = (c.sound ?? false) || sounds.includes(true);
      controllers.set(r, c);
      hashes.set(c, [...(hashes.get(c) ?? []), nodeHash(j.node)]);
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
          if (seg.length > BOX_LINK || !hasRoadside(seg.line)) continue;
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
    const laneUse = new Map(regs.laneUse.map((u) => [`${u.seg.id}/${u.dir}`, u]));
    // The records that say something of a junction's plan (T4): any node near it, crossing nodes
    // too (OSM puts 歩車分離 and the buttons on the crosswalks), but not a 単路 crossing's own.
    const planRecords = tagged.filter(
      (t) => !byCrossing.has(t) && t.record !== null && saysOfPlan(t.record.tags),
    );
    this.droppedArrows = 0;
    const liveKeys = new Set<string>();
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
          // An off-ramp arriving at the street is an approach too (isEnterable): it faces the signal
          // though nothing of the street's furniture stands on it.
          if (!isAllowed || !isEnterable(seg.line)) continue;
          // Travel direction arriving at the node.
          const { dir: d } = graph.sample(seg, dir === 1 ? seg.length - 0.5 : 0.5);
          const bearing = d.clone().multiplyScalar(dir);
          entries.push({ seg, node, dir, bearing });
        }
      }
      if (entries.length === 0) continue;
      // Axis 0 follows the widest road through the crossing; roughly perpendicular entries get axis 1.
      const main = entries.reduce((a, b) => (b.seg.line.width > a.seg.line.width ? b : a));
      const axisOf = (e: (typeof entries)[number]): 0 | 1 =>
        Math.abs(e.bearing.dot(main.bearing)) >= Math.SQRT1_2 ? 0 : 1;
      const nodes = c.nodes.map((n) => this.nodePos(graph, n)).filter((p): p is Vector3 => p !== null);
      const { plan, groupOf, night, droppedArrows } = planForJunction(
        entries.map((e) => ({
          axis: axisOf(e),
          lanes: laneUse.get(`${e.seg.id}/${e.dir}`),
          bearingDeg: compassOf(e.bearing),
        })),
        junctionFacts(tagsNear(planRecords, nodes)),
      );
      this.droppedArrows += droppedArrows;
      c.day = plan;
      c.night = night;
      const hash = Math.min(...(hashes.get(c) ?? [0]));
      c.offset = Math.min(...(hashes.get(c) ?? [0]).map((h) => h % plan.cycle));
      c.centre = nodes
        .reduce((a, p) => a.add(p), new Vector3())
        .multiplyScalar(1 / Math.max(1, nodes.length));
      const key = `j:${hash}`;
      liveKeys.add(key);
      const kept = this.runs.get(key);
      const isKept = kept instanceof ScheduledRun && kept.isFor(plan, night);
      c.run = isKept ? kept : new ScheduledRun(plan, night, c.offset, this.minute);
      this.runs.set(key, c.run);
      this.refresh(c, this.time);
      this.controllers.push(c);
      entries.forEach((e, i) => {
        const fromNode = this.clearance(graph, e.node, e.seg) + 5;
        const jartic = this.jarticStop(regs.stopLines, e.seg, e.dir, fromNode + 15);
        const back = jartic ?? fromNode;
        if (e.seg.length - back < 1) return;
        const ap = this.approach(
          graph,
          e.seg,
          e.dir,
          e.seg.length - back,
          "signal",
          c,
          axisOf(e),
          groupOf[i],
        );
        const box = Math.max(0, ...nodes.map((p) => p.distanceTo(ap.node)));
        const lineM = ap.a.clone().add(ap.b).multiplyScalar(0.5).distanceTo(ap.node);
        ap.exitM = Math.max(25, box + 20, lineM + 10);
        // Beyond the crossing on the far-left corner: past the widest other road's kerb.
        const nodePos = this.nodePos(graph, e.node) ?? ap.a;
        this.setHead(
          ap,
          nodePos.clone().addScaledVector(ap.travel, this.clearance(graph, e.node, e.seg) + 1),
        );
        this.approaches.push(ap);
        taken.add(`${e.seg.id}/${e.dir}`);
      });
    }
    for (const key of this.runs.keys()) if (key.startsWith("j:") && !liveKeys.has(key)) this.runs.delete(key);
    return taken;
  }

  /**
   * The 単路 (mid-block) crossings that can have a controller (T3), before any junction is
   * signalled: the OSM crossing records away from any junction, gathered within CROSSING_CLUSTER_M,
   * each matched to the JARTIC 横断歩道 it controls (one per carriageway of a divided road, on a
   * segment the records lie on), with a stop line on each way traffic crosses it. Records off the
   * road graph, with no crosswalk, or with no room for a stop line on the segment are skipped
   * (counted), not guessed. `byCrossing` is every record a matched crossing keeps from the
   * junction snap: its own and the plain signal nodes within CROSSING_CLUSTER_M that are away from
   * any OSM junction (a crossing is often mapped as its crossing node plus a signal node each side).
   */
  private planCrossings(
    graph: RoadGraph,
    regs: AppliedRegulations,
    tagged: readonly TaggedSignal[],
  ): { plans: CrossingPlan[]; byCrossing: Set<TaggedSignal>; skipped: CrossingSkips } {
    const skipped: CrossingSkips = { outside: 0, noCrosswalk: 0, nearJunction: 0, noRoom: 0 };
    const byCrossing = new Set<TaggedSignal>();
    const records = tagged.filter((t) => t.record?.tags.midBlock);
    if (records.length === 0) return { plans: [], byCrossing, skipped };
    const clusters: TaggedSignal[][] = [];
    for (const r of records) {
      const near = clusters.find((cl) => cl.some((o) => o.pos.distanceTo(r.pos) < CROSSING_CLUSTER_M));
      if (near) near.push(r);
      else clusters.push([r]);
    }
    const plans: CrossingPlan[] = [];
    for (const cluster of clusters) {
      const centre = cluster.reduce((a, t) => a.add(t.pos), new Vector3()).multiplyScalar(1 / cluster.length);
      // The signal tiles reach further than the road graph: records off its streets are not ours.
      const isOutside = graph.nearest(centre, CROSSING_MATCH_M) === null;
      if (isOutside) {
        skipped.outside++;
        continue;
      }
      // The crosswalk on each segment nearest the cluster's records (a divided road has two).
      const bySeg = new Map<number, { c: Crossing; d: number }>();
      for (const c of regs.crossings) {
        // Roads with no crosswalk or pavement (the expressway, its ramps) get no 単路 crossing.
        if (!hasRoadside(c.seg.line)) continue;
        const d = Math.min(...cluster.map((t) => Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z)));
        const isCloser = d < CROSSING_MATCH_M && d < (bySeg.get(c.seg.id)?.d ?? Infinity);
        if (!isCloser) continue;
        const isOnTheirRoad = cluster.some(
          (t) => graph.nearest(t.pos, CROSSING_ON_ROAD_M, (s) => s === c.seg) !== null,
        );
        if (isOnTheirRoad) bySeg.set(c.seg.id, { c, d });
      }
      if (bySeg.size === 0) {
        skipped.noCrosswalk++;
        continue;
      }
      const places: CrossingPlace[] = [];
      for (const { c } of bySeg.values()) {
        const mid = graph.sample(c.seg, c.s).pos.clone();
        for (const dir of [1, -1] as const) {
          const isAllowed = c.seg.oneway === 0 || c.seg.oneway === dir;
          if (!isAllowed) continue;
          const crossAt = dir === 1 ? c.s : c.seg.length - c.s; // the crosswalk along the travel
          const back = this.crossingStop(regs.stopLines, c.seg, dir, crossAt) ?? CROSSING_STOP_BACK_M;
          const at = crossAt - back;
          if (at < 1) continue;
          places.push({ seg: c.seg, dir, at, centre: mid, toNodeM: back });
        }
      }
      if (places.length === 0) {
        skipped.noRoom++;
        continue;
      }
      plans.push({ cluster, centre, places, crosswalks: [...bySeg.values()].map((v) => v.c) });
      for (const t of cluster) byCrossing.add(t);
      for (const t of tagged) {
        const isBeside =
          (t.record?.tags.awayFromJunction ?? false) &&
          cluster.some((c) => c.pos.distanceTo(t.pos) < CROSSING_CLUSTER_M);
        if (isBeside) byCrossing.add(t);
      }
    }
    return { plans, byCrossing, skipped };
  }

  /**
   * The 単路 crossings' controllers (planCrossings), but not next to a signalled junction (that
   * junction's signal governs there). Their plan is pushButton where OSM tags button_operated=yes
   * (assign.ts planForCrossing).
   */
  private buildCrossingSignals(
    graph: RoadGraph,
    plans: readonly CrossingPlan[],
    skipped: CrossingSkips,
  ): void {
    const junctionNodes = this.controllers.flatMap((c) =>
      c.nodes.map((n) => this.nodePos(graph, n)).filter((p): p is Vector3 => p !== null),
    );
    const liveKeys = new Set<number>();
    for (const { cluster, centre, places, crosswalks } of plans) {
      const isNearJunction = junctionNodes.some((p) => p.distanceTo(centre) < CROSSING_CLEAR_OF_JUNCTION_M);
      if (isNearJunction) {
        skipped.nearJunction++;
        continue;
      }
      const tagsOf = cluster.map((t) => t.record?.tags ?? UNTAGGED);
      const button = tagsOf.some((t) => t.button === true)
        ? true
        : tagsOf.some((t) => t.button === false)
          ? false
          : null;
      const sounds = tagsOf.flatMap((t) => (t.sound === null ? [] : [t.sound]));
      const { plan, groupOf } = planForCrossing({ button }, places.length);
      // Lon/lat, not local positions: the key and the phase must survive re-anchoring the frame.
      const key = Math.min(
        ...cluster.map((t) => recordHash(t.record?.lon ?? t.pos.x, t.record?.lat ?? t.pos.z)),
      );
      liveKeys.add(key);
      const run = this.crossingRun(key, plan);
      const c: Controller = {
        id: key,
        kind: "crossing",
        offset: key % plan.cycle,
        nodes: [],
        crosswalks,
        plan,
        day: plan,
        night: null,
        isNight: false,
        step: plan.plan.steps[0],
        run,
        walkersAcross: walkersAcrossOf(plan),
        diagonal: null,
        centre,
        sound: sounds.length > 0 ? sounds.includes(true) : null,
      };
      if (run instanceof ScheduledRun) c.run = this.keptCrossingRun(key, plan, c.offset);
      this.refresh(c, this.time);
      this.controllers.push(c);
      places.forEach((p, i) => {
        const ap = this.approach(graph, p.seg, p.dir, p.at, "signal", c, 0, groupOf[i]);
        ap.site = "crossing";
        ap.node = p.centre;
        ap.toNodeM = p.toNodeM;
        ap.exitM = Math.max(25, p.toNodeM + 10);
        this.setHead(ap, p.centre.clone().addScaledVector(ap.travel, CROSSING_HEAD_BEYOND_M));
        this.approaches.push(ap);
      });
    }
    for (const key of this.runs.keys())
      if (key.startsWith("x:") && !liveKeys.has(Number(key.slice(2)))) this.runs.delete(key);
    const isAnySkipped = skipped.outside + skipped.noCrosswalk + skipped.nearJunction + skipped.noRoom > 0;
    if (isAnySkipped) log("signal_crossings_skipped", skipped);
  }

  /**
   * The run of the 単路 crossing `key`: its push-button run carried over from the last network when it
   * had one; a fixed cycle is a ScheduledRun made by keptCrossingRun once the offset is known.
   */
  private crossingRun(key: number, plan: CompiledPlan): OnDemandRun | ScheduledRun {
    if (!plan.plan.onDemand) return new ScheduledRun(plan, null, 0, null);
    const kept = this.runs.get(`x:${key}`);
    if (kept instanceof OnDemandRun && kept.compiled === plan) return kept;
    const run = new OnDemandRun(plan, this.time);
    this.runs.set(`x:${key}`, run);
    return run;
  }

  /** A 単路 crossing's fixed-cycle run at `offset`, carried over when the plan is the same. */
  private keptCrossingRun(key: number, plan: CompiledPlan, offset: number): ScheduledRun {
    const kept = this.runs.get(`x:${key}`);
    if (kept instanceof ScheduledRun && kept.isFor(plan, null)) return kept;
    const run = new ScheduledRun(plan, null, offset, null);
    this.runs.set(`x:${key}`, run);
    return run;
  }

  /** A JARTIC stop line on this approach before its crosswalk at `crossAt` (distance from it), if any. */
  private crossingStop(lines: StopLine[], seg: Segment, dir: 1 | -1, crossAt: number): number | null {
    let best: number | null = null;
    for (const l of lines) {
      if (l.seg !== seg || l.dir !== dir) continue;
      const back = crossAt - l.at;
      const isInRange = back >= CROSSING_STOP_RANGE_M[0] && back <= CROSSING_STOP_RANGE_M[1];
      if (isInRange && (best === null || back < best)) best = back;
    }
    return best;
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
    group: GroupId = axis === 0 ? "a" : "b",
  ): Approach {
    const along = dir === 1 ? at : seg.length - at;
    const { pos, dir: d } = graph.sample(seg, along);
    const travel = d.clone().multiplyScalar(dir);
    const half = seg.line.width / 2 + 1;
    const node = graph.sample(seg, dir === 1 ? seg.length : 0).pos.clone();
    return {
      id: this.approaches.length,
      seg,
      dir,
      at,
      kind,
      controller,
      axis,
      group,
      site: "junction",
      node,
      exitM: 25,
      toNodeM: seg.length - at,
      head: null,
      headBase: null,
      a: pos.clone().add(leftOf(travel, half)),
      b: pos.clone().add(leftOf(travel, -half)),
      travel,
    };
  }

  /**
   * Where `ap`'s vehicle head hangs: `base` is the point on the centreline beyond the node the
   * head and its pole are set out from; the head is 0.35 of the half width to its left (over the
   * approach's lanes, Japanese practice).
   */
  private setHead(ap: Approach, base: Vector3): void {
    ap.headBase = base;
    ap.head = base.clone().add(leftOf(ap.travel, (ap.seg.line.width / 2) * 0.35));
  }

  /** Distance from a junction node to the kerb line of the widest other road there. */
  private clearance(graph: RoadGraph, node: number, except: Segment): number {
    const widths = (graph.nodes.get(node) ?? [])
      .filter((id) => id !== except.id)
      .map((id) => graph.segments[id].line.width);
    return (widths.length ? Math.max(...widths) : except.line.width) / 2 + 1.5;
  }

  // ---------- models ----------

  /** The head over `ap`: with the right-arrow row when its group's plan ever lights a right arrow. */
  private headFor(ap: Approach) {
    const isArrowGroup = ap.controller !== null && hasRightArrow(ap.controller.day, ap.group);
    return isArrowGroup ? RIGHT_ARROW_HEAD : VEHICLE_HEAD;
  }

  private *buildModels(graph: RoadGraph, crossings: Crossing[]): Generator<void | boolean> {
    const kit = signalKit();
    if (!kit) return;
    const signals = this.approaches.filter((a) => a.kind === "signal");
    const ground = (p: Vector3) => this.groundAt(p.x, p.z) ?? 0;
    const o = new Object3D();
    const poles: Array<{ pos: Vector3; height: number }> = [];
    const arms: Object3D["matrix"][] = [];
    const heads: Object3D["matrix"][] = [];
    const arrowHeads: Object3D["matrix"][] = [];
    const lamps: Object3D["matrix"][] = [];
    const arrowLamps: Object3D["matrix"][] = [];
    /** The vehicle heads' poles at 単路 crossings (the walk heads share them). */
    const crossingPoles: Vector3[] = [];
    /** Where the 「時差式信号」 plates hang (under the heads of a 時差式 road), facing the driver. */
    const staggeredPlates: { at: Vector3; yaw: number }[] = [];

    for (const ap of signals) {
      yield;
      // Japanese practice: the head stands beyond the crossing on the far-left corner, hung from
      // an arm over the lane and facing the stop line; 青・黄・赤 from left to right. At a 単路
      // crossing "beyond the crossing" is just past its crosswalk.
      // The head's place was set with the approach (setHead), so the lamp glow reads the same one.
      const headBase = ap.headBase;
      const head = ap.head;
      if (!headBase || !head) continue;
      const half = ap.seg.line.width / 2;
      const corner = headBase.clone().add(leftOf(ap.travel, half + POLE_KERB));
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
      const g = ground(base);
      const armY = g + SIGNAL_HEIGHT + HEAD_HANG * HEAD_SCALE;
      poles.push({ pos: base.clone().setY(g), height: armY - g + 0.25 });
      // The corner stands POLE_KERB beyond the carriageway edge; clearSpot moves it on or further out.
      this.signalPoles.push({
        pos: base.clone().setY(g),
        travel: ap.travel.clone(),
        armY: armY - g,
        kerbM: POLE_KERB,
        minBottomM: 0,
      });
      if (ap.site === "crossing") crossingPoles.push(base.clone().setY(g));
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
      const def = this.headFor(ap);
      (def === RIGHT_ARROW_HEAD ? arrowHeads : heads).push(o.matrix.clone());
      if (isStaggeredRoad(ap)) {
        const below = (def.housing.hM / 2 + STAGGERED_PLATE.gapM + STAGGERED_PLATE.hM / 2) * HEAD_SCALE;
        staggeredPlates.push({ at: new Vector3(head.x, g + SIGNAL_HEIGHT - below, head.z), yaw });
      }
      for (const { lamp, x, y, turn } of lampLayout(def)) {
        o.position.set(head.x, g + SIGNAL_HEIGHT, head.z);
        o.rotation.set(0, yaw, 0);
        // The face looks back along −travel, so local +X (lampLayout's right) is the driver's
        // right: 施行令第3条 赤・黄・青 from the right, and a right arrow points the driver's right.
        o.translateX(x * HEAD_SCALE);
        o.translateY(y * HEAD_SCALE);
        o.translateZ(LENS_Z_M);
        o.rotateZ(turn);
        o.scale.setScalar(HEAD_SCALE);
        o.updateMatrix();
        if (isArrow(lamp)) {
          arrowLamps.push(o.matrix.clone());
          this.arrowOwners.push({ approach: ap, dir: arrowDirection(lamp) });
          continue;
        }
        lamps.push(o.matrix.clone());
        this.lampOwners.push({ approach: ap, colour: lamp });
      }
    }

    // 歩行者用灯器 at both ends of each crosswalk a signal governs, facing across the road.
    const pedHeads: Object3D["matrix"][] = [];
    const pedStops: Object3D["matrix"][] = [];
    const pedGos: Object3D["matrix"][] = [];
    const sound = this.soundRecords;
    const boxes: Object3D["matrix"][] = [];
    const waitLamps: Object3D["matrix"][] = [];
    for (const c of crossings) {
      yield;
      if (this.pedLight(c.seg, c.pos) === null) continue;
      const governing = this.governing(c.seg, c.pos);
      const controller = governing?.controller ?? null;
      const sounds = this.soundsAt(c.pos, controller, sound);
      const isScramble = controller !== null && diagonalOf(controller.day) !== null;
      const calledWalkers = governing ? (controller?.walkersAcross.get(governing.group) ?? null) : null;
      const hasWalkButton = controller !== null && hasWalkButtons(controller);
      const { dir } = graph.sample(c.seg, c.s);
      for (const side of [1, -1] as const) {
        // Beside the crosswalk (not in it), just behind the kerb — and never in a carriageway:
        // near a junction box the kerb by GSI width can be inside the crossing road.
        const across = leftOf(dir, -side); // from this kerb toward the far one
        const kerb = c.pos.clone().add(leftOf(dir, side * (c.seg.line.width / 2 + 0.9)));
        const spot = clearSpot(graph, [
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
        if (!spot) continue;
        // At a 単路 crossing the vehicle head's pole stands at this kerb too: the walk head and the
        // button go on it (共架), not on a second pole beside it.
        const shared =
          controller !== null && controller.crosswalks.length > 0
            ? crossingPoles.find((p) => Math.hypot(p.x - kerb.x, p.z - kerb.z) < SHARED_POLE_M)
            : undefined;
        const at = shared ? shared.clone() : spot;
        const g = ground(at);
        if (!shared) poles.push({ pos: at.clone().setY(g), height: PED_HEIGHT + 0.55 });
        // Face the people waiting on the far kerb; the head sits 0.3 m out from its pole.
        const yaw = Math.atan2(across.x, across.z);
        const headAt = at.clone().addScaledVector(across, PED_MOUNT.offsetM);
        o.position.set(headAt.x, g + PED_HEIGHT, headAt.z);
        o.rotation.set(0, yaw, 0);
        o.scale.setScalar(1);
        o.updateMatrix();
        pedHeads.push(o.matrix.clone());
        for (const { lamp, y } of PED_LAMPS) {
          // 施行令第3条: lampLayout puts the red (止まれ) lamp above the green (進め) one.
          const list = lamp === "red" ? pedStops : pedGos;
          o.position.set(headAt.x, g + PED_HEIGHT + y, headAt.z);
          o.rotation.set(0, yaw, 0);
          o.translateZ(LENS_Z_M);
          o.updateMatrix();
          list.push(o.matrix.clone());
        }
        this.pedOwners.push({
          seg: c.seg,
          near: c.pos,
          at: headAt.clone().setY(g + PED_HEIGHT),
          across,
          side,
          sounds,
          bird: isScramble ? "piyo" : null,
        });
        const hasBox = controller?.run instanceof OnDemandRun || hasWalkButton;
        if (!controller || !hasBox) continue;
        // 押ボタン箱: banded to the same pole (電柱抱込式), facing along the pavement toward the
        // crosswalk, where the waiting walker stands.
        const toCrossing = kerb.clone().sub(at).setY(0);
        const faceDir = toCrossing.lengthSq() > 1e-6 ? toCrossing.normalize() : across.clone();
        const box = PUSH_BUTTON_BOX;
        const boxAt = at.clone().addScaledVector(faceDir, box.offsetM);
        const boxY = g + box.bottomM + box.housing.hM / 2;
        o.position.set(boxAt.x, boxY, boxAt.z);
        o.rotation.set(0, Math.atan2(faceDir.x, faceDir.z), 0);
        o.scale.setScalar(1);
        o.updateMatrix();
        boxes.push(o.matrix.clone());
        o.translateY(box.waitLamp.y);
        o.translateZ(LENS_Z_M);
        o.scale.set(box.waitLamp.wM, box.waitLamp.hM, 1);
        o.updateMatrix();
        waitLamps.push(o.matrix.clone());
        this.buttons.push({
          seg: c.seg,
          near: c.pos,
          at: boxAt.clone().setY(boxY),
          face: faceDir.clone(),
          stand: boxAt.clone().addScaledVector(faceDir, 0.45).setY(g),
          controller,
          walkers: calledWalkers ?? "p",
        });
      }
    }

    // A 歩行者用灯器 beside a 車両用 pole: plates shared onto that pole go above its housing
    // (multi-view review G4 round 1: in 神田 the head hid the lower plate).
    const pedTop = PED_HEIGHT + PED_HEAD.housing.hM / 2 + PED_HEAD_CLEAR.value;
    for (const pole of this.signalPoles) {
      const hasPedHead = this.pedOwners.some(
        (h) => Math.hypot(h.at.x - pole.pos.x, h.at.z - pole.pos.z) < PED_NEAR_POLE.value,
      );
      if (hasPedHead) pole.minBottomM = pedTop;
    }

    for (const { at, yaw } of staggeredPlates) {
      const plate = this.platePool.take(STAGGERED_PLATE.text, staggeredPlate);
      plate.position.copy(at);
      plate.rotation.y = yaw;
      this.scene.add(plate);
      this.plates.push(plate);
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
    const decks = new DeckOverhead(graph);
    for (const { pos, height } of poles) {
      yield;
      // A pole whose top reaches an expressway deck over it gets no collider: a car on the deck
      // would stop on it (deckOverhead.ts). Why only the collider, not the pole: the signal stands
      // for its junction (hiding it would change the control); a pole drawn into a girder is left
      // as a look to fix with the junction (knowledge/street-lighting-and-wet-roads.md).
      const isIntoDeck =
        !decks.isEmpty &&
        poleReachesDeck(decks.surfacesOver(pos.x, pos.z, MAX_MARGIN), pos.y, pos.y + height);
      if (isIntoDeck) continue;
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
    // Only when a plan here has an arrow: no empty meshes (and no extra pipeline) elsewhere.
    if (arrowHeads.length > 0) yield* this.instancedPart(kit.headRightArrow, arrowHeads, true);
    yield* this.instancedPart(kit.pedHead, pedHeads, true);
    const lampMesh = this.instanced(kit.lamp, kit.lens, lamps, false);
    for (let i = 0; i < lamps.length; i++) lampMesh.setColorAt(i, LAMP_OFF);
    this.lamps = lampMesh;
    if (arrowLamps.length > 0) {
      const arrowMesh = this.instanced(kit.arrowLamp, kit.lens, arrowLamps, false);
      for (let i = 0; i < arrowLamps.length; i++) arrowMesh.setColorAt(i, LAMP_OFF);
      this.arrowLamps = arrowMesh;
    }
    yield true;
    const stop = this.instanced(kit.pedLamp, kit.pedStop, pedStops, false);
    const go = this.instanced(kit.pedLamp, kit.pedGo, pedGos, false);
    for (let i = 0; i < pedStops.length; i++) {
      stop.setColorAt(i, LAMP_OFF);
      go.setColorAt(i, LAMP_OFF);
    }
    this.pedLamps = { stop, go };
    yield true;
    if (boxes.length === 0) return;
    yield* this.instancedPart(kit.buttonBox, boxes, true);
    const wait = this.instanced(kit.waitLamp, kit.waitLens, waitLamps, false);
    for (let i = 0; i < waitLamps.length; i++) wait.setColorAt(i, LAMP_OFF);
    this.waitLamps = wait;
    yield true;
  }

  /**
   * Whether the 視覚障害者用付加装置 at a crosswalk sounds: the OSM traffic_signals:sound of the
   * nearest tagged record within CROSSING_MATCH_M of it, else the controller's own nodes' tag, else
   * on (the rule before T3: every signalled crosswalk sounds in the daytime).
   */
  private soundsAt(pos: Vector3, controller: Controller | null, sound: readonly TaggedSignal[]): boolean {
    let best: boolean | null = null;
    let bestD = CROSSING_MATCH_M;
    for (const t of sound) {
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d >= bestD) continue;
      bestD = d;
      best = t.record?.tags.sound ?? null;
    }
    return best ?? controller?.sound ?? true;
  }

  /**
   * 交差点名 plates: blue with white lettering (and the English name under it when OSM has one),
   * hung on each signal arm beside the head, facing the approaching driver.
   */
  private *buildNamePlates(graph: RoadGraph, names: AppliedRegulations["junctionNames"]): Generator<void> {
    if (names.length === 0) return;
    for (const ap of this.approaches) {
      yield;
      const isJunctionSignal = ap.kind === "signal" && ap.site === "junction";
      if (!isJunctionSignal) continue;
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
      if (!best || !ap.headBase || !ap.head) continue;
      const half = ap.seg.line.width / 2;
      const base = ap.headBase.clone().add(leftOf(ap.travel, half + POLE_KERB));
      const head = ap.head;
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

/** Whether `ap`'s heads face a 時差式 road (its group is one of an `opposing` pair). */
const isStaggeredRoad = (ap: Approach): boolean =>
  ap.site === "junction" &&
  (ap.controller?.day.plan.opposing.some(([g, h]) => g === ap.group || h === ap.group) ?? false);

/**
 * The 「時差式信号」 plate under a 時差式 road's heads. Not a 補助標識 of 標識令 別表第一 (no 時差式 there:
 * assets/signs/law-table.json), so it is not in the sign registry: a plate the 公安委員会 hangs with
 * the signal, drawn as commonly seen — black 「時差式信号」 on white with a black border. The wording,
 * colours and size (0.9 × 0.3 m) are unconfirmed; no standard for it was read.
 */
const STAGGERED_PLATE = { text: "時差式信号", wM: 0.9, hM: 0.3, gapM: 0.08 } as const;

function staggeredPlate(): Mesh {
  let entry = plateTextures.get(STAGGERED_PLATE.text);
  if (!entry) {
    const h = 120;
    const w = Math.round((h * STAGGERED_PLATE.wM) / STAGGERED_PLATE.hM);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold 74px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`;
    ctx.fillText(STAGGERED_PLATE.text, w / 2, h / 2 + 2, w - 40);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    entry = { texture, aspect: w / h };
    plateTextures.set(STAGGERED_PLATE.text, entry);
  }
  const face = new MeshStandardMaterial({ map: entry.texture, roughness: 0.5 });
  // BoxGeometry face order: +x, −x, +y, −y, +z (the face toward the driver), −z.
  const mesh = new Mesh(
    new BoxGeometry(STAGGERED_PLATE.wM * HEAD_SCALE, STAGGERED_PLATE.hM * HEAD_SCALE, 0.03),
    [plateBack, plateBack, plateBack, plateBack, face, plateBack],
  );
  mesh.castShadow = true;
  return mesh;
}

/** Whether `c` has walk buttons in either of its plans (a junction's 押ボタン, all day or at night). */
const hasWalkButtons = (c: Controller): boolean =>
  c.day.plan.onCall.length > 0 || (c.night?.plan.plan.onCall.length ?? 0) > 0;

/** Compass bearing (degrees from north, clockwise) of a ground direction (x east, z south). */
const compassOf = (d: Vector3): number => ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360;

/** The tags of the records within SIGNAL_SNAP_M of a junction's nodes (assign.ts junctionFacts reads them). */
function tagsNear(records: readonly TaggedSignal[], nodes: readonly Vector3[]): SignalTags[] {
  return records
    .filter((t) => nodes.some((n) => Math.hypot(n.x - t.pos.x, n.z - t.pos.z) < SIGNAL_SNAP_M))
    .flatMap((t) => (t.record ? [t.record.tags] : []));
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
