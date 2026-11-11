import type { DataArrayTexture } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { LayerMipmapper } from "./layerMips";

/**
 * How one layer of a DataArrayTexture is written, with every reach into three's internals in this
 * one place (three 0.186.1; knowledge/webgpu-migration.md「three を上げるときに見ること」):
 * - `renderer.backend.isWebGPUBackend` / `.device`: the WebGPU backend and its GPUDevice;
 * - `renderer.backend.get(texture).texture`: the GPUTexture three made for the array (after
 *   `renderer.initTexture`), which must allow COPY_DST and RENDER_ATTACHMENT (copyExternalImage
 *   and the mip passes) and TEXTURE_BINDING, and carry its mip levels and all its layers;
 * - three reads `texture.image.data` again only when `needsUpdate` is set, so on the WebGPU path
 *   the CPU copy is let go after the first upload and needsUpdate is never set again.
 *
 * - "webgpu": the layer is copied on the GPU (copyExternalImageToTexture) and only its mips drawn.
 * - "webgl2": the WebGL 2 backend; the caller writes the pixels into image.data and asks three for
 *   that layer (addLayerUpdate), which regenerates all mips (glGenerateMipmap, cheap there).
 * - "three-fallback": WebGPU, but three's internals are not what this expects (a three update): the
 *   same path as "webgl2", correct but slow (three redraws every layer's mips, 20–57 ms), with the
 *   reason for the log.
 */
export type LayerUploader =
  | { kind: "webgpu"; write(layer: number, image: ImageBitmap): void; releaseCpuCopy(): void }
  | { kind: "webgl2" }
  | { kind: "three-fallback"; reason: string };

type Backend = {
  isWebGPUBackend?: boolean;
  device?: GPUDevice;
  get?: (o: object) => { texture?: GPUTexture } | undefined;
};

/** Usage bits the GPU path needs (WebGPU's GPUTextureUsage values, fixed by the spec). */
const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;

const fallback = (reason: string): LayerUploader => ({ kind: "three-fallback", reason });

export function layerUploader(renderer: WebGPURenderer, texture: DataArrayTexture): LayerUploader {
  renderer.initTexture(texture);
  const backend = renderer.backend as unknown as Backend;
  const isWebGPU = backend.isWebGPUBackend === true;
  if (!isWebGPU) return { kind: "webgl2" };
  const device = backend.device;
  if (!device) return fallback("backend.device is missing");
  const gpu = typeof backend.get === "function" ? backend.get(texture)?.texture : undefined;
  if (!gpu || typeof gpu.createView !== "function")
    return fallback("backend.get(texture).texture is not a GPUTexture");
  const needed = COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT;
  const hasUsage = (gpu.usage & needed) === needed;
  if (!hasUsage)
    return fallback(`texture usage ${gpu.usage} lacks COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT`);
  const hasLayers = gpu.depthOrArrayLayers === texture.image.depth && gpu.mipLevelCount > 1;
  if (!hasLayers)
    return fallback(`texture has ${gpu.depthOrArrayLayers} layers and ${gpu.mipLevelCount} mip levels`);
  const mips = new LayerMipmapper(device);
  return {
    kind: "webgpu",
    write(layer, image) {
      device.queue.copyExternalImageToTexture(
        { source: image, flipY: false },
        { texture: gpu, mipLevel: 0, origin: { x: 0, y: 0, z: layer }, premultipliedAlpha: false },
        { width: gpu.width, height: gpu.height, depthOrArrayLayers: 1 },
      );
      mips.generate(gpu, layer);
    },
    releaseCpuCopy() {
      texture.image.data = new Uint8Array(0);
    },
  };
}
