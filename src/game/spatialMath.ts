/**
 * The arithmetic behind the spatial audio layer (game/spatialAudio.ts): Doppler, velocity
 * tracking, whether the listener sits in the car's cabin, which sources get one of the few
 * voices, and the samples of the generated sounds. No WebAudio here, so vitest can run it.
 */

export const SPEED_OF_SOUND = 343; // m/s in air at about 20 °C

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

// Beyond these the pitch would sound broken rather than fast: two cars closing at 100 km/h
// each come to about 1.18.
export const DOPPLER_MIN = 0.75;
export const DOPPLER_MAX = 1.33;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * f′/f = (c + v_l) / (c − v_s), with v_s the source's speed toward the listener and v_l the
 * listener's toward the source, both along the line between them.
 */
export function dopplerFactor(src: Vec3, srcVel: Vec3, lis: Vec3, lisVel: Vec3, c = SPEED_OF_SOUND): number {
  const dx = lis.x - src.x;
  const dy = lis.y - src.y;
  const dz = lis.z - src.z;
  const d = Math.hypot(dx, dy, dz);
  // Right on top of each other the direction is undefined (and flips every frame).
  const isOnTop = d < 0.5;
  if (isOnTop) return 1;
  const towardListener = (srcVel.x * dx + srcVel.y * dy + srcVel.z * dz) / d;
  const towardSource = -(lisVel.x * dx + lisVel.y * dy + lisVel.z * dz) / d;
  // A source near the speed of sound would divide by ~0; the clamp below catches the rest.
  return clamp((c + towardSource) / Math.max(c * 0.25, c - towardListener), DOPPLER_MIN, DOPPLER_MAX);
}

/** The pitch ratio as an AudioParam detune (cents). */
export function dopplerCents(factor: number): number {
  return 1200 * Math.log2(factor);
}

/** A point followed from frame to frame: where it is and how fast it moves (smoothed). */
export type Motion = { p: Vec3; v: Vec3; primed: boolean };

export function newMotion(): Motion {
  return { p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, primed: false };
}

/**
 * Velocity from successive positions, eased with time constant `tau` so frame jitter does not
 * wobble the pitch. A step faster than `maxSpeed` (re-anchoring the world, a teleport, a camera
 * cut) moves the point but leaves the velocity as it was.
 */
export function track(m: Motion, p: Vec3, dt: number, tau = 0.12, maxSpeed = 90): void {
  const isFirst = !m.primed || dt <= 0;
  const ix = isFirst ? 0 : (p.x - m.p.x) / dt;
  const iy = isFirst ? 0 : (p.y - m.p.y) / dt;
  const iz = isFirst ? 0 : (p.z - m.p.z) / dt;
  m.p.x = p.x;
  m.p.y = p.y;
  m.p.z = p.z;
  m.primed = true;
  const isJump = Math.hypot(ix, iy, iz) > maxSpeed;
  if (isFirst || isJump) return;
  const k = 1 - Math.exp(-dt / tau);
  m.v.x += (ix - m.v.x) * k;
  m.v.y += (iy - m.v.y) * k;
  m.v.z += (iz - m.v.z) * k;
}

/**
 * The cabin of the player's car in its own frame (origin at chassis height, +Z forward): from
 * the floor to the roof (outer skin 0.60 m up) and from the windscreen's foot back to the
 * parcel shelf. DriverEye is at (−0.37, 0.351, −0.073) (knowledge/cockpit-blender.md).
 */
export const CABIN = { halfWidth: 0.78, bottom: -0.45, top: 0.6, front: 0.95, rear: -1.35 };

/** Whether a world point lies inside the cabin of a car posed at `carPos` / `carRot`. */
export function isInCabin(p: Vec3, carPos: Vec3, carRot: Quat, box = CABIN): boolean {
  // Rotate (p − carPos) by the inverse rotation (the conjugate): v + w·t + q×t, t = 2·q×v.
  const vx = p.x - carPos.x;
  const vy = p.y - carPos.y;
  const vz = p.z - carPos.z;
  const qx = -carRot.x;
  const qy = -carRot.y;
  const qz = -carRot.z;
  const w = carRot.w;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const x = vx + w * tx + (qy * tz - qz * ty);
  const y = vy + w * ty + (qz * tx - qx * tz);
  const z = vz + w * tz + (qx * ty - qy * tx);
  return Math.abs(x) <= box.halfWidth && y >= box.bottom && y <= box.top && z >= box.rear && z <= box.front;
}

/**
 * Outside sounds come through the closed car when the player is in it and the ears are inside:
 * the driver's-seat view, or any camera that ended up within the body.
 */
export function hearsFromCabin(o: { inCar: boolean; cockpit: boolean; cameraInCabin: boolean }): boolean {
  if (!o.inCar) return false;
  return o.cockpit || o.cameraInCabin;
}

/** What the body does to outside sound: a low-pass, less loss in the bass, and the overall loss. */
export type CabinAcoustics = { cutoff: number; lowShelfDb: number; insulationDb: number };

/**
 * Closed: a 800 Hz low-pass and −17 dB, with 6 dB of the bass given back below ~220 Hz, since a
 * body stops low rumble far less than voices and sirens (values set by ear, not measured). With
 * the driver's window down (talking to someone outside) most of that goes.
 */
export function cabinAcoustics(windowOpen: boolean): CabinAcoustics {
  return windowOpen
    ? { cutoff: 5000, lowShelfDb: 0, insulationDb: -5 }
    : { cutoff: 800, lowShelfDb: 6, insulationDb: -17 };
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Air takes the treble off distant sounds: a gentle low-pass cutoff (Hz) for a distance (m). */
export function airCutoff(distance: number): number {
  return clamp(20000 / (1 + Math.max(0, distance) / 60), 1500, 20000);
}

/** The gain a PannerNode's inverse model applies at `distance` (for estimates outside WebAudio). */
export function inverseGain(distance: number, ref: number, rolloff: number): number {
  return ref / (ref + rolloff * (Math.max(distance, ref) - ref));
}

/** One sound that wants a voice; `pool` says which kind of voice it needs. */
export type Candidate = {
  pool: number;
  distance: number;
  /** Loudness at 1 m, relative (only the order matters). */
  level: number;
  /** Not heard at all beyond this (m). */
  range: number;
  /** It is playing now: kept unless something clearly louder comes. */
  held: boolean;
  score: number;
  chosen: boolean;
};

// A playing source keeps its voice until a newcomer arrives 30 % louder, so two near-equal cars
// do not swap voices back and forth.
export const HOLD_BONUS = 1.3;

/**
 * Pick which ambient sources get a voice: drop those beyond their range, rank the rest by how
 * loud they arrive (level over distance, the inverse law), and take them in that order while
 * their pool has room and the total stays within `budget`. Sorts `cands[0..count)` loudest
 * first in place, sets `chosen`, and returns how many were chosen. `used` is scratch space (one
 * slot per pool) so nothing is allocated.
 */
export function rankAudible(
  cands: Candidate[],
  count: number,
  budget: number,
  poolSizes: readonly number[],
  used: number[],
): number {
  for (let i = 0; i < count; i++) {
    const c = cands[i];
    const isOutOfRange = c.distance > c.range;
    c.score = isOutOfRange ? -1 : (c.level / Math.max(1, c.distance)) * (c.held ? HOLD_BONUS : 1);
    c.chosen = false;
  }
  // Insertion sort: a few dozen candidates ten times a second, and no comparator allocations.
  for (let i = 1; i < count; i++) {
    const c = cands[i];
    let j = i - 1;
    while (j >= 0 && cands[j].score < c.score) {
      cands[j + 1] = cands[j];
      j--;
    }
    cands[j + 1] = c;
  }
  for (let p = 0; p < poolSizes.length; p++) used[p] = 0;
  let taken = 0;
  for (let i = 0; i < count && taken < budget; i++) {
    const c = cands[i];
    if (c.score < 0) break;
    const hasRoom = used[c.pool] < poolSizes[c.pool];
    if (!hasRoom) continue;
    used[c.pool]++;
    c.chosen = true;
    taken++;
  }
  return taken;
}

/** How the traffic hum is voiced: an ordinary car, a bus or lorry, or a motorbike. */
export type HumClass = "car" | "heavy" | "bike";

export function humClass(kind: string | null): HumClass {
  if (kind === "bus" || kind === "truck10t" || kind === "truck8t") return "heavy";
  if (kind === "motorbike" || kind === "shirobai") return "bike";
  return "car";
}

export type HumVoice = {
  /** Loudness relative to a car (ranking and gain). */
  level: number;
  range: number;
  /** Engine firing frequency (Hz) at a speed (m/s). */
  engineHz: (speed: number) => number;
  /** Engine low-pass (Hz): diesels are duller, bikes buzz. */
  cutoff: number;
  wave: OscillatorType;
  /** Centre of the tyre roar (Hz). */
  tyreHz: number;
};

// Buses and lorries: a low diesel note, louder and heard further; bikes: a higher, buzzier one.
export const HUM: Record<HumClass, HumVoice> = {
  car: { level: 1, range: 90, engineHz: (v) => 32 + v * 2.2, cutoff: 420, wave: "sawtooth", tyreHz: 700 },
  heavy: { level: 2.2, range: 150, engineHz: (v) => 24 + v * 1.1, cutoff: 300, wave: "square", tyreHz: 450 },
  bike: {
    level: 1.3,
    range: 120,
    engineHz: (v) => 70 + v * 5.5,
    cutoff: 1600,
    wave: "sawtooth",
    tyreHz: 900,
  },
};

/** Tyre roar rises with speed: 0 at a standstill, 1 near 60 km/h, a little more above. */
export function tyreLevel(speed: number): number {
  return Math.min(1.6, (Math.abs(speed) / 16.7) ** 1.5);
}

/**
 * Firing frequency (Hz) of the player's engine: rises through each gear's band and drops at the
 * change (every 45 km/h), over a climb with speed. The formula the old engine drone used.
 */
export function engineHz(kmh: number): number {
  const v = Math.abs(kmh);
  const rpm = 0.25 + (v % 45) / 45 + Math.min(v, 160) / 220;
  return 38 + rpm * 70;
}

// ---------- 視覚障害者用付加装置（音響式信号機）----------

/** 「ピヨ」 for walking north–south across the road, 「カッコー」 for east–west. */
export type Bird = "piyo" | "kakko";

/** The walking direction across the crosswalk decides the bird (+X east, −Z north). */
export function birdFor(across: { x: number; z: number }): Bird {
  return Math.abs(across.z) >= Math.abs(across.x) ? "piyo" : "kakko";
}

/** One call and its answer from the far end (鳴き交わし), seconds. */
export const CALL_CYCLE = 1.5;

/**
 * The next time at or after `now` when the speaker at this end calls: one end on the cycle,
 * the far end (side −1) half a cycle later, so a walker hears the call move across.
 */
export function nextCallAt(now: number, side: 1 | -1): number {
  const base = side === 1 ? 0 : CALL_CYCLE / 2;
  return base + Math.ceil((now - base) / CALL_CYCLE) * CALL_CYCLE;
}

/** Deterministic PRNG (mulberry32): the generated sounds are the same every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Glide = { at: number; dur: number; from: number; to: number; amp: number };

/** Sine glides with soft edges, summed (a fundamental plus a little second harmonic). */
function glides(parts: Glide[], sampleRate: number, harmonic: number): Float32Array {
  const end = Math.max(...parts.map((g) => g.at + g.dur));
  const out = new Float32Array(Math.ceil((end + 0.01) * sampleRate));
  for (const g of parts) {
    const n = Math.floor(g.dur * sampleRate);
    const start = Math.floor(g.at * sampleRate);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      phase += (2 * Math.PI * (g.from + (g.to - g.from) * t)) / sampleRate;
      // Raised-cosine attack and release over the first and last 15 %.
      const edge = Math.min(1, t / 0.15, (1 - t) / 0.15);
      const env = 0.5 - 0.5 * Math.cos(Math.PI * edge);
      out[start + i] += g.amp * env * (Math.sin(phase) + harmonic * Math.sin(2 * phase));
    }
  }
  return out;
}

const piyo = (at: number): Glide[] => [
  { at, dur: 0.03, from: 2700, to: 3300, amp: 0.8 },
  { at: at + 0.03, dur: 0.08, from: 3300, to: 2200, amp: 0.8 },
];
const ka = (at: number, dur: number): Glide => ({ at, dur, from: 840, to: 820, amp: 0.8 });

/**
 * The calls as samples. 「ピヨ」: a chick's chirp, a quick rise then a longer fall around
 * 2–3 kHz; the answering end chirps twice (ピヨピヨ). 「カッコー」: a cuckoo's falling third,
 * about 830 → 660 Hz; the answering end stutters the first note (カカッコー).
 */
export function birdCall(bird: Bird, answer: boolean, sampleRate: number): Float32Array {
  if (bird === "piyo") return glides(answer ? [...piyo(0), ...piyo(0.16)] : piyo(0), sampleRate, 0.15);
  const ko: Glide = { at: answer ? 0.25 : 0.14, dur: 0.3, from: 670, to: 640, amp: 0.8 };
  return glides(answer ? [ka(0, 0.06), ka(0.09, 0.1), ko] : [ka(0, 0.1), ko], sampleRate, 0.3);
}

/** White noise in [−1, 1]. */
export function whiteNoise(length: number, seed = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = r() * 2 - 1;
  return out;
}

/**
 * Rain on the roof and the windscreen, heard from inside: separate drops, each a click of
 * noise a few milliseconds long, and some with a dull thump of the roof panel (180–320 Hz).
 * About 140 drops a second; the loop is long enough not to be heard repeating.
 */
export function rainPatter(sampleRate: number, seconds: number, seed = 11): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  const drops = Math.floor(140 * seconds);
  for (let k = 0; k < drops; k++) {
    const start = Math.floor(r() * out.length);
    const amp = 0.15 + r() ** 2 * 0.85;
    const tau = (0.0008 + r() * 0.0025) * sampleRate;
    const isThump = r() < 0.25;
    const thumpHz = 180 + r() * 140;
    const len = Math.min(out.length - start, Math.floor(tau * (isThump ? 12 : 6)));
    for (let i = 0; i < len; i++) {
      const click = (r() * 2 - 1) * Math.exp(-i / tau);
      const thump = isThump
        ? 0.6 * Math.sin((2 * Math.PI * thumpHz * i) / sampleRate) * Math.exp(-i / (tau * 4))
        : 0;
      out[start + i] += amp * (click + thump);
    }
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

/**
 * Impulse response of a car cabin (stereo): a handful of early reflections in the first 6 ms
 * (glass and roof are 0.4–1 m from the ears) and a short, heavily damped tail (seats and
 * headliner absorb): about 60 ms to −60 dB.
 */
export function cabinImpulse(sampleRate: number, seed = 7): [Float32Array, Float32Array] {
  const r = rng(seed);
  const length = Math.floor(sampleRate * 0.08);
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const reflections = [1.2, 1.9, 2.6, 3.4, 4.3, 5.4]; // ms
  for (const [c, ch] of channels.entries()) {
    ch[0] = 1;
    reflections.forEach((ms, i) => {
      const at = Math.floor(((ms + c * 0.17) / 1000) * sampleRate);
      ch[at] += (i % 2 ? -1 : 1) * 0.55 * 0.82 ** i;
    });
    const tau = 0.0087 * sampleRate; // e^(−t/τ) reaches −60 dB at 6.9 τ ≈ 60 ms
    for (let i = Math.floor(0.002 * sampleRate); i < length; i++)
      ch[i] += (r() * 2 - 1) * 0.35 * Math.exp(-i / tau);
  }
  return channels;
}
