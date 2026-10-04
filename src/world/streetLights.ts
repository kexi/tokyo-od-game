import RAPIER from "@dimforge/rapier3d-compat";
import {
  BoxGeometry,
  type BufferGeometry,
  type Camera,
  Color,
  CylinderGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GRAPHICS } from "../device";
import { log } from "../log";
import { PROP_GROUPS } from "../physics/groups";
import { leftOf, type RoadGraph, type RoadLine, type Segment } from "./roads";
import type { Approach, LightState } from "./trafficControl";

/**
 * 道路照明 (street lights) along the streamed road network, and the shading of the street surfaces
 * that they and the weather act on: wet asphalt, puddles and rain ripples from `env.wetness`, light
 * pools from the nearest lamps, and the long streaky reflections of lamps, signals and car lamps on
 * a wet road. See knowledge/street-lighting-and-wet-roads.md for the sources and measurements.
 *
 * Why not real three.js lights: every PointLight is evaluated by every lit material and changing
 * their number recompiles every program. Here only the street surfaces (asphalt, paint, paving,
 * kerbs) read a small uniform array of the nearest lamps, refilled each frame as the car moves.
 * Why not screen-space reflections: the renderer uses a logarithmic depth buffer and no depth
 * pre-pass, so SSR would cost a depth/normal pass of the whole frame; the streaks come instead from
 * an anisotropic specular lobe over the same lamp list, and the sky from the scene environment map.
 */

// ---------- lamp placement (道路照明施設設置基準 / JIS Z 9111 / 防犯灯) ----------

/** 灯具の配列: one side, staggered (千鳥), or opposite pairs (向き合わせ). */
export type Arrangement = "one-side" | "staggered" | "opposite";

export type LampSpec = {
  name: "arterial" | "main" | "street" | "residential" | "lane";
  /** Mounting height H (m): ground to the luminaire. */
  height: number;
  /** Spacing S (m) between lamps on the same side of the street. */
  spacing: number;
  /** Overhang (m): how far the arm holds the luminaire out over the carriageway. */
  reach: number;
  arrangement: Arrangement;
  /** Luminous intensity towards the nadir (cd); the distribution is `luminaire`. */
  candela: number;
};

/**
 * Lighting class for a street, from its GSI carriageway width (rnkWidth midpoints 2.5 / 4.3 / 9 /
 * 16 m, or the real width above 19.5 m). The continuous-lighting rules keep the spacing S ≤ 3.5 H
 * and choose the arrangement by width W: one side for W ≤ H, staggered for W ≤ 1.5 H, opposite
 * beyond. Streets under 5.5 m get 防犯灯 (small crime-prevention lights) instead, sparser.
 * 首都高 (elevated) has no deck in the game, so no lights.
 */
export function lampSpecFor(width: number, kind: RoadLine["kind"]): LampSpec | null {
  if (kind === "highway") return null;
  if (width >= 19.5)
    return { name: "arterial", height: 12, spacing: 40, reach: 2.4, arrangement: "opposite", candela: 2400 };
  if (width >= 13)
    return { name: "main", height: 12, spacing: 38, reach: 2.2, arrangement: "staggered", candela: 2200 };
  if (width >= 5.5)
    return { name: "street", height: 10, spacing: 35, reach: 1.8, arrangement: "one-side", candela: 1500 };
  if (width >= 3)
    return {
      name: "residential",
      height: 5.5,
      spacing: 40,
      reach: 0.7,
      arrangement: "one-side",
      candela: 220,
    };
  return { name: "lane", height: 4.5, spacing: 50, reach: 0.5, arrangement: "one-side", candela: 150 };
}

/** A lamp: pole foot (x, z), the arm's direction towards the carriageway, and its light. */
export type LampSite = {
  x: number;
  z: number;
  /** Unit vector from the pole over the carriageway. */
  ax: number;
  az: number;
  spec: LampSpec;
  sodium: boolean;
  /** Darkness at which its photocell switches it on (they do not all switch at once). */
  threshold: number;
};

/** Pole foot behind the carriageway edge (on the pavement, clear of the kerb). */
const SETBACK = 0.6;
// A fixed bearing (not along the usual N–S / E–W grid) that picks the lit side of one-sided
// streets: the same physical side whichever way a segment's points run.
const SIDE_PICK = new Vector3(0.6, 0, -0.8);

/**
 * Stations along a segment of length L for spacing S: n = round(L / S) lamps evenly spread at
 * (k + 0.5)·L/n, so consecutive segments meet with about one spacing between their end lamps.
 * `half` shifts by half a spacing (the other side of a staggered street), which puts the first and
 * last at the segment's ends.
 */
export function stations(length: number, spacing: number, half = false): number[] {
  const n = Math.round(length / spacing);
  const isShort = n === 0;
  if (isShort) return length >= spacing * 0.35 && !half ? [length / 2] : [];
  const step = length / n;
  const out: number[] = [];
  if (half) for (let k = 0; k <= n; k++) out.push(k * step);
  else for (let k = 0; k < n; k++) out.push((k + 0.5) * step);
  return out;
}

/** Sides of the segment (+1 left of its point order) to light, with whether they are offset. */
export function sidesFor(spec: LampSpec, dir: Vector3): Array<{ side: 1 | -1; half: boolean }> {
  if (spec.arrangement === "opposite")
    return [
      { side: 1, half: false },
      { side: -1, half: false },
    ];
  const left = leftOf(dir, 1);
  const lit: 1 | -1 = left.dot(SIDE_PICK) >= 0 ? 1 : -1;
  if (spec.arrangement === "one-side") return [{ side: lit, half: false }];
  return [
    { side: lit, half: false },
    { side: -lit as 1 | -1, half: true },
  ];
}

/** Hash of two numbers into [0, 1). */
const hash2 = (a: number, b: number) =>
  ((((Math.round(a) * 73856093) ^ (Math.round(b) * 19349663)) >>> 0) % 1_000_003) / 1_000_003;

/**
 * Some 国道 sections keep 高圧ナトリウム lamps (orange, ~2100 K): LED replacement goes with each
 * luminaire's renewal since the 2011 MLIT LED guideline. Assumed: a quarter of 国道 by ~400 m
 * stretch (by geography, so it survives re-anchoring), all other roads LED 4000 K.
 */
function isSodium(seg: Segment): boolean {
  if (seg.line.kind !== "national") return false;
  const lon = seg.line.coords[0];
  const lat = seg.line.coords[1];
  return hash2(lon / 0.004, lat / 0.004) < 0.25;
}

type PlaceGraph = Pick<RoadGraph, "segments" | "sample" | "carriagewaysAt">;

/**
 * Lamps for every surface street: stations per side by the lighting class, each pole just behind
 * the kerb, skipped where it would stand in another carriageway (junction boxes, narrow crossings)
 * or within 0.4 S of a lamp already placed (segment joins, the corner of a crossing street).
 */
export function placeLamps(graph: PlaceGraph): LampSite[] {
  const sites: LampSite[] = [];
  const grid = new Map<string, number[]>();
  const CELL = 16;
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const isCrowded = (x: number, z: number, r: number) => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const reach = Math.ceil(r / CELL);
    for (let i = cx - reach; i <= cx + reach; i++)
      for (let j = cz - reach; j <= cz + reach; j++)
        for (const id of grid.get(`${i},${j}`) ?? []) {
          const isNear = Math.hypot(sites[id].x - x, sites[id].z - z) < r;
          if (isNear) return true;
        }
    return false;
  };
  const probe = new Vector3();
  const out = new Vector3();
  for (const seg of graph.segments) {
    const spec = lampSpecFor(seg.line.width, seg.line.kind);
    if (!spec) continue;
    const half = seg.line.width / 2;
    const middle = graph.sample(seg, seg.length / 2).dir.clone();
    const sodium = isSodium(seg);
    for (const { side, half: offset } of sidesFor(spec, middle)) {
      for (const s of stations(seg.length, spec.spacing, offset)) {
        const { pos, dir } = graph.sample(seg, s);
        leftOf(dir, side * (half + SETBACK), out);
        const x = pos.x + out.x;
        const z = pos.z + out.z;
        probe.set(x, 0, z);
        if (graph.carriagewaysAt(probe, 0.3).length > 0) continue;
        if (isCrowded(x, z, spec.spacing * 0.4)) continue;
        const id = sites.length;
        sites.push({
          x,
          z,
          ax: -out.x / (half + SETBACK),
          az: -out.z / (half + SETBACK),
          spec,
          sodium,
          // Photocells (自動点滅器) differ: switch-on spread over a darkness band.
          threshold: 0.2 + 0.12 * hash2(seg.line.coords[0] * 1e5 + s, seg.line.coords[1] * 1e5 + side),
        });
        const k = key(x, z);
        const list = grid.get(k) ?? [];
        list.push(id);
        grid.set(k, list);
      }
    }
  }
  return sites;
}

// ---------- photometry ----------

/**
 * Cut-off road luminaire, relative to its nadir intensity, by the cosine of the angle γ from the
 * nadir: rising towards ~70° to spread light along the road (batwing), then cut off above ~75–80°
 * to limit glare. The illuminance on flat ground is I(γ)·cos³γ / H².
 */
export function luminaire(cosGamma: number): number {
  if (cosGamma <= 0) return 0;
  const s2 = 1 - cosGamma * cosGamma;
  return (1 + 2 * s2) * smoothstep(0.17, 0.42, cosGamma);
}

/** Horizontal illuminance (lx) on flat ground `d` metres from the pole foot of a lamp H high. */
export function groundLux(spec: Pick<LampSpec, "height" | "candela">, d: number): number {
  const r = Math.hypot(d, spec.height);
  const c = spec.height / r;
  return (spec.candela * luminaire(c) * c) / (r * r);
}

/**
 * Light the lamps reflect towards a wet road's viewer at grazing angles leaves the luminaire well
 * above its cut-off, where `luminaire` is near zero; the housing's glare and the lens edge still
 * shine there. The streaks use at least this fraction of the nadir intensity.
 */
const GLARE_FLOOR = 0.3;
/** Scene units per lux: the scene's sun is ~3, so a 15 lx street reads as an overcast day. */
const LUX = 0.1;

/** Darkness the photocells see: the night factor, a little earlier under rain clouds. */
export function darkness(nightFactor: number, raining: boolean): number {
  return nightFactor + (raining ? 0.12 : 0);
}

/** How far on a lamp with this switch-on threshold is (ramps over a short band). */
export function lampOn(dark: number, threshold: number): number {
  return clamp((dark - threshold) / 0.04, 0, 1);
}

// Colour temperatures, white-balanced as a night photo is (~5000 K): LED 4000 K reads warm
// white, 高圧ナトリウム 2100 K orange.
const WHITE_BALANCE = 5000;
export const LED_KELVIN = 4000;
export const SODIUM_KELVIN = 2100;

/** Tanner Helland's fit of the blackbody colour (sRGB, 0–1) for 1000–40000 K. */
export function kelvinRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((v) => clamp(v / 255, 0, 1)) as [number, number, number];
}

/** Linear colour of a lamp of this temperature after the white balance. */
function lampColour(kelvin: number): Color {
  const c = kelvinRgb(kelvin);
  const w = kelvinRgb(WHITE_BALANCE);
  return new Color().setRGB(c[0] / w[0], c[1] / w[1], c[2] / w[2], SRGBColorSpace);
}

// ---------- wet surfaces ----------

/**
 * Wet-road state from `env.wetness` w (0 dry – 1 soaked) and how hollow a spot is (h: about 0–1.5,
 * value-noise sags plus the kerb gutter and the wheel ruts). The GLSL below uses the same numbers.
 * - The film (darker, glossier) covers average spots once w passes ~0.5 and is gone below ~0.3.
 * - Puddles fill the hollows as w rises and, while drying, shrink into the deepest spots (the
 *   gutter) and outlast the film: the threshold only reaches the gutter's depth near w ≈ 0.1.
 */
export const WET = {
  filmLo: 0.35,
  filmHi: 0.65,
  /** Hollower spots wet earlier and dry later (film offset per unit of h). */
  lowSpot: 0.35,
  average: 0.55,
  levelDry: 1.32,
  levelWet: 0.78,
  levelLo: 0.05,
  levelHi: 0.9,
  edge: 0.03,
  /** Damp ring round a drying puddle (h below the water line). */
  halo: 0.15,
};

export function filmWetness(w: number, h: number): number {
  if (w <= 0) return 0;
  return smoothstep(WET.filmLo, WET.filmHi, w + (h - WET.average) * WET.lowSpot);
}

/** Hollowness above which a spot holds a puddle at wetness w. */
export function puddleLevel(w: number): number {
  return WET.levelDry + (WET.levelWet - WET.levelDry) * smoothstep(WET.levelLo, WET.levelHi, w);
}

export function puddleCover(w: number, h: number): number {
  if (w <= 0) return 0;
  const level = puddleLevel(w);
  return smoothstep(level, level + WET.edge, h);
}

/** Rainfall (mm/h) → share of ripple cells with a drop: drizzle sparse, 本降り (8 mm/h) dense. */
export function rippleAmount(mmPerHour: number): number {
  if (mmPerHour <= 0) return 0;
  return clamp(0.2 + mmPerHour / 10, 0, 1);
}

// ---------- nearest-lamp selection ----------

/**
 * The `n` live lamps nearest (x, z), nearest first, into `out`; returns how many and the distance
 * of the nearest lamp left out (Infinity if none), which `edgeFade` uses so a lamp has faded to
 * nothing by the time it drops out of the set.
 */
export function nearestLamps(
  xs: Float32Array,
  zs: Float32Array,
  live: Uint8Array,
  x: number,
  z: number,
  n: number,
  out: Int32Array,
  dist: Float32Array,
): { count: number; cutoff: number } {
  let count = 0;
  let cutoff = Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (!live[i]) continue;
    const d = Math.hypot(xs[i] - x, zs[i] - z);
    const isFull = count === n;
    if (isFull && d >= dist[n - 1]) {
      cutoff = Math.min(cutoff, d);
      continue;
    }
    if (isFull) cutoff = Math.min(cutoff, dist[n - 1]);
    let k = isFull ? n - 1 : count++;
    while (k > 0 && dist[k - 1] > d) {
      dist[k] = dist[k - 1];
      out[k] = out[k - 1];
      k--;
    }
    dist[k] = d;
    out[k] = i;
  }
  return { count, cutoff };
}

/** 1 well inside the selection, 0 at the distance of the first lamp left out. */
export function edgeFade(d: number, cutoff: number): number {
  if (!Number.isFinite(cutoff)) return 1;
  return 1 - smoothstep(cutoff * 0.7, cutoff, d);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ---------- shading of the street surfaces ----------

/**
 * Lights in the shader's arrays: up to 32 lamps (画質「街灯の光」picks 0 / 8 / 16 / 32), then the
 * glints (signal heads, car lamps), fewer with fewer lamps.
 */
const MAX_LAMPS = 32;
const MAX_GLINTS = 16;
const MAX_LIGHTS = MAX_LAMPS + MAX_GLINTS;
/** Glint budget by lamp count: signal heads and cars (two glints each, head and tail lamps). */
const GLINTS: Record<string, { signals: number; cars: number }> = {
  "0": { signals: 0, cars: 0 },
  "8": { signals: 2, cars: 1 },
  "16": { signals: 4, cars: 3 },
  "32": { signals: 6, cars: 5 },
};

/**
 * Shared by every street material: three assigns uniform objects by reference, so one update per
 * frame reaches them all. stLight: xyz world position, w intensity (scene units × cd); stColor: rgb
 * linear colour; stState: x lamps, y glints (after the lamps), z wetness, w time (s); stRain: the
 * share of ripple cells with a drop.
 */
const UNIFORMS = {
  stLight: { value: new Float32Array(MAX_LIGHTS * 4) },
  stColor: { value: new Float32Array(MAX_LIGHTS * 4) },
  stState: { value: { x: 0, y: 0, z: 0, w: 0 } },
  stRain: { value: 0 },
};

export type SurfaceKind = "asphalt" | "paint" | "paving" | "concrete";

/**
 * How each surface takes the water (Lagarde 2013, "Water drop 2b"): porous asphalt and concrete
 * darken most, paint little; the film's roughness; and `drain` lowers how hollow every spot counts
 * (permeable paving and kerbs hold few puddles).
 */
const SURFACE: Record<SurfaceKind, { darken: number; wetRough: number; drain: number }> = {
  asphalt: { darken: 0.5, wetRough: 0.32, drain: 0 },
  paint: { darken: 0.8, wetRough: 0.25, drain: 0.04 },
  paving: { darken: 0.62, wetRough: 0.42, drain: 0.32 },
  concrete: { darken: 0.62, wetRough: 0.45, drain: 0.45 },
};

/** 画質「雨の路面」→ ST_WET: 0 dry always, 1 darker and glossy, 2 puddles and ripples too. */
const WET_MODE: Record<string, number> = { off: 0, simple: 1, full: 2 };
const wetMode = () => WET_MODE[GRAPHICS.settings.wetRoads] ?? 2;

const f = (n: number) => n.toFixed(4);

const VERTEX_PARS = /* glsl */ `
varying vec3 vStWorld;
#ifdef ST_STREET
attribute vec4 aStreet;
varying vec4 vStreet;
#endif
`;

const VERTEX = /* glsl */ `
vStWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#ifdef ST_STREET
vStreet = aStreet;
#endif
`;

function fragmentPars(kind: SurfaceKind): string {
  const s = SURFACE[kind];
  return /* glsl */ `
uniform vec4 stLight[ ${MAX_LIGHTS} ];
uniform vec4 stColor[ ${MAX_LIGHTS} ];
uniform vec4 stState;
uniform float stRain;
varying vec3 vStWorld;
#ifdef ST_STREET
varying vec4 vStreet;
#endif
float stFilm = 0.0;
float stPuddle = 0.0;

#if ST_WET == 2
// Hash without sine (Dave Hoskins): stable at world coordinates of a few km.
float stHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float stNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 u = fract( p );
  u = u * u * ( 3.0 - 2.0 * u );
  return mix( mix( stHash( i ), stHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( stHash( i + vec2( 0.0, 1.0 ) ), stHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}

// How hollow a spot is: sags of 0.5–5 m and of the road profile, the gutter the 1.5–2 % crossfall
// drains into, and the wheel ruts (±0.85 m from each lane centre).
float stHollow( vec2 xz ) {
  float h = stNoise( xz * 0.23 ) * 0.6 + stNoise( xz * 0.71 + 17.0 ) * 0.28 + stNoise( xz * 2.3 + 5.0 ) * 0.12;
  h += ( stNoise( xz * 0.035 + 3.0 ) - 0.5 ) * 0.25;
  #ifdef ST_STREET
  float halfWidth = vStreet.y;
  if ( halfWidth > 0.5 ) {
    h += smoothstep( halfWidth - 1.1, halfWidth - 0.15, abs( vStreet.x ) ) * 0.38;
    float laneWidth = max( vStreet.z, 1.0 );
    float fromCentre = abs( fract( ( vStreet.x - vStreet.w ) / laneWidth ) - 0.5 ) * laneWidth;
    h += ( 1.0 - smoothstep( 0.18, 0.42, abs( fromCentre - 0.85 ) ) ) * 0.2;
  }
  #endif
  return h - ${f(s.drain)};
}

// Raindrop rings in puddles: one drop per 0.38 m cell and cycle (two offset layers), the share of
// cells with a drop set by the rain; faded out where a cell gets smaller than a few pixels.
vec2 stRipples( vec2 xz, float t, float amount ) {
  vec2 q0 = xz * 2.6;
  float fw = max( fwidth( q0.x ), fwidth( q0.y ) );
  float fade = 1.0 - smoothstep( 0.2, 0.55, fw );
  vec2 g = vec2( 0.0 );
  for ( int k = 0; k < 2; k ++ ) {
    vec2 q = q0 + float( k ) * vec2( 0.53, 0.29 );
    vec2 cell = floor( q ) + float( k ) * 37.0;
    float h1 = stHash( cell );
    float h2 = stHash( cell + 11.0 );
    float h3 = stHash( cell + 23.0 );
    float age = fract( t * 0.85 + h1 );
    float isDrop = step( h2, amount );
    vec2 d = fract( q ) - 0.5 - ( vec2( h3, fract( h1 * 7.3 ) ) - 0.5 ) * 0.3;
    float r = length( d );
    float x = ( r - age * 0.42 ) * 24.0;
    float wave = sin( x * 2.4 ) * exp( - x * x * 0.35 ) * ( 1.0 - age ) * ( 1.0 - age );
    g += isDrop * wave * d / max( r, 1e-3 );
  }
  return g * fade * 0.35;
}
#endif

void stWetness( vec3 viewNormal ) {
#if ST_WET > 0
  float w = stState.z;
  if ( w <= 0.0 ) return;
  #if ST_WET == 2
  float h = stHollow( vStWorld.xz );
  stFilm = smoothstep( ${f(WET.filmLo)}, ${f(WET.filmHi)}, w + ( h - ${f(WET.average)} ) * ${f(WET.lowSpot)} );
  float level = mix( ${f(WET.levelDry)}, ${f(WET.levelWet)}, smoothstep( ${f(WET.levelLo)}, ${f(WET.levelHi)}, w ) );
  // Water stands only on up-facing surfaces: kerb faces just get wet.
  float isFlat = smoothstep( 0.85, 0.97, ( vec4( viewNormal, 0.0 ) * viewMatrix ).y );
  stPuddle = smoothstep( level, level + ${f(WET.edge)}, h ) * isFlat;
  stFilm = max( stFilm, smoothstep( level - ${f(WET.halo)}, level, h ) );
  #else
  stFilm = smoothstep( ${f(WET.filmLo)}, ${f(WET.filmHi)}, w );
  #endif
#endif
}

// Cut-off luminaire by cos γ from the nadir (luminaire() in streetLights.ts).
float stLuminaire( float c ) {
  return ( 1.0 + 2.0 * ( 1.0 - c * c ) ) * smoothstep( 0.17, 0.42, c );
}

// Specular of a point source: anisotropic GGX (see stLights) with Hammon's approximation of the
// height-correlated Smith term (no square roots) and Schlick's Fresnel.
float stLobe( vec3 L, vec3 V, vec3 N, vec3 T, vec3 B, float NoL, float NoV, float a, float aT, float aB ) {
  vec3 H = normalize( L + V );
  float ToH = dot( T, H );
  float BoH = dot( B, H );
  float NoH = dot( N, H );
  float k = ToH * ToH / ( aT * aT ) + BoH * BoH / ( aB * aB ) + NoH * NoH;
  float D = RECIPROCAL_PI / ( aT * aB * k * k );
  float Vis = 0.5 / mix( 2.0 * NoL * NoV, NoL + NoV, a );
  float VoH = saturate( dot( V, H ) );
  float fresnel = exp2( ( - 5.55473 * VoH - 6.98316 ) * VoH );
  return D * Vis * mix( 0.04, 1.0, fresnel );
}

void stLights( const in vec3 viewNormal, const in PhysicalMaterial mat, inout ReflectedLight rl ) {
  int lamps = int( stState.x );
  int glints = int( stState.y );
  if ( lamps + glints == 0 ) return;
  vec3 P = vStWorld;
  vec3 toEye = cameraPosition - P;
  // Beyond 300 m the haze has the street and the lamps' pools are a few pixels.
  if ( dot( toEye, toEye ) > 90000.0 ) return;
  vec3 N = normalize( ( vec4( viewNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 V = normalize( toEye );
  float NoV = clamp( dot( N, V ), 1e-3, 1.0 );
  // Streak frame: B along the view direction laid on the surface, T across it. A wet road's
  // microfacets spread the reflection of a light towards the viewer (long vertical streaks) and
  // keep it narrow across: anisotropic GGX, alpha_B / alpha_T growing with the water film.
  vec3 B = V - N * dot( N, V );
  float bl = length( B );
  B = bl > 1e-4 ? B / bl : normalize( cross( N, vec3( 1.0, 0.0, 0.0 ) ) );
  vec3 T = cross( N, B );
  float a = max( pow2( mat.roughness ), 2e-3 );
  float stretch = sqrt( mix( 1.0, 3.5, stFilm ) );
  float aT = a / stretch;
  float aB = a * stretch;
  vec3 albedo = BRDF_Lambert( mat.diffuseContribution );
  // Pole lamps: the pool (their distribution) and the streak (at least the glare of the housing).
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    if ( i >= lamps ) break;
    vec4 source = stLight[ i ];
    vec3 toLight = source.xyz - P;
    float d2 = max( dot( toLight, toLight ), 0.04 );
    vec3 L = toLight * inversesqrt( d2 );
    float NoL = dot( N, L );
    if ( NoL <= 0.0 ) continue;
    float shape = stLuminaire( L.y );
    vec3 E = stColor[ i ].rgb * ( source.w * NoL / d2 );
    float glare = max( shape, ${f(GLARE_FLOOR)} );
    rl.directDiffuse += E * shape * albedo;
    rl.directSpecular += E * ( glare * stLobe( L, V, N, T, B, NoL, NoV, a, aT, aB ) );
  }
  // Glints (signal heads, car lamps): only their reflection, so only on the carriageway (asphalt,
  // paint) and only once it is wet or glossy: on dry asphalt the lobe spreads them to nothing.
  #ifdef ST_GLINTS
  if ( stFilm < 0.02 && mat.roughness > 0.55 ) return;
  for ( int j = 0; j < ${MAX_GLINTS}; j ++ ) {
    if ( j >= glints ) break;
    vec4 source = stLight[ lamps + j ];
    vec3 toLight = source.xyz - P;
    float d2 = max( dot( toLight, toLight ), 0.04 );
    vec3 L = toLight * inversesqrt( d2 );
    float NoL = dot( N, L );
    if ( NoL <= 0.0 ) continue;
    vec3 E = stColor[ lamps + j ].rgb * ( source.w * NoL / d2 );
    rl.directSpecular += E * stLobe( L, V, N, T, B, NoL, NoV, a, aT, aB );
  }
  #endif
}
`;
}

function fragmentWet(kind: SurfaceKind): string {
  return /* glsl */ `
stWetness( normalize( vNormal ) );
diffuseColor.rgb *= mix( 1.0, ${f(SURFACE[kind].darken)}, stFilm ) * mix( 1.0, 0.8, stPuddle );
`;
}

function fragmentRoughness(kind: SurfaceKind): string {
  return /* glsl */ `
roughnessFactor = mix( roughnessFactor, min( roughnessFactor, ${f(SURFACE[kind].wetRough)} ), stFilm );
roughnessFactor = mix( roughnessFactor, 0.02, stPuddle );
`;
}

// Water fills the texture: the puddle is flat (and the film half fills it), then the rings.
const FRAGMENT_NORMAL = /* glsl */ `
normal = normalize( mix( normal, nonPerturbedNormal, max( stPuddle, stFilm * 0.5 ) ) );
#if ST_WET == 2
if ( stRain > 0.0 ) {
  vec2 ripple = stRipples( vStWorld.xz, stState.w, stRain ) * stPuddle;
  normal = normalize( normal - ( viewMatrix * vec4( ripple.x, 0.0, ripple.y, 0.0 ) ).xyz );
}
#endif
`;

const FRAGMENT_LIGHTS = /* glsl */ `
stLights( normal, material, reflectedLight );
`;

/** Every material given the street shading, to recompile when 雨の路面 changes. */
const shaded = new Set<MeshStandardMaterial>();
let shadedMode = wetMode();
GRAPHICS.onChange(() => {
  const mode = wetMode();
  if (mode === shadedMode) return;
  shadedMode = mode;
  for (const m of shaded) {
    m.defines = { ...m.defines, ST_WET: mode };
    m.needsUpdate = true;
  }
});

/**
 * Give a street material the wet shading and the lamp light. `hasStreet`: its geometry carries
 * `aStreet` (lateral offset from the centreline, half width, lane width, lane origin), which puts
 * puddles in the gutter and the wheel ruts. Chains any onBeforeCompile already set.
 */
// WEBGPU-TODO(phase C): the wet street and the lamp pools in TSL (node materials ignore
// onBeforeCompile, defines and customProgramCacheKey): wetness from env.wetness, the puddles from
// `aStreet`, the streaks and the pools from UNIFORMS (StreetLights.update), 画質 雨の路面 / 街灯の光.
// Until then roads, pavements and walls are dry and unlit by the lamps (the lamp heads still glow).
export function streetShading(material: MeshStandardMaterial, kind: SurfaceKind, hasStreet = false): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const defines: Record<string, unknown> = { ...material.defines, ST_WET: shadedMode };
  if (hasStreet) defines.ST_STREET = "";
  const isCarriageway = kind === "asphalt" || kind === "paint";
  if (isCarriageway) defines.ST_GLINTS = "";
  material.defines = defines;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${fragmentPars(kind)}\nvoid main() {`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${fragmentWet(kind)}`)
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n${fragmentRoughness(kind)}`,
      )
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${FRAGMENT_LIGHTS}`);
  };
  // The program cache keys on this (and the defines), not on the patched source.
  material.customProgramCacheKey = () => `street:${kind}:${hasStreet}:${previousKey}`;
  material.needsUpdate = true;
  shaded.add(material);
}

// ---------- lamp models ----------

/** Lamp model at H = 10 m, pole foot at the origin, the arm along +Z; scaled by H / 10. */
const MODEL_HEIGHT = 10;
const MODEL_REACH = 1.8;
const ARM_RISE = 0.35;
const LENS_DROP = 0.07; // lens centre below the arm's end

function lampGeometries(): { metal: BufferGeometry; lens: BufferGeometry } {
  const pole = new CylinderGeometry(0.075, 0.11, MODEL_HEIGHT - 0.3, 8);
  pole.translate(0, (MODEL_HEIGHT - 0.3) / 2, 0);
  const foot = new CylinderGeometry(0.16, 0.18, 0.45, 8);
  foot.translate(0, 0.225, 0);
  // The arm rises a little from the pole top to the luminaire, as on Japanese テーパーポール.
  const from = new Vector3(0, MODEL_HEIGHT - 0.3 - ARM_RISE, 0);
  const to = new Vector3(0, MODEL_HEIGHT, MODEL_REACH);
  const span = to.clone().sub(from);
  const arm = new CylinderGeometry(0.05, 0.06, span.length(), 6);
  arm.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), span.clone().normalize()));
  arm.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  const housing = new BoxGeometry(0.34, 0.1, 0.78);
  housing.translate(0, MODEL_HEIGHT + 0.02, MODEL_REACH + 0.2);
  const merged = mergeGeometries([pole, foot, arm, housing]);
  // The LED panel: the whole underside of the housing, deep enough to read from the side.
  const lens = new BoxGeometry(0.32, 0.04, 0.72);
  lens.translate(0, MODEL_HEIGHT - LENS_DROP + 0.025, MODEL_REACH + 0.2);
  for (const g of [pole, foot, arm, housing]) g.dispose();
  if (!merged) throw new Error("street lamp geometry did not merge");
  return { metal: merged, lens };
}

// ---------- the lights in the world ----------

type EnvLike = {
  wetness: number;
  nightFactor: number;
  weather: string;
  isRaining(): boolean;
  getObservation(): { precip10m: number | null } | null;
};

export type StreetLightDeps = {
  /** The current road graph (a new object after each rebuild). */
  graph: () => RoadGraph | null;
  /** Height of the walking surface at (x, z): the paving where PLATEAU has a pavement. */
  groundAt: (x: number, z: number) => number | null;
  /** False where a building stands over (x, z) (GSI 幅員 wider than the street). */
  isOpen: (x: number, z: number, groundY: number) => boolean;
  control: { approaches: Approach[]; state(ap: Approach): LightState };
  traffic: { forEachCar(visit: (object: Object3D, speed: number, kind: string | null) => void): void };
  /** The player's car: its tail lamps glint behind it while its lights are on. */
  player: { object: Object3D; headlights: Array<{ intensity: number }> };
};

const SIGNAL_HEIGHT = 5.2; // trafficControl's head height above the ground
const SIGNAL_CANDELA = 400;
const HEAD_CANDELA = 3000; // a pair of low beams, towards the road ahead
const TAIL_CANDELA = 40;
const LENS_GLOW = 10; // lens radiance (× colour) when on: well above 1 for the bloom
const SIGNAL_COLOURS: Record<LightState, Color> = {
  green: new Color(0x19e6b4),
  yellow: new Color(0xffc21a),
  red: new Color(0xff2a1a),
};
const HEAD_COLOUR = new Color(0xfff2d6);
const TAIL_COLOUR = new Color(0xff1a0d);
const HALF_LENGTH: Record<string, number> = { bus: 5.5, truck10t: 5.2, truck8t: 4.2, motorbike: 1 };

type Lamp = LampSite & { ground: number | null; hidden: boolean; collider: RAPIER.Collider | null };
type Head = { x: number; y: number; z: number; faceX: number; faceZ: number; approach: Approach };

/**
 * 道路照明 along the road graph: instanced poles and luminaires (two draw calls), solid poles, and
 * each frame the nearest lamps, signal heads and car lamps written into the street shading.
 */
export class StreetLights {
  /** Debug switch (window.__game.streetLights.enabled) for A/B frame timing. */
  enabled = true;
  /** Debug override of 街灯の光 (lamps in the shaders) for frame-time checks; null = the setting. */
  limit: number | null = null;
  private graph: RoadGraph | null = null;
  private lamps: Lamp[] = [];
  private xs = new Float32Array(0);
  private zs = new Float32Array(0);
  private live = new Uint8Array(0);
  private heads: Head[] = [];
  private metal: InstancedMesh | null = null;
  private lens: InstancedMesh | null = null;
  private body: RAPIER.RigidBody | null = null;
  private readonly metalMaterial = new MeshStandardMaterial({
    color: 0x8e9398,
    metalness: 0.5,
    roughness: 0.5,
  });
  private readonly lensMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly geometry = lampGeometries();
  private readonly led = lampColour(LED_KELVIN);
  private readonly sodium = lampColour(SODIUM_KELVIN);
  private lastSettle = -Infinity;
  private lastDark = -1;
  private time = 0;
  private rain = 0;
  private readonly picked = new Int32Array(MAX_LAMPS);
  private readonly pickedDist = new Float32Array(MAX_LAMPS);
  private readonly tmp = new Object3D();
  private readonly forward = new Vector3();
  private readonly colour = new Color();

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly deps: StreetLightDeps,
  ) {}

  get count(): number {
    return this.lamps.length;
  }

  update(dt: number, camera: Camera, env: EnvLike, now: number): void {
    const graph = this.deps.graph();
    if (graph !== this.graph) this.rebuild(graph);
    if (now - this.lastSettle > 2000) {
      this.lastSettle = now;
      this.settle(camera.position);
    }
    const raining = env.isRaining();
    const dark = darkness(env.nightFactor, raining);
    if (Math.abs(dark - this.lastDark) > 0.004) {
      this.lastDark = dark;
      this.paintLenses(dark, env.nightFactor);
    }
    this.time = (this.time + dt) % 1000;
    // Rings start and stop with the rain over about a second.
    const mm = raining
      ? Math.max(env.weather === "rain" ? 8 : 0, (env.getObservation()?.precip10m ?? 0) * 6)
      : 0;
    this.rain += (rippleAmount(mm) - this.rain) * Math.min(1, dt * 1.5);
    const isWet = this.enabled && wetMode() > 0;
    const state = UNIFORMS.stState.value;
    state.z = isWet ? env.wetness : 0;
    state.w = this.time;
    UNIFORMS.stRain.value = isWet && this.rain > 0.01 ? this.rain : 0;
    const setting = GRAPHICS.settings.streetLights;
    const lamps = this.limit ?? Number(setting);
    const glints = GLINTS[String(this.limit ?? setting)] ?? GLINTS["32"];
    const [lit, glinting] = this.enabled ? this.fillLights(camera, dark, env, lamps, glints) : [0, 0];
    state.x = lit;
    state.y = glinting;
    if (this.metal) this.metal.visible = this.enabled;
    if (this.lens) this.lens.visible = this.enabled;
  }

  private rebuild(graph: RoadGraph | null): void {
    this.clear();
    this.graph = graph;
    if (!graph) return;
    const t0 = performance.now();
    const sites = placeLamps(graph);
    this.lamps = sites.map((s) => ({
      ...s,
      ground: this.deps.groundAt(s.x, s.z),
      hidden: false,
      collider: null,
    }));
    const n = this.lamps.length;
    this.xs = new Float32Array(n);
    this.zs = new Float32Array(n);
    this.live = new Uint8Array(n);
    this.metal = new InstancedMesh(this.geometry.metal, this.metalMaterial, Math.max(1, n));
    this.lens = new InstancedMesh(this.geometry.lens, this.lensMaterial, Math.max(1, n));
    this.metal.count = this.lens.count = n;
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.lamps.forEach((lamp, i) => {
      this.place(lamp, i);
      this.lens?.setColorAt(i, this.colour.setScalar(0.2));
    });
    for (const m of [this.metal, this.lens]) {
      m.frustumCulled = false; // instances span the whole area
      this.scene.add(m);
    }
    this.metal.castShadow = true;
    this.heads = this.signalHeads(graph);
    this.lastDark = -1;
    log("street_lights", {
      lamps: n,
      sodium: this.lamps.filter((l) => l.sodium).length,
      byClass: Object.fromEntries(
        ["arterial", "main", "street", "residential", "lane"].map((c) => [
          c,
          this.lamps.filter((l) => l.spec.name === c).length,
        ]),
      ),
      signals: this.heads.length,
      ms: Math.round(performance.now() - t0),
    });
  }

  private clear(): void {
    for (const m of [this.metal, this.lens]) if (m) this.scene.remove(m);
    this.metal?.dispose();
    this.lens?.dispose();
    this.metal = this.lens = null;
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
    this.lamps = [];
    this.heads = [];
  }

  /** Pole, luminaire, collider and light position of lamp i at its current ground height. */
  private place(lamp: Lamp, i: number): void {
    const scale = lamp.spec.height / MODEL_HEIGHT;
    const g = lamp.ground ?? 0;
    const o = this.tmp;
    o.position.set(lamp.x, g, lamp.z);
    o.rotation.set(0, Math.atan2(lamp.ax, lamp.az), 0);
    o.scale.setScalar(lamp.hidden ? 0 : scale);
    o.updateMatrix();
    this.metal?.setMatrixAt(i, o.matrix);
    this.lens?.setMatrixAt(i, o.matrix);
    if (this.metal) this.metal.instanceMatrix.needsUpdate = true;
    if (this.lens) this.lens.instanceMatrix.needsUpdate = true;
    // The light source: the lens under the end of the arm.
    const out = (MODEL_REACH + 0.2) * scale;
    this.xs[i] = lamp.x + lamp.ax * out;
    this.zs[i] = lamp.z + lamp.az * out;
    this.live[i] = lamp.hidden || lamp.ground === null ? 0 : 1;
    if (lamp.collider) this.world.removeCollider(lamp.collider, false);
    lamp.collider = null;
    if (lamp.hidden || !this.body) return;
    const h = lamp.spec.height - 0.3 * scale;
    lamp.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, 0.11 * scale)
        .setTranslation(lamp.x, g + h / 2, lamp.z)
        .setCollisionGroups(PROP_GROUPS),
      this.body,
    );
  }

  /**
   * The ground and the paving stream in after the graph: re-seat lamps near the camera on it, and
   * hide those that turn out to stand inside a building.
   */
  private settle(focus: Vector3): void {
    this.lamps.forEach((lamp, i) => {
      if (lamp.hidden || Math.hypot(lamp.x - focus.x, lamp.z - focus.z) > 350) return;
      const g = this.deps.groundAt(lamp.x, lamp.z);
      if (g === null) return;
      const isInside =
        Math.hypot(lamp.x - focus.x, lamp.z - focus.z) < 220 && !this.deps.isOpen(lamp.x, lamp.z, g);
      const hasMoved = lamp.ground === null || Math.abs(g - lamp.ground) > 0.05;
      if (!isInside && !hasMoved) return;
      lamp.ground = g;
      lamp.hidden = isInside;
      this.place(lamp, i);
    });
  }

  /** Lens colours: off (a grey lens by day), or lit once each lamp's photocell says so. */
  private paintLenses(dark: number, night: number): void {
    const lens = this.lens;
    if (!lens) return;
    const off = 0.03 + 0.25 * (1 - night);
    this.lamps.forEach((lamp, i) => {
      const on = lampOn(dark, lamp.threshold);
      const base = lamp.sodium ? this.sodium : this.led;
      const lit = LENS_GLOW * on;
      const unlit = off * (1 - on);
      this.colour.setRGB(base.r * lit + unlit, base.g * lit + unlit, base.b * lit + unlit);
      lens.setColorAt(i, this.colour);
    });
    if (lens.instanceColor) lens.instanceColor.needsUpdate = true;
  }

  /** Signal heads as trafficControl hangs them: beyond the junction, over the approach's lane. */
  private signalHeads(graph: RoadGraph): Head[] {
    const heads: Head[] = [];
    for (const ap of this.deps.control.approaches) {
      if (ap.kind !== "signal") continue;
      const node = ap.dir === 1 ? ap.seg.to : ap.seg.from;
      const ids = graph.nodes.get(node) ?? [];
      const first = ids[0] === undefined ? null : graph.segments[ids[0]];
      if (!first) continue;
      const nodePos = first.from === node ? first.pts[0] : first.pts[first.pts.length - 1];
      const widths = ids.filter((id) => id !== ap.seg.id).map((id) => graph.segments[id].line.width);
      const far = (widths.length ? Math.max(...widths) : ap.seg.line.width) / 2 + 2.5;
      const at = nodePos
        .clone()
        .addScaledVector(ap.travel, far)
        .add(leftOf(ap.travel, (ap.seg.line.width / 2) * 0.35));
      const g = this.deps.groundAt(at.x, at.z) ?? 0;
      heads.push({
        x: at.x,
        y: g + SIGNAL_HEIGHT,
        z: at.z,
        faceX: -ap.travel.x,
        faceZ: -ap.travel.z,
        approach: ap,
      });
    }
    return heads;
  }

  /** Writes this frame's lamps, then glints, into the shared uniforms; returns how many of each. */
  private fillLights(
    camera: Camera,
    dark: number,
    env: EnvLike,
    maxLamps: number,
    budget: { signals: number; cars: number },
  ): [number, number] {
    const light = UNIFORMS.stLight.value;
    const tint = UNIFORMS.stColor.value;
    let n = 0;
    const push = (x: number, y: number, z: number, intensity: number, c: Color) => {
      if (intensity <= 1e-4 || n >= MAX_LIGHTS) return;
      const k = n * 4;
      light[k] = x;
      light[k + 1] = y;
      light[k + 2] = z;
      light[k + 3] = intensity;
      tint[k] = c.r;
      tint[k + 1] = c.g;
      tint[k + 2] = c.b;
      n++;
    };
    camera.getWorldDirection(this.forward);
    const eye = camera.position;
    // Rank lamps round a point ahead of the camera: those in view matter most.
    const fx = eye.x + this.forward.x * 25;
    const fz = eye.z + this.forward.z * 25;
    const wanted = Math.min(MAX_LAMPS, maxLamps);
    const isLit = dark > 0.18 && wanted > 0;
    if (isLit) {
      const picked = this.picked.subarray(0, wanted);
      const dist = this.pickedDist.subarray(0, wanted);
      const { count, cutoff } = nearestLamps(this.xs, this.zs, this.live, fx, fz, wanted, picked, dist);
      for (let k = 0; k < count; k++) {
        const i = picked[k];
        const lamp = this.lamps[i];
        const on = lampOn(dark, lamp.threshold) * edgeFade(dist[k], cutoff);
        const y = (lamp.ground ?? 0) + lamp.spec.height - LENS_DROP * (lamp.spec.height / MODEL_HEIGHT);
        push(this.xs[i], y, this.zs[i], lamp.spec.candela * LUX * on, lamp.sodium ? this.sodium : this.led);
      }
    }
    const lamps = n;
    // Glints show at night, and faintly on a wet road by day (dry asphalt by day: nothing to see).
    const glint = Math.max(env.nightFactor, 0.3 * env.wetness);
    const hasGlints = glint > 0.02 && budget.signals + budget.cars > 0;
    if (!hasGlints) return [lamps, 0];
    const facing = (x: number, z: number, faceX: number, faceZ: number) => {
      const dx = eye.x - x;
      const dz = eye.z - z;
      const d = Math.hypot(dx, dz) || 1;
      return smoothstep(-0.2, 0.5, (dx * faceX + dz * faceZ) / d);
    };
    // Signal heads: the lit lamp of the nearest heads facing the camera.
    const heads = this.heads
      .map((h) => ({ h, d: Math.hypot(h.x - eye.x, h.z - eye.z) }))
      .filter((e) => e.d < 220)
      .toSorted((a, b) => a.d - b.d)
      .slice(0, budget.signals);
    for (const { h, d } of heads) {
      const w = facing(h.x, h.z, h.faceX, h.faceZ) * (1 - smoothstep(150, 220, d));
      push(
        h.x,
        h.y,
        h.z,
        SIGNAL_CANDELA * LUX * glint * w,
        SIGNAL_COLOURS[this.deps.control.state(h.approach)],
      );
    }
    // Car lamps: the nearest cars (traffic and the player's, when its lights are on).
    const cars: Array<{ o: Object3D; half: number; d: number; isHeadOn: boolean }> = [];
    const isPlayerLit = this.deps.player.headlights.some((l) => l.intensity > 0);
    const isNight = env.nightFactor > 0.3;
    this.deps.traffic.forEachCar((o, _speed, kind) => {
      const d = Math.hypot(o.position.x - eye.x, o.position.z - eye.z);
      if (d < 160) cars.push({ o, half: HALF_LENGTH[kind ?? ""] ?? 2.2, d, isHeadOn: isNight });
    });
    if (isPlayerLit) {
      const o = this.deps.player.object;
      cars.push({ o, half: 2.2, d: Math.hypot(o.position.x - eye.x, o.position.z - eye.z), isHeadOn: false });
    }
    cars.sort((a, b) => a.d - b.d);
    const fwd = this.forward;
    for (const { o, half, d, isHeadOn } of cars.slice(0, budget.cars)) {
      fwd.set(0, 0, 1).applyQuaternion(o.quaternion).setY(0).normalize();
      const fade = 1 - smoothstep(110, 160, d);
      const p = o.position;
      if (isHeadOn) {
        const x = p.x + fwd.x * half;
        const z = p.z + fwd.z * half;
        push(x, p.y + 0.1, z, HEAD_CANDELA * LUX * glint * fade * facing(x, z, fwd.x, fwd.z), HEAD_COLOUR);
      }
      const x = p.x - fwd.x * half;
      const z = p.z - fwd.z * half;
      push(x, p.y + 0.2, z, TAIL_CANDELA * LUX * glint * fade * facing(x, z, -fwd.x, -fwd.z), TAIL_COLOUR);
    }
    return [lamps, n - lamps];
  }
}
