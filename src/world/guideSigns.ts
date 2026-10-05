import { reanchorBody } from "../physics/reanchor";
import {
  CanvasTexture,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
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
import { drawBoard, layoutBoard, loadGuideFonts, type BoardLayout } from "./guideArt";
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
import { leftOf, type RoadGraph } from "./roads";
import type { Approach } from "./trafficControl";
import { sharedDraco } from "../render/draco";
import { RoadInstances } from "./roadInstances";
import { FrameWork } from "../game/frameWork";

/**
 * 案内標識 108 series on the streets around the player: planned by guidePlan.ts from the road
 * graph, the OSM route numbers and destinations (public/data/routes) and the 表示地名
 * (public/data/guide-places.json); poles, arms and boards from scripts/blender/guide_signs.py;
 * faces drawn by guideArt.ts.
 *
 * Cost: every part is one InstancedMesh, and the board faces too, with a plain blue far face;
 * only the nearest boards (≤ NEAR_COUNT within NEAR_RANGE) get their own drawn texture, kept in a
 * cache across rebuilds. Why not a texture per board for all of them: 100 boards at 512 px are
 * ~110 MB of GPU memory with mipmaps, and beyond ~400 m the letters are a few pixels high anyway.
 */

const ROUTE_ZOOM = 14;
const ROAD_ZOOM = 16;
const NEAR_RANGE = 400; // m: boards this close get their drawn face (beyond, letters are < 3 px)
const NEAR_COUNT = 24;
const DRAWS_PER_UPDATE = 3; // canvas draws per update (a board takes a few ms)
const TEXTURE_PX = 512; // 280 cm → 1.8 px/cm: a 30 cm 漢字 is 55 px
const CACHE_LIMIT = 32; // ≈ 35 MB of faces with their mipmaps
const OVERHEAD_BOTTOM = 5.0; // 道路標識設置基準: 片持式の標示板の設置高さ 5.0 m 標準 (≥ 4.7 m)
const ROADSIDE_BOTTOM = 2.5; // 路側式 on a pavement without a furniture strip: 2.5 m or more
const TILT = 3; // ° the overhead boards lean forward (国土交通省 Q&A: 通常約3°)
const BOARD_GAP = 0.55; // m from the pole's surface to the board's inner edge

type Part = { geometry: BufferGeometry; material: Material };
type Kit = {
  pole: Part[];
  arm: Part[];
  flange: Part[];
  post: Part[];
  face: BufferGeometry;
  back: Part;
  poleHeight: number;
  poleRadius: number;
  armRadius: number;
  postRadius: number;
  railOffset: number;
};

type Sign = {
  plan: GuidePlan;
  layout: BoardLayout;
  key: string;
  /** Board centre and orientation (the face's matrix), for the near face mesh. */
  board: Matrix4;
  /** Where the pole or the posts stand, tested against the buildings. */
  feet: Vector3[];
  refs: Array<[InstancedMesh, number]>;
  faceIndex: number;
  colliders: RAPIER.Collider[];
  near: Mesh | null;
  hidden: boolean;
};

/** Placement of a part: at p, turned rotY about +Y, then leaning `pitch` about its own X. */
const at = (p: Vector3, rotY: number, scale: Vector3, pitch = 0) =>
  new Matrix4().compose(p, new Quaternion().setFromEuler(new Euler(pitch, rotY, 0, "YXZ")), scale);

const farMaterial = new MeshStandardMaterial({ color: 0x1d4f9c, roughness: 0.45 });
const textures = new Map<string, CanvasTexture>();

/** Faces drawn once per content, newest last (Map order), the oldest dropped past the limit. */
function faceTexture(key: string, layout: BoardLayout): CanvasTexture {
  const hit = textures.get(key);
  if (hit) {
    textures.delete(key);
    textures.set(key, hit);
    return hit;
  }
  const texture = new CanvasTexture(drawBoard(layout, TEXTURE_PX));
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false; // glTF UV convention: v runs down the image
  texture.anisotropy = 8;
  textures.set(key, texture);
  while (textures.size > CACHE_LIMIT) {
    const oldest = textures.keys().next().value;
    if (oldest === undefined) break;
    textures.get(oldest)?.dispose();
    textures.delete(oldest);
  }
  return texture;
}

export class GuideSigns {
  plans: GuidePlan[] = [];
  private signs: Sign[] = [];
  private kit: Kit | null = null;
  private places: PlaceRow[] | null = null;
  private meshes: InstancedMesh[] = [];
  private readonly instances = new RoadInstances();
  private nearPool: Mesh[] = [];
  private faces: InstancedMesh | null = null;
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
    const extras = gltf.scene.getObjectByName("GuideSigns")?.userData ?? {};
    this.kit = {
      pole: part("GuidePole"),
      arm: part("GuideArm"),
      flange: part("GuideFlange"),
      post: part("GuidePost"),
      face: face.geometry,
      back,
      poleHeight: Number(extras.poleHeight ?? 7.6),
      poleRadius: Number(extras.poleRadius ?? 0.134),
      armRadius: Number(extras.armRadius ?? 0.07),
      postRadius: Number(extras.postRadius ?? 0.045),
      railOffset: Number(extras.railOffset ?? 0.043),
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
      this.plans = await work.run(
        planGuideSteps({
          graph,
          approaches: guideApproaches,
          routes,
          places,
          names,
          dests: localDests(data.dests, frame),
          avoid: [...avoid, ...crossings],
        }),
      );
      await work.yield();
      await work.run(this.build(this.kit));
      this.instances.end();
      log("guide_signs_placed", {
        signs: this.plans.length,
        advance: this.plans.filter((p) => p.board.distance !== null).length,
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
      sign.near?.applyMatrix4(matrix);
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
    for (const s of this.signs) if (s.near) this.dropNear(s);
    if (!reuse) {
      for (const m of this.nearPool) (m.material as Material).dispose();
      this.nearPool = [];
    }
    this.signs = [];
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
  }

  /**
   * Drawn faces for the nearest boards, the far face for the rest; and, every 2 s, signs near the
   * player that stand inside a building (GSI 幅員 wider than the street) are hidden.
   */
  update(focus: Vector3, now: number): void {
    if (now - this.lastUpdate < 500 || !this.faces) return;
    this.lastUpdate = now;
    const byDistance = this.signs
      .filter((s) => !s.hidden)
      .map((s) => ({ s, d: Math.hypot(s.plan.pos.x - focus.x, s.plan.pos.z - focus.z) }))
      .toSorted((a, b) => a.d - b.d);
    const wanted = new Set(
      byDistance
        .filter((e) => e.d < NEAR_RANGE)
        .slice(0, NEAR_COUNT)
        .map((e) => e.s),
    );
    for (const s of this.signs) if (s.near && !wanted.has(s)) this.dropNear(s);
    let draws = 0;
    for (const s of wanted) {
      if (s.near) continue;
      const isCached = textures.has(s.key);
      if (!isCached && draws >= DRAWS_PER_UPDATE) continue;
      if (!isCached) draws++;
      this.makeNear(s);
    }
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

  private makeNear(s: Sign): void {
    const mesh =
      this.nearPool.pop() ??
      new Mesh(
        this.kit?.face,
        new MeshStandardMaterial({
          map: faceTexture(s.key, s.layout),
          // Retroreflective sheeting, as the other signs: a little self-illumination at night.
          emissive: 0xffffff,
          emissiveIntensity: 0.16,
          roughness: 0.45,
        }),
      );
    const material = mesh.material as MeshStandardMaterial;
    material.map = faceTexture(s.key, s.layout);
    material.emissiveMap = material.map;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(s.board);
    mesh.castShadow = true;
    this.scene.add(mesh);
    s.near = mesh;
    this.setFace(s, false);
  }

  private dropNear(s: Sign): void {
    if (!s.near) return;
    this.scene.remove(s.near);
    this.nearPool.push(s.near);
    s.near = null;
    if (!s.hidden) this.setFace(s, true);
  }

  private setFace(s: Sign, visible: boolean): void {
    const faces = this.faces;
    if (!faces) return;
    faces.setMatrixAt(s.faceIndex, visible ? s.board : new Matrix4().makeScale(0, 0, 0));
    faces.instanceMatrix.needsUpdate = true;
  }

  private hide(s: Sign): void {
    s.hidden = true;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const [mesh, i] of s.refs) {
      mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (s.near) this.dropNear(s);
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
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.signs = this.plans.map((plan, index) => {
      const layout = layoutBoard(plan.board);
      const w = layout.width / 100;
      const h = layout.height / 100;
      const ground = this.groundAt(plan.pos.x, plan.pos.z) ?? 0;
      const facing = plan.travel.clone().negate(); // the face looks at the oncoming traffic
      const yaw = Math.atan2(facing.x, facing.z);
      const across = leftOf(plan.travel, -1); // from the kerb toward the carriageway
      const sign: Sign = {
        plan,
        layout,
        key: JSON.stringify(plan.board),
        board: new Matrix4(),
        feet: [plan.pos.clone()],
        refs: [],
        faceIndex: index,
        colliders: [],
        near: null,
        hidden: false,
      };
      const add = (list: Matrix4[], m: Matrix4) => {
        list.push(m);
        owners.push({ list, sign: index });
      };
      if (plan.mount === "overhead") {
        const bottom = OVERHEAD_BOTTOM;
        const poleTop = bottom + h + 0.3;
        const base = new Vector3(plan.pos.x, ground, plan.pos.z);
        add(poles, at(base, yaw, new Vector3(1, poleTop / k.poleHeight, 1)));
        const offset = k.poleRadius + BOARD_GAP + w / 2;
        // Arms run from the pole across the road, just behind the board.
        const behind = k.armRadius + 0.02;
        for (const f of [0.25, 0.75]) {
          const y = ground + bottom + h * f;
          const armBase = new Vector3(plan.pos.x, y, plan.pos.z).addScaledVector(facing, -behind);
          const armYaw = Math.atan2(-across.z, across.x); // local +X along `across`
          add(arms, at(armBase, armYaw, new Vector3(offset + w / 2 - 0.15, 1, 1)));
          add(flanges, at(new Vector3(plan.pos.x, y, plan.pos.z), armYaw, new Vector3(1, 1, 1)));
        }
        const centre = new Vector3(plan.pos.x, ground + bottom + h / 2, plan.pos.z)
          .addScaledVector(across, offset)
          .addScaledVector(facing, k.railOffset - behind + k.armRadius);
        // Leaning forward: the face's normal points TILT° down toward the drivers.
        sign.board = at(centre, yaw, new Vector3(w, h, 1), (TILT * Math.PI) / 180);
        const collider = RAPIER.ColliderDesc.cylinder(poleTop / 2, k.poleRadius)
          .setTranslation(plan.pos.x, ground + poleTop / 2, plan.pos.z)
          .setCollisionGroups(PROP_GROUPS);
        sign.colliders.push(this.world.createCollider(collider, this.body ?? undefined));
      } else {
        // 路側式: two posts on the pavement, the board over the pavement beside the kerb.
        const bottom = ROADSIDE_BOTTOM;
        const toPavement = across.clone().negate();
        const inner = 0.25 - 0.9; // board edge 25 cm behind the kerb (the pole spot is 0.9 m behind)
        const mid = new Vector3(plan.pos.x, ground, plan.pos.z).addScaledVector(toPavement, inner + w / 2);
        const postTop = bottom + h;
        sign.feet = [];
        for (const f of [-0.28, 0.28]) {
          const p = mid.clone().addScaledVector(toPavement, f * w);
          const pg = this.groundAt(p.x, p.z) ?? ground;
          sign.feet.push(p.clone().setY(0));
          add(posts, at(new Vector3(p.x, pg, p.z), yaw, new Vector3(1, postTop + (ground - pg), 1)));
          const collider = RAPIER.ColliderDesc.cylinder(postTop / 2, k.postRadius)
            .setTranslation(p.x, pg + postTop / 2, p.z)
            .setCollisionGroups(PROP_GROUPS);
          sign.colliders.push(this.world.createCollider(collider, this.body ?? undefined));
        }
        const centre = mid
          .clone()
          .setY(ground + bottom + h / 2)
          .addScaledVector(facing, k.postRadius + 0.05);
        sign.board = at(centre, yaw, new Vector3(w, h, 1));
      }
      add(boards, sign.board);
      return sign;
    });
    const instanced = (geometry: BufferGeometry, material: Material, list: Matrix4[], shadow = true) => {
      const mesh = this.instances.take(geometry, material, list.length);
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
    this.faces = instanced(k.face, farMaterial, boards, false);
    yield true;
  }
}
