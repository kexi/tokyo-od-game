import {
  InstancedMesh,
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
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SIGN, type AppliedRegulations } from "./regulations";
import { leftOf, type RoadGraph } from "./roads";
import type { Approach } from "./trafficControl";

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

type Shape = "PlateCircle" | "PlateRect" | "PlateTriangle" | "PlateSquare";
type Design = { file: string; shape: Shape; bothFaces?: boolean };

function design(type: number, value: number): Design | null {
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
      return { file: "one_way", shape: "PlateRect" };
    case SIGN.slow:
      return { file: "slow", shape: "PlateTriangle" };
    case SIGN.stop:
      return { file: "stop", shape: "PlateTriangle" };
    case SIGN.crosswalk:
      // 横断歩道 signs at crossings are mounted back to back, one face per direction.
      return { file: "crosswalk", shape: "PlateSquare", bothFaces: true };
    default:
      return null;
  }
}

type Part = { face: BufferGeometry; back: BufferGeometry; backMaterial: Material };
type Kit = { plates: Record<Shape, Part>; post: Mesh; bracket: Mesh };
let kit: Kit | null = null;

/** Loads signs.glb (plates, post, bracket) once; TrafficSigns needs it to have resolved. */
export async function loadSignModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(
    new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
  );
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
  kit = {
    plates: {
      PlateCircle: part("PlateCircle"),
      PlateRect: part("PlateRect"),
      PlateTriangle: part("PlateTriangle"),
      PlateSquare: part("PlateSquare"),
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

type Post = { pos: Vector3; travel: Vector3; plates: Design[] };
type Item = { post: Post; level: number; flip: boolean };

/**
 * 道路標識 posts where JARTIC puts them (sections' starts and repeats, junction approaches,
 * one-way exits, 一時停止), plus 横断歩道 signs at crossings without signals. Plates, posts and
 * brackets come from scripts/blender/signs.py; artwork from scripts/textures/sign_textures.py.
 */
export class TrafficSigns {
  private meshes: InstancedMesh[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {}

  rebuild(graph: RoadGraph | null, regs: AppliedRegulations | null, approaches: Approach[]): void {
    this.clear();
    if (!graph || !regs || !kit) return;
    const posts: Post[] = [];
    const add = (pos: Vector3, travel: Vector3, d: Design | null) => {
      if (!d) return;
      // Several plates for the same traffic at (nearly) the same spot share one post.
      const post = posts.find((p) => p.pos.distanceTo(pos) < 2 && p.travel.dot(travel) > 0.7);
      if (!post) posts.push({ pos, travel, plates: [d] });
      else if (!post.plates.some((x) => x.file === d.file) && post.plates.length < 3) post.plates.push(d);
    };
    // 一時停止 first so it is the top plate where it shares a post.
    for (const ap of approaches) {
      if (ap.kind !== "stop") continue;
      const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5);
      add(mid.add(leftOf(ap.travel, ap.seg.line.width / 2 + 0.7)), ap.travel, design(SIGN.stop, 0));
    }
    for (const s of regs.signs) add(s.pos, s.travel, design(s.type, s.value));
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
  }

  count(): number {
    return this.meshes.reduce((n, m) => n + m.count, 0);
  }

  clear(): void {
    for (const m of this.meshes) this.scene.remove(m);
    this.meshes = [];
  }

  private build(posts: Post[], k: Kit): void {
    const byFile = new Map<string, { d: Design; items: Item[] }>();
    const byShape = new Map<Shape, Item[]>();
    for (const post of posts)
      post.plates.forEach((d, level) => {
        const entry = byFile.get(d.file) ?? { d, items: [] };
        byFile.set(d.file, entry);
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
      this.instanced(k.plates[d.shape].face, faceMaterial(d.file), items).userData.key = d.file;
    }
    for (const [shape, items] of byShape) {
      this.instanced(k.plates[shape].back, k.plates[shape].backMaterial, items);
    }
    this.instanced(k.bracket.geometry, k.bracket.material as Material, [...byShape.values()].flat(), false);
    const o = new Object3D();
    const pole = new InstancedMesh(k.post.geometry, k.post.material as Material, posts.length);
    posts.forEach((post, i) => {
      o.position.set(post.pos.x, this.groundAt(post.pos.x, post.pos.z) ?? 0, post.pos.z);
      // The modelled post is 3.2 m; stretch it to just above the top plate.
      o.scale.set(1, (POST_TOP + 0.45) / 3.2, 1);
      o.updateMatrix();
      pole.setMatrixAt(i, o.matrix);
    });
    pole.castShadow = true;
    this.add(pole);
  }

  /** One instance per plate; the face looks at oncoming traffic (−travel), just in front of the post. */
  private instanced(
    geometry: BufferGeometry,
    material: Material,
    items: Item[],
    castShadow = true,
  ): InstancedMesh {
    const o = new Object3D();
    const mesh = new InstancedMesh(geometry, material, items.length);
    items.forEach(({ post, level, flip }, i) => {
      const facing = flip ? post.travel : post.travel.clone().negate();
      const ground = this.groundAt(post.pos.x, post.pos.z) ?? 0;
      o.position.set(post.pos.x, ground + POST_TOP - level * STACK, post.pos.z);
      o.position.addScaledVector(facing, PLATE_OFFSET);
      o.rotation.set(0, Math.atan2(facing.x, facing.z), 0);
      o.scale.setScalar(SCALE);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
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
