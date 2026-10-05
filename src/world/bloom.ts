import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  RenderTarget,
  type Texture,
  Vector2,
  Vector4,
} from "three";
import { type Node, NodeMaterial, QuadMesh, type TextureNode, type WebGPURenderer } from "three/webgpu";
import {
  distance,
  float,
  If,
  Fn,
  max,
  min,
  pow,
  screenUV,
  smoothstep as smoothstepNode,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { GRAPHICS } from "../device";
import type { StreetPass } from "../render/frame";
import { HALF_MAX } from "../render/shaderMath";
import { smoothstep } from "./skyLight";

/**
 * Bloom: bright light spilling over its surroundings in the eye and the lens — lamps, lit windows,
 * signals, headlights, the low sun. A street pass of the frame (render/frame.ts): it runs on the
 * street only, before the motion blur, the wipers and the interior. The frame is linear HDR
 * (half float), so the threshold is a radiance:
 * 1. Prefilter to half resolution (画質 光のにじみ 低: quarter): 4 bilinear taps covering a 4×4 box
 *    (a two-pixel lamp is not missed), each scaled by the exposure (the threshold is in what the eye
 *    sees, whatever it is adapted to), held below CAP (the sun's disc at ~6·10⁴ would flood the
 *    chain), a soft-knee threshold, and a Karis average (weights 1 / (1 + brightness)) against
 *    fireflies.
 * 2. Dual-filter (Kawase) chain down to 1/32 and back up, each level added onto the next larger one
 *    (低: 3 levels below the quarter instead of 4 below the half).
 * 3. Added onto the street in the pass itself: one bilinear tap of the half-resolution sum per pixel,
 *    and, with 画質 レンズフレア, the lamps' ghosts (lensFlare.ts's night half: lamps and headlights
 *    mirrored through the centre of the picture, from a small level of the chain, only for lights
 *    that are points on the picture: see lampGhosts).
 *
 * Why not three's BloomNode (three/addons/tsl/display/BloomNode.js): five mips of a separable
 * Gaussian (11 passes, up to 22 taps) where the dual filter spreads as far in 9 passes of 4–8
 * taps, it has no Karis average, and it renders from updateBefore on the node frame, whose clock is
 * the renderer's animation loop rather than this frame's street passes. Why not the WebGL version's
 * pseudo-HDR expansion of display values (x / (1 − 0.96·max)): the frame is HDR now.
 */
export type BloomSettings = {
  /**
   * Exposed radiance (the frame's value times the tone mapping's exposure) from which light blooms;
   * the soft knee starts KNEE of it lower.
   */
  threshold: number;
  /** How much of the blurred light is added onto the street. */
  strength: number;
};

/** The soft knee's width, as a share of the threshold. */
export const KNEE = 0.35;
/** The brightest exposed radiance a pixel brings into the chain (the sun's disc, glints). */
export const CAP = 40;
/** The day's threshold: above the brightest sky (the horizon at noon, ~5.4) with its knee. */
const DAY_THRESHOLD = 9;
/**
 * The night's: below a lit signal lens's LEDs (~1.0–1.8, render/untonemapped.ts) and a headlamp
 * (~1.4–2.2), above the sky's glow.
 */
const NIGHT_THRESHOLD = 0.55;

/**
 * Night makes lights bloom: by day only what is far brighter than the sky spills (the sun and its
 * glare, glints on water and glass), not a white wall in the sun or the pale sky by the horizon; at
 * night lit windows, lamps, signals and headlights do. The threshold moves between the two in
 * proportion (geometrically): dusk is halfway in stops, not in radiance. Wet air spreads the
 * night's further (rain at night).
 */
export function bloomSettings(night: number, overcast: number): BloomSettings {
  const n = smoothstep(night, 0.05, 0.8);
  return {
    threshold: DAY_THRESHOLD * Math.pow(NIGHT_THRESHOLD / DAY_THRESHOLD, n),
    strength: (0.04 + (0.3 - 0.04) * n) * (1 + 0.35 * overcast * n),
  };
}

/**
 * What a pixel of exposed brightness `b` (its brightest channel) brings into the chain, as a share
 * of itself: 0 below the knee, a quadratic ramp through it, b − threshold above (the shader's
 * curve, here for the tests).
 */
export function bloomShare(b: number, threshold: number): number {
  const knee = threshold * KNEE;
  const held = Math.min(b, CAP);
  const soft = Math.min(Math.max(held - (threshold - knee), 0), 2 * knee);
  const curve = Math.max((soft * soft) / (4 * knee), held - threshold);
  return (curve / Math.max(held, 1e-4)) * (held / Math.max(b, 1e-4));
}

/** 画質 › 光のにじみ: the prefilter's resolution divisor and the number of levels from there. */
export const MODES = { low: { first: 4, levels: 4 }, high: { first: 2, levels: 5 } } as const;
/** The level the lamps' ghosts are sampled from (blurred enough to read as soft discs). */
export const GHOST_LEVEL = 2;

/**
 * The lamps' ghosts: each one's magnification (negative: turned through the centre of the picture,
 * as a reflection between two lens surfaces turns it) and the tint of the coating that reflected
 * it. At most 1.4 times: the old set (−1, −1.43, −2.5, −10) blew a light near the centre up to the
 * whole picture, so a lit tower straight ahead hung upside down under itself as a glowing column.
 */
export const LAMP_GHOST_TAPS: ReadonlyArray<{ scale: number; tint: readonly [number, number, number] }> = [
  { scale: -1, tint: [1, 0.86, 0.62] },
  { scale: -1.4, tint: [0.62, 0.9, 1] },
  { scale: -0.62, tint: [0.85, 1, 0.7] },
  { scale: -0.38, tint: [1, 0.7, 0.9] },
];

/** Where a ghost of magnification `scale` at screen uv (u, v) comes from: 0.5 + (uv − 0.5) / scale. */
export function ghostSourceUv(u: number, v: number, scale: number): [number, number] {
  return [0.5 + (u - 0.5) / scale, 0.5 + (v - 0.5) / scale];
}

/** Texels of the ghost level between a light and the neighbours it is compared with. */
export const ISOLATION_STEP = 2;
/** Ratios of a light to its brightest neighbour from which it makes a ghost, and fully. */
export const ISOLATION_FROM = 2;
export const ISOLATION_FULL = 6;

/**
 * How much of the ghost level at a place makes a ghost, 0–1: only a light that is a point on the
 * picture, brighter than each of its four neighbours ISOLATION_STEP texels away by ISOLATION_FROM
 * or more. Lamps, signals and headlights are points (on the CPU copy of the chain, tests/bloomCpu.ts,
 * a 2-pixel lamp is 20–30 times its neighbours); along a lit tower, a row of lamps or a lit wall,
 * and at a tower's ends, a neighbour is as bright (≤ 1.6), so they make none: their ghost was an
 * inverted copy of their shape. Why not compare the level with a wider one (a point falls by four
 * per level, a line by two): the end of a line passes that test, and a tower cut off by the
 * skyline left a ghost blob of its foot.
 */
export function ghostIsolation(light: number, brightestNeighbour: number): number {
  return smoothstep(light / (brightestNeighbour + 1e-4), ISOLATION_FROM, ISOLATION_FULL);
}

type V3 = Node<"vec3">;
type V4 = Node<"vec4">;

const maxOf = (c: V3) => max(c.x, max(c.y, c.z));

function quadMaterial(name: string, fragment: V4, isAdditive = false): NodeMaterial {
  const m = new NodeMaterial();
  m.name = `bloom-${name}`;
  m.fragmentNode = fragment;
  m.blending = isAdditive ? AdditiveBlending : NoBlending;
  m.depthTest = false;
  m.depthWrite = false;
  m.fog = false;
  return m;
}

const levelTarget = () =>
  new RenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    generateMipmaps: false,
  });

/**
 * A texture node for a texture set later. Each gets its own stand-in: texture nodes that hold the
 * same texture when the shader is built share one binding, and would keep sharing it after.
 */
const later = () => texture(new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }).texture);

export class Bloom implements StreetPass {
  readonly name = "bloom";
  /** The lamps' ghosts (lensFlare.ts sets it: 画質 レンズフレア, at night). 0 draws none. */
  readonly ghosts = uniform(0);
  private levels: RenderTarget[] = [];
  private readonly size = new Vector2();
  // The chain's inputs: each pass samples the level before it (set before each draw).
  private readonly prefilterSource = later();
  private readonly downSource = later();
  private readonly upSource = later();
  private readonly texel = uniform(new Vector2());
  private readonly downTexel = uniform(new Vector2());
  private readonly upTexel = uniform(new Vector2());
  /** threshold, threshold − knee, 2·knee, 1 / (4·knee). */
  private readonly knee = uniform(new Vector4());
  private readonly exposure = uniform(1);
  private readonly strength = uniform(0);
  // What the street pass adds: the half-resolution sum, and the point-like lights of a small level
  // for the ghosts (drawn by the `isolate` pass into `points`).
  private readonly sum = later();
  private readonly ghostSource = later();
  private readonly isolateSource = later();
  private readonly isolateTexel = uniform(new Vector2());
  private readonly points = levelTarget();
  private readonly prefilter = quadMaterial("prefilter", this.buildPrefilter());
  private readonly down = quadMaterial("down", this.buildDown());
  private readonly up = quadMaterial("up", this.buildUp(), true);
  private readonly isolate = quadMaterial("isolate", this.buildIsolate());
  private readonly quad = new QuadMesh(this.prefilter);
  /** The prefilter's divisor the targets were made for. */
  private first = 0;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly settings: () => BloomSettings,
  ) {}

  /** 画質 › 光のにじみ なし skips everything, the copy of the street included. */
  isActive(): boolean {
    return GRAPHICS.settings.bloom !== "off" && this.settings().strength > 0;
  }

  prepare(street: Texture): void {
    const mode = GRAPHICS.settings.bloom;
    if (mode === "off") return;
    const r = this.renderer;
    const { threshold, strength } = this.settings();
    r.getDrawingBufferSize(this.size);
    this.fit(this.size.x, this.size.y, MODES[mode].first, MODES[mode].levels);
    const knee = threshold * KNEE;
    this.knee.value.set(threshold, threshold - knee, 2 * knee, 0.25 / knee);
    this.exposure.value = r.toneMappingExposure;
    this.strength.value = strength;
    this.prefilterSource.value = street;
    this.texel.value.set(1 / this.size.x, 1 / this.size.y);
    this.draw(this.prefilter, this.levels[0]);
    const count = this.levels.length;
    for (let i = 1; i < count; i++) {
      const from = this.levels[i - 1];
      this.downSource.value = from.texture;
      this.downTexel.value.set(1 / from.width, 1 / from.height);
      this.draw(this.down, this.levels[i]);
    }
    for (let i = count - 1; i > 0; i--) {
      const from = this.levels[i];
      this.upSource.value = from.texture;
      this.upTexel.value.set(1 / from.width, 1 / from.height);
      this.draw(this.up, this.levels[i - 1]);
    }
    this.sum.value = this.levels[0].texture;
    const hasGhosts = this.ghosts.value > 0;
    if (!hasGhosts) return;
    // The point-like lights of the ghost level, at its size (a few thousand pixels, five taps each).
    const level = this.levels[Math.min(GHOST_LEVEL, count - 1)];
    if (this.points.width !== level.width || this.points.height !== level.height)
      this.points.setSize(level.width, level.height);
    this.isolateSource.value = level.texture;
    this.isolateTexel.value.set(1 / level.width, 1 / level.height);
    this.draw(this.isolate, this.points);
    this.ghostSource.value = this.points.texture;
  }

  /** The street with the bloom (and the lamps' ghosts) added: it brightens, never darkens. */
  build(street: TextureNode): Node<"vec4"> {
    return Fn(() => {
      const base = street.sample(screenUV);
      const lit = base.rgb.add(this.sum.sample(screenUV).rgb.mul(this.strength)).toVar();
      If(this.ghosts.greaterThan(0), () => {
        lit.addAssign(lampGhosts(this.ghostSource).mul(this.ghosts));
      });
      // Within half float: the sun's disc plus the bloom would overflow (shaderMath HALF_MAX).
      return vec4(min(lit, vec3(HALF_MAX)), base.a);
    })();
  }

  private draw(material: NodeMaterial, target: RenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  private buildPrefilter(): V4 {
    const src = this.prefilterSource;
    const k = this.knee;
    const tap = (dx: number, dy: number) => {
      const c = max(src.sample(screenUV.add(this.texel.mul(vec2(dx, dy)))).rgb, vec3(0));
      const seen = c.mul(this.exposure);
      const bright = maxOf(seen);
      const held = min(bright, CAP);
      const soft = min(max(held.sub(k.y), 0), k.z);
      const curve = max(soft.mul(soft).mul(k.w), held.sub(k.x));
      // In the frame's own units (the street pass adds it back to the frame).
      const share = curve.div(max(bright, 1e-4));
      const contribution = c.mul(share);
      const w = float(1).div(maxOf(contribution.mul(this.exposure)).add(1));
      return { c: contribution.mul(w), w };
    };
    const taps = [tap(-1, -1), tap(1, -1), tap(-1, 1), tap(1, 1)];
    const sum = taps.reduce((s, t) => s.add(t.c), vec3(0) as V3);
    const weights = taps.reduce((s, t) => s.add(t.w), float(0) as Node<"float">);
    return vec4(sum.div(max(weights, 1e-4)), 1);
  }

  /** The ghost level kept only where a light is a point (ghostIsolation, in the shader). */
  private buildIsolate(): V4 {
    const src = this.isolateSource;
    const t = this.isolateTexel.mul(ISOLATION_STEP);
    const light = src.sample(screenUV).rgb;
    const at = (x: number, y: number) => maxOf(src.sample(screenUV.add(t.mul(vec2(x, y)))).rgb);
    const neighbour = max(max(at(1, 0), at(-1, 0)), max(at(0, 1), at(0, -1)));
    const ratio = maxOf(light).div(neighbour.add(1e-4));
    return vec4(light.mul(smoothstepNode(ISOLATION_FROM, ISOLATION_FULL, ratio)), 1);
  }

  private buildDown(): V4 {
    const src = this.downSource;
    const t = this.downTexel;
    const at = (x: number, y: number) => src.sample(screenUV.add(t.mul(vec2(x, y)))).rgb;
    const s = src.sample(screenUV).rgb.mul(4).add(at(-1, -1)).add(at(1, 1)).add(at(1, -1)).add(at(-1, 1));
    return vec4(s.mul(0.125), 1);
  }

  private buildUp(): V4 {
    const src = this.upSource;
    const t = this.upTexel;
    const at = (x: number, y: number) => src.sample(screenUV.add(t.mul(vec2(x, y)))).rgb;
    const edges = at(-2, 0).add(at(2, 0)).add(at(0, -2)).add(at(0, 2));
    const corners = at(1, 1).add(at(-1, -1)).add(at(1, -1)).add(at(-1, 1)).mul(2);
    return vec4(edges.add(corners).div(12), 1);
  }

  /** The 1/first … 1/32 targets for this drawing-buffer size. */
  private fit(width: number, height: number, first: number, count: number): void {
    const isSame =
      this.first === first &&
      this.levels.length === count &&
      this.levels[0].width === Math.max(1, Math.round(width / first)) &&
      this.levels[0].height === Math.max(1, Math.round(height / first));
    if (isSame) return;
    this.first = first;
    while (this.levels.length < count) this.levels.push(levelTarget());
    for (const t of this.levels.splice(count)) t.dispose();
    this.levels.forEach((t, i) => {
      const w = Math.max(1, Math.round(width / (first * 2 ** i)));
      const h = Math.max(1, Math.round(height / (first * 2 ** i)));
      t.setSize(w, h);
    });
  }

  dispose(): void {
    for (const t of [...this.levels, this.points]) t.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.isolate]) m.dispose();
  }
}

/**
 * Lamps' ghosts (John Chapman's pseudo lens flare): the point-like lights of a blurred level of the
 * chain (the `isolate` pass) mirrored and scaled through the picture's centre (LAMP_GHOST_TAPS),
 * each fainter where it comes from near the picture's edge and tinted as a lens coating tints its
 * reflections; soft discs, as defocused ghosts are. Only points make them: a real ghost is the
 * light's image dimmed a thousandfold or more, which a lamp's or a headlight's luminance survives
 * and a floodlit tower's or a lit window's does not.
 */
function lampGhosts(source: TextureNode): V3 {
  let sum: V3 = vec3(0);
  for (const { scale, tint } of LAMP_GHOST_TAPS) {
    const at = screenUV.sub(0.5).div(scale).add(0.5);
    // Faint towards the edges (where a real ghost leaves the lens's field).
    const fade = pow(max(float(1).sub(distance(at, vec2(0.5)).div(Math.SQRT1_2)), 0), 6);
    sum = sum.add(
      source
        .sample(at)
        .rgb.mul(vec3(...tint))
        .mul(fade),
    );
  }
  return sum;
}
