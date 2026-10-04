import { Group, Mesh, MeshStandardMaterial, SpotLight, type Material, type Object3D } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Cars modelled in Blender by scripts/blender/car.py (public/models/car.glb): a detailed compact
 * hatchback for the player and a ~3k-triangle LOD for traffic, both with a taxi variant.
 * Chassis frame: +Z forward, +Y up, +X = the car's left, origin at the physics body centre; the
 * ground sits ~0.86 m below it at rest.
 */
export type CarModel = {
  root: Group;
  wheels: Group[]; // FL, FR, RL, RR — matches the physics wheel order
  headlights: SpotLight[];
  setLights(state: {
    brake: boolean;
    reverse: boolean;
    left: boolean;
    right: boolean;
    night: boolean;
    highBeam?: boolean;
  }): void;
};

export type CarStyle = {
  color?: number;
  taxi?: boolean;
  /** Half the body's width and length (m) for the physics, when it is not a car (a 白バイ). */
  halfWidth?: number;
  halfLength?: number;
};

export const WHEEL_RADIUS = 0.36;
// Same order and layout as WHEEL_POSITIONS in physics/vehicle.ts; −X is the driver's (right) side.
const WHEEL_LAYOUT: Array<[number, number]> = [
  [-0.82, 1.35],
  [0.82, 1.35],
  [-0.82, -1.35],
  [0.82, -1.35],
];
const HUB_Y = -0.5;
// Lamp and paint materials are cloned per car so each car's lights and colour are its own.
const PER_CAR = new Set([
  "Paint",
  "HeadLamp",
  "TailLamp",
  "IndicatorL",
  "IndicatorR",
  "Reverse",
  "TaxiSign",
  "Vacancy",
]);

type Templates = { hi: Object3D; low: Object3D; wheel: Object3D; caliper: Object3D };
let templates: Templates | null = null;

/** Loads car.glb once; createCarModel / createLowCar need it to have resolved. */
export async function loadCarModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(
    new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
  );
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/car.glb`);
  const find = (name: string) => {
    const o = gltf.scene.getObjectByName(name);
    if (!o) throw new Error(`car.glb has no ${name}`);
    o.removeFromParent();
    o.traverse((m) => {
      if (m instanceof Mesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return o;
  };
  templates = {
    hi: find("CarHi"),
    low: find("CarLow"),
    wheel: find("Wheel"),
    caliper: find("Caliper"),
  };
  // Traffic shares one set of lamp materials: always lit like daytime running lights.
  templates.low.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshStandardMaterial;
    if (m.name === "LampLowFront") m.emissiveIntensity = 0.9;
    if (m.name === "LampLowRear") m.emissiveIntensity = 0.7;
    if (m.name === "TaxiSign") m.emissiveIntensity = 0.6;
  });
}

function need(): Templates {
  if (!templates) throw new Error("loadCarModels() has not finished");
  return templates;
}

/** Deep clone that swaps materials through `pick` (shared unless it returns a new one). */
function cloneWith(source: Object3D, pick: (m: Material) => Material): Object3D {
  const copy = source.clone(true);
  copy.traverse((o) => {
    if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
  });
  return copy;
}

function setVariant(car: Object3D, taxiName: string, taxi: boolean, privateName?: string): void {
  const taxiParts = car.getObjectByName(taxiName);
  if (taxiParts) taxiParts.visible = taxi;
  const privateParts = privateName ? car.getObjectByName(privateName) : undefined;
  if (privateParts) privateParts.visible = !taxi;
}

export function createCarModel(style: CarStyle | number = {}): CarModel {
  const t = need();
  const opts = typeof style === "number" ? { color: style } : style;
  const own = new Map<string, MeshStandardMaterial>();
  const pick = (m: Material) => {
    if (!PER_CAR.has(m.name)) return m;
    let c = own.get(m.name);
    if (!c) {
      c = (m as MeshStandardMaterial).clone();
      own.set(m.name, c);
    }
    return c;
  };
  const root = new Group();
  root.name = "car";
  const body = cloneWith(t.hi, pick);
  root.add(body);
  setVariant(body, "Taxi", opts.taxi ?? false, "Private");
  // Taxis default to JPN TAXI-like 濃藍.
  own.get("Paint")?.color.setHex(opts.color ?? (opts.taxi ? 0x1d2a4a : 0x1f5fbf));

  const wheels = WHEEL_LAYOUT.map(([x, z]) => {
    const holder = new Group();
    holder.position.set(x, HUB_Y, z);
    const spin = t.wheel.clone(); // children[0]: the vehicle spins it about X
    const caliper = t.caliper.clone();
    // The wheel is modelled with its face toward +X; mirror it for the right-hand side.
    if (x < 0) {
      spin.scale.x = -1;
      caliper.scale.x = -1;
    }
    holder.add(spin, caliper);
    return holder;
  });

  const headlights: SpotLight[] = [];
  for (const side of [-1, 1]) {
    const light = new SpotLight(0xfff2d6, 0, 110, 0.48, 0.55, 1.1);
    light.position.set(side * 0.62, -0.03, 2.1);
    light.target.position.set(side * 0.9, -1.6, 28);
    root.add(light, light.target);
    headlights.push(light);
  }

  const glow = (name: string, intensity: number) => {
    const m = own.get(name);
    if (m) m.emissiveIntensity = intensity;
  };
  return {
    root,
    wheels,
    headlights,
    setLights({ brake, reverse, left, right, night, highBeam }) {
      glow("TailLamp", brake ? 2.4 : night ? 0.9 : 0.12);
      glow("Reverse", reverse ? 2.0 : 0);
      const blink = Math.floor(performance.now() / 380) % 2 === 0;
      glow("IndicatorL", left && blink ? 2.5 : 0); // +X = the car's left
      glow("IndicatorR", right && blink ? 2.5 : 0);
      glow("HeadLamp", night ? (highBeam ? 2.8 : 1.8) : 0.35);
      glow("TaxiSign", night ? 1.2 : 0.3);
      glow("Vacancy", 1.4);
      for (const l of headlights) {
        l.intensity = night ? (highBeam ? 160 : 70) : 0;
        // 走行用前照灯 (high beam) reaches about 100 m, すれ違い用 about 40 m (保安基準 第32条).
        l.distance = highBeam ? 220 : 110;
        l.target.position.y = highBeam ? -0.4 : -1.6;
      }
    },
  };
}

/** One paint material per colour, shared by every traffic car of that colour (draw-call budget). */
const lowPaint = new Map<number, Material>();

/** Low-poly traffic car (one mesh with its wheels baked in, shared materials). */
export function createLowCar(opts: { color: number; taxi?: boolean }): Group {
  const t = need();
  const body = cloneWith(t.low, (m) => {
    if (m.name !== "Paint") return m;
    let paint = lowPaint.get(opts.color);
    if (!paint) {
      const c = (m as MeshStandardMaterial).clone();
      c.color.setHex(opts.color);
      paint = c;
      lowPaint.set(opts.color, paint);
    }
    return paint;
  });
  setVariant(body, "TaxiLow", opts.taxi ?? false);
  const g = new Group();
  g.add(body);
  return g;
}
