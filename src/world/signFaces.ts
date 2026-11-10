import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  Quaternion,
  UnsignedByteType,
  Vector3,
  type Camera,
  type Object3D,
  type SpotLight,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { log, warn } from "../log";
import { layerUploader, type LayerUploader } from "../render/layerUpload";
import { DARK_ADAPT, DRIVER_EYE, NIGHT_BASE, WET_RETRO } from "../signs/retroAssumptions";
import { FaceLayerSlots } from "./faceLayerSlots";
import { markHeadlamp, setSignObserver, signGlow } from "./signFaceMaterial";

/**
 * The sign faces' artwork as layers of array textures (FaceLayerPool), and the per-frame state of
 * the player's headlamps the faces return (updateSignLamps). knowledge/sign-system.md
 * 「SignFaceMaterial（G3）」 has the PoC, the sizes and the measurements.
 *
 * A pool holds a fixed number of layers. Layer 0 is the stand-in shown until a face is in
 * (transparent for the plates, the plain blue far face for the 案内標識). Which face holds which
 * layer, what to decode next and when to retry a failed face is faceLayerSlots.ts (pure, tested);
 * when more are wanted than fit, `sign_face_layers_short` says so (once per wanted set) and the
 * furthest faces show layer 0 and are not decoded at all.
 *
 * Upload: render/layerUpload.ts. On WebGPU the decoded ImageBitmap is copied to its layer on the
 * GPU and only that layer's mipmaps drawn; the CPU copy of the array is let go after the first
 * upload. On the WebGL 2 backend (or if three's internals changed) the pixels go into the array's
 * data and three uploads the layer (DataArrayTexture.addLayerUpdate).
 * Why not an atlas (the fallback the design kept): the PoC showed layers update on r186's WebGPU,
 * and an atlas bleeds between cells in the mips and needs margins and new UVs.
 */

/** Where a face's picture comes from: an artwork URL, or a canvas drawn when its decode starts. */
export type FaceSource = { url: string } | { draw: () => HTMLCanvasElement | OffscreenCanvas };

type Want = { source: FaceSource; priority: number };

let renderer: WebGPURenderer | null = null;
const pending: FaceLayerPool[] = [];
const pools: FaceLayerPool[] = [];

/** Hands the renderer to the pools (main.ts, once it is initialised). */
export function bindSignFaceRenderer(r: WebGPURenderer): void {
  renderer = r;
  for (const pool of pending.splice(0)) pool.init();
}

export type PoolOptions = {
  name: string;
  /** Layer width, px (and height, unless `height` is given). */
  size: number;
  /** Layer height, px: the 案内標識's boards are wider than tall. */
  height?: number;
  layers: number;
  anisotropy: number;
  /** RGBA of layer 0 (the stand-in). */
  standIn: [number, number, number, number];
};

/** Decodes in flight at most, per pool. */
const DECODES_AT_ONCE = 4;

export class FaceLayerPool {
  readonly texture: DataArrayTexture;
  /** Bumped whenever a face moves in or out (meshes re-read their layers). */
  version = 0;
  private readonly slots: FaceLayerSlots;
  private sources = new Map<string, FaceSource>();
  private decoding = 0;
  private readonly decoded: Array<{ key: string; image: ImageBitmap }> = [];
  private uploader: LayerUploader | null = null;
  /** Uploads since the pool was made (the review hooks read it). */
  uploads = 0;
  /** Decodes started since the pool was made (the review hooks read it). */
  decodes = 0;

  constructor(readonly options: PoolOptions) {
    const { size, layers, anisotropy, standIn } = options;
    const height = options.height ?? size;
    const data = new Uint8Array(size * height * 4 * layers);
    for (let i = 0; i < size * height; i++) data.set(standIn, i * 4);
    const t = new DataArrayTexture(data, size, height, layers);
    t.name = `sign-faces-${options.name}`;
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.colorSpace = SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = anisotropy;
    // glTF UV convention: v runs down the image (as the PNG textures had flipY = false).
    t.flipY = false;
    t.needsUpdate = true;
    this.texture = t;
    this.slots = new FaceLayerSlots(layers - 1);
    pools.push(this);
    if (renderer) this.init();
    else pending.push(this);
  }

  /** Bytes on the GPU, mipmaps included (4/3 of the base level). */
  get gpuBytes(): number {
    const { size, layers } = this.options;
    return Math.round((size * this.height * 4 * layers * 4) / 3);
  }

  private get height(): number {
    return this.options.height ?? this.options.size;
  }

  get capacity(): number {
    return this.slots.capacity;
  }

  get used(): number {
    return this.slots.used;
  }

  init(): void {
    const r = renderer;
    if (!r || this.uploader) return;
    const uploader = layerUploader(r, this.texture);
    this.uploader = uploader;
    if (uploader.kind === "webgpu") uploader.releaseCpuCopy();
    if (uploader.kind === "three-fallback")
      warn("sign_face_upload_fallback", { pool: this.options.name, reason: uploader.reason });
    log("sign_face_pool_ready", {
      pool: this.options.name,
      size: this.options.size,
      layers: this.options.layers,
      backend: uploader.kind,
      mb: Math.round(this.gpuBytes / 1e5) / 10,
    });
  }

  /** The layer showing `key` now (0 until it is in, and from the moment it is pushed out). */
  layerOf(key: string): number {
    return this.slots.layerOf(key);
  }

  has(key: string): boolean {
    return this.slots.has(key);
  }

  /**
   * The faces wanted from now on, each with its priority (smaller first: the distance). Faces no
   * longer wanted keep their layers until one is needed.
   */
  want(entries: Map<string, Want>): void {
    this.sources = new Map([...entries].map(([key, w]) => [key, w.source]));
    const short = this.slots.want(new Map([...entries].map(([key, w]) => [key, w.priority])));
    if (short !== null)
      warn("sign_face_layers_short", { pool: this.options.name, wanted: short, capacity: this.capacity });
  }

  /**
   * Starts decoding up to `maxStarts` of the most wanted faces that fit and are not in
   * (DECODES_AT_ONCE in flight at most), and returns how many it started. A drawn face is drawn
   * here, inside the call, so the caller can time the canvas work (boardFacePool.ts slices it by
   * a FrameWork budget).
   */
  start(maxStarts = DECODES_AT_ONCE, now = performance.now()): number {
    if (!this.uploader) return 0;
    const room = Math.min(maxStarts, DECODES_AT_ONCE - this.decoding);
    let started = 0;
    for (const key of this.slots.toDecode(room, now)) {
      const source = this.sources.get(key);
      if (!source) continue;
      this.decode(key, source);
      started++;
    }
    return started;
  }

  /** Uploads up to `perFrame` decoded faces. True when one moved in (meshes re-read their layers). */
  pump(perFrame = 2): boolean {
    const uploader = this.uploader;
    if (!uploader) return false;
    let moved = false;
    for (let n = 0; n < perFrame && this.decoded.length > 0; n++) {
      const next = this.decoded.shift();
      if (!next) break;
      const layer = this.slots.place(next.key);
      if (layer !== null) {
        this.upload(uploader, layer, next.image);
        moved = true;
      }
      next.image.close();
    }
    if (moved) this.version++;
    return moved;
  }

  private decode(key: string, source: FaceSource): void {
    this.slots.started(key);
    this.decoding++;
    this.decodes++;
    const { size } = this.options;
    const options: ImageBitmapOptions = {
      resizeWidth: size,
      resizeHeight: this.height,
      resizeQuality: "high",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    };
    const bitmap =
      "url" in source
        ? fetch(source.url).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.blob().then((b) => createImageBitmap(b, options));
          })
        : drawn(source.draw, options);
    bitmap
      .then((image) => this.decoded.push({ key, image }))
      .catch((error: unknown) => {
        this.slots.failed(key, performance.now());
        warn("sign_face_load_failed", { pool: this.options.name, key, error: String(error) });
      })
      .finally(() => this.decoding--);
  }

  private upload(uploader: LayerUploader, layer: number, image: ImageBitmap): void {
    this.uploads++;
    if (uploader.kind === "webgpu") {
      uploader.write(layer, image);
      return;
    }
    const { size } = this.options;
    const canvas = new OffscreenCanvas(size, this.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, size, this.height).data;
    (this.texture.image.data as Uint8Array).set(pixels, size * this.height * 4 * layer);
    this.texture.addLayerUpdate(layer);
    this.texture.needsUpdate = true;
  }
}

/**
 * A drawn face's bitmap: the canvas is drawn now (synchronously, so its cost falls inside
 * FaceLayerPool.start), the copy to a bitmap runs off the main thread. A draw that throws is a
 * failed face (backed off like a failed fetch).
 * Why not draw in a microtask (before G5): the draw then ran outside any budget, after the frame's
 * work was measured.
 */
function drawn(
  draw: () => HTMLCanvasElement | OffscreenCanvas,
  options: ImageBitmapOptions,
): Promise<ImageBitmap> {
  try {
    return createImageBitmap(draw(), options);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

const isShown = (o: Object3D | null): boolean => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

const QUAT = new Quaternion();
const EYE = new Vector3();
/** What the faces read last (the review hooks report it). */
export const lampState = {
  on: false,
  high: false,
  gain: 0,
  base: 1,
  observer: "camera" as "driver" | "camera",
};
/** Dev only (the review): see the faces from the placed camera rather than the driver's eye. */
let observerOverride: "driver" | "camera" | null = null;
export function setSignObserverMode(mode: "driver" | "camera" | null): void {
  observerOverride = mode;
}

/** Tags the player's headlamps before any face is built (only they lose the faces' glossy lobe). */
export function markPlayerHeadlamps(lights: readonly SpotLight[]): void {
  for (const light of lights) markHeadlamp(light);
}

/**
 * The player's headlamps for this frame: positions and aim from its SpotLights (lit when their
 * intensity is above 0 and the car is shown), the beam, how dark it is (0–1: env.nightFactor, a
 * tunnel's darkness may be passed instead), how wet the faces are (env.wetness), and the eye the
 * game's `camera` sees the faces from: the driver's (`driverEye`, else DRIVER_EYE on the car) while
 * `inCar`, else the camera's own. Called every frame, the replay's included.
 */
export function updateSignLamps(
  lights: readonly SpotLight[],
  state: {
    highBeam: boolean;
    darkness: number;
    wetness: number;
    camera: Camera;
    inCar: boolean;
    driverEye?: Vector3 | null;
  },
): void {
  const [a, b] = lights;
  const isLit = a !== undefined && a.intensity > 0 && isShown(a);
  const dark = smooth(DARK_ADAPT.value.from, DARK_ADAPT.value.to, state.darkness);
  const wet = 1 + (WET_RETRO.value - 1) * Math.min(Math.max(state.wetness, 0), 1);
  const car = a?.parent ?? null;
  if (a) {
    a.getWorldPosition(signGlow.lampA.value);
    (b ?? a).getWorldPosition(signGlow.lampB.value);
  }
  if (car) {
    car.getWorldQuaternion(QUAT);
    signGlow.forward.value.set(0, 0, 1).applyQuaternion(QUAT);
    signGlow.up.value.set(0, 1, 0).applyQuaternion(QUAT);
  }
  const mode = observerOverride ?? (state.inCar ? "driver" : "camera");
  const fallbackEye = () => {
    if (!car) return null;
    const { x, y, z } = DRIVER_EYE.value;
    return car.localToWorld(EYE.set(x, y, z));
  };
  const eye = mode === "driver" ? (state.driverEye ?? fallbackEye()) : null;
  setSignObserver(state.camera, eye);
  signGlow.high.value = state.highBeam ? 1 : 0;
  signGlow.gain.value = isLit ? dark * wet : 0;
  signGlow.base.value = 1 + (NIGHT_BASE.value - 1) * smooth(0, 1, state.darkness);
  lampState.on = isLit;
  lampState.high = state.highBeam;
  lampState.gain = signGlow.gain.value;
  lampState.base = signGlow.base.value;
  lampState.observer = eye ? "driver" : "camera";
  lastEye = eye ? { x: eye.x, y: eye.y, z: eye.z } : null;
}
let lastEye: { x: number; y: number; z: number } | null = null;

/** The pools and the lamps as the review hooks and the perf probe read them (dev only). */
export function debugSignFaces() {
  return {
    pools: pools.map((p) => ({
      name: p.options.name,
      size: p.options.size,
      layers: p.options.layers,
      used: p.used,
      uploads: p.uploads,
      decodes: p.decodes,
      bytes: p.gpuBytes,
    })),
    lamps: {
      ...lampState,
      positions: [signGlow.lampA.value, signGlow.lampB.value].map(({ x, y, z }) => ({ x, y, z })),
      forward: { ...signGlow.forward.value },
      up: { ...signGlow.up.value },
      /** The driver's eye the game camera sees the faces from (null: the camera itself). */
      eye: lastEye,
    },
    setObserver: setSignObserverMode,
  };
}
