import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
  const loader = new GLTFLoader().setDRACOLoader(
    new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
  );
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

/** Person (~1.7 m × height) with pivoting limbs for a walk cycle. Feet at y = 0, facing +Z. */
export function createHuman(colors: HumanColors, height = 1, variant = 0): HumanModel {
  if (!parts) throw new Error("loadHumanModels() has not finished");
  const root = new Group();
  const clone = (name: PartName) => {
    const o = parts?.[name].clone(true) as Object3D;
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
  const canopy = new Mesh(new ConeGeometry(0.55, 0.25, 12, 1, true), umbrellaMaterial(colors.umbrella));
  canopy.position.y = 2.05;
  const shaft = new Mesh(new CylinderGeometry(0.01, 0.01, 0.7), shaftMaterial);
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
  for (const [k, offset] of [
    [0, 0],
    [1, Math.PI],
  ] as const) {
    const p = phase + offset;
    // Positive rotation.x moves a hanging limb backward (toward −Z).
    h.legs[k].rotation.x = -hipAmp * Math.sin(p);
    const swing = Math.max(0, Math.cos(p)) ** 2;
    h.shins[k].rotation.x = isMoving ? 0.08 + swing * (0.9 + run * 0.8) : 0.03;
    const armSwing = hipAmp * (0.7 + run * 0.3) * Math.sin(p);
    h.arms[k].rotation.x = armSwing;
    // Forearms bend forward (negative); more on the forward swing and when running.
    h.forearms[k].rotation.x = isMoving ? -(0.2 + 0.25 * Math.max(0, -Math.sin(p)) + run * 1.1) : -0.08;
  }
  if (holdingUmbrella) {
    h.arms[0].rotation.x = -0.45;
    h.forearms[0].rotation.x = -1.35;
  }
  h.body.position.y = isMoving ? (0.012 + run * 0.02) * Math.cos(2 * phase) : 0;
  h.body.rotation.y = isMoving ? 0.04 * Math.sin(phase) : 0;
  h.umbrella.visible = holdingUmbrella;
}

/** Frees what one person owns (the umbrella); body parts share the loaded templates. */
export function disposeHuman(h: HumanModel): void {
  h.root.traverse((o) => {
    if (o instanceof Mesh && !o.userData.shared) o.geometry.dispose();
  });
}
