import {
  BoxGeometry,
  CanvasTexture,
  type InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from "three";
import { RoadInstances } from "./roadInstances";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PROP_GROUPS } from "../physics/groups";
import { SIGN, type AppliedRegulations, type LaneDirection } from "./regulations";
import catalog from "../../assets/signs/catalog.json";
import { leftOf, type RoadGraph } from "./roads";
import type { Approach } from "./trafficControl";
import { sharedDraco } from "../render/draco";

// Sign artwork drawn by scripts/textures/sign_textures.py (道路標識、区画線及び道路標示に関する命令
// 別表第二); Vite bundles each PNG with a content hash.
const ARTWORK = import.meta.glob<string>("../../assets/signs/textures/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const artworkUrl = (name: string) => ARTWORK[`../../assets/signs/textures/${name}.png`];

// Plates are modelled at their real size (60 cm circles, 80 cm triangles); drawn 1.25× so they
// read at game camera distances.
const SCALE = 1.25;
const POST_TOP = 2.6; // ground to the centre of the top plate
const STACK = 0.8 * SCALE; // vertical spacing of plates sharing a post
const PLATE_OFFSET = 0.05; // plate face in front of the post axis (bracket depth)

/**
 * Plate meshes are named in signs.glb (PlateCircle, PlateDiamond, PlateRect120x90 …); the
 * catalogue (assets/signs/catalog.json, scripts/textures/sign_textures.py) says which plate and
 * artwork each sign of 別表第一 uses.
 */
type Shape = string;
/**
 * `bothFaces`: back-to-back copies of the same face. `parallel`: mounted along the street with
 * `back` as the other face (一方通行 326-A, 道路標識設置基準 3-1-4: 平行又は斜め 0°〜45°).
 */
type Design = { file: string; shape: Shape; bothFaces?: boolean; parallel?: boolean; back?: string };

type CatalogSign = { id: string; texture: string | null; plate_node?: string };
const CATALOG = new Map((catalog.signs as CatalogSign[]).map((c) => [c.id, c]));
const LANE_SIGNS = new Map(
  (catalog.lanes.rendered as Array<{ lanes: string; texture: string; plate_node: string }>).map((r) => [
    r.lanes,
    r,
  ]),
);

/** The catalogue's design for a sign number (null when not drawn). */
function catalogued(id: string, extra: Partial<Design> = {}): Design | null {
  const c = CATALOG.get(id);
  if (!c?.texture || !c.plate_node) return null;
  return { file: c.texture.replace(/\.png$/, ""), shape: c.plate_node, ...extra };
}

// Lane letters in the lane-sign file names (scripts/textures/signs/lanes.py), in their order.
const LANE_LETTERS: Array<[LaneDirection, string]> = [
  ["reverse", "u"],
  ["left", "l"],
  ["slight_left", "hl"],
  ["through", "t"],
  ["slight_right", "hr"],
  ["right", "r"],
];

/** 327の7 進行方向別通行区分 for these lanes, if that pattern was drawn. */
function laneDesign(lanes: readonly LaneDirection[][]): Design | null {
  const key = lanes
    .map((set) =>
      LANE_LETTERS.filter(([d]) => set.includes(d))
        .map(([, l]) => l)
        .join(""),
    )
    .join("-");
  const r = LANE_SIGNS.get(key);
  return r ? { file: r.texture.replace(/\.png$/, ""), shape: r.plate_node } : null;
}

// Game sign types drawn straight from the catalogue.
const BY_ID: Partial<Record<number, string>> = {
  [SIGN.closed]: "302",
  [SIGN.pedestrianRoad]: "325の4",
  [SIGN.roadClosed]: "301",
  [SIGN.motorClosed]: "310",
  [SIGN.noPedestrianCrossing]: "332",
  [SIGN.noOvertakeRight]: "314",
  [SIGN.noOvertake]: "314の2",
  [SIGN.noVehicleCrossing]: "312",
  [SIGN.horn]: "328",
  [SIGN.bikeOnPavement]: "325の3",
  [SIGN.parkingAllowed]: "403",
  [SIGN.timedParking]: "318",
  [SIGN.busLane]: "327の4",
  [SIGN.bikeLane]: "327の4の2",
  [SIGN.busPriority]: "327の5",
  [SIGN.vehicleClass]: "327",
  [SIGN.hydrant]: "x-hydrant",
  [SIGN.school]: "208",
  [SIGN.schoolRoute]: "x-school-route",
};

function design(type: number, value: number, lanes?: readonly LaneDirection[][]): Design | null {
  const id = BY_ID[type];
  if (id) return catalogued(id);
  switch (type) {
    case SIGN.speed:
      return [20, 30, 40, 50, 60, 70, 80].includes(value)
        ? { file: `speed_${value}`, shape: "PlateCircle" }
        : null;
    case SIGN.noEntry:
      return { file: "no_entry", shape: "PlateCircle" };
    case SIGN.noParking:
      return { file: "no_parking", shape: "PlateCircle" };
    case SIGN.noStopping:
      return { file: "no_stopping", shape: "PlateCircle" };
    case SIGN.noUturn:
      return { file: "no_uturn", shape: "PlateCircle" };
    case SIGN.turn:
      return value >= 1 && value <= 6 ? { file: `turn_${value}`, shape: "PlateCircle" } : null;
    case SIGN.oneway:
      // Seen from the carriageway the arrow points right, the way the traffic beside it goes;
      // the face on the back points left for the far side.
      return { file: "one_way_right", back: "one_way_left", shape: "PlateWide", parallel: true };
    case SIGN.slow:
      return { file: "slow", shape: "PlateTriangle" };
    case SIGN.stop:
      return { file: "stop", shape: "PlateTriangle" };
    case SIGN.crosswalk:
      // 横断歩道 (407-A, the current blue pentagon), back to back: one face per direction.
      return (
        catalogued("407-A", { bothFaces: true }) ?? {
          file: "crosswalk",
          shape: "PlateSquare",
          bothFaces: true,
        }
      );
    case SIGN.laneArrows:
      return lanes ? laneDesign(lanes) : null;
    default:
      return null;
  }
}

type Part = { face: BufferGeometry; back: BufferGeometry; backMaterial: Material };
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
  /** 補助標識 texts hung under the plates. */
  notes: string[];
  collider: RAPIER.Collider | null;
  hidden: boolean;
};
type Item = { post: Post; level: number; flip: boolean; facing?: Vector3 };

/**
 * 道路標識 posts where JARTIC puts them (sections' starts and repeats, junction approaches,
 * one-way exits, 一時停止), plus 横断歩道 signs at crossings without signals. Plates, posts and
 * brackets come from scripts/blender/signs.py; artwork from scripts/textures/sign_textures.py.
 */
export class TrafficSigns {
  private meshes: InstancedMesh[] = [];
  private readonly instances = new RoadInstances();

  private posts: Post[] = [];
  private notes: Mesh[] = [];
  private body: RAPIER.RigidBody | null = null;
  private lastCheck = 0;

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly world: RAPIER.World,
    private readonly isOpen: (x: number, z: number, groundY: number) => boolean,
  ) {}

  rebuild(graph: RoadGraph | null, regs: AppliedRegulations | null, approaches: Approach[]): void {
    this.clear(true);
    if (!graph || !regs || !kit) {
      this.instances.end();
      return;
    }
    const posts: Post[] = [];
    const add = (pos: Vector3, travel: Vector3, d: Design | null, note?: string) => {
      if (!d) return;
      // Never in another road's carriageway (junctions, the far side of a narrow crossing).
      if (graph.carriagewaysAt(pos, 0.3).length > 0) return;
      // Several plates for the same traffic at (nearly) the same spot share one post.
      const post = posts.find((p) => p.pos.distanceTo(pos) < 2 && p.travel.dot(travel) > 0.7);
      if (!post)
        posts.push({
          pos,
          travel,
          plates: [d],
          refs: [],
          collider: null,
          hidden: false,
          notes: note ? [note] : [],
        });
      else if (!post.plates.some((x) => x.file === d.file) && post.plates.length < 3) {
        post.plates.push(d);
        if (note) post.notes.push(note);
      }
    };
    // 一時停止 first so it is the top plate where it shares a post.
    for (const ap of approaches) {
      if (ap.kind !== "stop") continue;
      const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5);
      add(mid.add(leftOf(ap.travel, ap.seg.line.width / 2 + 0.7)), ap.travel, design(SIGN.stop, 0));
    }
    for (const s of regs.signs) add(s.pos, s.travel, design(s.type, s.value, s.lanes), s.note);
    const signalStops = approaches.filter((a) => a.kind === "signal");
    for (const c of regs.crossings) {
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
    this.build(posts, kit);
    this.instances.end();
  }

  count(): number {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }

  /** Feet of the posts standing now (the 案内標識 keep clear of them). */
  postPositions(): Vector3[] {
    return this.posts.filter((p) => !p.hidden).map((p) => p.pos.clone());
  }

  clear(reuse = false): void {
    if (reuse) this.instances.begin();
    else this.instances.clear();
    for (const m of this.meshes) this.scene.remove(m);
    this.meshes = [];
    for (const n of this.notes) {
      this.scene.remove(n);
      n.geometry.dispose();
      for (const m of n.material as Material[]) if (m !== noteBack) m.dispose();
    }
    this.notes = [];
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

  private build(posts: Post[], k: Kit): void {
    const byFile = new Map<string, { d: Design; items: Item[] }>();
    const byShape = new Map<Shape, Item[]>();
    for (const post of posts)
      post.plates.forEach((d, level) => {
        const entry = byFile.get(d.file) ?? { d, items: [] };
        byFile.set(d.file, entry);
        if (d.parallel && d.back) {
          // Face the carriageway (right of travel) and, back to back, the pavement.
          const right = leftOf(post.travel, -1);
          entry.items.push({ post, level, flip: false, facing: right });
          const back = byFile.get(d.back) ?? { d: { ...d, file: d.back }, items: [] };
          byFile.set(d.back, back);
          back.items.push({ post, level, flip: false, facing: right.clone().negate() });
          return;
        }
        entry.items.push({ post, level, flip: false });
        if (d.bothFaces) {
          entry.items.push({ post, level, flip: true });
          return;
        }
        const backs = byShape.get(d.shape) ?? [];
        backs.push({ post, level, flip: false });
        byShape.set(d.shape, backs);
      });
    for (const { d, items } of byFile.values()) {
      const plate = k.plate(d.shape);
      if (plate) this.instanced(plate.face, faceMaterial(d.file), items).userData.key = d.file;
    }
    for (const [shape, items] of byShape) {
      const plate = k.plate(shape);
      if (plate) this.instanced(plate.back, plate.backMaterial, items);
    }
    this.instanced(k.bracket.geometry, k.bracket.material as Material, [...byShape.values()].flat(), false);
    const o = new Object3D();
    const pole = this.instances.take(k.post.geometry, k.post.material as Material, posts.length);
    // Posts are solid: one fixed body carries a thin cylinder per post (60.5 mm steel pipe).
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const height = POST_TOP + 0.45;
    posts.forEach((post, i) => {
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
    });
    pole.castShadow = true;
    this.add(pole);
    this.posts = posts;
    // 補助標識 under the lowest plate (one mesh each: their texts differ).
    for (const post of posts) {
      if (post.notes.length === 0) continue;
      const plate = notePlate(post.notes[0]);
      const ground = this.groundAt(post.pos.x, post.pos.z) ?? 0;
      const h = (plate.geometry as BoxGeometry).parameters.height;
      const lowest = ground + POST_TOP - (post.plates.length - 1) * STACK;
      const facing = post.travel.clone().negate();
      plate.position
        .set(post.pos.x, lowest - 0.3 * SCALE - 0.06 - h / 2, post.pos.z)
        .addScaledVector(facing, PLATE_OFFSET);
      plate.rotation.y = Math.atan2(facing.x, facing.z);
      this.scene.add(plate);
      this.notes.push(plate);
    }
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
    items.forEach(({ post, level, flip, facing: given }, i) => {
      const facing = given ?? (flip ? post.travel : post.travel.clone().negate());
      const ground = this.groundAt(post.pos.x, post.pos.z) ?? 0;
      o.position.set(post.pos.x, ground + POST_TOP - level * STACK, post.pos.z);
      o.position.addScaledVector(facing, PLATE_OFFSET);
      o.rotation.set(0, Math.atan2(facing.x, facing.z), 0);
      o.scale.setScalar(SCALE);
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

const noteBack = new MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.6, roughness: 0.45 });
const noteTextures = new Map<string, { texture: CanvasTexture; lines: number }>();

/** 補助標識: black text on a white plate with a black border, 60 cm wide. */
function notePlate(text: string): Mesh {
  let entry = noteTextures.get(text);
  if (!entry) {
    const lines = text.split("\n");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 24 + lines.length * 70;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => {
      let size = 54;
      ctx.font = `bold ${size}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
      while (ctx.measureText(line).width > canvas.width - 40 && size > 22) {
        size -= 2;
        ctx.font = `bold ${size}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
      }
      ctx.fillText(line, canvas.width / 2, 12 + 35 + i * 70);
    });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    entry = { texture, lines: lines.length };
    noteTextures.set(text, entry);
  }
  const width = 0.6 * SCALE;
  const height = width * ((24 + entry.lines * 70) / 320);
  const face = new MeshStandardMaterial({ map: entry.texture, roughness: 0.45 });
  return new Mesh(new BoxGeometry(width, height, 0.01), [
    noteBack,
    noteBack,
    noteBack,
    noteBack,
    face,
    noteBack,
  ]);
}
