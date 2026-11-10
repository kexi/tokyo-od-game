import { reanchorBody } from "../physics/reanchor";
import {
  Euler,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
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

const faces = new Map<string, MeshStandardMaterial>();
const textureLoader = new TextureLoader();
function faceMaterial(file: string): MeshStandardMaterial {
  let m = faces.get(file);
  if (m) return m;
  const map = textureLoader.load(artworkUrl(file));
  map.colorSpace = SRGBColorSpace;
  map.flipY = false; // glTF UV convention: v runs down the image, as GLTFLoader's own textures
  map.anisotropy = 4;
  // Retroreflective sheeting: a little self-illumination keeps plates legible at night.
  m = new MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: 0xffffff,
    emissiveIntensity: 0.18,
    roughness: 0.45,
    alphaTest: 0.5,
  });
  faces.set(file, m);
  return m;
}

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
    if (now - this.lastCheck < 2000) return;
    this.lastCheck = now;
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
    const byFile = new Map<string, { d: Design; items: Item[] }>();
    const byShape = new Map<Shape, Item[]>();
    const byRole = new Map<MemberRole, Item[]>();
    const push = <K>(map: Map<K, Item[]>, key: K, item: Item) => {
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    };
    const faceItem = (key: Design) => {
      const entry = byFile.get(key.file) ?? { d: key, items: [] };
      byFile.set(key.file, entry);
      return entry.items;
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
          faceItem(d).push(at(local(f.x + f.standoff, f.z, Math.PI / 2)));
          faceItem({ ...d, file: d.back }).push(at(local(f.x - f.standoff, f.z, -Math.PI / 2)));
          continue;
        }
        const front = at(local(f.x, f.z + f.standoff, 0));
        faceItem(d).push(front);
        if (d.bothFaces) {
          faceItem(d).push(at(local(f.x, f.z - f.standoff, Math.PI)));
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
    for (const { d, items } of byFile.values()) {
      const plate = k.plate(d.shape);
      if (plate) this.instanced(plate.face, faceMaterial(d.file), items).userData.key = d.file;
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
  ): InstancedMesh {
    const mesh = this.instances.take(geometry, material, items.length);
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
