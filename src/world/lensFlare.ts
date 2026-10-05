import {
  AddEquation,
  type Camera,
  Color,
  CustomBlending,
  Mesh,
  NoBlending,
  NoColorSpace,
  OneFactor,
  PlaneGeometry,
  RenderTarget,
  type Scene,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  ZeroFactor,
} from "three";
import { type Node, NodeMaterial, QuadMesh, type TextureNode, type WebGPURenderer } from "three/webgpu";
import {
  abs,
  atan,
  cos,
  exp,
  float,
  Fn,
  length,
  max,
  min,
  pow,
  screenUV,
  select,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { GRAPHICS } from "../device";
import type { FrameReader, StreetPass } from "../render/frame";
import { HALF_MAX } from "../render/shaderMath";
import { smoothstep as smooth } from "./skyLight";

/**
 * レンズフレア: the sun seen through a lens — ghosts (the aperture's image reflected between the
 * lens's surfaces) along the line from the sun through the centre of the picture, a faint halo
 * round the sun, and a starburst (diffraction at the aperture's six blades). A street pass of the
 * frame (render/frame.ts), after the bloom and before the motion blur, so it is never drawn on the
 * interior or the wipers.
 *
 * Whether the sun is seen at all is measured, not guessed:
 * 1. A probe, a small disc at the sun's place 30 km out, is drawn with the world right after the
 *    sky. It writes only the frame's alpha (to 0; everything else leaves alpha at 1), depth-tested
 *    against the street: wherever the sun is behind a building, a tree, a car or the terrain, the
 *    occluder overwrites it. Semi-transparent things (rain streaks, glass) leave a share of it.
 * 2. After the whole frame is drawn — the interior and the windscreen included — a reader samples
 *    the frame at the sun's disc: the share of the probe left (1 − alpha) times how bright the disc
 *    still is (clouds pass in front of it in the sky shader, and the haze reddens and dims it at the
 *    horizon). The result goes to a 1×1 target and is read back asynchronously (a frame or two
 *    late), smoothed over ~0.1 s.
 * In the driver's seat this makes the flare follow the cabin exactly: the sun above the roof line or
 * behind a pillar is hidden by the interior the reader sees, so no ghosts show through the glass
 * for a sun the driver cannot see. Overcast fades it (a deck has no disc); the sun low in the haze
 * fades it by its own brightness.
 *
 * Why not a depth read: the frame's depth is multisampled (depth32float with MSAA), which a shader
 * can only read sample by sample and a copy cannot resolve; the alpha channel is free (the output
 * pass writes opaque) and resolves with the colour. Why not an occlusion query: three answers it
 * only during a render, per render context, and not for the interior drawn in another pass. Why not
 * the screen-space flare of three's LensflareNode for the sun: it mirrors whatever is bright, so the
 * sun's ghosts would be blurred copies of the sky round it, and it cannot tell the sun from glints;
 * the lamps at night do get that kind of ghost (bloom.ts, `ghosts`), when the sun is down.
 */

/** The probe's distance (m) and angular radius (rad): inside the far plane, over the disc's core. */
const PROBE_DISTANCE = 30000;
export const PROBE_RADIUS = 0.0065;
/** Where the reader samples: the disc's centre and a ring at this share of the probe's radius. */
export const TAP_RING = 0.6;
const TAP_COUNT = 6;
/** Exposed radiance of the disc from which the sun counts as seen, and at which fully. */
const DISC_DIM = 30;
const DISC_BRIGHT = 300;
/** Seconds for the measured visibility to settle (the read-back is a frame or two late). */
const SETTLE_S = 0.08;

/** The sun on the screen: uv with the origin top left, as the frame's passes sample it. */
export type SunOnScreen = { uv: Vector2; isInView: boolean };

const tmp = new Vector3();

/**
 * Where a direction (unit vector, world) lands on the camera's picture. In view when it is in front
 * of the eye (camera space z < 0: the projected z's range depends on the depth convention) and
 * within the picture.
 */
export function sunOnScreen(direction: Vector3, camera: Camera, into = new Vector2()): SunOnScreen {
  camera.updateMatrixWorld();
  const isInFront = tmp.copy(direction).transformDirection(camera.matrixWorldInverse).z < 0;
  // A point along it well past the near plane, projected.
  const ndc = camera.getWorldPosition(tmp).addScaledVector(direction, 1000).project(camera);
  into.set((ndc.x + 1) / 2, (1 - ndc.y) / 2);
  const isInside = into.x >= 0 && into.x <= 1 && into.y >= 0 && into.y <= 1;
  return { uv: into, isInView: isInFront && isInside };
}

/**
 * How strong the flare is, 0 – 1, from what the probe saw (0 – 1), the sun's elevation (degrees)
 * and the cloud (0 fair – 1 raining). The disc sinks between +2° and −0.5°; cloud takes the disc
 * away well before the deck closes.
 */
export function flareStrength(visibility: number, elevation: number, overcast: number): number {
  const isUp = smooth(elevation, -0.5, 2);
  const clear = 1 - smooth(overcast, 0.15, 0.6);
  return Math.max(0, Math.min(1, visibility)) * isUp * clear;
}

/**
 * The ghosts: where each sits on the line from the centre (0) to the sun (1) — negative beyond the
 * centre — its radius (share of the picture's height), tint, brightness and whether it is the
 * aperture's hexagon or a round ghost.
 */
export const GHOSTS: ReadonlyArray<{
  at: number;
  radius: number;
  tint: [number, number, number];
  gain: number;
  hex: boolean;
}> = [
  { at: 0.62, radius: 0.022, tint: [1, 0.82, 0.5], gain: 0.5, hex: false },
  { at: 0.3, radius: 0.05, tint: [0.45, 0.65, 1], gain: 0.3, hex: true },
  { at: -0.28, radius: 0.03, tint: [1, 0.6, 0.28], gain: 0.45, hex: false },
  { at: -0.55, radius: 0.085, tint: [0.35, 0.85, 0.6], gain: 0.28, hex: true },
  { at: -0.85, radius: 0.045, tint: [0.65, 0.42, 1], gain: 0.4, hex: false },
  { at: -1.2, radius: 0.15, tint: [0.35, 0.72, 1], gain: 0.14, hex: true },
  { at: -1.65, radius: 0.26, tint: [0.6, 0.85, 0.55], gain: 0.07, hex: false },
];

/** The halo's radius round the sun (share of the picture's height) and its width. */
const HALO_RADIUS = 0.42;
const HALO_WIDTH = 0.018;
/** Exposed radiance at the brightest part of a ghost of gain 1, of the halo and of the starburst. */
const GHOST_GAIN = 0.55;
const HALO_GAIN = 0.12;
const BURST_GAIN = 0.9;
/** The lamps' ghosts at night (bloom.ts), as a share of the bloom chain's level they mirror. */
const LAMP_GHOSTS = 0.5;

type F = Node<"float">;
type V2 = Node<"vec2">;

/** Distance to a regular hexagon's edge, 1 on it (p in its radii; flat sides top and bottom). */
function hexDistance(p: V2): F {
  const q = abs(p);
  return max(q.x.mul(0.866).add(q.y.mul(0.5)), q.y).div(0.866);
}

export type FlareSun = {
  /** Unit vector towards the sun (world). */
  direction: Vector3;
  elevation: number;
  overcast: number;
  /** The sun's colour (DirectionalLight's), and the night factor for the lamps' ghosts. */
  color: Color;
  night: number;
};

export class LensFlare implements StreetPass {
  readonly name = "lens-flare";
  /**
   * The sun probe's reader (composer.frameReaders). Its own isActive: it must run whenever the probe
   * was drawn, also while the flare itself is off for want of a reading (the pass's isActive).
   */
  readonly reader: FrameReader = {
    name: "sun-probe",
    isActive: () => this.probe.visible,
    read: (frame) => this.read(frame),
  };
  private readonly probe: Mesh<PlaneGeometry, NodeMaterial>;
  private readonly readTarget = (() => {
    const t = new RenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
    // The share as written, not encoded.
    t.texture.colorSpace = NoColorSpace;
    return t;
  })();
  private readonly readQuad: QuadMesh;
  private readonly sunUV = uniform(new Vector2(0.5, 0.5));
  /** The probe's radius in uv (x, y). */
  private readonly tapRadius = uniform(new Vector2());
  private readonly exposure = uniform(1);
  private readonly aspect = uniform(1);
  /** The flare's colour times its strength, in frame radiance. */
  private readonly tint = uniform(new Color(0, 0, 0));
  private readonly frame = texture(new RenderTarget(1, 1).texture);
  private readonly sun = new Vector2();
  private isInView = false;
  private isReading = false;
  private measured = 0;
  private visibility = 0;
  private strength = 0;
  private lastMs = performance.now();

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    private readonly bloom: { ghosts: { value: number } } | null,
  ) {
    const material = new NodeMaterial();
    material.name = "sun-probe";
    material.fragmentNode = vec4(0, 0, 0, 0);
    // Alpha only: the colour stays (Zero·src + One·dst), the alpha becomes the probe's 0.
    material.blending = CustomBlending;
    material.blendEquation = AddEquation;
    material.blendSrc = ZeroFactor;
    material.blendDst = OneFactor;
    material.blendEquationAlpha = AddEquation;
    material.blendSrcAlpha = OneFactor;
    material.blendDstAlpha = ZeroFactor;
    material.depthWrite = false;
    material.fog = false;
    this.probe = new Mesh(new PlaneGeometry(2, 2), material);
    this.probe.name = "sun-probe";
    // Right after the sky (−1000), which paints over whatever is drawn before it.
    this.probe.renderOrder = -999;
    this.probe.frustumCulled = false;
    this.probe.visible = false;
    scene.add(this.probe);
    const reader = new NodeMaterial();
    reader.name = "sun-probe-read";
    reader.fragmentNode = this.buildReader();
    reader.blending = NoBlending;
    reader.depthTest = false;
    reader.depthWrite = false;
    reader.fog = false;
    this.readQuad = new QuadMesh(reader);
  }

  /**
   * Before the frame: where the sun is, the probe placed for the main camera (only its view: the
   * probe is hidden again once the frame is read), and the flare's strength from the last read.
   */
  update(camera: Camera, sun: FlareSun): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const isOn = GRAPHICS.settings.lensFlare === "on";
    if (this.bloom) this.bloom.ghosts.value = isOn ? LAMP_GHOSTS * smooth(sun.night, 0.3, 0.9) : 0;
    const isUp = sun.elevation > -1;
    const { isInView } = sunOnScreen(sun.direction, camera, this.sun);
    this.isInView = isOn && isUp && isInView;
    // Out of view nothing is read; coming back in, the old reading is not to be trusted.
    if (!this.isInView) this.measured = 0;
    const target = this.measured;
    this.visibility += (target - this.visibility) * Math.min(1, dt / SETTLE_S);
    this.strength = flareStrength(this.visibility, sun.elevation, sun.overcast);
    this.probe.visible = this.isInView;
    if (this.isInView) {
      const eye = camera.getWorldPosition(new Vector3());
      this.probe.position.copy(eye).addScaledVector(sun.direction, PROBE_DISTANCE);
      // Facing the eye, as the camera is turned.
      camera.getWorldQuaternion(this.probe.quaternion);
      this.probe.scale.setScalar(PROBE_DISTANCE * Math.tan(PROBE_RADIUS));
      this.probe.updateMatrixWorld();
    }
    const exposure = this.renderer.toneMappingExposure;
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.aspect.value = size.x / Math.max(1, size.y);
    this.sunUV.value.copy(this.sun);
    // The disc's radius in uv: the vertical field of view spans the picture's height.
    const fov = (camera as Camera & { fov?: number }).fov ?? 60;
    const ry = (Math.tan(PROBE_RADIUS) / Math.tan(((fov / 2) * Math.PI) / 180)) * 0.5;
    this.tapRadius.value.set(ry / this.aspect.value, ry);
    this.exposure.value = exposure;
    // In exposed units: the flare looks the same however the eye is adapted.
    this.tint.value.copy(sun.color).multiplyScalar(this.strength / Math.max(exposure, 1e-3));
  }

  /** What the last frames measured (0 – 1), smoothed: for the console. */
  get seen(): number {
    return this.visibility;
  }

  // ---- StreetPass ----

  isActive(): boolean {
    return this.isInView && this.strength > 0.002;
  }

  build(street: TextureNode): Node<"vec4"> {
    return Fn(() => {
      const base = street.sample(screenUV);
      const aspect = vec2(this.aspect, 1);
      // Picture coordinates in heights, from the centre.
      const p = screenUV.sub(0.5).mul(aspect).toVar();
      const s = this.sunUV.sub(0.5).mul(aspect).toVar();
      const flare = vec3(0).toVar();
      for (const g of GHOSTS) {
        const q = p.sub(s.mul(g.at)).div(g.radius);
        const d = g.hex ? hexDistance(q) : length(q);
        // A soft disc with a brighter rim, as a defocused aperture image.
        const disc = smoothstep(1, 0.86, d).mul(smoothstep(0.35, 1, d).mul(0.5).add(0.5));
        flare.addAssign(vec3(...g.tint).mul(disc.mul(g.gain * GHOST_GAIN)));
      }
      const toSun = p.sub(s).toVar();
      const r = length(toSun).toVar();
      // The halo: a thin ring round the sun, its colours split (red outside, blue inside).
      const ring = (radius: number) => exp(r.sub(radius).div(HALO_WIDTH).pow(2).negate());
      const halo = vec3(ring(HALO_RADIUS * 1.02), ring(HALO_RADIUS), ring(HALO_RADIUS * 0.98));
      flare.addAssign(halo.mul(HALO_GAIN));
      // The starburst: six long spikes and fainter ones between, falling off with distance.
      const angle = atan(toSun.y, toSun.x);
      const spikes = pow(abs(cos(angle.mul(3).add(0.35))), 60)
        .add(pow(abs(cos(angle.mul(9).add(1.1))), 120).mul(0.35))
        .toVar();
      const falloff = float(0.012)
        .div(r.add(0.012))
        .mul(exp(r.div(0.35).negate()));
      flare.addAssign(vec3(1, 0.95, 0.88).mul(spikes.mul(falloff).mul(BURST_GAIN)));
      // Within half float: at the sun's centre the starburst lands on the disc (shaderMath HALF_MAX).
      return vec4(min(base.rgb.add(flare.mul(this.tint)), vec3(HALF_MAX)), base.a);
    })();
  }

  // ---- the probe's reader ----

  /** After the frame: the probe is hidden again and, unless a reading is in flight, read. */
  private read(frame: Texture): void {
    this.probe.visible = false;
    if (this.isReading) return;
    const r = this.renderer;
    this.frame.value = frame;
    r.setRenderTarget(this.readTarget);
    this.readQuad.render(r);
    this.isReading = true;
    // Queued now, resolved after the GPU has drawn this frame.
    r.readRenderTargetPixelsAsync(this.readTarget, 0, 0, 1, 1)
      .then((px) => {
        this.measured = (px[0] as number) / 255;
      })
      .catch(() => {
        this.measured = 0;
      })
      .finally(() => {
        this.isReading = false;
      });
  }

  /** The reader's shader: the share of the sun's disc seen, at a few taps over it. */
  private buildReader(): Node<"vec4"> {
    const taps: Array<[number, number]> = [[0, 0]];
    for (let k = 0; k < TAP_COUNT; k++) {
      const a = (k / TAP_COUNT) * Math.PI * 2;
      taps.push([Math.cos(a) * TAP_RING, Math.sin(a) * TAP_RING]);
    }
    let sum: F = float(0);
    for (const [x, y] of taps) {
      const at = this.sunUV.add(this.tapRadius.mul(vec2(x, y)));
      const c = this.frame.sample(at);
      const isInside = at.x
        .greaterThanEqual(0)
        .and(at.x.lessThanEqual(1))
        .and(at.y.greaterThanEqual(0))
        .and(at.y.lessThanEqual(1));
      const disc = max(c.r, max(c.g, c.b)).mul(this.exposure);
      const seen = c.a
        .oneMinus()
        .clamp(0, 1)
        .mul(smoothstep(DISC_DIM, DISC_BRIGHT, disc));
      sum = sum.add(select(isInside, seen, float(0)));
    }
    const v = sum.div(taps.length);
    return vec4(v, v, v, 1);
  }

  /** The current reading, for tests and the console (also: is the sun's probe drawn). */
  get state(): { isInView: boolean; measured: number; strength: number } {
    return { isInView: this.isInView, measured: this.measured, strength: this.strength };
  }

  dispose(): void {
    this.probe.removeFromParent();
    this.probe.geometry.dispose();
    this.probe.material.dispose();
    this.readTarget.dispose();
  }
}
