import { reanchorBody } from "../physics/reanchor";
import {
  Euler,
  type InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from "three";
import { RoadInstances } from "./roadInstances";
import { FrameWork } from "../game/frameWork";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PROP_GROUPS } from "../physics/groups";
import { SIGN, type AppliedRegulations, type LaneDirection } from "./regulations";
import gameTable from "../../assets/signs/game.json";
import { auxKey, type AuxPlate } from "../signs/auxPlates";
import {
  MEMBER_NODES,
  MEMBER_ROLES,
  resolveMount,
  withoutColumn,
  type MemberRole,
  type MountKind,
  type MountPlacement,
  type ResolvedMount,
} from "../signs/mount";
import { SIGNAL_SHARE_RADIUS, SIGN_KERB } from "../signs/mountAssumptions";
import { PLATES, plateBoxMm } from "../signs/plates";
import { auxDesignFor, designFor, type Design, type GameTable } from "../signs/game";
import { laneKey } from "../signs/lanes";
import { log, warn } from "../log";
import { leftOf, type RoadGraph } from "./roads";
import type { Approach, SignalPole } from "./trafficControl";
import { sharedDraco } from "../render/draco";
import { FaceLayerPool } from "./signFaces";
import { attachFaceLayers, SignFaceMaterial } from "./signFaceMaterial";
import { BASE_GLOW } from "../signs/retroAssumptions";

// Sign artwork drawn by scripts/textures/sign_textures.py (道路標識、区画線及び道路標示に関する命令
// 別表第二); Vite bundles each PNG with a content hash.
const ARTWORK = import.meta.glob<string>("../../assets/signs/textures/*.png", {
  eager: true,
  // no-inline: Vite would otherwise put every PNG under assetsInlineLimit (4 KB) into the chunk as
  // a data URI, and the small 補助標識 faces (79 of them) would load with the game whether shown or not.
  query: "?url&no-inline",
  import: "default",
});
const artworkUrl = (name: string) => ARTWORK[`../../assets/signs/textures/${name}.png`];

// Plates are modelled at their real size (60 cm circles, 80 cm triangles); each is drawn at its
// definition's displayScale (Design.scale: 1.25× for 規制・指示, 1.3× for 警戒, inside 別表第二
// 備考一(二)) so they read at game camera distances. Where they hang: src/signs/mount.ts.

const GAME_TABLE = gameTable as GameTable;

/** Plate meshes are named in signs.glb (PlateCircle, PlateDiamond, PlateRect120x90 …). */
type Shape = string;

/**
 * The artwork and plate of a placed sign (exported for tests/signRegistry.test.ts). Which number
 * and face a type shows is declared on the sign definitions (src/signs/defs `game`) and comes in
 * as assets/signs/game.json. Why not import the definitions or catalog.json: their names, notes
 * and figures would all land in the bundle (review I9).
 */
export function design(type: number, value: number, lanes?: readonly LaneDirection[][]): Design | null {
  const d = designFor(GAME_TABLE, type, value, lanes);
  const isUnrenderedLanes = d === null && type === SIGN.laneArrows && lanes !== undefined;
  if (isUnrenderedLanes) reportUnrenderedLanes(lanes);
  return d;
}

const reportedLanes = new Set<string>();
const reportedAux = new Set<string>();

/** Logs a 補助標識 with no face drawn ahead of time, once per wording (it is placed on every rebuild). */
function reportUndrawnAux(plate: AuxPlate): void {
  const key = auxKey(plate);
  if (reportedAux.has(key)) return;
  reportedAux.add(key);
  warn("sign_aux_undrawn", { sign: plate.sign, lines: plate.lines });
}

/** Logs a lane pattern with no pre-rendered plate, once per pattern (it is placed on every rebuild). */
function reportUnrenderedLanes(lanes: readonly LaneDirection[][]): void {
  const key = laneKey(lanes);
  if (reportedLanes.has(key)) return;
  reportedLanes.add(key);
  warn("sign_lanes_unrendered", { lanes: key, count: lanes.length });
}

/** A plate of signs.glb. */
type Part = { face: BufferGeometry; back: BufferGeometry; backMaterial: Material };
/** The member roles drawn from signs.glb (src/signs/mount.ts MEMBER_NODES); the rest are guide_signs.glb's. */
const SIGN_ROLES = MEMBER_ROLES.filter((r) => MEMBER_NODES[r].glb === "signs");
type Kit = { plate: (shape: Shape) => Part | null; members: Partial<Record<MemberRole, Mesh>> };
let kit: Kit | null = null;

/** Loads signs.glb (plates and the unit members) once; TrafficSigns needs it to have resolved. */
export async function loadSignModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/signs.glb`);
  const meshOf = (name: string, material?: string): Mesh => {
    const found: Mesh[] = [];
    gltf.scene.getObjectByName(name)?.traverse((o) => {
      const isMatch = o instanceof Mesh && (!material || (o.material as Material).name === material);
      if (isMatch) found.push(o);
    });
    if (!found[0]) throw new Error(`signs.glb has no ${name}/${material ?? "*"}`);
    return found[0];
  };
  const part = (name: Shape): Part => {
    const back = meshOf(name, "SignBack");
    return {
      face: meshOf(name, "SignFace").geometry,
      back: back.geometry,
      backMaterial: back.material as Material,
    };
  };
  const plates = new Map<Shape, Part | null>();
  kit = {
    // Any plate node in signs.glb, loaded on first use (a missing one draws nothing).
    plate: (shape) => {
      if (!plates.has(shape)) {
        try {
          plates.set(shape, part(shape));
        } catch {
          plates.set(shape, null);
        }
      }
      return plates.get(shape) ?? null;
    },
    members: Object.fromEntries(SIGN_ROLES.map((r) => [r, meshOf(MEMBER_NODES[r].node)])),
  };
}

/**
 * The plates' faces: two FaceLayerPools (signFaces.ts) under one SignFaceMaterial. The artwork
 * (512–1024 px PNGs) is resampled into 256 px layers, and into 512 px layers for the 90 cm boards
 * (327 series, drawn at 1024 px): at 10 m a 75 cm plate is ~110 px high on a 720 px screen.
 * 104 + 17 layers (layer 0 of each is the stand-in) are 36.4 + 23.8 MB with mipmaps; with the
 * 案内標識's 28.8 MB, 89.0 MB of faces,
 * inside the design's 96 MB. A rebuild at 丸の内 wanted 37 plates and 16 boards (the 327の7 lane
 * patterns: 8 layers were short).
 * Why 256 and not the PNGs' 512: 128 layers of 512 would be 179 MB alone.
 */
const SMALL_LAYERS = 104;
const LARGE_LAYERS = 17;
/** A plate this wide or high (mm) takes a large layer: the 90 cm boards. */
const LARGE_PLATE_MM = 900;
/** Faces uploaded per frame, per pool (the decodes run off the main thread). */
const UPLOADS_PER_FRAME = 2;

type Faces = { small: FaceLayerPool; large: FaceLayerPool; material: SignFaceMaterial };
let signFaces: Faces | null = null;
/** Made on first use: the pools need the renderer (bound by main.ts); tests never build faces. */
function faces(): Faces {
  if (signFaces) return signFaces;
  const transparent: [number, number, number, number] = [0, 0, 0, 0];
  const small = new FaceLayerPool({
    name: "plates",
    size: 256,
    layers: SMALL_LAYERS,
    anisotropy: 4,
    standIn: transparent,
  });
  const large = new FaceLayerPool({
    name: "boards",
    size: 512,
    layers: LARGE_LAYERS,
    anisotropy: 4,
    standIn: transparent,
  });
  const material = new SignFaceMaterial({
    small: small.texture,
    large: { texture: large.texture, base: SMALL_LAYERS },
    baseGlow: BASE_GLOW.value.plates,
    alphaTest: 0.5,
  });
  signFaces = { small, large, material };
  return signFaces;
}

const isLargePlate = (shape: Shape): boolean => {
  const plate = PLATES[shape as keyof typeof PLATES] as (typeof PLATES)[keyof typeof PLATES] | undefined;
  return plate !== undefined && Math.max(...plateBoxMm(plate)) >= LARGE_PLATE_MM;
};

/** The face geometry of each plate shape (its mesh's `faceLayer` is attachFaceLayers'). */
const faceGeometries = new Map<Shape, BufferGeometry>();
function faceGeometry(shape: Shape, face: BufferGeometry): BufferGeometry {
  let g = faceGeometries.get(shape);
  if (g) return g;
  // A clone: the attribute is this shape's alone, the glb's geometry stays as loaded.
  g = face.clone();
  faceGeometries.set(shape, g);
  return g;
}

/**
 * The face mesh of one plate shape: the artwork each instance shows, the item it draws (its post's
 * foot ranks the artwork by distance; a hidden column's faces do not count) and its pool.
 */
type FaceMesh = { mesh: InstancedMesh; files: string[]; items: Item[]; large: boolean };

/**
 * One column of a post as it stands: the instances drawing it and its colliders (to hide them
 * together), and where its feet stand (world, y = 0) for the building test.
 */
type ColumnState = {
  refs: Array<[InstancedMesh, number]>;
  colliders: RAPIER.Collider[];
  feet: Vector3[];
  hidden: boolean;
};
type Post = PostMount & {
  /** The plates as gathered (for debugPlates), before the mount split them into faces. */
  plates: Design[];
  auxOf: AuxPlate[][];
  /** By MountFace.column: a double post's columns are hidden one by one. */
  columns: ColumnState[];
  /** Every column hidden (inside buildings). */
  hidden: boolean;
};
/** One instance, the post it belongs to and the column it is drawn in (to hide it with that column). */
type Item = { post: Post; column: number; matrix: Matrix4 };

/**
 * A post as the review hooks read it (src/debug/privateViews.ts, through TrafficSigns.debugPlates):
 * where it stands, the plates gathered on it with their 補助標識, whether it is hidden, its mount
 * and the centre height of each plate above the ground (null: left off).
 */
export type PostDebug = {
  pos: Vector3;
  travel: Vector3;
  plates: Design[];
  auxOf: AuxPlate[][];
  hidden: boolean;
  kind: MountKind;
  plateHeights: Array<number | null>;
};

/**
 * The mount's frame in the world: origin at the foot on the ground, +x across toward the
 * carriageway (right of travel), +z toward the oncoming traffic (−travel). A turn about +Y by the
 * facing's yaw maps local +z onto the facing and local +x onto the right of travel, so the frame
 * is a plain rotation (no mirror).
 */
function mountFrame(post: Pick<PostMount, "pos" | "travel">, ground: number): Matrix4 {
  const facing = post.travel.clone().negate();
  const yaw = Math.atan2(facing.x, facing.z);
  return new Matrix4().compose(
    new Vector3(post.pos.x, ground, post.pos.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    new Vector3(1, 1, 1),
  );
}

/**
 * A post with its mount resolved: `pos` is the foot of the mount's frame (the post, or the signal
 * pole it shares), the faces look at traffic travelling along `travel`, and `designs` gives the
 * artwork of each of `mount.faces` (same index).
 */
export type PostMount = { pos: Vector3; travel: Vector3; mount: ResolvedMount; designs: Design[] };

/** Size of a face as drawn, m: the plate's texture box (plates.ts) at the design's scale. */
function drawnSize(d: Design): { width: number; height: number } {
  const plate = PLATES[d.shape as keyof typeof PLATES] as (typeof PLATES)[keyof typeof PLATES] | undefined;
  const [w, h] = plate ? plateBoxMm(plate) : [0, 0];
  return { width: (w / 1000) * d.scale, height: (h / 1000) * d.scale };
}
/** A 326-A drawn back to back, parallel to the street. */
const isParallel = (d: Design) => d.parallel && d.back !== undefined;

/**
 * Resolves one gathered post: on the signal pole it is given when its plates fit there (one
 * column under the arm), otherwise on its own post or two (src/signs/mount.ts). The plates hang
 * over the pavement (site "pavement": every game sign stands SIGN_KERB behind the kerb). A
 * 補助標識 with no face drawn ahead of time is left off with a warning, the plate above standing.
 * `isInRoad` (a point of the mount's frame, world) drops a column whose feet would stand in a
 * carriageway (the second column stands further from the kerb, maybe across a narrow pavement).
 */
export function mountPost(
  plan: PostPlan,
  pole: SignalPole | null = null,
  isInRoad: (p: Vector3) => boolean = () => false,
): PostMount {
  const auxOf = plan.plates.map((d, level) =>
    (plan.auxOf[level] ?? []).flatMap((plate) => {
      const aux = auxDesignFor(GAME_TABLE, plate, d.scale);
      if (aux) return [aux];
      reportUndrawnAux(plate);
      return [];
    }),
  );
  const plates = plan.plates.map((d, level) => ({
    ...drawnSize(d),
    parallel: isParallel(d),
    twoSided: d.bothFaces === true || isParallel(d),
    kerbSide: d.kerbSide === true,
    aux: auxOf[level].map(drawnSize),
  }));
  const designsOf = (m: ResolvedMount) =>
    m.faces.map((f) => (f.aux === null ? plan.plates[f.plate] : auxOf[f.plate][f.aux]));
  if (pole) {
    const shared = resolveMount({
      kind: "signal-share",
      site: "pavement",
      kerbM: pole.kerbM,
      armY: pole.armY,
      minBottomM: pole.minBottomM,
      plates,
    });
    const isFit = shared.dropped === 0;
    if (isFit)
      return { pos: pole.pos.clone(), travel: plan.travel, mount: shared, designs: designsOf(shared) };
  }
  const placement: MountPlacement = { kind: "single-post", site: "pavement", kerbM: SIGN_KERB.value, plates };
  let mount = resolveMount(placement);
  const frame = mountFrame(plan, 0);
  const columns = new Set(mount.feet.map((f) => f.column));
  for (const column of columns) {
    const isBlocked = mount.feet.some(
      (f) => f.column === column && isInRoad(new Vector3(f.x, 0, f.z).applyMatrix4(frame)),
    );
    if (isBlocked) mount = withoutColumn(mount, column);
  }
  return { pos: plan.pos, travel: plan.travel, mount, designs: designsOf(mount) };
}

/**
 * The signal pole each post shares, if any: within SIGNAL_SHARE_RADIUS, heads facing the same
 * traffic, one post per pole, the nearest pairs first (so a nearer post wins a pole over one
 * gathered earlier). Plates whose place means something (game.fixedPlace: 一時停止, 横断歩道) never
 * move to a pole.
 */
export function sharedPoles(
  plans: readonly PostPlan[],
  poles: readonly SignalPole[],
): Array<SignalPole | null> {
  const pairs: Array<{ plan: number; pole: SignalPole; d: number }> = [];
  for (const [i, plan] of plans.entries()) {
    const isMovable = plan.plates.every((d) => d.fixedPlace !== true);
    if (!isMovable) continue;
    for (const pole of poles) {
      const d = Math.hypot(pole.pos.x - plan.pos.x, pole.pos.z - plan.pos.z);
      const isCandidate = d < SIGNAL_SHARE_RADIUS.value && pole.travel.dot(plan.travel) > 0.9;
      if (isCandidate) pairs.push({ plan: i, pole, d });
    }
  }
  const out: Array<SignalPole | null> = plans.map(() => null);
  const taken = new Set<SignalPole>();
  for (const pair of pairs.toSorted((a, b) => a.d - b.d)) {
    const isFree = out[pair.plan] === null && !taken.has(pair.pole);
    if (!isFree) continue;
    out[pair.plan] = pair.pole;
    taken.add(pair.pole);
  }
  return out;
}

/** The plates for one traffic stream at one spot, before their mount is resolved (top to bottom). */
export type PostPlan = {
  pos: Vector3;
  travel: Vector3;
  plates: Design[];
  /** The 補助標識 of each plate (same index), hung right under it. */
  auxOf: AuxPlate[][];
};

/**
 * Gathers the plates of the placed signs into posts: 一時停止 first (the top plate where it shares
 * a post), then the regulation signs, then 横断歩道 at both kerb ends of crossings without signals.
 * Plates for the same traffic within 2 m share a post, three at most. One step per sign, so the
 * rebuild can spread it over frames.
 */
export function* gatherPostSteps(
  graph: RoadGraph,
  regs: AppliedRegulations,
  approaches: Approach[],
  posts: PostPlan[],
): Generator<void> {
  const add = (pos: Vector3, travel: Vector3, d: Design | null, aux: AuxPlate[] = []) => {
    if (!d) return;
    // Never in another road's carriageway (junctions, the far side of a narrow crossing).
    if (graph.carriagewaysAt(pos, 0.3).length > 0) return;
    // Several plates for the same traffic at (nearly) the same spot share one post.
    const post = posts.find((p) => p.pos.distanceTo(pos) < 2 && p.travel.dot(travel) > 0.7);
    if (!post) {
      posts.push({ pos, travel, plates: [d], auxOf: [aux] });
      return;
    }
    const isNewPlate = !post.plates.some((x) => x.file === d.file) && post.plates.length < 3;
    if (!isNewPlate) return;
    post.plates.push(d);
    post.auxOf.push(aux);
  };
  const kerb = SIGN_KERB.value;
  for (const ap of approaches) {
    yield;
    if (ap.kind !== "stop") continue;
    const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5);
    add(mid.add(leftOf(ap.travel, ap.seg.line.width / 2 + kerb)), ap.travel, design(SIGN.stop, 0));
  }
  for (const s of regs.signs) {
    add(s.pos, s.travel, design(s.type, s.value, s.lanes), s.aux);
    yield;
  }
  const signalStops = approaches.filter((a) => a.kind === "signal");
  for (const c of regs.crossings) {
    yield;
    const isSignalled = signalStops.some(
      (a) => a.a.clone().add(a.b).multiplyScalar(0.5).distanceTo(c.pos) < 30,
    );
    if (isSignalled) continue;
    // One post at each kerb end of the crossing, facing the traffic that keeps to that side.
    const seg = c.seg;
    const { dir: along } = graph.sample(seg, c.s);
    for (const side of [1, -1]) {
      const travel = along.clone().multiplyScalar(seg.oneway === 0 ? side : seg.oneway);
      const offset = leftOf(along, side * (seg.line.width / 2 + kerb));
      add(c.pos.clone().add(offset), travel, design(SIGN.crosswalk, 0));
    }
  }
}

/** gatherPostSteps all at once (tests). */
export function gatherPosts(graph: RoadGraph, regs: AppliedRegulations, approaches: Approach[]): PostPlan[] {
  const posts: PostPlan[] = [];
  for (const _ of gatherPostSteps(graph, regs, approaches, posts)) {
    /* run to the end */
  }
  return posts;
}

/** Columns hidden inside buildings since the last rebuild, by what they belonged to. */
type HiddenCounts = { single: number; doubleFirst: number; doubleSecond: number; doubleWhole: number };

/**
 * 道路標識 posts where JARTIC puts them (sections' starts and repeats, junction approaches,
 * one-way exits, 一時停止), plus 横断歩道 signs at crossings without signals. Plates, posts and
 * brackets come from scripts/blender/signs.py; artwork from scripts/textures/sign_textures.py.
 */
export class TrafficSigns {
  private meshes: InstancedMesh[] = [];
  private readonly instances = new RoadInstances();

  private posts: Post[] = [];
  private body: RAPIER.RigidBody | null = null;
  private lastCheck = 0;
  private hiddenCounts: HiddenCounts = { single: 0, doubleFirst: 0, doubleSecond: 0, doubleWhole: 0 };
  private readonly reportedRoles = new Set<MemberRole>();
  private faceMeshes: FaceMesh[] = [];
  /** The pools' versions the face layers were last written for. */
  private layerVersions: [number, number] = [-1, -1];
  private lastFocus: Vector3 | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
    private readonly isOpen: (x: number, z: number, groundY: number) => boolean,
  ) {}

  /**
   * `poles` are the 車両用 signal poles standing now (TrafficControl.signalPoles, built first):
   * posts near one hang their plates on it.
   */
  rebuild(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null,
    approaches: Approach[],
    poles: readonly SignalPole[] = [],
  ): void {
    for (const _ of this.rebuildSteps(graph, regs, approaches, poles)) {
      /* synchronous compatibility path */
    }
  }

  rebuildAsync(
    graph: RoadGraph,
    regs: AppliedRegulations | null,
    approaches: Approach[],
    poles: readonly SignalPole[],
    work: FrameWork,
  ): Promise<void> {
    return work.run(this.rebuildSteps(graph, regs, approaches, poles));
  }

  private *rebuildSteps(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null,
    approaches: Approach[],
    poles: readonly SignalPole[],
  ): Generator<void | boolean> {
    this.clear(true);
    if (!graph || !regs || !kit) {
      this.instances.end();
      return;
    }
    const plans: PostPlan[] = [];
    yield* gatherPostSteps(graph, regs, approaches, plans);
    const shared = sharedPoles(plans, poles);
    const isInRoad = (p: Vector3) => graph.carriagewaysAt(p, 0.3).length > 0;
    const posts: Post[] = [];
    for (const [i, plan] of plans.entries()) {
      const mounted = mountPost(plan, shared[i], isInRoad);
      const count = Math.max(1, ...mounted.mount.feet.map((f) => f.column + 1));
      const columns = Array.from({ length: count }, () => ({
        refs: [],
        colliders: [],
        feet: [],
        hidden: false,
      }));
      posts.push({ ...mounted, plates: plan.plates, auxOf: plan.auxOf, columns, hidden: false });
      const checkpoint = i % 64 === 0;
      if (checkpoint) yield;
    }
    yield* this.build(posts, kit);
    this.instances.end();
  }

  count(): number {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }

  /** Feet of the posts standing now (the 案内標識 keep clear of them). */
  postPositions(): Vector3[] {
    return this.posts.filter((p) => !p.hidden).map((p) => p.pos.clone());
  }

  /** The posts standing now, read-only, for the review hooks (src/debug/viewHooks.ts). */
  debugPlates(): PostDebug[] {
    return this.posts.map((p) => ({
      pos: p.pos.clone(),
      travel: p.travel.clone(),
      plates: p.plates,
      auxOf: p.auxOf,
      hidden: p.hidden,
      kind: p.mount.kind,
      plateHeights: p.plates.map(
        (_, level) => p.mount.faces.find((f) => f.plate === level && f.aux === null)?.y ?? null,
      ),
    }));
  }

  reanchor(matrix: Matrix4, rotation: Quaternion): void {
    this.instances.reanchor(matrix);
    // The focus the faces were last ranked from moves with the frame (the next rank reads it).
    this.lastFocus?.applyMatrix4(matrix);
    for (const post of this.posts) {
      post.pos.applyMatrix4(matrix);
      post.travel.applyQuaternion(rotation);
      for (const c of post.columns) for (const foot of c.feet) foot.applyMatrix4(matrix).setY(0);
    }
    if (this.body) reanchorBody(this.body, matrix, rotation);
  }

  clear(reuse = false): void {
    if (reuse) this.instances.begin();
    else this.instances.clear();
    for (const m of this.meshes) this.scene.remove(m);
    this.meshes = [];
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
    this.posts = [];
    this.faceMeshes = [];
    this.hiddenCounts = { single: 0, doubleFirst: 0, doubleSecond: 0, doubleWhole: 0 };
  }

  /**
   * Building tiles stream in after the signs are placed, so posts near the player are re-tested
   * now and then; a column whose foot stands inside a building (the road is narrower than its GSI
   * 幅員) is hidden and loses its colliders, the other column of a double post still standing.
   * A post on a signal pole has no feet of its own and is not tested (the pole stays either way).
   *
   * Why per column and not the whole post: the second column stands 0.85–1.65 m further from the
   * kerb, and hiding the post with it took the first column (often 一時停止) away too (review W1).
   */
  update(focus: Vector3, now: number): void {
    this.pumpFaces();
    if (now - this.lastCheck < 2000) return;
    this.lastCheck = now;
    this.lastFocus = focus.clone();
    this.wantFaces(focus);
    const hide = new Matrix4().makeScale(0, 0, 0);
    let changed = false;
    for (const post of this.posts) {
      if (post.hidden || post.pos.distanceTo(focus) > 200) continue;
      for (const [k, column] of post.columns.entries()) {
        const isInside = column.feet.some((p) => {
          const ground = this.groundAt(p.x, p.z);
          return ground !== null && !this.isOpen(p.x, p.z, ground);
        });
        if (column.hidden || !isInside) continue;
        column.hidden = true;
        changed = true;
        for (const [mesh, i] of column.refs) {
          mesh.setMatrixAt(i, hide);
          mesh.instanceMatrix.needsUpdate = true;
        }
        for (const c of column.colliders) this.world.removeCollider(c, false);
        column.colliders = [];
        this.countHidden(post, k);
      }
      post.hidden = post.columns.every((c) => c.hidden);
    }
    if (changed) log("sign_columns_hidden", { ...this.hiddenCounts, posts: this.posts.length });
  }

  /** Every frame: decodes started, a few faces uploaded, and the layers re-read when one moved in. */
  private pumpFaces(): void {
    if (this.faceMeshes.length === 0) return;
    const { small, large } = faces();
    small.start();
    large.start();
    small.pump(UPLOADS_PER_FRAME);
    large.pump(UPLOADS_PER_FRAME);
    const isChanged = small.version !== this.layerVersions[0] || large.version !== this.layerVersions[1];
    if (isChanged) this.applyLayers();
  }

  private countHidden(post: Post, column: number): void {
    const isDouble = post.columns.length > 1;
    if (!isDouble) {
      this.hiddenCounts.single++;
      return;
    }
    if (column === 0) this.hiddenCounts.doubleFirst++;
    else this.hiddenCounts.doubleSecond++;
    const isWhole = post.columns.every((c) => c.hidden);
    if (isWhole) this.hiddenCounts.doubleWhole++;
  }

  private *build(posts: Post[], k: Kit): Generator<void | boolean> {
    // Faces by plate shape (one mesh each, any artwork), backs by shape, members by role.
    const facesByShape = new Map<Shape, { items: Item[]; files: string[] }>();
    const byShape = new Map<Shape, Item[]>();
    const byRole = new Map<MemberRole, Item[]>();
    const push = <K>(map: Map<K, Item[]>, key: K, item: Item) => {
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    };
    const pushFace = (d: Design, item: Item) => {
      const entry = facesByShape.get(d.shape) ?? { items: [], files: [] };
      facesByShape.set(d.shape, entry);
      entry.items.push(item);
      entry.files.push(d.file);
    };
    // Posts are solid: one fixed body carries a thin cylinder per foot (60.5 mm steel pipe).
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let dropped = 0;
    for (const [n, post] of posts.entries()) {
      const ground = this.groundAt(post.pos.x, post.pos.z) ?? 0;
      const frame = mountFrame(post, ground);
      const { mount } = post;
      dropped += mount.dropped;
      for (const [i, f] of mount.faces.entries()) {
        const d = post.designs[i];
        const local = (x: number, z: number, yaw: number) =>
          new Matrix4().compose(
            new Vector3(x, f.y, z),
            new Quaternion().setFromEuler(new Euler(f.pitch, yaw, 0, "YXZ")),
            new Vector3(d.scale, d.scale, d.scale),
          );
        const at = (m: Matrix4): Item => ({ post, column: f.column, matrix: frame.clone().multiply(m) });
        if (f.parallel && d.back) {
          // Face the carriageway (+x) and, back to back, the pavement.
          pushFace(d, at(local(f.x + f.standoff, f.z, Math.PI / 2)));
          pushFace({ ...d, file: d.back }, at(local(f.x - f.standoff, f.z, -Math.PI / 2)));
          continue;
        }
        const front = at(local(f.x, f.z + f.standoff, 0));
        pushFace(d, front);
        if (d.bothFaces) {
          pushFace(d, at(local(f.x, f.z - f.standoff, Math.PI)));
          continue;
        }
        push(byShape, d.shape, front);
      }
      for (const m of mount.members) {
        const isLoaded = k.members[m.role] !== undefined;
        if (!isLoaded) {
          this.reportUnloadedRole(m.role);
          continue;
        }
        const local = new Matrix4().compose(
          new Vector3(m.x, m.y, m.z),
          new Quaternion().setFromEuler(new Euler(m.pitch, 0, 0)),
          new Vector3(m.sx, m.sy, m.sz),
        );
        push(byRole, m.role, { post, column: m.column, matrix: frame.clone().multiply(local) });
      }
      for (const foot of mount.feet) {
        const p = new Vector3(foot.x, 0, foot.z).applyMatrix4(frame);
        const column = post.columns[foot.column];
        column.feet.push(p.clone().setY(0));
        const collider = RAPIER.ColliderDesc.cylinder(foot.height / 2, Math.max(foot.radius, 0.05))
          .setTranslation(p.x, p.y + foot.height / 2, p.z)
          .setCollisionGroups(PROP_GROUPS);
        column.colliders.push(this.world.createCollider(collider, this.body ?? undefined));
      }
      const checkpoint = n % 32 === 0;
      if (checkpoint) yield;
    }
    if (dropped > 0) warn("sign_faces_unmounted", { faces: dropped, posts: posts.length });
    log("sign_mounts_resolved", {
      posts: posts.length,
      double: posts.filter((p) => p.mount.kind === "double-post").length,
      shared: posts.filter((p) => p.mount.kind === "signal-share").length,
      faces: posts.reduce((n, p) => n + p.mount.faces.length, 0),
    });
    const { material } = faces();
    this.faceMeshes = [];
    for (const [shape, { items, files }] of facesByShape) {
      const plate = k.plate(shape);
      if (!plate) continue;
      // attachFaceLayers gives the mesh its `faceLayer` as it is taken, before it can be drawn.
      const mesh = this.instanced(faceGeometry(shape, plate.face), material, items, true, attachFaceLayers);
      // The review hooks read which artwork each instance shows (src/debug/privateViews.ts).
      mesh.userData.faceKeys = files;
      const face = { mesh, files, items, large: isLargePlate(shape) };
      this.faceMeshes.push(face);
      this.writeLayers(face);
      yield true;
    }
    for (const [shape, items] of byShape) {
      const plate = k.plate(shape);
      if (plate) this.instanced(plate.back, plate.backMaterial, items);
      yield true;
    }
    for (const [role, items] of byRole) {
      const mesh = k.members[role];
      if (!mesh) continue;
      // Small fittings cast no shadow worth its cost; the posts do.
      const isPost = role === "post";
      this.instanced(mesh.geometry, mesh.material as Material, items, isPost);
      yield true;
    }
    this.posts = posts;
    this.wantFaces(this.lastFocus);
    this.applyLayers();
    log("sign_faces_built", {
      pool: "plates",
      artworks: new Set(this.faceMeshes.flatMap((f) => f.files)).size,
      meshes: this.faceMeshes.length,
      instances: this.faceMeshes.reduce((n, f) => n + f.files.length, 0),
    });
  }

  /**
   * Asks the pools for the artworks standing now, nearest to `focus` first (each artwork by its
   * nearest face). A face not yet in shows the transparent stand-in.
   */
  private wantFaces(focus: Vector3 | null): void {
    if (this.faceMeshes.length === 0) return;
    const { small, large } = faces();
    const nearest = new Map<string, { d: number; large: boolean }>();
    for (const { files, items, large: isLarge } of this.faceMeshes) {
      for (const [i, file] of files.entries()) {
        // The post's foot, not the instance matrix: a hidden column's matrix is all zeros (its
        // position the origin, which would rank it nearest).
        const { post, column } = items[i];
        const isHidden = post.columns[column]?.hidden === true;
        if (isHidden) continue;
        const d = focus ? Math.hypot(post.pos.x - focus.x, post.pos.z - focus.z) : 0;
        const known = nearest.get(file);
        const isNearer = !known || d < known.d;
        if (isNearer) nearest.set(file, { d, large: isLarge });
      }
    }
    const want = (isLarge: boolean) =>
      new Map(
        [...nearest]
          .filter(([, n]) => n.large === isLarge)
          .map(([file, n]) => [file, { source: { url: artworkUrl(file) }, priority: n.d }]),
      );
    small.want(want(false));
    large.want(want(true));
  }

  /** Writes each face instance's layer (its artwork's, or 0 until it is in). */
  private applyLayers(): void {
    const { small, large } = faces();
    for (const face of this.faceMeshes) this.writeLayers(face);
    this.layerVersions = [small.version, large.version];
  }

  private writeLayers({ mesh, files, large: isLarge }: FaceMesh): void {
    const { small, large } = faces();
    const attribute = attachFaceLayers(mesh);
    for (const [i, file] of files.entries()) {
      const layer = isLarge
        ? large.has(file)
          ? SMALL_LAYERS + large.layerOf(file)
          : 0
        : small.layerOf(file);
      attribute.setX(i, layer);
    }
    attribute.needsUpdate = true;
  }

  /** Logs a member role with no signs.glb part (a guide_signs.glb role on a sign post), once per role. */
  private reportUnloadedRole(role: MemberRole): void {
    if (this.reportedRoles.has(role)) return;
    this.reportedRoles.add(role);
    warn("sign_member_unloaded", { role, glb: MEMBER_NODES[role].glb, node: MEMBER_NODES[role].node });
  }

  /** One instance per item, at the item's matrix, remembered by its post's column. */
  private instanced(
    geometry: BufferGeometry,
    material: Material,
    items: Item[],
    castShadow = true,
    prepare?: (mesh: InstancedMesh) => void,
  ): InstancedMesh {
    const mesh = this.instances.take(geometry, material, items.length, prepare);
    items.forEach(({ post, column, matrix }, i) => {
      mesh.setMatrixAt(i, matrix);
      post.columns[column]?.refs.push([mesh, i]);
    });
    mesh.castShadow = castShadow;
    this.add(mesh);
    return mesh;
  }

  private add(mesh: InstancedMesh): void {
    mesh.frustumCulled = false; // instances span the whole area
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }
}
