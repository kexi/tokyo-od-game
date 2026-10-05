import { Group, Mesh, MeshStandardMaterial, type Material, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { warn } from "../log";
import type { HumanModel } from "./human";
import { sharedDraco } from "../render/draco";

/**
 * Uniformed officers on foot for the roadside stop and the 検問: the 制服警察官 of
 * scripts/blender/police.py (public/models/police.glb) and the standing 白バイ隊員 of
 * scripts/blender/police_bike.py (police_rider.glb). Both share human.glb's skeleton (the parts'
 * origins are the joints), so they are built into the same HumanModel rig and animateHuman walks
 * them. No real emblem or organisation name is on either model.
 *
 * police.glb carries its dress variants as separate nodes (glTF cannot hide one), listed in the
 * scene's extras: 地域 (patrol), 交通整理 (traffic: the reflective vest and the white cap cover)
 * and 夏服 (summer: short sleeves, the light blue shirt and navy trousers). Everything not listed
 * for the chosen variant stays out.
 *
 * Parts are found by their glTF node names. GLTFLoader turns a node whose mesh has several
 * primitives (several materials: the torso's shirt, trousers, belt and skin) into a Group of that
 * name holding Meshes named `<name>_1`, `<name>_2`…; a single-primitive node is the Mesh itself.
 * Why not collect the Meshes by name: the multi-material parts (the torso, the right arm, the
 * forearms, the shins, the rider's head) would be missed — the torso was, and the car showed
 * through the officer.
 */
export type OfficerKind = "foot" | "rider";
export type OfficerDress = "patrol" | "traffic" | "summer";

/** Every node name the two models use for a body part (human.glb's, plus the dress variants). */
export const PART_NAMES: ReadonlySet<string> = new Set([
  "Torso",
  "Head",
  "HairShort",
  "Cap",
  "CapCover",
  "Vest",
  "Tie",
  "UpperArmL",
  "UpperArmR",
  "UpperArmShortL",
  "UpperArmShortR",
  "ForearmL",
  "ForearmR",
  "ForearmBareL",
  "ForearmBareR",
  "ThighL",
  "ThighR",
  "ShinL",
  "ShinR",
]);

type Variants = Partial<Record<OfficerDress, string[]>>;
/** police.glb's extras: which nodes each dress shows, and the colours of the cloth. */
type PoliceExtras = {
  variants?: Record<string, { show?: string[] }>;
  colors?: Record<string, string>;
};
type Template = {
  parts: Map<string, Object3D>;
  variants: Variants;
  colors: Record<string, string>;
  /** Materials recoloured per dress (made once, shared by every officer in that dress). */
  dressed: Map<string, Material>;
};
const templates: Partial<Record<OfficerKind, Template>> = {};
const FILES: Record<OfficerKind, string> = { foot: "models/police.glb", rider: "models/police_rider.glb" };
/** Always shown on the foot officer whatever the dress (the rest are in the variants' lists). */
const BASE_FOOT = ["Torso", "Head", "HairShort", "ThighL", "ThighR", "ShinL", "ShinR"];
const BASE_RIDER = [
  "Torso",
  "Head",
  "UpperArmL",
  "UpperArmR",
  "ForearmL",
  "ForearmR",
  "ThighL",
  "ThighR",
  "ShinL",
  "ShinR",
];
/** The joints' parts (their origin is the pivot): the rest hang on the body as they are. */
const JOINTED = new Set(["UpperArm", "UpperArmShort", "Forearm", "ForearmBare", "Thigh", "Shin"]);

/** The parts of a loaded model by node name (the Group of a multi-material part, else the Mesh). */
export function collectParts(root: Object3D): Map<string, Object3D> {
  const parts = new Map<string, Object3D>();
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.userData.shared = true; // template geometry: never dispose per officer
    }
    const isPart = PART_NAMES.has(o.name) && !parts.has(o.name);
    if (isPart) parts.set(o.name, o);
  });
  return parts;
}

/** The parts an officer of `kind` in `dress` shows. */
export function shownParts(kind: OfficerKind, dress: OfficerDress, variants: Variants): Set<string> {
  return new Set(kind === "rider" ? BASE_RIDER : [...BASE_FOOT, ...(variants[dress] ?? [])]);
}

/** Registers a loaded model (the loader, and tests with a stand-in scene). */
export function registerOfficer(kind: OfficerKind, root: Object3D, extras: PoliceExtras = {}): void {
  const variants: Variants = {};
  for (const [name, v] of Object.entries(extras.variants ?? {}))
    variants[name as OfficerDress] = v.show ?? [];
  templates[kind] = { parts: collectParts(root), variants, colors: extras.colors ?? {}, dressed: new Map() };
}

/** Loads both models once; createOfficer returns null for one that failed (the scene goes without). */
export async function loadOfficerModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
  await Promise.all(
    (Object.keys(FILES) as OfficerKind[]).map(async (kind) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${FILES[kind]}`);
        const extras = gltf.scene.userData as { police?: PoliceExtras };
        registerOfficer(kind, gltf.scene, extras.police ?? {});
      } catch (error) {
        warn("officer_model_failed", { kind, error: String(error) });
      }
    }),
  );
}

/** 夏服 from June to September (警察官の服制に関する規則 第3条), else the 合・冬 dress. */
export function dressFor(month: number, traffic: boolean): OfficerDress {
  const isSummer = month >= 6 && month <= 9;
  if (isSummer) return "summer";
  return traffic ? "traffic" : "patrol";
}

/**
 * The cloth's colour for a dress, by material name (police.glb's extras `colors`): the summer shirt
 * light blue and trousers navy; bare hands in the 地域 dress (white gloves for 交通整理).
 */
function dressColour(t: Template, dress: OfficerDress, material: string): string | null {
  if (dress === "summer" && material === "Shirt") return t.colors.summerShirt ?? null;
  if (dress === "summer" && material === "Pants") return t.colors.summerTrousers ?? null;
  if (dress !== "traffic" && material === "Hands") return t.colors.skin ?? null;
  return null;
}

function dressed(t: Template, dress: OfficerDress, m: Material): Material {
  const colour = dressColour(t, dress, m.name);
  if (!colour || !(m instanceof MeshStandardMaterial)) return m;
  const key = `${dress}:${m.name}`;
  let c = t.dressed.get(key);
  if (!c) {
    const copy = m.clone();
    copy.color.set(colour);
    c = copy;
    t.dressed.set(key, c);
  }
  return c;
}

/**
 * An officer (feet at y = 0, facing +Z) rigged like a pedestrian. `dress` only applies to the foot
 * officer; the rider wears the 乗車服.
 */
export function createOfficer(kind: OfficerKind, dress: OfficerDress = "patrol"): HumanModel | null {
  const t = templates[kind];
  if (!t) return null;
  const shown = shownParts(kind, dress, t.variants);
  // The summer arms take the long sleeves' place on the same joints.
  const upperName = (side: "L" | "R") =>
    shown.has(`UpperArmShort${side}`) ? `UpperArmShort${side}` : `UpperArm${side}`;
  const foreName = (side: "L" | "R") =>
    shown.has(`ForearmBare${side}`) ? `ForearmBare${side}` : `Forearm${side}`;
  const clone = (name: string): Object3D => {
    const part = t.parts.get(name);
    if (!part) return new Group();
    const copy = part.clone(true);
    if (kind === "foot")
      copy.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const list = [o.material].flat() as Material[];
        const mapped = list.map((m) => dressed(t, dress, m));
        o.material = Array.isArray(o.material) ? mapped : mapped[0];
      });
    return copy;
  };
  const root = new Group();
  const body = new Group();
  root.add(body);
  for (const name of shown) {
    const isJoint = JOINTED.has(name.replace(/[LR]$/, ""));
    if (!isJoint) body.add(clone(name));
  }
  const joint = (name: string, parent: Group, parentPivot: Group | null) => {
    const o = clone(name);
    const pivot = new Group();
    pivot.position.copy(o.position);
    if (parentPivot) pivot.position.sub(parentPivot.position);
    o.position.set(0, 0, 0);
    pivot.add(o);
    parent.add(pivot);
    return pivot;
  };
  const arms: [Group, Group] = [joint(upperName("R"), body, null), joint(upperName("L"), body, null)];
  const legs: [Group, Group] = [joint("ThighR", body, null), joint("ThighL", body, null)];
  const forearms: [Group, Group] = [
    joint(foreName("R"), arms[0], arms[0]),
    joint(foreName("L"), arms[1], arms[1]),
  ];
  const shins: [Group, Group] = [joint("ShinR", legs[0], legs[0]), joint("ShinL", legs[1], legs[1])];
  const umbrella = new Group();
  umbrella.visible = false;
  root.add(umbrella);
  return { root, body, legs, shins, arms, forearms, umbrella };
}
