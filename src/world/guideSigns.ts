import { reanchorBody } from "../physics/reanchor";
import {
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { LocalFrame } from "../geo/frame";
import { latToTileY, lonToTileX } from "../geo/tiles";
import { log, warn } from "../log";
import { PROP_GROUPS } from "../physics/groups";
import { drawBoard, layoutGuideBoard, loadGuideFonts } from "./guideArt";
import type { BoardLayout } from "../signs/board/boxes";
import { boardKey, boardNames, type BoardContent } from "../signs/board/content";
import { keepValidBoards } from "../signs/board/layout";
import { BoardFacePool, TEXTURE_PX, type BoardFace } from "./boardFacePool";
import { planRowSteps, type SignalArm } from "./guideRows";
import {
  localDests,
  localPlaces,
  matchRouteSteps,
  planGuideSteps,
  type GuideApproach,
  type GuideName,
  type GuidePlace,
  type GuidePlan,
  type PlaceRow,
  type RouteInfo,
  type RouteTile,
} from "./guidePlan";
import type { AppliedRegulations } from "./regulations";
import type { RoadGraph } from "./roads";
import type { Approach } from "./trafficControl";
import { sharedDraco } from "../render/draco";
import { MEMBER_NODES, resolveMount, type MemberRole } from "../signs/mount";
import { GUIDE_POLE_KERB } from "../signs/mountAssumptions";
import { RoadInstances } from "./roadInstances";
import { FrameWork } from "../game/frameWork";
import { attachFaceLayers } from "./signFaceMaterial";

/**
 * 案内標識 on the streets around the player: the 108 series planned by guidePlan.ts and the 105・106
 * by guideRows.ts from the road graph, the OSM route numbers and destinations (public/data/routes)
 * and the 表示地名 (public/data/guide-places.json); poles, arms and boards from
 * scripts/blender/guide_signs.py; faces laid out by src/signs/board/ and drawn by guideArt.ts.
 *
 * Cost: every part is one InstancedMesh, and the board faces too: one SignFaceMaterial
 * (signFaceMaterial.ts) over the BoardFacePool (boardFacePool.ts), each board's layer an instance
 * attribute. Only the most wanted boards (apparent size × facing, ≤ NEAR_COUNT within NEAR_RANGE)
 * show their drawn face; the rest show layer 0, the plain blue far face. The pool keeps 32 faces
 * across rebuilds (the least recently wanted goes first). Why not a texture per board for all of
 * them: 100 boards at 512 px are ~110 MB of GPU memory with mipmaps, and beyond ~400 m the letters
 * are a few pixels high anyway. Why not a Mesh and material per near board (before G3): 24 more
 * draw calls and materials, and the faces could not share the plates' headlamp return.
 */

const ROUTE_ZOOM = 14;
const ROAD_ZOOM = 16;
// Heights, the 3° lean and the gap to the pole: src/signs/mount.ts (片持式 cantilever-f, 路側式
// double-post on the pavement, 2.5 m).

type Part = { geometry: BufferGeometry; material: Material };
type Kit = {
  pole: Part[];
  arm: Part[];
  flange: Part[];
  post: Part[];
  face: BufferGeometry;
  back: Part;
};

/** A board as the review hooks see it (GuideSigns.debugTargets). */
export type GuideTargetView = {
  kind: string;
  pos: Vector3;
  normal: Vector3;
  width: number;
  height: number;
  letterCm: number;
  mount: "overhead" | "roadside";
  before: number;
  bottomM: number;
  hidden: boolean;
  /** The layer it shows (0: the plain far face). */
  layer: number;
  names: string[];
};

/** A placed board of any number (108 from guidePlan.ts, 105・106 from guideRows.ts). */
type Placed = GuidePlan<BoardContent>;

type Sign = {
  plan: Placed;
  layout: BoardLayout;
  key: string;
  /** Board centre and orientation (the face's matrix), for the near face mesh. */
  board: Matrix4;
  /** Where the pole or the posts stand, tested against the buildings. */
  feet: Vector3[];
  refs: Array<[InstancedMesh, number]>;
  faceIndex: number;
  colliders: RAPIER.Collider[];
  /** Showing its drawn face (one of the nearest). */
  isNear: boolean;
  hidden: boolean;
};

/** Placement of a part: at p, turned rotY about +Y, then leaning `pitch` about its own X. */
const at = (p: Vector3, rotY: number, scale: Vector3, pitch = 0) =>
  new Matrix4().compose(p, new Quaternion().setFromEuler(new Euler(pitch, rotY, 0, "YXZ")), scale);

let boardFaces: BoardFacePool | null = null;
/** Made on first use (the pool's uploads need the renderer, bound by main.ts). */
function faces(): BoardFacePool {
  boardFaces ??= new BoardFacePool();
  return boardFaces;
}

export class GuideSigns {
  plans: Placed[] = [];
  private signs: Sign[] = [];
  private kit: Kit | null = null;
  private places: PlaceRow[] | null = null;
  private meshes: InstancedMesh[] = [];
  private readonly instances = new RoadInstances();
  private faces: InstancedMesh | null = null;
  /** The board face geometry with this class's `faceLayer` instance attribute. */
  private faceGeometry: BufferGeometry | null = null;
  private layerVersion = -1;
  private body: RAPIER.RigidBody | null = null;
  private readonly tiles = new Map<string, Promise<RouteTile | null>>();
  /**
   * The OSM route numbers and street names matched to the graph's segments and the junction names
   * (signals and junction=yes), for the nav panel's road line and 交差点名. Null until the route
   * tiles of the current graph are in.
   */
  roadInfo: { graph: RoadGraph; routes: Map<number, RouteInfo>; names: GuideName[] } | null = null;
  private index: Promise<Set<string>> | null = null;
  private generation = 0;
  private lastUpdate = 0;
  private lastCheck = 0;
  private ready: Promise<void>;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
    private readonly isOpen: (x: number, z: number, groundY: number) => boolean,
  ) {
    this.ready = Promise.all([this.loadModel(), this.loadPlaces(), loadGuideFonts()])
      .then(() => undefined)
      .catch((error: unknown) => warn("guide_signs_load_failed", { error: String(error) }));
  }

  private async loadModel(): Promise<void> {
    const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/guide_signs.glb`);
    gltf.scene.updateMatrixWorld(true);
    const part = (name: string): Part[] => {
      const o = gltf.scene.getObjectByName(name);
      if (!o) throw new Error(`guide_signs.glb has no ${name}`);
      const out: Part[] = [];
      o.traverse((m) => {
        const mesh = m as Mesh;
        if (!mesh.isMesh) return;
        // The parts are modelled at the origin; bake their node transform (the root's identity).
        out.push({
          geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
          material: mesh.material as Material,
        });
      });
      return out;
    };
    const board = part("GuideBoard");
    const face = board.find((p) => p.material.name === "GuideFace");
    const back = board.find((p) => p.material.name === "GuideBack");
    if (!face || !back) throw new Error("guide_signs.glb: GuideBoard lacks its face or back");
    // The part sizes the layout uses are src/signs/mountAssumptions.ts MEMBER_SIZES (checked against
    // guide_signs.py by tests/signMount.test.ts), not the glb's extras.
    this.kit = {
      pole: part("GuidePole"),
      arm: part("GuideArm"),
      flange: part("GuideFlange"),
      post: part("GuidePost"),
      face: face.geometry,
      back,
    };
  }

  private async loadPlaces(): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}data/guide-places.json`);
    const data = res.ok ? ((await res.json()) as { places?: PlaceRow[] }) : {};
    this.places = data.places ?? [];
  }

  /** OSM route tiles over the 3×3 z16 road area around a point (z14, de-duplicated). */
  private async routesAround(lat: number, lon: number): Promise<RouteTile> {
    this.index ??= fetch(`${import.meta.env.BASE_URL}data/routes/meta.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ tiles?: string[] }>) : { tiles: [] }))
      .then((m) => new Set<string>(m.tiles ?? []))
      .catch(() => new Set<string>());
    const index = await this.index;
    const shift = 2 ** (ROAD_ZOOM - ROUTE_ZOOM);
    const cx = Math.floor(lonToTileX(lon, ROAD_ZOOM));
    const cy = Math.floor(latToTileY(lat, ROAD_ZOOM));
    const keys = new Set<string>();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        keys.add(`${Math.floor((cx + dx) / shift)}-${Math.floor((cy + dy) / shift)}`);
    const out: RouteTile = { roads: [], dests: [], names: [] };
    const seen = new Set<string>();
    const tiles = await Promise.all([...keys].filter((k) => index.has(k)).map((k) => this.tile(k)));
    for (const t of tiles) {
      if (!t) continue;
      for (const k of ["roads", "dests", "names"] as const)
        for (const item of t[k] as unknown[]) {
          // Lines crossing a tile edge are stored in every tile they touch.
          const id = `${k}:${JSON.stringify(item)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          (out[k] as unknown[]).push(item);
        }
    }
    return out;
  }

  private tile(key: string): Promise<RouteTile | null> {
    let p = this.tiles.get(key);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}data/routes/${key}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<RouteTile>) : null))
        .catch((error: unknown) => {
          warn("route_tile_failed", { key, error: String(error) });
          this.tiles.delete(key);
          return null;
        });
      this.tiles.set(key, p);
    }
    return p;
  }

  /**
   * Plan and stand the signs for a new road graph (also after the frame is re-anchored). The
   * route tiles load first; a newer rebuild started meanwhile wins.
   */
  rebuild(
    graph: RoadGraph | null,
    frame: LocalFrame,
    approaches: Approach[],
    regs: AppliedRegulations | null,
    centre: { lat: number; lon: number },
    avoid: Vector3[],
    work = new FrameWork(),
    signalArms: SignalArm[] = [],
  ): Promise<void> {
    const generation = ++this.generation;
    this.clear(true);
    if (!graph) {
      this.instances.end();
      return Promise.resolve();
    }
    const guideApproaches: GuideApproach[] = approaches
      .filter((a) => a.kind === "signal" && a.controller)
      .map((a) => ({ seg: a.seg, dir: a.dir, at: a.at, travel: a.travel, nodes: a.controller?.nodes ?? [] }));
    return Promise.all([this.ready, this.routesAround(centre.lat, centre.lon)]).then(async ([, data]) => {
      if (generation !== this.generation) return;
      const routes = await work.run(matchRouteSteps(graph, data.roads, frame));
      await work.yield();
      const names: GuideName[] = [
        ...(regs?.junctionNames ?? []).map((n) => ({ ja: n.name, en: n.en, pos: n.pos.clone().setY(0) })),
        ...data.names.map(([lon, lat, ja, en]) => ({
          ja,
          en,
          pos: frame.toLocal(lat, lon, frame.origin.h).setY(0),
        })),
      ];
      // The nav panel reads them too, even when the boards' model or places failed to load.
      this.roadInfo = { graph, routes, names };
      if (!this.kit || !this.places) {
        this.instances.end();
        return;
      }
      const places: GuidePlace[] = localPlaces(this.places, frame);
      const crossings = (regs?.crossings ?? []).map((c) => c.pos);
      const started = performance.now();
      const planInput = {
        graph,
        approaches: guideApproaches,
        routes,
        places,
        names,
        dests: localDests(data.dests, frame),
        avoid: [...avoid, ...crossings],
      };
      const junctionBoards = await work.run(planGuideSteps(planInput));
      await work.yield();
      // 105・106 after every 108: the 108 boards keep the places they had before G5.
      const rowBoards = await work.run(planRowSteps({ ...planInput, placed: junctionBoards, signalArms }));
      this.plans = [...junctionBoards, ...rowBoards];
      await work.yield();
      await work.run(this.build(this.kit));
      this.instances.end();
      log("guide_signs_placed", {
        signs: this.plans.length,
        advance: junctionBoards.filter((p) => p.board.distance !== null).length,
        direction: rowBoards.filter((p) => p.board.kind.startsWith("105")).length,
        confirm: rowBoards.filter((p) => p.board.kind === "106-A").length,
        overhead: this.plans.filter((p) => p.mount === "overhead").length,
        routed: routes.size,
        mapped: data.dests.length,
        durationMs: Math.round(performance.now() - started),
      });
    });
  }

  count(): number {
    return this.signs.length;
  }

  /**
   * Dev (scripts/qa/guideBoards.ts, the review): each plan's face drawn now at the layer's width,
   * and the pool's budget and use.
   */
  /**
   * Dev (the review's `guide` targets, src/debug/viewHooks.ts): every standing board's face as
   * drawn now — its centre and normal from the face's instance matrix, size, number, mount, the
   * layer it shows and the height of its lower edge.
   */
  debugTargets(): GuideTargetView[] {
    const pool = faces();
    return this.signs.map((s) => {
      const pos = new Vector3().setFromMatrixPosition(s.board);
      const normal = new Vector3(0, 0, 1).transformDirection(s.board).setY(0).normalize();
      const ground = this.groundAt(s.plan.pos.x, s.plan.pos.z) ?? 0;
      const h = s.layout.height / 100;
      return {
        kind: s.plan.board.kind,
        pos,
        normal,
        width: s.layout.width / 100,
        height: h,
        letterCm: s.plan.board.letter,
        mount: s.plan.mount,
        before: s.plan.before,
        bottomM: pos.y - h / 2 - ground,
        hidden: s.hidden,
        layer: s.isNear ? pool.layerOf(s.key) : 0,
        names: boardNames(s.plan.board).map((n) => n.ja),
      };
    });
  }

  debugBoards() {
    const pool = faces();
    return {
      plans: this.plans,
      draw: (i: number) => drawBoard(layoutGuideBoard(this.plans[i].board), TEXTURE_PX),
      layout: (i: number) => layoutGuideBoard(this.plans[i].board),
      usage: pool.usage(),
      stats: { ...pool.stats, stepMs: [...pool.stats.stepMs] },
    };
  }

  reanchor(matrix: Matrix4, rotation: Quaternion, graph: RoadGraph): void {
    this.instances.reanchor(matrix);
    const shiftedCentres = new Set<Vector3>();
    for (const sign of this.signs) {
      sign.plan.pos.applyMatrix4(matrix);
      if (!shiftedCentres.has(sign.plan.centre)) {
        shiftedCentres.add(sign.plan.centre);
        sign.plan.centre.applyMatrix4(matrix);
      }
      sign.plan.travel.applyQuaternion(rotation);
      sign.board.premultiply(matrix);
      for (const foot of sign.feet) foot.applyMatrix4(matrix);
    }
    if (this.roadInfo) {
      this.roadInfo.graph = graph;
      for (const name of this.roadInfo.names) name.pos.applyMatrix4(matrix);
    }
    if (this.body) reanchorBody(this.body, matrix, rotation);
  }

  clear(reuse = false): void {
    if (reuse) this.instances.begin();
    else this.instances.clear();
    for (const m of this.meshes) {
      this.scene.remove(m);
    }
    this.meshes = [];
    this.faces = null;
    this.signs = [];
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
  }

  /**
   * Drawn faces for the most wanted boards, the far face for the rest; and, every 2 s, signs near
   * the player that stand inside a building (GSI 幅員 wider than the street) are hidden. The pool
   * uploads a couple of faces a frame and draws a board per FrameWork step, yielding once 4 ms are
   * spent (one board's step can take longer: boardFacePool.ts); the boards are
   * asked for every 500 ms, weighed as seen from `eye` (the camera: what is on the screen; the
   * building check stays round `focus`, the player).
   */
  update(focus: Vector3, now: number, eye: Vector3 = focus): void {
    if (!this.faces) return;
    const pool = faces();
    pool.frame();
    if (pool.version !== this.layerVersion) this.applyLayers();
    if (now - this.lastUpdate < 500) return;
    this.lastUpdate = now;
    const boards: BoardFace[] = [];
    for (const s of this.signs) {
      if (s.hidden) continue;
      boards.push(this.faceOf(s));
    }
    const wanted = pool.want(boards, eye);
    for (const s of this.signs) s.isNear = !s.hidden && wanted.has(s.key);
    this.applyLayers();
    if (now - this.lastCheck < 2000) return;
    this.lastCheck = now;
    for (const s of this.signs) {
      if (s.hidden || Math.hypot(s.plan.pos.x - focus.x, s.plan.pos.z - focus.z) > 200) continue;
      const isInside = s.feet.some((f) => {
        const g = this.groundAt(f.x, f.z);
        return g !== null && !this.isOpen(f.x, f.z, g);
      });
      if (isInside) this.hide(s);
    }
  }

  /** A sign as the pool weighs it: the face's centre and normal, its width. */
  private faceOf(s: Sign): BoardFace {
    const pos = new Vector3().setFromMatrixPosition(s.board);
    return {
      key: s.key,
      layout: s.layout,
      pos,
      normal: s.plan.travel.clone().negate(),
      width: s.layout.width / 100,
      level: 0,
    };
  }

  /** Each board's layer: its drawn face when it is near and the face is in, else the far face (0). */
  private applyLayers(): void {
    const mesh = this.faces;
    if (!mesh) return;
    const pool = faces();
    const attribute = attachFaceLayers(mesh);
    for (const s of this.signs) attribute.setX(s.faceIndex, s.isNear ? pool.layerOf(s.key) : 0);
    attribute.needsUpdate = true;
    this.layerVersion = pool.version;
  }

  private hide(s: Sign): void {
    s.hidden = true;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const [mesh, i] of s.refs) {
      mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    s.isNear = false;
    for (const c of s.colliders) this.world.removeCollider(c, false);
    s.colliders = [];
  }

  private *build(k: Kit): Generator<boolean> {
    const poles: Matrix4[] = [];
    const arms: Matrix4[] = [];
    const flanges: Matrix4[] = [];
    const posts: Matrix4[] = [];
    const boards: Matrix4[] = [];
    const owners: Array<{ list: Matrix4[]; sign: number }> = [];
    // The guide_signs.glb roles this class draws (src/signs/mount.ts MEMBER_NODES).
    const lists: Partial<Record<MemberRole, Matrix4[]>> = {
      pole: poles,
      arm: arms,
      flange: flanges,
      boardPost: posts,
    };
    const reported = new Set<MemberRole>();
    const reportUnloadedRole = (role: MemberRole) => {
      if (reported.has(role)) return;
      reported.add(role);
      warn("sign_member_unloaded", { role, glb: MEMBER_NODES[role].glb, node: MEMBER_NODES[role].node });
    };
    // The boundary between the planners and the boards: a content that fails the schema is not
    // stood up (and the log says why), so the layout and the drawing only see checked contents.
    this.plans = keepValidBoards(this.plans, (plan, issues) =>
      warn("guide_board_invalid", { kind: String(plan.board.kind), issues }),
    );
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.signs = this.plans.map((plan, index) => {
      const layout = layoutGuideBoard(plan.board);
      const w = layout.width / 100;
      const h = layout.height / 100;
      const ground = this.groundAt(plan.pos.x, plan.pos.z) ?? 0;
      const facing = plan.travel.clone().negate(); // the face looks at the oncoming traffic
      const yaw = Math.atan2(facing.x, facing.z);
      const sign: Sign = {
        plan,
        layout,
        key: boardKey(plan.board),
        board: new Matrix4(),
        feet: [plan.pos.clone()],
        refs: [],
        faceIndex: index,
        colliders: [],
        isNear: false,
        hidden: false,
      };
      const add = (list: Matrix4[], m: Matrix4) => {
        list.push(m);
        owners.push({ list, sign: index });
      };
      // The mount's frame (src/signs/mount.ts): +x across toward the carriageway, +z toward the
      // oncoming traffic; turning by the facing's yaw maps local +x onto `across`.
      const frame = at(new Vector3(plan.pos.x, ground, plan.pos.z), yaw, new Vector3(1, 1, 1));
      const local = (x: number, y: number, z: number, scale: Vector3, pitch = 0) =>
        frame.clone().multiply(at(new Vector3(x, y, z), 0, scale, pitch));
      // 片持式 over the road; 路側式 (a road administrator's sign: 道路標識設置基準) on two posts over
      // the pavement, the board 25 cm behind the kerb.
      const mount =
        plan.mount === "overhead"
          ? resolveMount({ kind: "cantilever-f", board: { width: w, height: h } })
          : resolveMount({
              kind: "double-post",
              site: "pavement",
              authority: "road",
              support: "guide",
              kerbM: GUIDE_POLE_KERB.value,
              plates: [{ width: w, height: h, twoSided: true }],
            });
      for (const m of mount.members) {
        const list = lists[m.role];
        if (!list) {
          reportUnloadedRole(m.role);
          continue;
        }
        // A post reaches from its own ground to the board's top (the frame stands on `ground`).
        const p = new Vector3(m.x, 0, m.z).applyMatrix4(frame);
        const lift = m.role === "boardPost" ? ground - (this.groundAt(p.x, p.z) ?? ground) : 0;
        add(list, local(m.x, m.y - lift, m.z, new Vector3(m.sx, m.sy + lift, m.sz)));
      }
      sign.feet = [];
      for (const foot of mount.feet) {
        const p = new Vector3(foot.x, 0, foot.z).applyMatrix4(frame);
        const pg = this.groundAt(p.x, p.z) ?? ground;
        sign.feet.push(p.clone().setY(0));
        const height = foot.height + (ground - pg);
        const collider = RAPIER.ColliderDesc.cylinder(height / 2, foot.radius)
          .setTranslation(p.x, pg + height / 2, p.z)
          .setCollisionGroups(PROP_GROUPS);
        sign.colliders.push(this.world.createCollider(collider, this.body ?? undefined));
      }
      const [f] = mount.faces;
      // Leaning forward when overhead: the face's normal points TILT_DEG down toward the drivers.
      sign.board = f
        ? local(f.x, f.y, f.z + f.standoff, new Vector3(w, h, 1), f.pitch)
        : new Matrix4().makeScale(0, 0, 0);
      add(boards, sign.board);
      return sign;
    });
    const instanced = (
      geometry: BufferGeometry,
      material: Material,
      list: Matrix4[],
      shadow = true,
      prepare?: (mesh: InstancedMesh) => void,
    ) => {
      const mesh = this.instances.take(geometry, material, list.length, prepare);
      mesh.count = list.length;
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.frustumCulled = false; // instances span the whole area
      mesh.castShadow = shadow;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      // Remember which sign owns each instance, to hide it later.
      let i = 0;
      for (const o of owners) if (o.list === list) this.signs[o.sign]?.refs.push([mesh, i++]);
      return mesh;
    };
    for (const p of k.pole) {
      instanced(p.geometry, p.material, poles);
      yield true;
    }
    for (const p of k.arm) {
      instanced(p.geometry, p.material, arms);
      yield true;
    }
    for (const p of k.flange) {
      instanced(p.geometry, p.material, flanges);
      yield true;
    }
    for (const p of k.post) {
      instanced(p.geometry, p.material, posts);
      yield true;
    }
    instanced(k.back.geometry, k.back.material, boards);
    // A clone of the face for the instance attribute (the glb's geometry stays as loaded).
    this.faceGeometry ??= k.face.clone();
    // attachFaceLayers gives the mesh its `faceLayer` as it is taken, before it can be drawn.
    this.faces = instanced(this.faceGeometry, faces().material, boards, false, attachFaceLayers);
    // The review hooks and the perf probe tell the faces by this (as the plates' faceKeys).
    this.faces.userData.guideFaces = true;
    this.layerVersion = -1;
    this.applyLayers();
    yield true;
  }
}
