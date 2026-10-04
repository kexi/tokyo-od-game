import type RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { warn } from "../log";
import { type Cabin, cabinFromMirror, CharmRig, type CharmKind, DEFAULT_CABIN } from "../physics/charmRig";
import { INTERIOR_LAYER } from "./cockpit";
import type { CharmChoice } from "./controlsHelp";

/**
 * ミラーの飾り: the plush bear and/or the お守り (public/models/mirror_charms.glb) hanging from the
 * rear-view mirror's stay on a cord, moved by the physics in physics/charmRig.ts. The cord is a
 * thin tube redrawn through the rig's joint points every frame. From the driver's seat they are
 * drawn in the cockpit's own pass (INTERIOR_LAYER, lit by the lights cockpit.ts opens to that
 * layer); from the outside views they are on the main layer, seen through the tinted glass, with a
 * copy of the cockpit's mirror to hang from (car.glb has none of its own).
 */
export const CHARM_KINDS: Record<CharmChoice, CharmKind[]> = {
  none: [],
  plush: ["plush"],
  omamori: ["omamori"],
  // The pouch on the driver's side of the knot (−X), the bear beside it.
  both: ["omamori", "plush"],
};

/** Cord colours: black for the bear (it stands out against it), the お守り's own red. */
const CORD_COLOUR: Record<CharmKind, number> = { plush: 0x1b1b1d, omamori: 0xc8352e };
const NODE: Record<CharmKind, string> = { plush: "Charm_Plush", omamori: "Charm_Omamori" };
/** Tube: 5 sides round, 3 samples per segment along a Catmull-Rom curve through the joints. */
const SIDES = 5;
const PER_SEGMENT = 3;

/** First-time hint: hang it small; what the law says (knowledge/mirror-charms.md). */
export const CHARM_TIP =
  "ミラーの飾りは小さく。視野やミラーの効用を妨げる飾りは違反になりえます（道交法第55条第2項・都規則第8条第8号）。設定で「なし」にできます";
const TIP_KEY = "tod.charmTip";

/** True the first time in this browser (then remembered). Storage blocked: never, not every drive. */
export function firstCharmTip(): boolean {
  try {
    if (localStorage.getItem(TIP_KEY)) return false;
    localStorage.setItem(TIP_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export class MirrorCharms {
  /** Lives under the car model: the rig works in the car's frame. */
  readonly group = new Group();
  private templates: Partial<Record<CharmKind, Object3D>> = {};
  private cabin: Cabin = DEFAULT_CABIN;
  private rig: CharmRig | null = null;
  private hung: Array<{ cord: Cord; charm: Object3D }> = [];
  private choice: CharmChoice = "none";
  /** The cockpit's mirror, copied for the outside views. */
  private mirror: Object3D | null = null;
  private interior: boolean | null = null;

  async load(): Promise<void> {
    try {
      const loader = new GLTFLoader().setDRACOLoader(
        new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
      );
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/mirror_charms.glb`);
      for (const kind of ["plush", "omamori"] as const) {
        const node = gltf.scene.getObjectByName(NODE[kind]);
        if (node) this.templates[kind] = node;
      }
    } catch (error) {
      warn("mirror_charms_load_failed", { error: String(error) });
    }
  }

  /**
   * Hang the charms in `car` (the player's car model), where the cockpit's Mirror_Rear is, facing
   * its DriverEye. Without the cockpit model, cockpit.glb's own numbers (charmRig DEFAULT_CABIN).
   */
  attach(car: Object3D, cockpitRoot: Object3D | null): void {
    car.add(this.group);
    const mirror = cockpitRoot?.getObjectByName("Mirror_Rear");
    const eye = cockpitRoot?.getObjectByName("DriverEye");
    const centre = mirror?.userData.center as number[] | undefined;
    const normal = mirror?.userData.normal as number[] | undefined;
    const hasMirror = centre?.length === 3 && normal?.length === 3 && eye !== undefined;
    if (hasMirror && cockpitRoot) {
      // The eye in the cockpit's (= the car's) frame, wherever it sits in the node tree.
      cockpitRoot.updateWorldMatrix(true, true);
      const eyeAt = cockpitRoot.worldToLocal(eye.getWorldPosition(new Vector3()));
      this.cabin = cabinFromMirror(new Vector3().fromArray(centre), new Vector3().fromArray(normal), eyeAt);
    }
    if (!mirror) return;
    // The outside views' mirror: the housing and stay; the glass a plain dark mirror (the cockpit's
    // own shows a render target only drawn from the driver's seat).
    this.mirror = mirror.clone(true);
    this.mirror.traverse((o) => {
      if (o instanceof Mesh && o.name.startsWith("MirrorSurface"))
        o.material = new MeshStandardMaterial({ color: 0x3a4048, metalness: 1, roughness: 0.15 });
    });
    this.group.add(this.mirror);
  }

  setChoice(choice: CharmChoice): void {
    if (choice === this.choice) return;
    this.choice = choice;
    this.rig?.dispose();
    for (const h of this.hung) {
      h.cord.mesh.geometry.dispose();
      (h.cord.mesh.material as Material).dispose();
      this.group.remove(h.cord.mesh, h.charm);
    }
    this.hung = [];
    const kinds = CHARM_KINDS[choice].filter((k) => this.templates[k]);
    this.rig = kinds.length > 0 ? new CharmRig(this.cabin, kinds) : null;
    for (const chain of this.rig?.chains ?? []) {
      const template = this.templates[chain.kind];
      if (!template) continue;
      const cord = new Cord(chain.cord.segments, chain.cord.radius, CORD_COLOUR[chain.kind]);
      const charm = template.clone(true);
      this.group.add(cord.mesh, charm);
      this.hung.push({ cord, charm });
    }
    // The new meshes on the view's layer now: the choice is made in 設定, while the game (and so
    // update) is paused.
    const wasInterior = this.interior ?? false;
    this.interior = null;
    this.setInterior(wasInterior);
    this.draw();
  }

  /**
   * After the game's physics steps: follow the chassis for `elapsed` seconds of physics (0 when
   * no step ran this frame) and redraw. `interior`: the driver's-seat view is on.
   */
  update(body: RAPIER.RigidBody, elapsed: number, interior: boolean): void {
    this.setInterior(interior);
    if (!this.rig || elapsed <= 0) return;
    const t = body.translation();
    const r = body.rotation();
    const rotation = new Quaternion(r.x, r.y, r.z, r.w);
    const at = this.cabin.hang
      .clone()
      .applyQuaternion(rotation)
      .add(new Vector3(t.x, t.y, t.z));
    const v = body.velocityAtPoint(at);
    const w = body.angvel();
    this.rig.follow(
      { at, velocity: new Vector3(v.x, v.y, v.z), rotation, angvel: new Vector3(w.x, w.y, w.z) },
      elapsed,
    );
    this.draw();
  }

  /** What the dev hook shows: the choice, the last step's kind and the felt acceleration. */
  debug(): { choice: CharmChoice; step: string; felt: number[] } {
    const a = this.rig?.feltAcceleration() ?? new Vector3();
    return { choice: this.choice, step: this.rig?.lastStep ?? "none", felt: [a.x, a.y, a.z] };
  }

  private draw(): void {
    const poses = this.rig?.poses() ?? [];
    for (const [i, h] of this.hung.entries()) {
      const pose = poses[i];
      if (!pose) continue;
      h.cord.update(pose.points);
      h.charm.position.copy(pose.position);
      h.charm.quaternion.copy(pose.quaternion);
    }
  }

  /** Driver's seat: the cockpit's pass draws them; outside: the main pass, through the glass. */
  private setInterior(interior: boolean): void {
    if (interior === this.interior) return;
    this.interior = interior;
    const layer = interior ? INTERIOR_LAYER : 0;
    this.group.traverse((o) => o.layers.set(layer));
    // From the driver's seat the cockpit's own mirror is there; the copy is for the outside.
    if (this.mirror) this.mirror.visible = !interior && this.rig !== null;
  }
}

/** The cord: a tube of fixed topology whose rings are moved onto the joint points each frame. */
class Cord {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly samples: number;

  constructor(
    segments: number,
    private readonly radius: number,
    colour: number,
  ) {
    this.samples = segments * PER_SEGMENT + 1;
    this.positions = new Float32Array(this.samples * SIDES * 3);
    this.normals = new Float32Array(this.samples * SIDES * 3);
    const index: number[] = [];
    for (let s = 0; s < this.samples - 1; s++)
      for (let k = 0; k < SIDES; k++) {
        const a = s * SIDES + k;
        const b = s * SIDES + ((k + 1) % SIDES);
        index.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
      }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(this.normals, 3));
    geometry.setIndex(index);
    this.mesh = new Mesh(geometry, new MeshStandardMaterial({ color: colour, roughness: 0.65 }));
    // The tube moves every frame; its bounds would be stale (and it is never far from the eye).
    this.mesh.frustumCulled = false;
  }

  update(points: Vector3[]): void {
    const n = points.length - 1;
    const p = new Vector3();
    const tangent = new Vector3();
    const side = new Vector3();
    const up = new Vector3();
    let prevSide = new Vector3(1, 0, 0);
    for (let s = 0; s < this.samples; s++) {
      const u = (s / (this.samples - 1)) * n;
      const i = Math.min(n - 1, Math.floor(u));
      catmullRom(points, i, u - i, p, tangent);
      tangent.normalize();
      // The ring's axes carried along the cord (no flips where it bends).
      side.copy(prevSide).addScaledVector(tangent, -prevSide.dot(tangent));
      if (side.lengthSq() < 1e-8) side.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
      side.normalize();
      up.crossVectors(tangent, side);
      prevSide = side.clone();
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        const nx = side.x * Math.cos(a) + up.x * Math.sin(a);
        const ny = side.y * Math.cos(a) + up.y * Math.sin(a);
        const nz = side.z * Math.cos(a) + up.z * Math.sin(a);
        const o = (s * SIDES + k) * 3;
        this.normals[o] = nx;
        this.normals[o + 1] = ny;
        this.normals[o + 2] = nz;
        this.positions[o] = p.x + nx * this.radius;
        this.positions[o + 1] = p.y + ny * this.radius;
        this.positions[o + 2] = p.z + nz * this.radius;
      }
    }
    const geometry = this.mesh.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
  }
}

/** Point and tangent at `t` (0–1) between points[i] and points[i + 1], ends clamped. */
export function catmullRom(points: Vector3[], i: number, t: number, out: Vector3, tangent: Vector3): void {
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(points.length - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  for (const axis of ["x", "y", "z"] as const) {
    const a = p0[axis];
    const b = p1[axis];
    const c = p2[axis];
    const d = p3[axis];
    out[axis] =
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    tangent[axis] = 0.5 * (-a + c + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
  }
}
