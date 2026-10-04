import { type BufferGeometry, type Material, Mesh, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { UntonemappedBasicMaterial } from "../render/untonemapped";

/**
 * 信号機 parts modelled in Blender (scripts/blender/signals.py → public/models/signals.glb) and
 * the lens artwork drawn by scripts/textures/signal_textures.py (assets/signals/textures).
 * Dimensions in the model are real (300 mm lenses 0.37 m apart, 250 mm pedestrian lenses);
 * the game draws heads a little larger so they read at driving distance.
 */
const ARTWORK = import.meta.glob<string>("../../assets/signals/textures/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export const LAMP_GAP = 0.37;
export const HEAD_HANG = 0.48; // housing centre below the arm (hanger + half the housing)
export const PED_LAMP_Y = 0.175;

/** One glTF mesh; several primitives (one per material) when it uses more than one material. */
export type Part = Array<{ geometry: BufferGeometry; material: Material }>;
export type SignalKit = {
  head: Part;
  pedHead: Part;
  pole: Part;
  arm: Part;
  lamp: BufferGeometry;
  pedLamp: BufferGeometry;
  /** Lens materials; per-instance colours light them (white artwork × colour). */
  lens: UntonemappedBasicMaterial;
  pedStop: UntonemappedBasicMaterial;
  pedGo: UntonemappedBasicMaterial;
};

let kit: SignalKit | null = null;
export const signalKit = (): SignalKit | null => kit;

export async function loadSignalModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(
    new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
  );
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/signals.glb`);
  const part = (name: string): Part => {
    const o = gltf.scene.getObjectByName(name);
    if (!o) throw new Error(`signals.glb has no ${name}`);
    const out: Part = [];
    o.traverse((m) => {
      if (m instanceof Mesh)
        out.push({ geometry: m.geometry as BufferGeometry, material: m.material as Material });
    });
    return out;
  };
  const textures = new TextureLoader();
  const art = async (name: string): Promise<Texture | null> => {
    const url = ARTWORK[`../../assets/signals/textures/${name}.png`];
    if (!url) return null;
    const t = await textures.loadAsync(url);
    t.colorSpace = SRGBColorSpace;
    t.flipY = false; // glTF UVs
    return t;
  };
  const [lensMap, stopMap, goMap] = await Promise.all([art("lens_led"), art("ped_stop"), art("ped_go")]);
  // Lit lamps must stay bright and pure at night and in fog: unlit, and shown as their colour
  // whatever the exposure. Not `toneMapped: false`: WebGPURenderer ignores it (the frame is
  // tone-mapped once at the end, render/untonemapped.ts draws the radiance that shows the colour).
  const lensMaterial = (map: Texture | null) =>
    new UntonemappedBasicMaterial({ map, alphaTest: 0.5, transparent: false });
  kit = {
    head: part("SignalHead"),
    pedHead: part("PedHead"),
    pole: part("SignalPole"),
    arm: part("SignalArm"),
    lamp: part("SignalLamp")[0].geometry,
    pedLamp: part("PedLamp")[0].geometry,
    lens: lensMaterial(lensMap),
    pedStop: lensMaterial(stopMap),
    pedGo: lensMaterial(goMap),
  };
}
