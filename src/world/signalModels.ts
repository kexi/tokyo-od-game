import { type BufferGeometry, type Material, Mesh, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { UntonemappedBasicMaterial } from "../render/untonemapped";
import { sharedDraco } from "../render/draco";
import { PED_HEAD, SIGNAL_HEADS, VEHICLE_HEAD } from "../signals/heads";

/**
 * 信号機 parts modelled in Blender (scripts/blender/signals.py → public/models/signals.glb) and
 * the lens artwork drawn by scripts/textures/signal_textures.py (assets/signals/textures).
 * Dimensions in the model are real (src/signals/heads.ts: 300 mm lenses 0.37 m apart, 250 mm
 * pedestrian lenses); the game draws heads a little larger so they read at driving distance.
 */
const ARTWORK = import.meta.glob<string>("../../assets/signals/textures/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

// Lamp positions and the hanger are not here: src/signals/heads.ts declares them once for the
// model (via assets/signals/heads.json) and the game (lampLayout).

/** One glTF mesh; several primitives (one per material) when it uses more than one material. */
export type Part = Array<{ geometry: BufferGeometry; material: Material }>;
export type SignalKit = {
  head: Part;
  /** The 3 灯横型 with its right-arrow row, over approaches whose plan has a 右折矢印 step. */
  headRightArrow: Part;
  pedHead: Part;
  pole: Part;
  arm: Part;
  lamp: BufferGeometry;
  /** The arrow lens (pointing up; lampLayout's `turn` rotates it), lit like the round lamps. */
  arrowLamp: BufferGeometry;
  pedLamp: BufferGeometry;
  /** Lens materials; per-instance colours light them (white artwork × colour). */
  lens: UntonemappedBasicMaterial;
  pedStop: UntonemappedBasicMaterial;
  pedGo: UntonemappedBasicMaterial;
};

let kit: SignalKit | null = null;
export const signalKit = (): SignalKit | null => kit;

export async function loadSignalModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
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
    // The housings of the heads the game shows (VEHICLE_HEAD / PED_HEAD are the one record of which).
    head: part(VEHICLE_HEAD.node),
    headRightArrow: part(SIGNAL_HEADS["vehicle-h3-right"].node),
    pedHead: part(PED_HEAD.node),
    pole: part("SignalPole"),
    arm: part("SignalArm"),
    lamp: part("SignalLamp")[0].geometry,
    arrowLamp: part("SignalArrowLamp")[0].geometry,
    pedLamp: part("PedLamp")[0].geometry,
    lens: lensMaterial(lensMap),
    pedStop: lensMaterial(stopMap),
    pedGo: lensMaterial(goMap),
  };
}
