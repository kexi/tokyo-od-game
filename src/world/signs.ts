import { reanchorBody } from "../physics/reanchor";
import {
  type InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Material,
  type Matrix4,
  type Quaternion,
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
import { POST_TOP, stackPlates } from "../signs/stack";
import { auxDesignFor, designFor, type Design, type GameTable } from "../signs/game";
import { laneKey } from "../signs/lanes";
import { warn } from "../log";
import { leftOf, type RoadGraph } from "./roads";
import type { Approach } from "./trafficControl";
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
// 備考一(二)) so they read at game camera distances. Their heights on the post: src/signs/stack.ts.
const PLATE_OFFSET = 0.05; // plate face in front of the post axis (bracket depth)

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

/** A plate of signs.glb; `height` is its modelled height in metres (the face's bounding box). */
type Part = { face: BufferGeometry; back: BufferGeometry; backMaterial: Material; height: number };
type Kit = { plate: (shape: Shape) => Part | null; post: Mesh; bracket: Mesh };
let kit: Kit | null = null;

/** Loads signs.glb (plates, post, bracket) once; TrafficSigns needs it to have resolved. */
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
    const face = meshOf(name, "SignFace").geometry;
    face.computeBoundingBox();
    const box = face.boundingBox;
    return {
      face,
      back: back.geometry,
      backMaterial: back.material as Material,
      height: box ? box.max.y - box.min.y : 0,
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
    post: meshOf("Post"),
    bracket: meshOf("Bracket"),
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

type Post = {
  pos: Vector3;
  travel: Vector3;
  plates: Design[];
  /** Instances drawing this post, to hide it if it turns out to stand inside a building. */
  refs: Array<[InstancedMesh, number]>;
  /** The 補助標識 of each plate (same index), hung right under it. */
  auxOf: AuxPlate[][];
  collider: RAPIER.Collider | null;
  hidden: boolean;
};
/** One plate instance: its post, the height of its centre above the ground and its scale. */
type Item = { post: Post; y: number; scale: number; flip: boolean; facing?: Vector3 };

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

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
    private readonly isOpen: (x: number, z: number, groundY: number) => boolean,
  ) {}

  rebuild(graph: RoadGraph | null, regs: AppliedRegulations | null, approaches: Approach[]): void {
    for (const _ of this.rebuildSteps(graph, regs, approaches)) {
      /* synchronous compatibility path */
    }
  }

  rebuildAsync(
    graph: RoadGraph,
    regs: AppliedRegulations | null,
    approaches: Approach[],
    work: FrameWork,
  ): Promise<void> {
    return work.run(this.rebuildSteps(graph, regs, approaches));
  }

  private *rebuildSteps(
    graph: RoadGraph | null,
    regs: AppliedRegulations | null,
    approaches: Approach[],
  ): Generator<void | boolean> {
    this.clear(true);
    if (!graph || !regs || !kit) {
      this.instances.end();
      return;
    }
    const posts: Post[] = [];
    const add = (pos: Vector3, travel: Vector3, d: Design | null, aux: AuxPlate[] = []) => {
      if (!d) return;
      // Never in another road's carriageway (junctions, the far side of a narrow crossing).
      if (graph.carriagewaysAt(pos, 0.3).length > 0) return;
      // Several plates for the same traffic at (nearly) the same spot share one post.
      const post = posts.find((p) => p.pos.distanceTo(pos) < 2 && p.travel.dot(travel) > 0.7);
      if (!post) {
        posts.push({ pos, travel, plates: [d], refs: [], collider: null, hidden: false, auxOf: [aux] });
        return;
      }
      const isNewPlate = !post.plates.some((x) => x.file === d.file) && post.plates.length < 3;
      if (!isNewPlate) return;
      post.plates.push(d);
      post.auxOf.push(aux);
    };
    // 一時停止 first so it is the top plate where it shares a post.
    for (const ap of approaches) {
      yield;
      if (ap.kind !== "stop") continue;
      const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5);
      add(mid.add(leftOf(ap.travel, ap.seg.line.width / 2 + 0.7)), ap.travel, design(SIGN.stop, 0));
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
        const kerb = leftOf(along, side * (seg.line.width / 2 + 0.7));
        add(c.pos.clone().add(kerb), travel, design(SIGN.crosswalk, 0));
      }
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

  reanchor(matrix: Matrix4, rotation: Quaternion): void {
    this.instances.reanchor(matrix);
    for (const post of this.posts) {
      post.pos.applyMatrix4(matrix);
      post.travel.applyQuaternion(rotation);
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
  }

  /**
   * Building tiles stream in after the signs are placed, so posts near the player are re-tested
   * now and then; one that stands inside a building (the road is narrower than its GSI 幅員) is
   * hidden and loses its collider.
   */
  update(focus: Vector3, now: number): void {
    if (now - this.lastCheck < 2000) return;
    this.lastCheck = now;
    const hide = new Object3D();
    hide.scale.setScalar(0);
    hide.updateMatrix();
    for (const post of this.posts) {
      if (post.hidden || post.pos.distanceTo(focus) > 200) continue;
      const ground = this.groundAt(post.pos.x, post.pos.z);
      if (ground === null || this.isOpen(post.pos.x, post.pos.z, ground)) continue;
      post.hidden = true;
      for (const [mesh, i] of post.refs) {
        mesh.setMatrixAt(i, hide.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (post.collider) this.world.removeCollider(post.collider, false);
      post.collider = null;
    }
  }

  private *build(posts: Post[], k: Kit): Generator<void | boolean> {
    const byFile = new Map<string, { d: Design; items: Item[] }>();
    const byShape = new Map<Shape, Item[]>();
    const place = (post: Post, d: Design, y: number) => {
      const entry = byFile.get(d.file) ?? { d, items: [] };
      byFile.set(d.file, entry);
      const scale = d.scale;
      if (d.parallel && d.back) {
        // Face the carriageway (right of travel) and, back to back, the pavement.
        const right = leftOf(post.travel, -1);
        entry.items.push({ post, y, scale, flip: false, facing: right });
        const back = byFile.get(d.back) ?? { d: { ...d, file: d.back }, items: [] };
        byFile.set(d.back, back);
        back.items.push({ post, y, scale, flip: false, facing: right.clone().negate() });
        return;
      }
      entry.items.push({ post, y, scale, flip: false });
      if (d.bothFaces) {
        entry.items.push({ post, y, scale, flip: true });
        return;
      }
      const backs = byShape.get(d.shape) ?? [];
      backs.push({ post, y, scale, flip: false });
      byShape.set(d.shape, backs);
    };
    let dropped = 0;
    for (const post of posts) dropped += this.layOut(post, k, place);
    if (dropped > 0) warn("sign_faces_below_ground", { faces: dropped, posts: posts.length });
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
    this.instanced(k.bracket.geometry, k.bracket.material as Material, [...byShape.values()].flat(), false);
    const o = new Object3D();
    const pole = this.instances.take(k.post.geometry, k.post.material as Material, posts.length);
    // Posts are solid: one fixed body carries a thin cylinder per post (60.5 mm steel pipe).
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const height = POST_TOP + 0.45;
    for (const [i, post] of posts.entries()) {
      const ground = this.groundAt(post.pos.x, post.pos.z) ?? 0;
      o.position.set(post.pos.x, ground, post.pos.z);
      // The modelled post is 3.2 m; stretch it to just above the top plate.
      o.scale.set(1, height / 3.2, 1);
      o.updateMatrix();
      pole.setMatrixAt(i, o.matrix);
      post.refs.push([pole, i]);
      post.collider = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(height / 2, 0.05)
          .setTranslation(post.pos.x, ground + height / 2, post.pos.z)
          .setCollisionGroups(PROP_GROUPS),
        this.body ?? undefined,
      );
      const checkpoint = i % 32 === 0;
      if (checkpoint) yield;
    }
    pole.castShadow = true;
    this.add(pole);
    yield true;
    this.posts = posts;
  }

  /**
   * The plates of a post from the top, each with its 補助標識 right under it at the plate's scale
   * (別表第二 備考二(二)2), at the heights src/signs/stack.ts gives. A 補助標識 with no face drawn
   * ahead of time (public/data/regs newer than registry.json) is left off with a warning, the plate
   * above still standing. Returns how many faces did not fit above the ground.
   */
  private layOut(post: Post, k: Kit, place: (post: Post, d: Design, y: number) => void): number {
    const heightOf = (d: Design) => (k.plate(d.shape)?.height ?? 0) * d.scale;
    const auxOf = post.plates.map((d, level) =>
      (post.auxOf[level] ?? []).flatMap((plate) => {
        const aux = auxDesignFor(GAME_TABLE, plate, d.scale);
        if (aux) return [aux];
        reportUndrawnAux(plate);
        return [];
      }),
    );
    const { placed, dropped } = stackPlates(
      post.plates.map((d, level) => ({ height: heightOf(d), aux: auxOf[level].map(heightOf) })),
    );
    for (const f of placed) {
      const d = f.aux === null ? post.plates[f.plate] : auxOf[f.plate][f.aux];
      place(post, d, f.y);
    }
    return dropped;
  }

  /** One instance per plate; the face looks at oncoming traffic (−travel), just in front of the post. */
  private instanced(
    geometry: BufferGeometry,
    material: Material,
    items: Item[],
    castShadow = true,
  ): InstancedMesh {
    const o = new Object3D();
    const mesh = this.instances.take(geometry, material, items.length);
    items.forEach(({ post, y, scale, flip, facing: given }, i) => {
      const facing = given ?? (flip ? post.travel : post.travel.clone().negate());
      const ground = this.groundAt(post.pos.x, post.pos.z) ?? 0;
      o.position.set(post.pos.x, ground + y, post.pos.z);
      o.position.addScaledVector(facing, PLATE_OFFSET);
      o.rotation.set(0, Math.atan2(facing.x, facing.z), 0);
      o.scale.setScalar(scale);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      post.refs.push([mesh, i]);
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
