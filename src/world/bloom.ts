import {
  AdditiveBlending,
  FramebufferTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { GRAPHICS } from "../device";
import { smoothstep } from "./skyLight";

/**
 * Bloom: bright light spilling over its surroundings in the eye and the lens — lamps, lit windows,
 * signals, headlights, the low sun. Runs on the street only (main.ts's afterWorld, before the
 * motion blur and the car's interior):
 * 1. The frame just drawn is copied once (as motionBlur.ts does).
 * 2. Prefilter to half resolution (画質 光のにじみ 低: quarter): 4 bilinear taps covering a 4×4
 *    box (a two-pixel lamp is not missed), each expanded from display to a pseudo-HDR value
 *    (x / (1 − 0.96·max)) so that clipped pixels weigh ~25× and a white wall at 0.85 only ~5×, then
 *    a soft-knee threshold and a Karis average (weights 1 / (1 + brightness)) against fireflies.
 * 3. Dual-filter (Kawase) chain down to 1/32 and back up, each level added onto the next larger one
 *    (低: 3 levels below the quarter instead of 4 below the half).
 * 4. Added onto the frame: one bilinear tap of the half-resolution sum per pixel.
 *
 * Why not real HDR (the world drawn into a half-float target, then tone-mapped): the cockpit's two
 * passes, the windscreen's rain and the motion blur all draw onto the canvas; a float target means
 * twice the bandwidth for the whole world plus an extra full-screen pass, for every frame. Why not
 * three's UnrealBloomPass: it needs EffectComposer's targets and a 5-level separable Gaussian
 * (2×5 passes with 3–11 taps each); the dual filter does the same spread in fewer taps.
 */
// WEBGPU-TODO(phase B): this pass is GLSL over the WebGL canvas and is not run on WebGPU (bloom is
// off). Port it as a StreetPass (render/frame.ts) registered before the motion blur in main.ts:
// the frame there is linear HDR already, so the prefilter's pseudo-HDR expansion of display values
// is not needed, and three's BloomNode (three/addons/tsl/display/BloomNode.js) is an option.
// bloomSettings below (with env.nightFactor and env.overcast) and 画質 光のにじみ stay the interface.
export type BloomSettings = {
  /** Pseudo-HDR brightness from which light blooms (1 = display white of 0.5; clipped ≈ 25). */
  threshold: number;
  /** How much of the blurred light is added onto the frame. */
  strength: number;
};

/**
 * Night makes lights bloom: by day only what is clipped spills (the sun and its glare, glints:
 * display ≥ 0.975, so a white wall at noon or the pale sky beside it does not); at night lit windows
 * (display ~0.85) and lamps do. Wet air spreads it further (rain at night).
 */
export function bloomSettings(night: number, overcast: number): BloomSettings {
  const n = smoothstep(night, 0.05, 0.8);
  return {
    threshold: 15 + (3.6 - 15) * n,
    strength: (0.02 + (0.05 - 0.02) * n) * (1 + 0.35 * overcast * n),
  };
}

/** 画質 › 光のにじみ: the prefilter's resolution divisor and the number of levels from there. */
const MODES = { low: { first: 4, levels: 4 }, high: { first: 2, levels: 5 } } as const;
const VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

const PREFILTER = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  uniform vec4 knee; // threshold, threshold − knee, 2·knee, 1 / (4·knee)
  varying vec2 vUv;
  vec3 tap( vec2 uv, out float w ) {
    vec3 c = texture2D( src, uv ).rgb;
    c /= max( 1.0 - 0.96 * max( c.r, max( c.g, c.b ) ), 0.04 );
    float b = max( c.r, max( c.g, c.b ) );
    float soft = clamp( b - knee.y, 0.0, knee.z );
    soft = soft * soft * knee.w;
    c *= max( soft, b - knee.x ) / max( b, 1e-4 );
    w = 1.0 / ( 1.0 + max( c.r, max( c.g, c.b ) ) );
    return c * w;
  }
  void main() {
    float w0, w1, w2, w3;
    vec3 s = tap( vUv + texel * vec2( -1.0, -1.0 ), w0 ) + tap( vUv + texel * vec2( 1.0, -1.0 ), w1 )
      + tap( vUv + texel * vec2( -1.0, 1.0 ), w2 ) + tap( vUv + texel * vec2( 1.0, 1.0 ), w3 );
    gl_FragColor = vec4( s / max( w0 + w1 + w2 + w3, 1e-4 ), 1.0 );
  }
`;

const DOWN = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D( src, vUv ).rgb * 4.0;
    s += texture2D( src, vUv - texel ).rgb + texture2D( src, vUv + texel ).rgb;
    s += texture2D( src, vUv + vec2( texel.x, -texel.y ) ).rgb + texture2D( src, vUv - vec2( texel.x, -texel.y ) ).rgb;
    gl_FragColor = vec4( s * 0.125, 1.0 );
  }
`;

const UP = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D( src, vUv + vec2( -2.0 * texel.x, 0.0 ) ).rgb + texture2D( src, vUv + vec2( 2.0 * texel.x, 0.0 ) ).rgb;
    s += texture2D( src, vUv + vec2( 0.0, -2.0 * texel.y ) ).rgb + texture2D( src, vUv + vec2( 0.0, 2.0 * texel.y ) ).rgb;
    s += 2.0 * ( texture2D( src, vUv + texel ).rgb + texture2D( src, vUv - texel ).rgb );
    s += 2.0 * ( texture2D( src, vUv + vec2( texel.x, -texel.y ) ).rgb + texture2D( src, vUv - vec2( texel.x, -texel.y ) ).rgb );
    gl_FragColor = vec4( s / 12.0, 1.0 );
  }
`;

// The bloom onto the frame: one bilinear tap of the half-resolution sum, already smooth.
const COMPOSITE = /* glsl */ `
  uniform sampler2D src;
  uniform float gain;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4( texture2D( src, vUv ).rgb * gain, 1.0 );
  }
`;

const pass = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, isAdditive = false) =>
  new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: isAdditive ? AdditiveBlending : NoBlending,
  });

export class Bloom {
  private frame: FramebufferTexture | null = null;
  private levels: WebGLRenderTarget[] = [];
  private readonly size = new Vector2();
  private readonly prefilter = pass(PREFILTER, {
    src: { value: null },
    texel: { value: new Vector2() },
    knee: { value: new Vector4() },
  });
  private readonly down = pass(DOWN, { src: { value: null }, texel: { value: new Vector2() } });
  private readonly up = pass(UP, { src: { value: null }, texel: { value: new Vector2() } }, true);
  private readonly composite = pass(COMPOSITE, { src: { value: null }, gain: { value: 1 } }, true);
  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.prefilter);
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** The prefilter's divisor the targets were made for. */
  private first = 0;

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Bloom the frame on the canvas now (call after the world is drawn, before the interior). 画質 ›
   * 光のにじみ なし skips everything, the copy included.
   */
  apply(renderer: WebGLRenderer, settings: BloomSettings): void {
    const mode = GRAPHICS.settings.bloom;
    const isOff = mode === "off" || settings.strength <= 0;
    if (isOff) return;
    renderer.getDrawingBufferSize(this.size);
    this.fit(this.size.x, this.size.y, MODES[mode].first, MODES[mode].levels);
    const frame = this.frame;
    if (!frame) return;
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(frame);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const knee = settings.threshold * 0.35;
    const pre = this.prefilter.uniforms;
    pre.src.value = frame;
    pre.texel.value.set(1 / this.size.x, 1 / this.size.y);
    pre.knee.value.set(settings.threshold, settings.threshold - knee, 2 * knee, 0.25 / knee);
    this.draw(renderer, this.prefilter, this.levels[0]);
    const count = this.levels.length;
    for (let i = 1; i < count; i++) {
      const from = this.levels[i - 1];
      this.down.uniforms.src.value = from.texture;
      this.down.uniforms.texel.value.set(1 / from.width, 1 / from.height);
      this.draw(renderer, this.down, this.levels[i]);
    }
    for (let i = count - 1; i > 0; i--) {
      const from = this.levels[i];
      const u = this.up.uniforms;
      u.src.value = from.texture;
      u.texel.value.set(1 / from.width, 1 / from.height);
      this.draw(renderer, this.up, this.levels[i - 1]);
    }
    // Onto the frame, added: the bloom brightens, it never darkens what is there.
    this.composite.uniforms.src.value = this.levels[0].texture;
    this.composite.uniforms.gain.value = settings.strength;
    this.draw(renderer, this.composite, null);
    renderer.autoClear = autoClear;
  }

  private draw(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  /** The frame copy and the 1/first … 1/32 targets for this drawing-buffer size. */
  private fit(width: number, height: number, first: number, count: number): void {
    const isSame =
      this.frame?.image.width === width &&
      this.frame?.image.height === height &&
      this.first === first &&
      this.levels.length === count;
    if (isSame) return;
    this.frame?.dispose();
    for (const t of this.levels) t.dispose();
    this.frame = new FramebufferTexture(width, height);
    this.first = first;
    this.levels = [];
    for (let i = 0; i < count; i++) {
      const w = Math.max(1, Math.round(width / (first * 2 ** i)));
      const h = Math.max(1, Math.round(height / (first * 2 ** i)));
      this.levels.push(
        new WebGLRenderTarget(w, h, {
          type: HalfFloatType,
          depthBuffer: false,
          magFilter: LinearFilter,
          minFilter: LinearFilter,
          generateMipmaps: false,
        }),
      );
    }
  }
}
