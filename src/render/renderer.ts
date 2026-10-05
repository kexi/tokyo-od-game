import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, type RenderTarget } from "three";
import { WebGPURenderer } from "three/webgpu";
import type { GraphicsSettings } from "../graphics";
import type { MessageKey } from "../i18n";
import { log, warn } from "../log";

/**
 * The game's renderer: three's WebGPURenderer, on WebGPU where the browser has it and on its WebGL 2
 * backend otherwise (or when 画質 描画方式 asks for WebGL 2). Every material in the app is a node
 * material underneath (the classic Mesh*Material are converted by the renderer), so both backends
 * draw the same shaders.
 *
 * Depth: a reversed float depth buffer (1 at the near plane, 0 at infinity, depth32float). The world
 * spans 0.5 m to 40 km; with the old [0, 1] buffer, road paint and kerbs a few hundred metres away
 * flickered. Reversed float depth spreads its precision evenly over distance (about 2^-23 of the
 * distance: 0.5 mm at 4 km), better than the logarithmic buffer the WebGL version used.
 * Why not the logarithmic buffer here: it writes the depth from the fragment shader, which turns off
 * the GPU's early depth test, so every hidden façade and road fragment behind a building is shaded
 * in full; reversed depth keeps early-Z and costs nothing. The logarithmic buffer stays only as the
 * fallback for a WebGL 2 without EXT_clip_control (three then cannot reverse the depth range).
 */
export type RenderInfo = {
  backend: "webgpu" | "webgl2";
  depth: "reversed" | "logarithmic";
  /** For 設定 (an i18n key): what is running, and why WebGL 2 when it is. */
  label: MessageKey;
};

/** -1 with a standard depth buffer; +1 with a reversed one (nearer is a larger depth). */
let depthTowardEye = -1;

/**
 * A polygon offset that pulls a decal towards the eye, whichever way the depth buffer runs. Why:
 * three passes polygonOffsetFactor/Units through unchanged, and with a reversed depth buffer the
 * usual negative offset pushes the decal behind the surface it is painted on.
 */
export function towardEye(units: number): number {
  return Math.abs(units) * depthTowardEye;
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  settings: Pick<GraphicsSettings, "backend">,
  quality: { antialias: boolean; pixelRatio: number; shadows: boolean },
): Promise<{ renderer: WebGPURenderer; info: RenderInfo }> {
  const isWebGLAsked = settings.backend === "webgl";
  const renderer = new WebGPURenderer({
    canvas,
    antialias: quality.antialias,
    // Opaque canvas, as the WebGL renderer was: the page behind must never show through.
    alpha: false,
    powerPreference: "high-performance",
    reversedDepthBuffer: true,
    forceWebGL: isWebGLAsked,
  });
  renderer.onDeviceLost = (lost) => warn("gpu_device_lost", { reason: lost.reason, message: lost.message });
  await renderer.init();
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  // The WebGL 2 backend drops the reversed depth without EXT_clip_control: fall back to the
  // logarithmic buffer before any material is built (NodeMaterial reads the flag when it builds).
  const isReversed = renderer.reversedDepthBuffer;
  if (!isReversed) (renderer as { logarithmicDepthBuffer: boolean }).logarithmicDepthBuffer = true;
  depthTowardEye = isReversed ? 1 : -1;
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  const webgl = isWebGLAsked ? "graphics.runningWebglAsked" : "graphics.runningWebglFallback";
  const info: RenderInfo = {
    backend: isWebGPU ? "webgpu" : "webgl2",
    depth: isReversed ? "reversed" : "logarithmic",
    label: isWebGPU ? "graphics.runningWebgpu" : webgl,
  };
  log("renderer", { backend: info.backend, depth: info.depth, samples: renderer.samples });
  return { renderer, info };
}

/**
 * The pixels of an 8-bit RGBA target, tightly packed with the rows bottom-up (as WebGL's
 * readPixels gives them, which the photo developing expects). WebGPU hands rows top-down, each
 * padded to 256 bytes; the WebGL 2 backend gives them packed and bottom-up already.
 */
export async function readPixels(
  renderer: WebGPURenderer,
  target: RenderTarget,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const raw = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Uint8Array;
  const row = width * 4;
  const stride = height > 1 ? (raw.length - row) / (height - 1) : row;
  const isTopDown = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const isPacked = stride === row && !isTopDown;
  if (isPacked) return raw.subarray(0, row * height);
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const from = (isTopDown ? height - 1 - y : y) * stride;
    out.set(raw.subarray(from, from + row), y * row);
  }
  return out;
}
