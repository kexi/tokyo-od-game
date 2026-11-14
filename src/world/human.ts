import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { sharedDraco } from "../render/draco";
import { cloneHumanPart } from "./humanParts";

export type HumanColors = { shirt: number; pants: number; skin: number; hair: number; umbrella: number };

export type HumanModel = {
  root: Group;
  /** Everything above the feet's ground contact; bobs while walking. */
  body: Group;
  /** [right, left]: thighs pivot at the hips, shins (their children) at the knees. */
  legs: [Group, Group];
  shins: [Group, Group];
  /** [right, left]: upper arms pivot at the shoulders, forearms (their children) at the elbows. */
  arms: [Group, Group];
  forearms: [Group, Group];
  umbrella: Group;
};

/**
 * Pedestrians modelled in Blender by scripts/blender/human.py (public/models/human.glb): torso,
 * head and three hair styles, plus two-part arms and legs whose origins are the joint pivots
 * (shoulder, elbow, hip, knee).
 * Textures are white-based greyscale, so each person's colours are material tints.
 */
const PARTS = [
  "Torso",
  "Head",
  "HairShort",
  "HairLong",
  "HairBun",
  "UpperArmL",
  "UpperArmR",
  "ForearmL",
  "ForearmR",
  "ThighL",
  "ThighR",
  "ShinL",
  "ShinR",
] as const;
type PartName = (typeof PARTS)[number];
const HAIR: PartName[] = ["HairShort", "HairLong", "HairBun"];
let parts: Record<PartName, Object3D> | null = null;

/** Loads human.glb once; createHuman needs it to have resolved. */
export async function loadHumanModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/human.glb`);
  const found = {} as Record<PartName, Object3D>;
  for (const name of PARTS) {
    const o = gltf.scene.getObjectByName(name);
    if (!o) throw new Error(`human.glb has no ${name}`);
    o.removeFromParent();
    o.traverse((m) => {
      if (m instanceof Mesh) {
        m.castShadow = true;
        m.userData.shared = true; // template geometry: never dispose per person
      }
    });
    found[name] = o;
  }
  parts = found;
}

// Tinted copies of the template materials, shared by everyone wearing the same colour.
const tinted = new Map<string, Material>();
function tint(m: Material, colors: HumanColors): Material {
  const color = { Skin: colors.skin, Shirt: colors.shirt, Pants: colors.pants, Hair: colors.hair }[m.name];
  if (color === undefined) return m; // shoes keep their own colours
  const key = `${m.name}:${color}`;
  let t = tinted.get(key);
  if (!t) {
    const c = (m as MeshStandardMaterial).clone();
    c.color.setHex(color);
    t = c;
    tinted.set(key, t);
  }
  return t;
}

const umbrellaMaterials = new Map<number, MeshStandardMaterial>();
const umbrellaMaterial = (color: number) => {
  let m = umbrellaMaterials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.6 });
    umbrellaMaterials.set(color, m);
  }
  return m;
};
const shaftMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
// Each person moves their own meshes; the identical umbrella vertices need only one CPU/GPU copy.
const canopyGeometry = new ConeGeometry(0.55, 0.25, 12, 1, true);
const shaftGeometry = new CylinderGeometry(0.01, 0.01, 0.7);

/** Person (~1.7 m × height) with pivoting limbs for a walk cycle. Feet at y = 0, facing +Z. */
export function createHuman(colors: HumanColors, height = 1, variant = 0): HumanModel {
  const templates = parts;
  const unavailable = templates === null;
  if (unavailable) throw new Error("loadHumanModels() has not finished");
  const root = new Group();
  const clone = (name: PartName) => {
    const o = cloneHumanPart(templates[name]);
    o.traverse((m) => {
      if (m instanceof Mesh) m.material = tint(m.material as Material, colors);
    });
    return o;
  };
  const body = new Group();
  root.add(body);
  body.add(clone("Torso"), clone("Head"), clone(HAIR[Math.abs(variant) % HAIR.length]));
  // Each part keeps its joint as the group origin, so rotation.x bends that joint; the lower
  // part hangs from the upper one at the offset between their pivots.
  const joint = (name: PartName, parent: Group, parentPivot: Group | null) => {
    const o = clone(name);
    const pivot = new Group();
    pivot.position.copy(o.position);
    if (parentPivot) pivot.position.sub(parentPivot.position);
    o.position.set(0, 0, 0);
    pivot.add(o);
    parent.add(pivot);
    return pivot;
  };
  const upper = (name: PartName) => joint(name, body, null);
  const arms: [Group, Group] = [upper("UpperArmR"), upper("UpperArmL")];
  const legs: [Group, Group] = [upper("ThighR"), upper("ThighL")];
  const forearms: [Group, Group] = [joint("ForearmR", arms[0], arms[0]), joint("ForearmL", arms[1], arms[1])];
  const shins: [Group, Group] = [joint("ShinR", legs[0], legs[0]), joint("ShinL", legs[1], legs[1])];

  const umbrella = new Group();
  const canopy = new Mesh(canopyGeometry, umbrellaMaterial(colors.umbrella));
  canopy.userData.shared = true;
  canopy.position.y = 2.05;
  const shaft = new Mesh(shaftGeometry, shaftMaterial);
  shaft.userData.shared = true;
  shaft.position.y = 1.75;
  umbrella.add(canopy, shaft);
  umbrella.position.x = -0.2; // held in the right hand (−X)
  umbrella.visible = false;
  root.add(umbrella);

  root.scale.setScalar(height);
  return { root, body, legs, shins, arms, forearms, umbrella };
}

/**
 * Walk (and run) cycle at `phase` (radians, one stride of both legs per 2π); speed in m/s.
 * Hips swing forward and back; the knee folds most mid-swing, when the foot passes under the
 * body, and stays nearly straight in stance. Arms swing against the legs with the elbows a little
 * bent, more on the forward swing and when running. The body is highest with the legs together.
 */
export function animateHuman(h: HumanModel, phase: number, speed: number, holdingUmbrella: boolean): void {
  const isMoving = speed > 0.05;
  const run = Math.min(1, Math.max(0, (speed - 2) / 2.5)); // 0 walking … 1 running
  const hipAmp = isMoving ? Math.min(0.75, 0.3 + speed * 0.12) : 0;
  // Each animated person runs this every frame; tuple arrays and iterators would be short-lived.
  for (let k = 0; k < 2; k++) {
    const offset = k * Math.PI;
    const p = phase + offset;
    // Positive rotation.x moves a hanging limb backward (toward −Z).
    h.legs[k].rotation.x = -hipAmp * Math.sin(p);
    const swing = Math.max(0, Math.cos(p)) ** 2;
    h.shins[k].rotation.x = isMoving ? 0.08 + swing * (0.9 + run * 0.8) : 0.03;
    const armSwing = hipAmp * (0.7 + run * 0.3) * Math.sin(p);
    // Whole rotations, not just .x: poseFilming turns the arms about every axis.
    h.arms[k].rotation.set(armSwing, 0, 0);
    // Forearms bend forward (negative); more on the forward swing and when running.
    h.forearms[k].rotation.set(
      isMoving ? -(0.2 + 0.25 * Math.max(0, -Math.sin(p)) + run * 1.1) : -0.08,
      0,
      0,
    );
  }
  if (holdingUmbrella) {
    h.arms[0].rotation.x = -0.45;
    h.forearms[0].rotation.x = -1.35;
  }
  h.body.position.y = isMoving ? (0.012 + run * 0.02) * Math.cos(2 * phase) : 0;
  h.body.rotation.y = isMoving ? 0.04 * Math.sin(phase) : 0;
  h.umbrella.visible = holdingUmbrella;
}

// ---------------------------------------------------------------- filming with a phone

/**
 * Where a phone held up to film sits, in the body's frame (before the height scale): in front of
 * the face, about 30 cm out, at the chin (head centre 1.665), so the eyes look down onto it.
 */
export const FILM_GRIP = new Vector3(0, 1.52, 0.32);
// human.py: the hand's centre is 0.585 below the shoulder and the elbow 0.27, so 0.315 from elbow.
const HAND_REACH = 0.315;
// Hand centres just beyond the phone's short ends (147 mm long in landscape), a little below and
// on the camera side: fingers wrap round the edges and the back, so the screen stays in view.
const GRIP_HAND = new Vector3(0.085, -0.025, 0.01);
// Where the phone comes from while it is being raised (taken out at chest height).
const PHONE_START = new Vector3(-0.1, 1.15, 0.22);
const DOWN = new Vector3(0, -1, 0);
// Phone axes (smartphone.glb: +Y top, +Z out of the screen) → body: screen toward the face (−Z),
// top to the person's left (+X), so it is held landscape with the camera toward +Z.
const LANDSCAPE = new Quaternion()
  .setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
const PORTRAIT = new Quaternion()
  .setFromAxisAngle(new Vector3(1, 0, 0), -0.5)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
const tmp = {
  q: new Quaternion(),
  upper: new Quaternion(),
  fore: new Quaternion(),
  pitch: new Quaternion(),
  hand: new Vector3(),
  dir: new Vector3(),
  pole: new Vector3(),
  elbow: new Vector3(),
  v: new Vector3(),
};

/**
 * Filming pose: both forearms up, the hands on the ends of a phone held landscape in front of the
 * face, its camera toward the subject. `amount` (0…1) blends from whatever pose the arms are in
 * (raising and lowering it); `pitch` tilts the camera down (+) or up (−). The phone becomes a
 * child of the body. Each arm is a two-bone IK in the body's frame with the elbow dropping down
 * and out, the way people brace a phone.
 *
 * Why not baked poses from Blender: the phone follows the subject's height (pitch), and the arms
 * have to meet it wherever it is, so the pose is solved here each frame.
 */
export function poseFilming(h: HumanModel, phone: Object3D, amount: number, pitch: number): void {
  const t = Math.min(1, Math.max(0, amount));
  if (phone.parent !== h.body) h.body.add(phone);
  phone.visible = t > 0.15; // still in the pocket at first
  tmp.pitch.setFromAxisAngle(tmp.v.set(1, 0, 0), pitch);
  const held = tmp.q.copy(tmp.pitch).multiply(LANDSCAPE);
  phone.position.lerpVectors(PHONE_START, FILM_GRIP, t);
  phone.quaternion.slerpQuaternions(PORTRAIT, held, t);
  for (const k of [0, 1] as const) {
    const side = k === 0 ? -1 : 1; // [right (−X), left (+X)]
    const shoulder = h.arms[k].position;
    const a = h.forearms[k].position.length();
    const b = HAND_REACH;
    const hand = tmp.hand
      .set(side * GRIP_HAND.x, GRIP_HAND.y, GRIP_HAND.z)
      .applyQuaternion(tmp.pitch)
      .add(FILM_GRIP);
    const dir = tmp.dir.subVectors(hand, shoulder);
    const dist = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, dir.length()));
    dir.normalize();
    // Law of cosines for the angle at the shoulder; the elbow goes toward the pole.
    const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = tmp.pole.set(side * 0.35, -1, 0.3);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = tmp.elbow
      .copy(shoulder)
      .addScaledVector(dir, a * cosA)
      .addScaledVector(pole, a * sinA);
    hand.copy(shoulder).addScaledVector(dir, dist);
    const upper = tmp.upper.setFromUnitVectors(DOWN, tmp.v.subVectors(elbow, shoulder).normalize());
    const fore = tmp.fore
      .setFromUnitVectors(DOWN, tmp.v.subVectors(hand, elbow).normalize())
      .premultiply(tmp.q.copy(upper).invert());
    h.arms[k].quaternion.slerp(upper, t);
    h.forearms[k].quaternion.slerp(fore, t);
  }
}

/** Only per-person attachments are owned; body parts and umbrellas keep their shared geometry. */
export function disposeHuman(h: HumanModel): void {
  h.root.traverse((o) => {
    const isOwnedGeometry = o instanceof Mesh && !o.userData.shared;
    if (isOwnedGeometry) o.geometry.dispose();
  });
}
