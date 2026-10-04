import { Group, Mesh, MeshStandardMaterial, type Material, type Object3D } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { warn } from "../log";

/**
 * Blender-built vehicles other than the player's car (scripts/blender/{bus,truck,motorbike,
 * police_car,police_bike}.py): loaded once, cloned per use. Their origin is on the ground at the
 * middle of the length, +Z forward, wheels as nodes spinning about local X. Dimensions come from
 * the root node's extras (written by the scripts) with sane fallbacks.
 */
export type VehicleKind = "bus" | "truck10t" | "truck8t" | "motorbike" | "patrol" | "unmarked" | "shirobai";

const FILES: Record<VehicleKind, string> = {
  bus: "models/bus.glb",
  truck10t: "models/truck10t.glb",
  truck8t: "models/truck8t.glb",
  motorbike: "models/motorbike.glb",
  patrol: "models/police_patrol.glb",
  unmarked: "models/police_unmarked.glb",
  shirobai: "models/police_shirobai.glb",
};
// Length × width × height (m) when the extras are missing.
const SIZE: Record<VehicleKind, [number, number, number]> = {
  bus: [10.5, 2.49, 3.1],
  truck10t: [11.98, 2.49, 3.79],
  truck8t: [8.81, 2.49, 2.78],
  motorbike: [2.05, 0.78, 1.06],
  patrol: [4.94, 1.94, 1.77],
  unmarked: [4.94, 1.94, 1.455],
  shirobai: [2.15, 0.93, 1.55],
};

type Template = { scene: Object3D; size: [number, number, number] };
const templates = new Map<VehicleKind, Template>();

export async function loadVehicleModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(
    new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
  );
  await Promise.all(
    (Object.keys(FILES) as VehicleKind[]).map(async (kind) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${FILES[kind]}`);
        const extras = (gltf.scene.children[0]?.userData ?? {}) as {
          length?: number;
          width?: number;
          height?: number;
        };
        const size: [number, number, number] = [
          extras.length ?? SIZE[kind][0],
          extras.width ?? SIZE[kind][1],
          extras.height ?? SIZE[kind][2],
        ];
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) o.castShadow = true;
        });
        templates.set(kind, { scene: gltf.scene, size });
      } catch (error) {
        warn("vehicle_model_failed", { kind, error: String(error) });
      }
    }),
  );
}

export function hasVehicleModel(kind: VehicleKind): boolean {
  return templates.has(kind);
}

export type VehicleInstance = {
  object: Group;
  kind: VehicleKind;
  length: number;
  width: number;
  height: number;
  wheels: Object3D[];
  /** Red beacons (赤色の警光灯): left and right halves, for flashing. */
  beacons: MeshStandardMaterial[][];
  /** Lamps by role, for brake lights and indicators. */
  lamps: Map<string, MeshStandardMaterial>;
};

/** A copy with its own lamp and beacon materials (so each can light up on its own). */
export function createVehicle(kind: VehicleKind): VehicleInstance | null {
  const t = templates.get(kind);
  if (!t) return null;
  const object = new Group();
  const own = new Map<Material, MeshStandardMaterial>();
  const scene = t.scene.clone(true);
  const wheels: Object3D[] = [];
  const left: MeshStandardMaterial[] = [];
  const right: MeshStandardMaterial[] = [];
  const lamps = new Map<string, MeshStandardMaterial>();
  scene.traverse((o) => {
    if (o.name.startsWith("Wheel")) wheels.push(o);
    if (!(o instanceof Mesh)) return;
    const mats = [o.material].flat() as Material[];
    const mapped = mats.map((m) => {
      const isOwn = /^(Beacon|HeadLamp|TailLamp|Indicator|Reverse|Dest)/.test(m.name);
      if (!isOwn || !(m instanceof MeshStandardMaterial)) return m;
      let c = own.get(m);
      if (!c) {
        c = m.clone();
        own.set(m, c);
        if (m.name.startsWith("BeaconL")) left.push(c);
        else if (m.name.startsWith("BeaconR")) right.push(c);
        else lamps.set(m.name, c);
      }
      return c;
    });
    o.material = Array.isArray(o.material) ? mapped : mapped[0];
  });
  // Beacons dark until switched on.
  for (const m of [...left, ...right]) m.emissiveIntensity = 0;
  object.add(scene);
  return {
    object,
    kind,
    length: t.size[0],
    width: t.size[1],
    height: t.size[2],
    wheels,
    beacons: [left, right],
    lamps,
  };
}

/** 赤色の警光灯 flashing (alternating halves) or off. */
export function setBeacons(v: VehicleInstance, isOn: boolean, now: number): void {
  const phase = Math.floor(now / 160) % 2;
  v.beacons.forEach((side, i) => {
    for (const m of side) m.emissiveIntensity = isOn && phase === i ? 2.5 : 0;
  });
}
