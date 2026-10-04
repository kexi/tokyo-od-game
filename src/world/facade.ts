import {
  BufferAttribute,
  DataArrayTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterial,
} from "three";
import { QUALITY } from "../device";
import { geodeticToEcef } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";

/**
 * Textured façades for untextured PLATEAU LOD1 buildings. Eight wall styles drawn by
 * scripts/textures/building_textures.py (each tile = 12.8 m × 14 m: four 3.2 m bays × four
 * 3.5 m storeys) are packed into one texture array, colour in RGB and the window mask in A.
 * Each building gets a style chosen from its height and floors counted from its own base
 * (vertex attribute `facade`, computed when a tile loads); windows light up at night.
 *
 * The horizontal pattern is computed from world position, which changes whenever the floating
 * origin is re-anchored. Adding the origin's offset modulo PERIOD keeps it glued to the city;
 * PERIOD is a multiple of the 12.8 m tile so the wrap is invisible.
 */
const PERIOD = 576; // = 12.8 × 45
const TILE_W = 12.8;
const TILE_H = 14.0;

// Texture-array layers, in this order.
const STYLES = [
  "office_glass",
  "office_concrete",
  "office_tile",
  "apartment_balcony",
  "apartment_small",
  "mixed_use",
  "metal_panel",
  "brick",
] as const;
const S = Object.fromEntries(STYLES.map((name, i) => [name, i])) as Record<(typeof STYLES)[number], number>;
// Weighted choices by building height (Tokyo: towers are glass or concrete offices, mid-rises
// mix offices and condominiums, low buildings are small apartments, 雑居ビル and warehouses).
const BY_HEIGHT: Array<[maxHeight: number, choices: Array<[number, number]>]> = [
  [
    12,
    [
      [S.apartment_small, 4],
      [S.mixed_use, 3],
      [S.metal_panel, 2],
      [S.brick, 1],
    ],
  ],
  [
    30,
    [
      [S.apartment_balcony, 3],
      [S.mixed_use, 3],
      [S.office_tile, 2],
      [S.apartment_small, 2],
    ],
  ],
  [
    60,
    [
      [S.office_concrete, 3],
      [S.office_tile, 2.5],
      [S.apartment_balcony, 2.5],
      [S.office_glass, 2],
    ],
  ],
  [
    Infinity,
    [
      [S.office_glass, 6],
      [S.office_concrete, 4],
    ],
  ],
];

const IMAGES = import.meta.glob<string>("../../assets/buildings/textures/facade_*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export const facadeUniforms = {
  uNight: { value: 0 },
  uOrigin: { value: new Vector3() },
  uFacadeTex: { value: null as DataArrayTexture | null },
};

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });

/** Packs every style's colour (RGB) and window mask (A) into one texture array. */
export async function loadFacadeTextures(): Promise<void> {
  // Phones get half resolution (2.3 MB of texture memory instead of 9 MB).
  const scale = QUALITY.isMobile ? 0.5 : 1;
  const width = 512 * scale;
  const height = 560 * scale;
  const data = new Uint8Array(width * height * 4 * STYLES.length);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2D canvas unavailable");
  const pixels = async (file: string) => {
    const url = IMAGES[`../../assets/buildings/textures/${file}.png`];
    if (!url) throw new Error(`missing façade texture ${file}`);
    g.clearRect(0, 0, width, height);
    g.drawImage(await loadImage(url), 0, 0, width, height);
    return g.getImageData(0, 0, width, height).data;
  };
  for (const [layer, style] of STYLES.entries()) {
    const [color, mask] = [await pixels(`facade_${style}`), await pixels(`facade_${style}_mask`)];
    const base = layer * width * height * 4;
    for (let y = 0; y < height; y++) {
      // Canvas rows run top-down; texture rows bottom-up (v = 0 is the building's base).
      const src = (height - 1 - y) * width * 4;
      const dst = base + y * width * 4;
      for (let x = 0; x < width * 4; x += 4) {
        data[dst + x] = color[src + x];
        data[dst + x + 1] = color[src + x + 1];
        data[dst + x + 2] = color[src + x + 2];
        data[dst + x + 3] = mask[src + x];
      }
    }
  }
  const tex = new DataArrayTexture(data, width, height, STYLES.length);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = QUALITY.isMobile ? 2 : 8;
  tex.needsUpdate = true;
  facadeUniforms.uFacadeTex.value = tex;
}

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/**
 * Per-vertex `facade` = (style + tint, height above the building's base). `positions` are the
 * vertices in the tileset's ECEF frame; `idAt` gives each vertex's building within the tile.
 */
export function addFacadeAttribute(
  geometry: BufferGeometry,
  ecef: Float32Array,
  idAt: ((vertex: number) => number) | null,
): void {
  const count = geometry.getAttribute("position").count;
  // Local "up" for the tile: the radial direction at its centre (≤0.2° from the ellipsoid normal).
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += ecef[i * 3];
    cy += ecef[i * 3 + 1];
    cz += ecef[i * 3 + 2];
  }
  const len = Math.hypot(cx, cy, cz) || 1;
  const [ux, uy, uz] = [cx / len, cy / len, cz / len];
  const heights = new Float32Array(count);
  const low = new Map<number, number>();
  const high = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const h = ecef[i * 3] * ux + ecef[i * 3 + 1] * uy + ecef[i * 3 + 2] * uz;
    heights[i] = h;
    const id = idAt ? Math.round(idAt(i)) : 0;
    low.set(id, Math.min(low.get(id) ?? Infinity, h));
    high.set(id, Math.max(high.get(id) ?? -Infinity, h));
  }
  // A tile-wide seed so the same batch id in different tiles gets an independent style.
  const seed = Math.round(cx / count) ^ Math.round(cz / count);
  const style = new Map<number, number>();
  for (const [id, lo] of low) {
    const tall = (high.get(id) ?? lo) - lo;
    const choices = (BY_HEIGHT.find(([max]) => tall <= max) ?? BY_HEIGHT[BY_HEIGHT.length - 1])[1];
    const total = choices.reduce((n, [, w]) => n + w, 0);
    let r = hash(seed, id) * total;
    let pick = choices[0][0];
    for (const [s, w] of choices) {
      if (r < w) {
        pick = s;
        break;
      }
      r -= w;
    }
    style.set(id, pick + 0.05 + 0.9 * hash(id, seed + 1)); // fractional part: brightness tint
  }
  const attr = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const id = idAt ? Math.round(idAt(i)) : 0;
    attr[i * 2] = style.get(id) ?? 0.5;
    attr[i * 2 + 1] = heights[i] - (low.get(id) ?? heights[i]);
  }
  geometry.setAttribute("facade", new BufferAttribute(attr, 2));
}

export function setFacadeOrigin(frame: LocalFrame): void {
  const o = geodeticToEcef(frame.origin.lat, frame.origin.lon, frame.origin.h);
  // Project the ECEF origin onto the frame's own axes (east/up/south) in metres.
  const e = frame.ecefToLocal.elements;
  const east = e[0] * o.x + e[4] * o.y + e[8] * o.z;
  const up = e[1] * o.x + e[5] * o.y + e[9] * o.z;
  const south = e[2] * o.x + e[6] * o.y + e[10] * o.z;
  const wrap = (v: number) => ((v % PERIOD) + PERIOD) % PERIOD;
  facadeUniforms.uOrigin.value.set(wrap(east), wrap(up), wrap(south));
}

export function applyFacade(material: MeshStandardMaterial): void {
  material.customProgramCacheKey = () => "plateau-facade";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeUniforms.uNight;
    shader.uniforms.uOrigin = facadeUniforms.uOrigin;
    shader.uniforms.uFacadeTex = facadeUniforms.uFacadeTex;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFacade = facade;\nvFacadePos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFacadeNormal = normalize(mat3(modelMatrix) * objectNormal);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vFacade;
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
uniform float uNight;
uniform vec3 uOrigin;
uniform highp sampler2DArray uFacadeTex;
float facadeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float facadeWindow = 0.0;
float facadeLit = 0.0;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 fp = vFacadePos + uOrigin;
  vec3 fn = normalize(vFacadeNormal);
  float isWall = 1.0 - step(0.6, abs(fn.y));
  float layer = floor(vFacade.x);
  float tint = fract(vFacade.x);
  // Along the wall: world x or z (whichever the wall runs along); up: height above the base.
  float along = abs(fn.x) > abs(fn.z) ? fp.z : fp.x;
  vec2 uv = vec2(along / ${TILE_W.toFixed(1)}, vFacade.y / ${TILE_H.toFixed(1)});
  vec4 tex = texture(uFacadeTex, vec3(uv, layer));
  facadeWindow = isWall * smoothstep(0.4, 0.6, tex.a);
  // One window per bay and storey: 4 × 4 per tile.
  facadeLit = step(0.6, facadeHash(floor(uv * 4.0) + vec2(layer * 17.0, tint * 97.0)));
  vec3 roof = mix(vec3(0.46, 0.47, 0.48), vec3(0.58, 0.57, 0.55), tint);
  diffuseColor.rgb = isWall > 0.5 ? tex.rgb * (0.88 + 0.24 * tint) : roof;
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, facadeWindow);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * facadeWindow * facadeLit * uNight * 1.2;",
      );
  };
  material.needsUpdate = true;
}
