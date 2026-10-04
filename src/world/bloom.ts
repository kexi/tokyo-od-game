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
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { GRAPHICS } from "../device";
import type { StreetPass } from "../render/frame";
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
 *    mirrored through the centre of the picture, from a small level of the chain).
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
/** The night's: below a lit signal lens (~3) and a headlamp (~1.4–2.2), above the sky's glow. */
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
const MODES = { low: { first: 4, levels: 4 }, high: { first: 2, levels: 5 } } as const;
/** The level the lamps' ghosts are sampled from (blurred enough to read as soft discs). */
const GHOST_LEVEL = 2;

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
  // What the street pass adds: the half-resolution sum, and a small level for the ghosts.
  private readonly sum = later();
  private readonly ghostSource = later();
  private readonly prefilter = quadMaterial("prefilter", this.buildPrefilter());
  private readonly down = quadMaterial("down", this.buildDown());
  private readonly up = quadMaterial("up", this.buildUp(), true);
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
    this.ghostSource.value = this.levels[Math.min(GHOST_LEVEL, count - 1)].texture;
  }

  /** The street with the bloom (and the lamps' ghosts) added: it brightens, never darkens. */
  build(street: TextureNode): Node<"vec4"> {
    return Fn(() => {
      const base = street.sample(screenUV);
      const lit = base.rgb.add(this.sum.sample(screenUV).rgb.mul(this.strength)).toVar();
      If(this.ghosts.greaterThan(0), () => {
        lit.addAssign(lampGhosts(this.ghostSource).mul(this.ghosts));
      });
      return vec4(lit, base.a);
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
    for (const t of this.levels) t.dispose();
    for (const m of [this.prefilter, this.down, this.up]) m.dispose();
  }
}

/**
 * Lamps' ghosts (John Chapman's pseudo lens flare): the bright parts of the picture mirrored through
 * its centre, a few times at growing distances along the line through it, each fainter towards the
 * picture's edge and tinted as a lens coating tints its reflections. Read from a blurred level of
 * the chain, so they are soft discs, as defocused ghosts are.
 */
function lampGhosts(source: TextureNode): V3 {
  const flipped = vec2(1).sub(screenUV);
  const toCentre = vec2(0.5).sub(flipped);
  const tints = [vec3(1, 0.86, 0.62), vec3(0.62, 0.9, 1), vec3(0.85, 1, 0.7), vec3(1, 0.7, 0.9)];
  let sum: V3 = vec3(0);
  tints.forEach((tint, i) => {
    const at = flipped.add(toCentre.mul(0.3 * i));
    // Faint towards the edges (where a real ghost leaves the lens's field).
    const fade = pow(max(float(1).sub(distance(at, vec2(0.5)).div(Math.SQRT1_2)), 0), 6);
    sum = sum.add(source.sample(at).rgb.mul(tint).mul(fade));
  });
  return sum;
}
