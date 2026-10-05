import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

/**
 * The one Draco decoder every glTF loader of the game shares (the cars, the city, the signs, the
 * PLATEAU tiles…). Why not one per loader as before: each DRACOLoader starts up to four workers,
 * each instantiating its own WebAssembly decoder, and sixteen of them reserved so much Wasm memory
 * in the page's process that later instances failed with "Out of memory" — the speech synthesizer,
 * a model loaded late (the portable speed camera never appeared) and, on a reload, the game itself.
 * Two workers decode as fast for these small meshes.
 */
let shared: DRACOLoader | null = null;

export function sharedDraco(): DRACOLoader {
  shared ??= new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`).setWorkerLimit(2);
  return shared;
}
