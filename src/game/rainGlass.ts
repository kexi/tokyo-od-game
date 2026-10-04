import {
  Color,
  DataTexture,
  DoubleSide,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  NoBlending,
  NormalBlending,
  type Object3D,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  RGFormat,
  Scene,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three";
import { NodeMaterial, type Node, type TextureNode, type WebGPURenderer } from "three/webgpu";
import {
  attribute,
  bool,
  cameraPosition,
  clamp,
  dFdx,
  dFdy,
  Discard,
  dot,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  length,
  log2,
  max,
  mix,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  screenUV,
  select,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { FrameComposer } from "../render/frame";

/**
 * Rain on the windscreen (車内視点): a drop simulation on the glass, and the optics that draw it.
 *
 * Physics (RainSim) works in metres on the glass plane: x along the windscreen UV's u (to the
 * driver's right), y along v (up the glass). Raindrops land at the Marshall–Palmer rate for the
 * rainfall, more when driving into the rain (fast impacts splash into pieces). Drops of 1.6 mm and
 * up become simulated drops, at most `maxDrops` of them (a fresh impact takes the place of a
 * smaller drop); the smaller ones (nearly all of the count, about two thirds of the water) feed a
 * per-cell layer of fine droplets that the glass shader draws statistically, and that coalesce
 * into drops where they crowd. A drop holds while contact-angle hysteresis (Furmidge,
 * 2γ·a·Δcosθ) beats gravity along the raked glass plus the airflow's drag, and past that it
 * slides at the speed contact-line friction allows: about 2.6 mm of contact radius slides down a
 * standing car, and above roughly 65 km/h the airflow carries millimetre drops up and out towards
 * the pillars. Touching drops merge (volume conserved); running ones wander on the glass's dirt,
 * sweep up the fine droplets in their path and leave a trail of tiny ones. The blades push the
 * water to the ends of their stroke and leave a thin, streaky film that beads up and fades.
 *
 * Optics (RainGlass): each drop is drawn into a glass-space texture as the position inside its
 * spherical cap. The windscreen shader traces the view ray through the cap (into the water
 * through the flat glass, out through the curved surface, reflecting inside past the critical
 * angle) and looks up what the eye would see along the ray that leaves, in a copy of the frame
 * just rendered: each drop is a plano-convex lens showing the street minified and upside down,
 * with a dark rim where the light ends up back in the cabin, a little out of focus because the
 * eye is on the road. Glass geometry, wiper pivots and angles: knowledge/cockpit-blender.md.
 */
const DEG = Math.PI / 180;

/** Glass size in metres (u × v of the Windshield UV). */
export const GLASS_W = 1.4706;
export const GLASS_H = 0.8245;
// The v axis rises 0.4204 per unit: the glass lies 24.9° from horizontal.
const SIN_RAKE = 0.4204;
const COS_RAKE = 0.9073;
const G = 9.81;
const RHO = 1000; // water, kg/m³
const RHO_AIR = 1.2;
const GAMMA = 0.072; // surface tension of water, N/m
const MU = 1.0e-3; // viscosity of water, Pa·s
const N_WATER = 1.333;
// Road-dirty, untreated glass: about 60° static contact angle, Δcosθ ≈ 0.2 of hysteresis.
const CONTACT = 60 * DEG;
const SIN_C = Math.sin(CONTACT);
const COS_C = Math.cos(CONTACT);
const HYSTERESIS = 0.2;
/** Spherical-cap volume over the contact radius cubed (V = KAPPA·a³), ≈ 1.01 at 60°. */
const KAPPA = ((Math.PI / 3) * (2 - 3 * COS_C + COS_C ** 3)) / SIN_C ** 3;
/** The cap's frontal area over a² (the airflow pushes on this). */
const FRONTAL = (CONTACT - SIN_C * COS_C) / SIN_C ** 2;
const DRAG_CD = 1.0;
// Air speed at drop height over the car's speed: the drops sit deep in the boundary layer. Set so
// a 2 mm drop starts to creep up at about 65 km/h, as drivers see.
const AIR_FRACTION = 0.37;
const FLOW_SPREAD = 1.2; // how much the flow fans out towards the pillars
// Contact-line friction: a sliding drop moves at v = F_excess / (CONTACT_FRICTION·μ·a), the
// linear law measured for drops on inclined plates (Ca ∝ Bo − Bo_c), ≈ 3 cm/s just past the onset.
const CONTACT_FRICTION = 250;
const INERTIA = 0.02; // s, how fast a drop takes up its sliding speed
const MAX_RUN = 0.4; // m/s, where a running drop's speed levels off
const FALL_SPEED = 5.5; // m/s, a typical raindrop's terminal speed
const D_SIM = 1.6e-3; // raindrops at least this big land as simulated drops
const D_MAX = 5.5e-3; // bigger raindrops break up in the air
const SPLASH_SPEED = 7; // m/s normal impact speed above which a drop splashes into pieces
const PIN_SCALE = 4e-3; // m, size of the patches of dirt that pin drops harder or softer
const WANDER = 0.6; // rad, how far surface flaws turn a running drop
const TRAIL_MIN = 1.4e-3; // drops smaller than this slide without leaving a trail
const TRAIL_EVERY = 2.4; // contact radii run per trail droplet
const A_SPLIT = 5e-3; // m: a running drop bigger than this breaks in two
const EVAPORATION = 1e-9; // m²/s (a² shrinks at 2× this once the rain stops: ~8 min for 1 mm)
const STEP = 1 / 120; // s, the fixed physics step
const FIELD_STEP = 1 / 30; // s, the fine-droplet field's update interval
const GRID = 12e-3; // m: merge-grid cells, twice the largest drop that merges reliably
const GRID_W = Math.ceil(GLASS_W / GRID);
const GRID_H = Math.ceil(GLASS_H / GRID);

/** The fine-droplet field: water (m deep) and wiper film (0–1) per cell. */
export const FIELD_W = 320;
export const FIELD_H = 180;
const CELL_W = GLASS_W / FIELD_W;
const CELL_H = GLASS_H / FIELD_H;
const CELL_AREA = CELL_W * CELL_H;
/** Water depth (m) at which fine droplets cover 63% of the glass (≈ κ·ā/π for ā ≈ 0.25 mm). */
export const MICRO_SCALE = 8e-5;
const COARSEN = 1.6; // × MICRO_SCALE: crowded fine droplets coalesce into a simulated drop
const COARSEN_RATE = 40; // cells per second that may coalesce
// Shares of the cap that coalescence and trails may fill: the rest stays free for fresh impacts.
const COARSEN_ROOM = 0.75;
const TRAIL_ROOM = 0.95;
const MICRO_DRY_TAU = 240; // s, fine droplets evaporating once the rain stops
const FILM_TAU = 0.7; // s, the wiper's film thinning out
const FILM_DEPTH = 3e-6; // m of water a fresh film holds; it beads up into fine droplets
const RESIDUAL = 0.04; // share of fine droplets a blade leaves behind
const DEPOSIT_KEEP = 0.2; // share of the pushed water left at the top of the stroke
const DEPOSIT_BEADS = 16; // beads along the blade there, of about DEPOSIT_A contact radius
const DEPOSIT_A = 1.3e-3;

/** Fine-droplet coverage 1 − e^(−w / MICRO_SCALE) as a byte, by w / MICRO_SCALE in 1/32 steps. */
const COVER_LUT = Uint8Array.from({ length: 257 }, (_, k) => 255 * (1 - Math.exp(-k / 32)));

/**
 * The wiper blades on the glass (knowledge/cockpit-blender.md): pivot in glass metres, the arm's
 * park angle φ (from the car's left, arm direction (−cos φ, sin φ)), the sweep of rotation.z,
 * and the blade's span from the pivot.
 */
export const WIPER_BLADES = [
  {
    name: "WiperArm_R",
    pivot: [0.9522 * GLASS_W, -0.0338 * GLASS_H],
    park: 3.6 * DEG,
    sweep: 82 * DEG,
    rIn: 0.145,
    rOut: 0.795,
  },
  {
    name: "WiperArm_L",
    pivot: [0.5068 * GLASS_W, -0.0273 * GLASS_H],
    park: 3.94 * DEG,
    sweep: 84 * DEG,
    rIn: 0.19,
    rOut: 0.59,
  },
] as const;

export type RainEnv = {
  /** Rainfall in mm/h (0 = not raining). */
  rainMmH: number;
  /** The car's forward speed, m/s. */
  speed: number;
  /** Each blade's arm angle φ (park + rotation.z), in WIPER_BLADES order. */
  blades: readonly number[];
};

/** Small seeded PRNG (mulberry32), so a simulation can be replayed. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isOnGlass(x: number, y: number): boolean {
  return x > 0 && x < GLASS_W && y > 0 && y < GLASS_H;
}

/** First index of the sorted array whose value is at least x. */
function lowerBound(sorted: Float32Array, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Smooth value noise in [0, 1), fixed in space (the glass's dirt does not move). */
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Raindrops reaching the glass: simulated drops per second (D ≥ D_SIM) and the depth rate (m/s)
 * of the finer ones. Marshall–Palmer N(D) = N₀·e^(−ΛD), Λ = 4.1·R^−0.21 /mm; the glass meets
 * the rain at the fall speed plus the car's, so the flux grows with speed.
 */
export function rainFlux(mmH: number, speed: number): { drops: number; microRate: number; slope: number } {
  if (mmH <= 0) return { drops: 0, microRate: 0, slope: 1 };
  const slope = 4.1 * Math.pow(mmH, -0.21) * 1000; // Λ, 1/m
  const depthRate = (mmH / 3.6e6) * (COS_RAKE + (SIN_RAKE * Math.max(0, speed)) / FALL_SPEED);
  const x = slope * D_SIM;
  // Share of the water in drops ≥ D_SIM, and their mean volume (E[D³ | D ≥ d] of an exponential).
  const share = Math.exp(-x) * (1 + x + (x * x) / 2 + (x * x * x) / 6);
  const d = D_SIM;
  const meanVolume = (Math.PI / 6) * (d ** 3 + (3 * d * d) / slope + (6 * d) / slope ** 2 + 6 / slope ** 3);
  return {
    drops: (depthRate * GLASS_W * GLASS_H * share) / meanVolume,
    microRate: depthRate * (1 - share),
    slope,
  };
}

/** Contact radius at which a drop starts to slide down a standing car's glass (no airflow). */
export const SLIDE_RADIUS = Math.sqrt((2 * GAMMA * HYSTERESIS) / (RHO * KAPPA * G * SIN_RAKE));

/** Drops on the glass: positions, contact radii and velocities as parallel arrays. */
export class RainSim {
  readonly maxDrops: number;
  count = 0;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Contact radius (m); 0 marks a drop removed this step. */
  readonly a: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  private readonly trail: Float64Array;
  /** Fine droplets: water depth per field cell (m), row 0 at the bottom of the glass. */
  readonly water = new Float32Array(FIELD_W * FIELD_H);
  /** Wiper film per field cell, 1 just after a blade passes. */
  readonly film = new Float32Array(FIELD_W * FIELD_H);
  /** The field as the glass texture wants it: fine-droplet coverage and film, two bytes a cell. */
  readonly fieldBytes = new Uint8Array(FIELD_W * FIELD_H * 2);
  /** Bumped whenever the field changes, so the view uploads it only then. */
  fieldVersion = 0;
  private isWet = false;
  private readonly rng: () => number;
  private spawnDebt = 0;
  private coarsenDebt = 0;
  private clock = 0;
  private fieldClock = 0;
  private readonly prevBlade: number[] = [];
  private readonly bladeDir: number[] = [];
  private readonly bladeLoad: number[] = [];
  /** Per blade, the cells within its span sorted by arm angle, so a wipe visits only its band. */
  private readonly bladeCells: Array<{ cells: Int32Array; phi: Float32Array }>;
  // Per-cell spread of the coalescence threshold, so cells do not all coarsen in the same frame.
  private readonly cellThreshold = new Float32Array(FIELD_W * FIELD_H);
  private readonly head = new Int32Array(GRID_W * GRID_H);
  private readonly link: Int32Array;

  constructor({ maxDrops = 1000, seed = 1 }: { maxDrops?: number; seed?: number } = {}) {
    this.maxDrops = maxDrops;
    this.x = new Float64Array(maxDrops);
    this.y = new Float64Array(maxDrops);
    this.a = new Float64Array(maxDrops);
    this.vx = new Float64Array(maxDrops);
    this.vy = new Float64Array(maxDrops);
    this.trail = new Float64Array(maxDrops);
    this.link = new Int32Array(maxDrops);
    this.rng = mulberry32(seed);
    this.bladeCells = WIPER_BLADES.map((b) => {
      const inSpan: Array<{ c: number; phi: number }> = [];
      for (let j = 0; j < FIELD_H; j++) {
        for (let i = 0; i < FIELD_W; i++) {
          const px = (i + 0.5) * CELL_W - b.pivot[0];
          const py = (j + 0.5) * CELL_H - b.pivot[1];
          const r = Math.hypot(px, py);
          if (r >= b.rIn && r <= b.rOut) inSpan.push({ c: j * FIELD_W + i, phi: Math.atan2(py, -px) });
        }
      }
      inSpan.sort((p, q) => p.phi - q.phi);
      return { cells: Int32Array.from(inSpan, (e) => e.c), phi: Float32Array.from(inSpan, (e) => e.phi) };
    });
    for (let c = 0; c < this.cellThreshold.length; c++) this.cellThreshold[c] = 0.7 + 0.6 * this.rng();
    for (let b = 0; b < WIPER_BLADES.length; b++) {
      this.prevBlade.push(WIPER_BLADES[b].park);
      this.bladeDir.push(0);
      this.bladeLoad.push(0);
    }
  }

  /** Nothing on the glass: no drops, no fine droplets, no film. */
  isDry(): boolean {
    return this.count === 0 && !this.isWet;
  }

  /** Volume of the simulated drops (m³). */
  dropVolume(): number {
    let v = 0;
    for (let i = 0; i < this.count; i++) v += KAPPA * this.a[i] ** 3;
    return v;
  }

  /**
   * Put a drop on the glass. At the cap it takes the place of a smaller drop (whose water joins
   * the fine droplets), so fresh impacts keep showing where the blades have just cleared;
   * without a smaller one its own water joins the fine droplets.
   */
  add(x: number, y: number, a: number, vx = 0, vy = 0): boolean {
    const isFull = this.count >= this.maxDrops;
    if (isFull && !this.evictSmallerThan(a)) {
      this.addWater(x, y, KAPPA * a ** 3);
      return false;
    }
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.a[i] = a;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.trail[i] = this.rng() * TRAIL_EVERY * a;
    return true;
  }

  step(dt: number, env: RainEnv): void {
    if (dt <= 0) return;
    // Fixed steps with the remainder carried over: the same drops at 30 or 144 fps.
    // (Splitting each frame into equal substeps instead drifted by ~2% between frame rates.)
    const flux = rainFlux(env.rainMmH, env.speed);
    this.clock += dt;
    while (this.clock >= STEP - 1e-9) {
      this.clock -= STEP;
      this.rain(STEP, flux.drops, flux.slope, env.speed);
      this.move(STEP, env.speed, env.rainMmH > 0);
      this.merge();
    }
    this.wipe(env.blades);
    // The field changes slowly (and a frame's lag behind the blade does not show): 30 Hz.
    this.fieldClock += dt;
    if (this.fieldClock < FIELD_STEP) return;
    this.updateField(this.fieldClock, flux.microRate);
    this.fieldClock = 0;
  }

  /** Retire the smallest of a few random drops if it is smaller than `a`. */
  private evictSmallerThan(a: number): boolean {
    let pick = -1;
    let smallest = a;
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(this.rng() * this.count);
      if (this.a[i] > 0 && this.a[i] < smallest) {
        smallest = this.a[i];
        pick = i;
      }
    }
    if (pick < 0) return false;
    this.addWater(this.x[pick], this.y[pick], KAPPA * this.a[pick] ** 3);
    this.copyDrop(this.count - 1, pick);
    this.count--;
    return true;
  }

  private copyDrop(from: number, to: number): void {
    this.x[to] = this.x[from];
    this.y[to] = this.y[from];
    this.a[to] = this.a[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.trail[to] = this.trail[from];
  }

  private cellAt(x: number, y: number): number {
    const i = Math.min(FIELD_W - 1, Math.max(0, Math.floor(x / CELL_W)));
    const j = Math.min(FIELD_H - 1, Math.max(0, Math.floor(y / CELL_H)));
    return j * FIELD_W + i;
  }

  private addWater(x: number, y: number, volume: number): void {
    this.water[this.cellAt(x, y)] += volume / CELL_AREA;
    this.isWet = true;
  }

  /** New raindrops landing; fast impacts splash into a few pieces. */
  private rain(h: number, rate: number, slope: number, speed: number): void {
    this.spawnDebt += rate * h;
    const impact = FALL_SPEED * COS_RAKE + Math.max(0, speed) * SIN_RAKE;
    const pieces = 1 + Math.min(3, Math.max(0, Math.floor((impact - SPLASH_SPEED) / 4)));
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      const d = Math.min(D_MAX, D_SIM - Math.log(1 - this.rng()) / slope);
      const volume = (Math.PI / 6) * d ** 3;
      const x = this.rng() * GLASS_W;
      const y = this.rng() * GLASS_H;
      const spread = Math.cbrt(volume / KAPPA) * 2.5;
      for (let p = 0; p < pieces; p++) {
        // Splash pieces fly up the glass with the airflow.
        const share = pieces === 1 ? 1 : (0.5 + this.rng()) / pieces;
        const px = x + (this.rng() - 0.5) * spread * (pieces - 1);
        const py = y + this.rng() * spread * (pieces - 1);
        this.add(px, py, Math.cbrt((volume * share) / KAPPA));
      }
    }
  }

  private move(h: number, speed: number, isRaining: boolean): void {
    const air = Math.max(0, speed) * AIR_FRACTION;
    const keep = Math.exp(-h / INERTIA);
    for (let i = 0; i < this.count; i++) {
      let a = this.a[i];
      if (a <= 0) continue;
      if (!isRaining) {
        // Once the rain stops the drops slowly evaporate (negligible while it rains).
        const a2 = a * a - 2 * EVAPORATION * h;
        a = a2 > 1e-8 ? Math.sqrt(a2) : 0;
        this.a[i] = a;
        if (a === 0) continue;
      }
      const px = this.x[i];
      const py = this.y[i];
      const mass = RHO * KAPPA * a * a * a;
      // The air runs up the glass, faster towards the roof, fanning out towards the pillars.
      const u = air * (0.55 + (0.6 * py) / GLASS_H);
      const drag = 0.5 * RHO_AIR * DRAG_CD * FRONTAL * a * a * u * u;
      const sx = FLOW_SPREAD * (px / GLASS_W - 0.5);
      const sl = Math.hypot(sx, 1);
      const fx = (drag * sx) / sl;
      const fy = drag / sl - mass * G * SIN_RAKE;
      const force = Math.hypot(fx, fy);
      // Hysteresis holds the drop up to 2γ·a·Δcosθ, more or less where the glass is dirtier.
      const hold = 2 * GAMMA * HYSTERESIS * a * (0.6 + 0.8 * noise(px / PIN_SCALE, py / PIN_SCALE));
      let tx = 0;
      let ty = 0;
      const isSliding = force > hold;
      if (isSliding) {
        // Big drops stop speeding up as they turn into rivulets (bulk viscosity takes over).
        const free = (force - hold) / (CONTACT_FRICTION * MU * a);
        const run = free / (1 + free / MAX_RUN);
        // Surface flaws steer a running drop from side to side.
        const turn = WANDER * 2 * (noise(px / 7e-3 + 31.7, py / 7e-3) - 0.5);
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const dx = fx / force;
        const dy = fy / force;
        tx = (dx * c - dy * s) * run;
        ty = (dx * s + dy * c) * run;
      }
      const vx = tx + (this.vx[i] - tx) * keep;
      const vy = ty + (this.vy[i] - ty) * keep;
      this.vx[i] = vx;
      this.vy[i] = vy;
      const dist = Math.hypot(vx, vy) * h;
      this.x[i] = px + vx * h;
      this.y[i] = py + vy * h;
      const isOff = this.x[i] < -a || this.x[i] > GLASS_W + a || this.y[i] < -a || this.y[i] > GLASS_H + a;
      if (isOff) {
        this.a[i] = 0;
        continue;
      }
      if (dist < 1e-7) continue;
      this.sweep(i, dist);
      this.leaveTrail(i, dist);
      const isOversized = this.a[i] > A_SPLIT;
      if (isOversized) this.split(i);
    }
  }

  /** A running drop takes up the fine droplets in its path (leaving a clear channel). */
  private sweep(i: number, dist: number): void {
    const c = this.cellAt(this.x[i], this.y[i]);
    const w = this.water[c];
    if (w <= 0) return;
    const a = this.a[i];
    const take = w * Math.min(1, (2 * a * dist) / CELL_AREA);
    this.water[c] = w - take;
    this.a[i] = Math.cbrt(a ** 3 + (take * CELL_AREA) / KAPPA);
  }

  /** Every couple of radii run, a sliding drop leaves a droplet behind (its receding edge breaks). */
  private leaveTrail(i: number, dist: number): void {
    const a = this.a[i];
    if (a < TRAIL_MIN) return;
    this.trail[i] += dist;
    if (this.trail[i] < TRAIL_EVERY * a) return;
    this.trail[i] = this.rng() * a;
    if (this.count >= this.maxDrops * TRAIL_ROOM) return;
    const t = a * (0.16 + 0.12 * this.rng());
    const v = Math.hypot(this.vx[i], this.vy[i]);
    const back = (a + t) * 1.15;
    const tx = this.x[i] - (this.vx[i] / v) * back;
    const ty = this.y[i] - (this.vy[i] / v) * back;
    this.a[i] = Math.cbrt(a ** 3 - t ** 3);
    this.add(tx, ty, t);
  }

  /**
   * A drop running this big would become a rivulet; it breaks into two side by side instead (a
   * cap model cannot draw a rivulet, and one huge lens looked wrong).
   */
  private split(i: number): void {
    const a = this.a[i] / Math.cbrt(2);
    const v = Math.hypot(this.vx[i], this.vy[i]) || 1;
    const sx = (-this.vy[i] / v) * a * 1.05;
    const sy = (this.vx[i] / v) * a * 1.05;
    this.a[i] = a;
    const x = this.x[i];
    const y = this.y[i];
    this.x[i] = x + sx;
    this.y[i] = y + sy;
    this.add(x - sx, y - sy, a, this.vx[i], this.vy[i]);
  }

  /** Touching drops coalesce into one of the summed volume, at the volume-weighted centre. */
  private merge(): void {
    const { head, link } = this;
    head.fill(-1);
    for (let i = 0; i < this.count; i++) {
      if (this.a[i] <= 0) continue;
      const cell = this.gridCell(this.x[i], this.y[i]);
      link[i] = head[cell];
      head[cell] = i;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.a[i] <= 0) continue;
      const gx = Math.min(GRID_W - 1, Math.max(0, Math.floor(this.x[i] / GRID)));
      const gy = Math.min(GRID_H - 1, Math.max(0, Math.floor(this.y[i] / GRID)));
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(GRID_H - 1, gy + 1); cy++) {
        for (let cx = Math.max(0, gx - 1); cx <= Math.min(GRID_W - 1, gx + 1); cx++) {
          for (let j = head[cy * GRID_W + cx]; j >= 0; j = link[j]) {
            if (j === i || this.a[j] <= 0 || this.a[i] <= 0) continue;
            const reach = this.a[i] + this.a[j];
            const dx = this.x[j] - this.x[i];
            const dy = this.y[j] - this.y[i];
            const isTouching = dx * dx + dy * dy < reach * reach;
            if (isTouching) this.combine(i, j);
          }
        }
      }
    }
    this.compact();
  }

  private gridCell(x: number, y: number): number {
    const gx = Math.min(GRID_W - 1, Math.max(0, Math.floor(x / GRID)));
    const gy = Math.min(GRID_H - 1, Math.max(0, Math.floor(y / GRID)));
    return gy * GRID_W + gx;
  }

  private combine(i: number, j: number): void {
    const vi = this.a[i] ** 3;
    const vj = this.a[j] ** 3;
    const v = vi + vj;
    this.x[i] = (this.x[i] * vi + this.x[j] * vj) / v;
    this.y[i] = (this.y[i] * vi + this.y[j] * vj) / v;
    this.vx[i] = (this.vx[i] * vi + this.vx[j] * vj) / v;
    this.vy[i] = (this.vy[i] * vi + this.vy[j] * vj) / v;
    this.a[i] = Math.cbrt(v);
    this.trail[i] = Math.min(this.trail[i], this.trail[j]);
    this.a[j] = 0;
  }

  /** Drop the removed drops (a = 0), keeping the arrays packed. */
  private compact(): void {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.a[i] <= 0) continue;
      if (n !== i) {
        this.x[n] = this.x[i];
        this.y[n] = this.y[i];
        this.a[n] = this.a[i];
        this.vx[n] = this.vx[i];
        this.vy[n] = this.vy[i];
        this.trail[n] = this.trail[i];
      }
      n++;
    }
    this.count = n;
  }

  /** The blades clear the band they swept since the last frame and carry the water along. */
  private wipe(blades: readonly number[]): void {
    for (let b = 0; b < WIPER_BLADES.length; b++) {
      const blade = WIPER_BLADES[b];
      const now = blades[b] ?? blade.park;
      const before = this.prevBlade[b];
      this.prevBlade[b] = now;
      const delta = now - before;
      const isMoving = Math.abs(delta) > 1e-6;
      if (!isMoving) continue;
      const lo = Math.min(before, now);
      const hi = Math.max(before, now);
      const [ox, oy] = blade.pivot;
      let load = 0;
      for (let i = 0; i < this.count; i++) {
        const a = this.a[i];
        const px = this.x[i] - ox;
        const py = this.y[i] - oy;
        const r = Math.hypot(px, py);
        const isInSpan = r > blade.rIn - a && r < blade.rOut + a;
        if (!isInSpan) continue;
        const phi = Math.atan2(py, -px);
        const margin = a / Math.max(r, 1e-3);
        const isSwept = phi > lo - margin && phi < hi + margin;
        if (!isSwept) continue;
        load += KAPPA * a ** 3;
        this.a[i] = 0;
      }
      const { cells, phi } = this.bladeCells[b];
      for (let k = lowerBound(phi, lo); k < phi.length && phi[k] <= hi; k++) {
        const c = cells[k];
        load += this.water[c] * (1 - RESIDUAL) * CELL_AREA;
        this.water[c] *= RESIDUAL;
        this.film[c] = 1;
      }
      this.isWet = true;
      this.bladeLoad[b] += load;
      const dir = Math.sign(delta);
      // Up the glass the blade carries its water to the top of the stroke and leaves it there;
      // down the glass it pushes it off the bottom edge.
      const isTopReversal = this.bladeDir[b] > 0 && dir < 0;
      if (isTopReversal) this.deposit(b, hi);
      const isParked = dir < 0 && now <= blade.park + 1e-4;
      if (isParked) this.bladeLoad[b] = 0;
      this.bladeDir[b] = dir;
    }
    this.compact();
  }

  /**
   * The water a blade pushed up, left just past the end of its stroke: a row of beads, the rest
   * as fine droplets along the line (the rest of the load runs off the blade's end).
   */
  private deposit(b: number, angle: number): void {
    const blade = WIPER_BLADES[b];
    let volume = this.bladeLoad[b] * DEPOSIT_KEEP;
    this.bladeLoad[b] = 0;
    const phi = angle + 2 * DEG;
    const at = (t: number): [number, number] => {
      const r = blade.rIn + (blade.rOut - blade.rIn) * t;
      return [blade.pivot[0] - Math.cos(phi) * r, blade.pivot[1] + Math.sin(phi) * r];
    };
    for (let k = 0; k < DEPOSIT_BEADS && volume > 0; k++) {
      const a = DEPOSIT_A * (0.6 + 0.6 * this.rng());
      const v = Math.min(volume, KAPPA * a ** 3);
      const [x, y] = at((k + this.rng()) / DEPOSIT_BEADS);
      if (!isOnGlass(x, y)) continue;
      this.add(x, y, Math.cbrt(v / KAPPA));
      volume -= v;
    }
    if (volume <= 0) return;
    for (let k = 0; k < 16; k++) {
      const [x, y] = at(this.rng());
      if (isOnGlass(x, y)) this.addWater(x, y, volume / 16);
    }
  }

  /** Fine droplets: rain adds them, the film beads into them, crowded ones coalesce into drops. */
  private updateField(dt: number, microRate: number): void {
    const isRaining = microRate > 0;
    if (!this.isWet && !isRaining) return;
    const add = microRate * dt;
    const dry = isRaining ? 1 : Math.exp(-dt / MICRO_DRY_TAU);
    const filmKeep = Math.exp(-dt / FILM_TAU);
    // Coalescence takes its time: a few cells a frame, so it cannot take every free slot at once.
    let budget = this.coarsenDebt + COARSEN_RATE * dt;
    this.coarsenDebt = budget % 1;
    budget = Math.floor(budget);
    let isWet = false;
    for (let c = 0; c < this.water.length; c++) {
      let w = this.water[c] * dry + add;
      const f = this.film[c];
      if (f > 0) {
        const next = f * filmKeep < 0.004 ? 0 : f * filmKeep;
        w += (f - next) * FILM_DEPTH;
        this.film[c] = next;
      }
      const isCrowded = w > COARSEN * MICRO_SCALE * this.cellThreshold[c];
      if (isCrowded && budget > 0 && this.count < this.maxDrops * COARSEN_ROOM) {
        budget--;
        const excess = w - 0.5 * MICRO_SCALE * this.cellThreshold[c];
        const i = c % FIELD_W;
        const j = (c - i) / FIELD_W;
        this.add(
          (i + this.rng()) * CELL_W,
          (j + this.rng()) * CELL_H,
          Math.cbrt((excess * CELL_AREA) / KAPPA),
        );
        w -= excess;
      }
      // Once the rain stops, droplets too sparse to show count as gone (else the glass would
      // stay "wet", and drawn, for most of an hour of exponential drying).
      const isTrace = w < (isRaining ? 1e-9 : MICRO_SCALE / 64);
      if (isTrace) w = 0;
      this.water[c] = w;
      isWet ||= w > 0 || this.film[c] > 0;
      this.fieldBytes[c * 2] = COVER_LUT[Math.min(COVER_LUT.length - 1, ((w / MICRO_SCALE) * 32) | 0)];
      this.fieldBytes[c * 2 + 1] = 255 * Math.min(1, this.film[c]);
    }
    this.isWet = isWet;
    this.fieldVersion++;
  }
}

// ---- Optics ----

const SIN_CAP = float(SIN_C);
const COT_C = float(COS_C / SIN_C);
const INV_SIN2 = float(1 / SIN_C ** 2);
const N = float(N_WATER);
/** Fine droplets: one candidate per cell of this size (m), drawn radius 0.12–0.32 cells. */
const MICRO_CELL = 3.2e-3;

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;
type V4 = Node<"vec4">;

/** Dave Hoskins' hash (three outputs in [0, 1) from a 2D point). */
function hash32(p: V2): V3 {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yxz.add(33.33)));
  return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}

function noise1(x: F): F {
  const i = floor(x);
  const f = fract(x);
  return mix(hash32(vec2(i, 7)).x, hash32(vec2(i.add(1), 7)).x, f.mul(f).mul(f.mul(-2).add(3)));
}

/**
 * A fine droplet at cell coordinate cp, where the field says the glass is this wet: its position in
 * the cap (contact radii) and coverage, premultiplied. Its edge is blurred over `blur` cells (the
 * defocus), analytically: taps would draw droplets this small as crosses.
 */
function microDrop(cp: V2, wetness: F, blur: F): V3 {
  const cell = floor(cp);
  const h = hash32(cell);
  const r = mix(0.12, 0.32, h.y.mul(h.y));
  const centre = r.add(
    r
      .mul(-2)
      .add(1)
      .mul(hash32(cell.add(17)).xy),
  );
  const q = cp.sub(cell).sub(centre).div(r);
  const soft = clamp(blur.div(r), 0.15, 0.9);
  const edge = float(1)
    .sub(smoothstep(soft.oneMinus(), soft.mul(0.5).add(1), length(q)))
    .div(soft.add(1));
  const a = select(h.x.lessThan(wetness), edge, float(0));
  return vec3(q, 1).mul(a);
}

/** The blade's rubber wipes unevenly along its length, so its film lies in arcs round the pivot. */
function streaks(r: F, seed: number): F {
  return noise1(r.mul(700).add(seed))
    .mul(0.55)
    .add(noise1(r.mul(2300).add(seed * 3.1)).mul(0.3))
    .add(noise1(r.mul(160).add(seed)).mul(0.15));
}

function filmTilt(pm: V2, pivot: V2, span: V2, seed: number): V2 {
  const rel = pm.sub(pivot);
  const r = length(rel);
  const inSpan = step(span.x, r).mul(step(r, span.y));
  const slope = streaks(r.add(1e-4), seed)
    .sub(streaks(r.sub(1e-4), seed))
    .div(2e-4);
  return rel.div(max(r, 1e-3)).mul(slope).mul(inSpan);
}

/**
 * The view ray through a sessile drop: a spherical cap of contact radius 1 meeting the glass at the
 * contact angle (sphere radius 1/sinθ, centre cotθ below the glass). The ray enters through the flat
 * base at q going d (in the water) and leaves through the curved surface, or, past the critical
 * angle, reflects inside and tries again further on. Returns the direction in the air (glass axes)
 * and the transmitted share; zero when the ray ends up back in the glass and so in the cabin.
 */
function throughCap(q: V2, entering: V3): V4 {
  const o = vec3(q, COT_C); // base point relative to the sphere's centre
  const b = dot(o, entering);
  let d: V3 = entering;
  let p: V3 = o.add(d.mul(b.negate().add(sqrt(max(b.mul(b).sub(dot(o, o)).add(INV_SIN2), 0)))));
  let out: V4 = vec4(0, 0, 0, 0);
  let isDone: Node<"bool"> = bool(false);
  // Three bounces unrolled into straight-line code (select, not If/Break): the derivatives taken
  // after this must stay in uniform control flow, which a data-dependent break would end in WGSL.
  for (let k = 0; k < 3; k++) {
    const n = p.mul(SIN_CAP).toVar();
    const cosI = dot(d, n).toVar();
    const sin2T = N.mul(N).mul(cosI.mul(cosI).oneMinus());
    const isOut = isDone.not().and(sin2T.lessThan(1));
    const cosT = sqrt(max(sin2T.oneMinus(), 0));
    const fresnel = float(0.98).mul(pow(cosT.oneMinus(), 5)).add(0.02);
    out = select(isOut, vec4(d.mul(N).add(n.mul(cosT.sub(N.mul(cosI)))), fresnel.oneMinus()), out).toVar();
    isDone = isDone.or(isOut).toVar();
    const reflected = d.sub(n.mul(cosI.mul(2))).toVar();
    const next = p.add(reflected.mul(dot(p, reflected).mul(-2))).toVar();
    // Below the base: out through the glass, into the cabin (out stays zero).
    isDone = isDone.or(next.z.lessThan(COT_C)).toVar();
    d = select(isDone, d, reflected).toVar();
    p = select(isDone, p, next).toVar();
  }
  return out;
}

/**
 * Drawn size over physical size. A screen pixel here spans about 1.2 mrad, four times coarser
 * than the eye resolves, so drops drawn at their real 1–3 mm would be 2–5 px specks that read as
 * dust; 2.5× keeps each lens readable. The physics, merging included, stays at the real size.
 */
const DRAW_SCALE = 2.5;
/** Smallest drawn radius, so trail droplets still read as dots on screen. */
const MIN_DRAWN = 0.6e-3;

/**
 * The windscreen's water: owns the simulation and draws it. Each frame the glass is wet, the drops
 * are drawn into a glass-space texture before the frame (drawDrops), and after the interior the
 * panes are drawn over the frame from a copy of the street and the wiper arms (drawPanes; the
 * interior is not behind the glass, so it is not in the copy).
 */
export class RainGlass {
  readonly sim: RainSim;
  private readonly panes: Array<{ source: Mesh; proxy: Mesh }> = [];
  private readonly paneScene = new Scene();
  private readonly dropScene = new Scene();
  private readonly dropCamera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly dropGeometry = new InstancedBufferGeometry();
  private readonly dropAttr: InstancedBufferAttribute;
  private readonly dirAttr: InstancedBufferAttribute;
  private readonly fieldTexture: DataTexture;
  private fieldUploaded = -1;
  private readonly dropsTarget: RenderTarget;
  private readonly clearColor = new Color();
  private readonly frameNode: TextureNode;
  private readonly u = {
    frameSize: uniform(new Vector2(1, 1)),
    viewProj: uniform(new Matrix4()),
    origin: uniform(new Vector3()),
    axisU: uniform(new Vector3()),
    axisV: uniform(new Vector3()),
    normal: uniform(new Vector3()),
    glow: uniform(0),
  };
  private readonly paneMaterial: NodeMaterial;
  private readonly dropMaterial: NodeMaterial;
  /** 0 by day, 1 at night: how strongly drops gather nearby lights. */
  glow = 0;

  constructor({ isMobile = false, maxDrops = 1000 }: { isMobile?: boolean; maxDrops?: number } = {}) {
    this.sim = new RainSim({ maxDrops, seed: 20261005 });
    // Glass texels about 1 mm (0.7 mm on desktop): finer than the drops, near the screen's density.
    const [w, h] = isMobile ? [1024, 576] : [2048, 1152];
    this.dropsTarget = new RenderTarget(w, h, {
      type: HalfFloatType,
      depthBuffer: false,
      magFilter: LinearFilter,
      minFilter: LinearFilter,
    });
    this.fieldTexture = new DataTexture(this.sim.fieldBytes, FIELD_W, FIELD_H, RGFormat, UnsignedByteType);
    this.fieldTexture.magFilter = LinearFilter;
    this.fieldTexture.minFilter = LinearFilter;
    this.fieldTexture.needsUpdate = true;
    const quad = new PlaneGeometry(2, 2);
    this.dropGeometry.index = quad.index;
    this.dropGeometry.setAttribute("position", quad.getAttribute("position"));
    this.dropAttr = new InstancedBufferAttribute(new Float32Array(maxDrops * 4), 4);
    this.dirAttr = new InstancedBufferAttribute(new Float32Array(maxDrops * 2), 2);
    this.dropGeometry.setAttribute("aDrop", this.dropAttr);
    this.dropGeometry.setAttribute("aDir", this.dirAttr);
    this.dropGeometry.instanceCount = 0;
    this.dropMaterial = dropMaterial();
    const drops = new Mesh(this.dropGeometry, this.dropMaterial);
    drops.frustumCulled = false;
    this.dropScene.add(drops);
    // A stand-in until the first copy of the frame (the composer hands one over each wet frame).
    this.frameNode = texture(new DataTexture(new Uint8Array(4), 1, 1));
    this.paneMaterial = this.makePaneMaterial();
  }

  /** Draw this Windshield mesh with the rain shader, in a pass after the scene. */
  addPane(mesh: Mesh): void {
    const proxy = new Mesh(mesh.geometry, this.paneMaterial);
    proxy.matrixAutoUpdate = false;
    proxy.matrixWorldAutoUpdate = false;
    proxy.frustumCulled = false;
    this.paneScene.add(proxy);
    this.panes.push({ source: mesh, proxy });
    mesh.visible = false;
  }

  /** Something on the glass to draw (dry glass costs nothing beyond the scene itself). */
  isWet(): boolean {
    return !this.sim.isDry() && this.panes.length > 0;
  }

  /** The drops as spherical caps into the glass-space texture (before the frame: its own target). */
  drawDrops(renderer: WebGPURenderer): void {
    const sim = this.sim;
    const d = this.dropAttr.array as Float32Array;
    const dir = this.dirAttr.array as Float32Array;
    for (let i = 0; i < sim.count; i++) {
      const speed = Math.hypot(sim.vx[i], sim.vy[i]);
      const isRunning = speed > 2e-3;
      d[i * 4] = sim.x[i];
      d[i * 4 + 1] = sim.y[i];
      d[i * 4 + 2] = Math.max(MIN_DRAWN, sim.a[i] * DRAW_SCALE);
      // A running drop: round front, tail drawn out behind it (more the faster it runs).
      d[i * 4 + 3] = isRunning ? 1 + Math.min(1.6, speed / 0.15) : 1;
      dir[i * 2] = isRunning ? sim.vx[i] / speed : 0;
      dir[i * 2 + 1] = isRunning ? sim.vy[i] / speed : 0;
    }
    this.dropAttr.clearUpdateRanges();
    this.dropAttr.addUpdateRange(0, sim.count * 4);
    this.dropAttr.needsUpdate = true;
    this.dirAttr.clearUpdateRanges();
    this.dirAttr.addUpdateRange(0, sim.count * 2);
    this.dirAttr.needsUpdate = true;
    this.dropGeometry.instanceCount = sim.count;
    // Clear to "no water" (alpha 0) without touching the scene's clear colour.
    const color = renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha();
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.dropsTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (sim.count > 0) {
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(this.dropScene, this.dropCamera);
      renderer.autoClear = autoClear;
    }
    renderer.setRenderTarget(before);
    renderer.setClearColor(color, alpha);
  }

  /**
   * The panes over the frame (after the interior, testing against its depth), refracting `frame`:
   * the street and the wiper arms, linear HDR with mipmaps. Drawn with the interior's camera, so the
   * glass close to the eye is not clipped either.
   */
  drawPanes(
    composer: FrameComposer,
    frame: Texture,
    camera: PerspectiveCamera,
    car: Object3D,
    nearCamera: PerspectiveCamera,
  ): void {
    this.syncField();
    const u = this.u;
    this.frameNode.value = frame;
    const image = frame.image as { width: number; height: number };
    u.frameSize.value.set(image.width, image.height);
    u.viewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.glow.value = this.glow;
    // Glass frame in the car (knowledge/cockpit-blender.md): UV (0, 0) corner, u and v axes, and
    // the outward normal.
    const m = car.matrixWorld;
    u.origin.value.set(0.7353, 0.188, 0.9454).applyMatrix4(m);
    u.axisU.value.set(-1, 0, 0).transformDirection(m);
    u.axisV.value.set(0, 0.4204, -0.9073).transformDirection(m);
    u.normal.value.set(0, 0.9073, 0.4204).transformDirection(m);
    for (const p of this.panes) p.proxy.matrixWorld.copy(p.source.matrixWorld);
    const layers = nearCamera.layers.mask;
    nearCamera.layers.enableAll();
    composer.drawOver(this.paneScene, nearCamera, true);
    nearCamera.layers.mask = layers;
  }

  /** Build the glass's and the drops' pipelines before the first wet frame. */
  async precompile(
    renderer: WebGPURenderer,
    frameTarget: RenderTarget,
    near: PerspectiveCamera,
  ): Promise<void> {
    renderer.setRenderTarget(frameTarget);
    const panes = renderer.compileAsync(this.paneScene, near);
    renderer.setRenderTarget(this.dropsTarget);
    const drops = renderer.compileAsync(this.dropScene, this.dropCamera);
    renderer.setRenderTarget(null);
    await Promise.all([panes, drops]);
  }

  /** Upload the fine-droplet coverage and the film when they changed. */
  private syncField(): void {
    if (this.fieldUploaded === this.sim.fieldVersion) return;
    this.fieldUploaded = this.sim.fieldVersion;
    this.fieldTexture.needsUpdate = true;
  }

  /**
   * The windscreen: the view ray traced through each drop's cap into the frame copy. Screen
   * positions are in the frame's uv with the origin at the top left (screenUV, as three samples a
   * copy of the frame on both backends).
   */
  private makePaneMaterial(): NodeMaterial {
    const u = this.u;
    const frame = this.frameNode;
    const drops = texture(this.dropsTarget.texture);
    const field = texture(this.fieldTexture);
    const glass = vec2(GLASS_W, GLASS_H);
    const pivots = vec4(...WIPER_BLADES[0].pivot, ...WIPER_BLADES[1].pivot);
    const spans = vec4(WIPER_BLADES[0].rIn, WIPER_BLADES[0].rOut, WIPER_BLADES[1].rIn, WIPER_BLADES[1].rOut);
    const toScreen = (p: V3): V2 => {
      const c = u.viewProj.mul(vec4(p, 1));
      const ndc = c.xy.div(c.w);
      return vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5));
    };
    // Where the frame shows what lies along world direction d. The street is far compared with the
    // drop's distance from the eye, so the direction alone picks the pixel. Directions the frame
    // shows only as cabin (roof lining, dashboard, pillars) are pulled back to the edge of the
    // glass, the nearest place the frame shows the outside.
    const throughWindow = (d: V3): V2 => {
      const s = dot(u.origin.sub(cameraPosition), u.normal).div(max(dot(d, u.normal), 1e-3));
      const q = cameraPosition.add(d.mul(s)).sub(u.origin);
      const g = clamp(vec2(dot(q, u.axisU), dot(q, u.axisV)).div(glass), 0.015, 0.985);
      return toScreen(u.origin.add(u.axisU.mul(g.x.mul(GLASS_W))).add(u.axisV.mul(g.y.mul(GLASS_H))));
    };
    const shade = Fn(() => {
      const vUv = uv();
      const pm = vUv.mul(glass);
      const screen = screenUV;
      const wetField = field.sample(vUv).rg;
      // Defocus: the eye is focused on the road, so the water blurs by a few pixels. Six taps on a
      // ring 1.6 px across on screen (whatever the glass's foreshortening) plus the centre.
      // (Derivatives and implicit-LOD samples stay out of branches: WGSL wants them in uniform
      // control flow.)
      const du = dFdx(vUv).mul(1.6);
      const dv = dFdy(vUv).mul(1.6);
      let drop = drops.sample(vUv).mul(0.25);
      for (let k = 0; k < 6; k++) {
        const a = k * 1.0472 + 0.3;
        drop = drop.add(drops.sample(vUv.add(du.mul(Math.cos(a))).add(dv.mul(Math.sin(a)))).mul(0.125));
      }
      const cp = pm.div(MICRO_CELL);
      const fw = fwidth(cp);
      const micro = microDrop(cp, wetField.x, max(fw.x, fw.y).mul(1.2));
      // Simulated drops over the fine ones (premultiplied "over").
      const water3 = vec3(drop.xy, drop.w).add(micro.mul(drop.w.oneMinus())).toVar();
      const wet = clamp(water3.z, 0, 1).toVar();
      const q = select(wet.greaterThan(1e-3), water3.xy.div(water3.z), vec2(0, 0));

      // The view ray in glass axes, then into the water through the flat glass (the tangential
      // part shrinks by 1/n).
      const view = normalize(positionWorld.sub(cameraPosition));
      const vt = vec3(dot(view, u.axisU), dot(view, u.axisV), dot(view, u.normal));
      const tw = vt.xy.div(N);
      const inWater = vec3(tw, sqrt(max(dot(tw, tw).oneMinus(), 0)));
      const cap = throughCap(q, inWater);
      const isCabin = cap.w.lessThanEqual(0);
      // The blade's film: streaky arcs that tilt the view a little while it thins out.
      const film = wetField.y;
      const tilt = filmTilt(pm, pivots.xy, spans.xy, 0)
        .add(filmTilt(pm, pivots.zw, spans.zw, 41))
        .mul(film)
        .mul(2.5e-5)
        .mul(step(0.003, film));
      const bent = mix(vt, cap.xyz, step(1e-3, wet));
      const outT = vec3(bent.xy.add(tilt.mul(N_WATER - 1)), bent.z).toVar();
      const dir = normalize(u.axisU.mul(outT.x).add(u.axisV.mul(outT.y)).add(u.normal.mul(outT.z)));
      const uvR = select(isCabin.and(wet.greaterThan(1e-3)), screen, throughWindow(dir)).toVar();

      // A drop shows a wide view squeezed into a few pixels: the mip level does the averaging, but
      // two levels short of the full footprint (three at night) so that lights stay points in it.
      // They twinkle as the car moves, as in real drops; the full average turned every drop grey.
      const px = uvR.mul(u.frameSize);
      const footprint = max(length(dFdx(px)), length(dFdy(px)));
      const lod = clamp(log2(max(footprint, 1)).sub(u.glow.add(2).mul(wet)).add(film.mul(1.5)), 0, 6);

      const base = frame.sample(screen).level(float(0)).rgb;
      // The copy is linear HDR: a light keeps its brightness in the drop's tiny image of it. (The
      // WebGL version pushed the bright part back up at night: its copy was tone-mapped, so a light
      // read as about 1.)
      const seen = frame.sample(uvR).level(lod).rgb;
      const cabin = frame.sample(vec2(0.5, 0.9)).level(float(7)).rgb.mul(0.6);
      const sky = frame
        .sample(toScreen(u.origin.add(u.axisU.mul(0.5 * GLASS_W)).add(u.axisV.mul(0.92 * GLASS_H))))
        .level(float(5)).rgb;
      const water = select(isCabin, cabin, mix(cabin, seen, cap.w)).toVar();
      // At night the lights around also light the whole drop a little (a soft glow). Squeezed back
      // into the range the tuning was made in (the linear copy holds the lights' full radiance).
      const hdrHalo = frame.sample(screen).level(float(6)).rgb;
      const halo = hdrHalo.div(hdrHalo.add(1));
      water.addAssign(max(halo.sub(0.1), 0).mul(1.2).mul(u.glow).mul(wet));
      // The film also scatters a little light: a faint haze over the smear.
      const smear = film.mul(0.9);
      const smeared = mix(seen, sky, 0.08);
      const total = max(wet, smear);
      Discard(total.lessThan(0.002));
      const col = mix(mix(base, smeared, smear.mul(wet.oneMinus())), water, wet);
      return vec4(col, 1);
    });
    const material = new NodeMaterial();
    material.fragmentNode = shade();
    // The pane writes every glass pixel it touches (the frame copy plus the water), so no blending.
    material.blending = NoBlending;
    material.depthWrite = false;
    material.fog = false;
    material.name = "rain-glass";
    return material;
  }
}

/**
 * One instanced quad per drop, drawn into a glass-space texture: RG = where in its cap each point
 * lies (contact radii, premultiplied), A = coverage.
 */
function dropMaterial(): NodeMaterial {
  const drop = attribute<"vec4">("aDrop", "vec4"); // centre (m), drawn radius (m), tail stretch (≥ 1)
  const aDir = attribute<"vec2">("aDir", "vec2"); // direction of motion, zero at rest
  const dir = select(dot(aDir, aDir).greaterThan(0.25), aDir, vec2(0, -1));
  const side = vec2(dir.y.negate(), dir.x);
  // From the tail (stretch radii behind the centre) to the round front (one radius ahead).
  const local = vec2(
    select(positionGeometry.x.lessThan(0), drop.w.negate(), float(1)),
    positionGeometry.y,
  ).mul(1.04);
  const p = drop.xy.add(dir.mul(local.x).add(side.mul(local.y)).mul(drop.z));
  const ndc = p.div(vec2(GLASS_W, GLASS_H)).mul(2).sub(1);
  const material = new NodeMaterial();
  // Glass v up = the top of the target down: a target's row 0 is sampled at v = 0 on both
  // backends, so the panes read this texture with the glass UV as it is.
  material.vertexNode = vec4(ndc.x, ndc.y.negate(), 0, 1);
  const vLocal = varying(local);
  const vDir = varying(dir);
  const vStretch = varying(drop.w);
  material.fragmentNode = Fn(() => {
    const isTail = vLocal.x.lessThan(0);
    const q = vec2(select(isTail, vLocal.x.div(vStretch), vLocal.x), vLocal.y);
    const rho2 = dot(q, q);
    Discard(rho2.greaterThanEqual(1));
    // Where in the (round) cap this point lies, in contact radii along the glass axes: the glass
    // shader traces the view ray through the cap from here. A running drop's tail is the cap
    // stretched out behind it.
    const g = vDir.mul(q.x).add(vec2(vDir.y.negate(), vDir.x).mul(q.y));
    const alpha = smoothstep(0.8, 1, sqrt(rho2)).oneMinus();
    // Premultiplied (by three, from this straight colour: premultipliedAlpha), so overlapping edges
    // blend instead of cutting each other.
    return vec4(g, 0, alpha);
  })();
  material.fog = false;
  material.transparent = true;
  material.blending = NormalBlending;
  material.premultipliedAlpha = true;
  material.depthTest = false;
  material.depthWrite = false;
  // The flipped y turns the quads round.
  material.side = DoubleSide;
  material.name = "rain-drops";
  return material;
}
