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
  legs: [Group, Group];
  arms: [Group, Group];
  umbrella: Group;
};

/**
 * Pedestrians modelled in Blender by scripts/blender/human.py (public/models/human.glb): torso,
 * head and three hair styles, plus arms and legs whose origins are the shoulder and hip pivots.
 * Textures are white-based greyscale, so each person's colours are material tints.
 */
const PARTS = ["Torso", "Head", "HairShort", "HairLong", "HairBun", "ArmL", "ArmR", "LegL", "LegR"] as const;
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
  root.add(clone("Torso"), clone("Head"), clone(HAIR[Math.abs(variant) % HAIR.length]));
  // Limbs keep their pivot (shoulder / hip) as the group origin, so rotation.x swings them.
  const limb = (name: PartName) => {
    const o = clone(name);
    const pivot = new Group();
    pivot.position.copy(o.position);
    o.position.set(0, 0, 0);
    pivot.add(o);
    root.add(pivot);
    return pivot;
  };
  const arms: [Group, Group] = [limb("ArmR"), limb("ArmL")];
  const legs: [Group, Group] = [limb("LegR"), limb("LegL")];

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
  return { root, legs, arms, umbrella };
}

/** Advance the walk cycle; speed in m/s. */
export function animateHuman(h: HumanModel, phase: number, speed: number, holdingUmbrella: boolean): void {
  const swing = speed > 0.05 ? Math.sin(phase) * Math.min(0.9, 0.35 + speed * 0.12) : 0;
  h.legs[0].rotation.x = swing;
  h.legs[1].rotation.x = -swing;
  h.arms[0].rotation.x = holdingUmbrella ? -1.2 : -swing * 0.8;
  h.arms[1].rotation.x = swing * 0.8;
  h.umbrella.visible = holdingUmbrella;
}

/** Frees what one person owns (the umbrella); body parts share the loaded templates. */
export function disposeHuman(h: HumanModel): void {
  h.root.traverse((o) => {
    if (o instanceof Mesh && !o.userData.shared) o.geometry.dispose();
  });
}
