import { Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { VoiceFrom, VoiceOutput } from "../ai/tts";
import { QUALITY } from "../device";
import {
  airCutoff,
  birdCall,
  birdFor,
  cabinAcoustics,
  cabinImpulse,
  CALL_CYCLE,
  type Bird,
  type Candidate,
  dbToGain,
  dopplerCents,
  dopplerFactor,
  engineHz,
  hearsFromCabin,
  HUM,
  humClass,
  type HumClass,
  inverseGain,
  isInCabin,
  type Motion,
  newMotion,
  nextCallAt,
  rainPatter,
  rankAudible,
  track,
  tyreLevel,
  whiteNoise,
} from "./spatialMath";

/**
 * 音源の位置: sounds come from where their sources are. The listener rides the camera (the
 * driver's head in the driver's seat); sirens, the patrol car's loudspeaker, people talking, the
 * horn, the nearest traffic and the crosswalk signals' calls are PannerNodes (HRTF, inverse
 * distance) placed every frame, with a Doppler shift worked out here. From inside the player's
 * car everything outside goes through the cabin: muffled, quieter, with the cabin's own short
 * reverberation; the car's own engine and road noise are then the dull rumble heard inside.
 *
 * Bus layout (all on GameAudio's AudioContext):
 *   world ─┬─ outside (1 − k) ─────────────────────────────┐
 *          └─ cabin low-pass → low shelf → insulation (k) ─┼─ master (mute) → limiter → out
 *   interior (k): own engine, road, rain on the roof ──────┤
 *   exterior sounds of the player's car → outside ─────────┘   (+ cabin reverb from k paths)
 * k crossfades between 0 (outside) and 1 (in the cabin) over about 0.3 s.
 */

/** "rotor": the police helicopter's blade slap overhead (pursuitScene.ts), on the same voices. */
export type SirenKind = "ambulance" | "police" | "rotor";
export type VoiceStyle = "voice" | "loudspeaker";
/** One car for the traffic hum: its scene object (identity and pose), speed (m/s), model kind. */
export type CarVisitor = (object: Object3D, speed: number, kind: string | null) => void;
/** A 歩行者用灯器 whose accessible signal is sounding: the speaker, walking direction, which end. */
export type WalkSpeaker = { readonly at: Vector3; readonly across: Vector3; readonly side: 1 | -1 };

// Positional sources at once. Each HRTF panner convolves on the audio thread, and past a dozen
// the extra ones would be faint cars nobody picks out.
const MAX_SOURCES = 12;
const POOL_TRAFFIC = 0;
const POOL_CROSSWALK = 1;
const POOL_SIZES = [6, 4] as const;
const VOICE_SLOTS = 2;
const ASSIGN_EVERY = 0.1; // s between re-deciding which traffic and crosswalks get a voice
const SIREN_LEASE = 0.5; // s a siren keeps sounding without being asked again
const CROSSFADE = 0.1; // time constant: about 0.3 s to settle (3 τ)
const PITCH_GLIDE = 0.05;
const LOOKAHEAD = 0.12; // s: crosswalk calls are scheduled this far ahead of the clock

type Placement = { ref: number; rolloff: number; range: number };

// Street scale: refDistance is where the level is the nominal one, range where it is dropped.
const PLACE = {
  siren: { ref: 20, rolloff: 0.8, range: 900 },
  horn: { ref: 3, rolloff: 1, range: 300 },
  exhaust: { ref: 3, rolloff: 1, range: 200 },
  voice: { ref: 3, rolloff: 0.6, range: 40 },
  loudspeaker: { ref: 8, rolloff: 0.8, range: 350 },
  crosswalk: { ref: 3, rolloff: 1, range: 70 },
  hum: { ref: 4, rolloff: 1.2, range: 150 },
  // A speaker in the dashboard, 60 cm from the driver's ear.
  cabin: { ref: 0.6, rolloff: 1, range: 4 },
} satisfies Record<string, Placement>;

const HUM_PLACE: Record<HumClass, Placement> = {
  car: { ...PLACE.hum, range: HUM.car.range },
  heavy: { ...PLACE.hum, range: HUM.heavy.range },
  bike: { ...PLACE.hum, range: HUM.bike.range },
};

// Source gains at refDistance. A voice is speech PCM at about full scale, the rest synthetic.
const LEVEL = {
  siren: 0.14,
  horn: 0.16,
  exhaust: 0.12,
  voice: 1.8,
  loudspeaker: 2.2,
  crosswalk: 0.1,
  hum: 0.05,
};

/** Set an AudioParam toward `v` unless it is already (nearly) there: fewer automation events. */
function glide(
  param: AudioParam,
  v: number,
  now: number,
  tau: number,
  last: { v: number },
  eps: number,
): void {
  if (Math.abs(v - last.v) <= eps) return;
  last.v = v;
  param.setTargetAtTime(v, now, tau);
}

/** A positional source: input → air absorption → panner → its bus. Reused for many sounds. */
class Emitter {
  readonly input: GainNode;
  private readonly air: BiquadFilterNode;
  private readonly panner: PannerNode;
  anchor: Object3D | null = null;
  private readonly offset = new Vector3();
  private isFixed = false;
  readonly pos = new Vector3();
  readonly motion = newMotion();
  range = 100;
  level = 0;
  distance = Infinity;
  doppler = 1;
  /** Detune params of what plays through it (oscillators, buffer sources): Doppler goes here. */
  readonly detunes: AudioParam[] = [];

  /** Let the Doppler shift drive this param too, from the next update on. */
  addDetune(...params: AudioParam[]): void {
    this.detunes.push(...params);
    this.lastCents.v = Infinity; // force the next update to set them all
  }
  private readonly lastGain = { v: 0 };
  private readonly lastAir = { v: 20000 };
  private readonly lastCents = { v: 0 };

  constructor(ctx: BaseAudioContext, out: AudioNode, hrtf: boolean) {
    this.input = ctx.createGain();
    this.input.gain.value = 0;
    this.air = ctx.createBiquadFilter();
    this.air.type = "lowpass";
    this.air.frequency.value = 20000;
    this.panner = new PannerNode(ctx, {
      // HRTF places sounds behind and above too; phones get the cheaper equal-power pan.
      panningModel: hrtf ? "HRTF" : "equalpower",
      distanceModel: "inverse",
    });
    this.input.connect(this.air).connect(this.panner).connect(out);
  }

  place(p: Placement, level: number): void {
    this.panner.refDistance = p.ref;
    this.panner.rolloffFactor = p.rolloff;
    this.panner.maxDistance = p.range * 4;
    this.range = p.range;
    this.level = level;
  }

  /** Ride an object (a child of the scene): `offset` is in its own frame. */
  follow(anchor: Object3D | null, x = 0, y = 0, z = 0): void {
    this.anchor = anchor;
    this.isFixed = false;
    this.offset.set(x, y, z);
    this.motion.primed = false;
  }

  /** Stand at a fixed point. */
  at(p: Vector3): void {
    this.anchor = null;
    this.isFixed = true;
    this.pos.copy(p);
    this.motion.primed = false;
  }

  /** Silence it and let go of the source (its generators keep running, at zero gain). */
  free(now: number): void {
    this.anchor = null;
    this.isFixed = false;
    glide(this.input.gain, 0, now, 0.05, this.lastGain, 0);
  }

  dispose(): void {
    this.input.disconnect();
    this.air.disconnect();
    this.panner.disconnect();
  }

  get placed(): boolean {
    return this.anchor !== null || this.isFixed;
  }

  /** Follow the source, then set the panner, the air filter, the level and the Doppler pitch. */
  update(dt: number, listener: Motion, now: number): void {
    if (!this.placed) return;
    if (this.anchor)
      this.pos.copy(this.offset).applyQuaternion(this.anchor.quaternion).add(this.anchor.position);
    track(this.motion, this.pos, dt);
    const l = listener.p;
    this.distance = Math.hypot(this.pos.x - l.x, this.pos.y - l.y, this.pos.z - l.z);
    const isHeard = this.distance <= this.range;
    glide(this.input.gain, isHeard ? this.level : 0, now, 0.05, this.lastGain, 1e-4);
    if (!isHeard) return;
    // Positions are plain values (no automation): HRTF interpolates between frames itself.
    this.panner.positionX.value = this.pos.x;
    this.panner.positionY.value = this.pos.y;
    this.panner.positionZ.value = this.pos.z;
    glide(this.air.frequency, airCutoff(this.distance), now, 0.1, this.lastAir, this.lastAir.v * 0.03);
    this.doppler = dopplerFactor(this.motion.p, this.motion.v, l, listener.v);
    const cents = dopplerCents(this.doppler);
    // Why not WebAudio's own Doppler: AudioListener.dopplerFactor / PannerNode.setVelocity were
    // removed from the spec. Why not a DelayNode swept by distance / c: up to ~3 s of buffer per
    // source, and a delay time changed every frame tends to zipper.
    if (Math.abs(cents - this.lastCents.v) > 0.5) {
      this.lastCents.v = cents;
      for (const p of this.detunes) p.setTargetAtTime(cents, now, PITCH_GLIDE);
    }
  }

  /** Detune for a source started now (one-shots take the current pitch and keep it). */
  get cents(): number {
    return dopplerCents(this.doppler);
  }
}

type Siren = {
  kind: SirenKind;
  emitter: Emitter;
  osc: OscillatorNode;
  until: number;
  step: number;
  asked: number;
};
type VoiceSlot = { emitter: Emitter; plain: GainNode; megaphone: GainNode; busy: boolean };
type Hum = {
  emitter: Emitter;
  osc: OscillatorNode;
  lp: BiquadFilterNode;
  engine: GainNode;
  tyreBp: BiquadFilterNode;
  tyre: GainNode;
  key: object | null;
  cls: HumClass;
  keep: boolean;
};
type Caller = {
  emitter: Emitter;
  key: WalkSpeaker | null;
  bird: Bird;
  side: 1 | -1;
  nextAt: number;
  keep: boolean;
};
type Ambient = Candidate & {
  key: object | null;
  anchor: Object3D | null;
  speaker: WalkSpeaker | null;
  speed: number;
  cls: HumClass;
  pending: boolean;
};
/** The player's own car: engine and road heard inside (interior) or from the car (exterior). */
type OwnCar = {
  saw: OscillatorNode;
  sub: OscillatorNode;
  inLp: BiquadFilterNode;
  inEngine: GainNode;
  exLp: BiquadFilterNode;
  exEngine: GainNode;
  roadBp: BiquadFilterNode;
  roadIn: GainNode;
  tyreEx: GainNode;
  rainOut: GainNode;
  rainIn: GainNode;
  exhaust: Emitter;
};

export class SpatialAudio {
  /** The player's car (a child of the scene): the cabin, the exhaust and the horn ride it. */
  car: Object3D | null = null;
  /** Visit the traffic cars (set once by the game). */
  traffic: ((visit: CarVisitor) => void) | null = null;
  /** Visit the crosswalk speakers sounding now (walk light green, in operating hours). */
  crosswalks: ((visit: (s: WalkSpeaker) => void) => void) | null = null;

  private ctx: BaseAudioContext | null = null;
  private hrtf = !QUALITY.isMobile;
  private master: GainNode | null = null;
  private world: GainNode | null = null;
  private outside: GainNode | null = null;
  private cabinLp: BiquadFilterNode | null = null;
  private cabinShelf: BiquadFilterNode | null = null;
  private cabinGain: GainNode | null = null;
  private interior: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private calls: Record<Bird, [AudioBuffer, AudioBuffer]> | null = null;
  private own: OwnCar | null = null;
  private hornEmitter: Emitter | null = null;
  private hornOn = false;
  private speaker: Emitter | null = null;
  private readonly speakerAt = new Vector3();
  private readonly sirens = new Map<object, Siren>();
  private readonly voices: VoiceSlot[] = [];
  private readonly hums: Hum[] = [];
  private readonly callers: Caller[] = [];
  private readonly cands: Ambient[] = [];
  private candCount = 0;
  private readonly used = [0, 0];
  private readonly listener = newMotion();
  private readonly fwd = new Vector3();
  private readonly up = new Vector3();
  private inside = false;
  private windowOpen = false;
  private clock = 0;
  private lastAssign = -Infinity;
  private muted = false;
  private level = 1;
  private boundCar: Object3D | null = null;

  constructor(
    private readonly isMuted: () => boolean = () => false,
    private readonly volumeOf: () => number = () => 1,
  ) {}

  /** The master level now (mute and 音量), also while the game is paused and update() is not run. */
  applyLevel(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const isMuted = this.isMuted();
    const level = isMuted ? 0 : this.volumeOf();
    const isChanged = isMuted !== this.muted || level !== this.level;
    if (!isChanged) return;
    this.muted = isMuted;
    this.level = level;
    this.master.gain.setTargetAtTime(level, ctx.currentTime, 0.03);
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Build the buses and the always-there sounds (after the first user gesture). */
  init(ctx: BaseAudioContext): void {
    if (this.ctx) return;
    this.ctx = ctx;
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -4,
      knee: 3,
      ratio: 20,
      attack: 0.002,
      release: 0.2,
    });
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(limiter);
    this.master = master;
    const outside = ctx.createGain();
    outside.connect(master);
    const world = ctx.createGain();
    world.connect(outside);
    // Through the closed car: low-pass, the bass given some back, then the insulation loss.
    const closed = cabinAcoustics(false);
    const cabinLp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: closed.cutoff, Q: 0.6 });
    const cabinShelf = new BiquadFilterNode(ctx, {
      type: "lowshelf",
      frequency: 220,
      gain: closed.lowShelfDb,
    });
    const cabinGain = new GainNode(ctx, { gain: 0 });
    world.connect(cabinLp).connect(cabinShelf).connect(cabinGain).connect(master);
    const interior = new GainNode(ctx, { gain: 0 });
    interior.connect(master);
    // The cabin's own few milliseconds of reflections, on what is heard inside.
    const reverb = ctx.createConvolver();
    const [left, right] = cabinImpulse(ctx.sampleRate);
    const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
    ir.getChannelData(0).set(left);
    ir.getChannelData(1).set(right);
    reverb.normalize = true;
    reverb.buffer = ir;
    const wet = new GainNode(ctx, { gain: 0.3 });
    cabinGain.connect(reverb);
    interior.connect(reverb);
    reverb.connect(wet).connect(master);
    this.world = world;
    this.outside = outside;
    this.cabinLp = cabinLp;
    this.cabinShelf = cabinShelf;
    this.cabinGain = cabinGain;
    this.interior = interior;

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    noise.getChannelData(0).set(whiteNoise(noise.length));
    this.noise = noise;
    const toBuffer = (data: Float32Array) => {
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      return b;
    };
    const sr = ctx.sampleRate;
    this.calls = {
      piyo: [toBuffer(birdCall("piyo", false, sr)), toBuffer(birdCall("piyo", true, sr))],
      kakko: [toBuffer(birdCall("kakko", false, sr)), toBuffer(birdCall("kakko", true, sr))],
    };
    this.own = this.buildOwnCar(ctx, { interior, outside, world }, noise, toBuffer(rainPatter(sr, 3.7)));
    this.hornEmitter = this.buildHorn(ctx, world);
    for (let i = 0; i < POOL_SIZES[POOL_TRAFFIC]; i++) this.hums.push(this.buildHum(ctx, world));
    for (let i = 0; i < POOL_SIZES[POOL_CROSSWALK]; i++)
      this.callers.push({
        emitter: new Emitter(ctx, world, this.hrtf),
        key: null,
        bird: "piyo",
        side: 1,
        nextAt: 0,
        keep: false,
      });
    for (let i = 0; i < VOICE_SLOTS; i++) this.voices.push(this.buildVoice(ctx, world));
  }

  /**
   * Once a frame, after the camera is placed: move the listener, decide inside / outside, move
   * every source, and now and then re-pick which traffic and crosswalks are heard.
   */
  update(o: {
    dt: number;
    camera: PerspectiveCamera;
    /** Driving the player's car (not on foot, not in a taxi). */
    inCar: boolean;
    /** The driver's-seat view is on. */
    cockpit: boolean;
    /** The driver's window is down (talking to someone outside). */
    windowOpen: boolean;
    /** Rainfall at the car (mm/h, 0 when dry). */
    rainMmH: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.clock += o.dt;
    const cam = o.camera;
    const car = this.car;
    if (car !== this.boundCar) {
      this.boundCar = car;
      // The horn behind the front bumper, the exhaust (and the tyres) at the back.
      this.hornEmitter?.follow(car, 0, -0.3, 2.1);
      this.own?.exhaust.follow(car, 0, -0.5, -1.6);
      this.speaker?.follow(car, this.speakerAt.x, this.speakerAt.y, this.speakerAt.z);
    }
    const cameraInCabin = car !== null && isInCabin(cam.position, car.position, car.quaternion);
    const inside = hearsFromCabin({ inCar: o.inCar, cockpit: o.cockpit, cameraInCabin });
    // A cut into or out of the cabin moves the ears a metre or more at once: not a velocity.
    if (inside !== this.inside) this.listener.primed = false;
    if (inside !== this.inside || o.windowOpen !== this.windowOpen) this.setCabin(inside, o.windowOpen, now);
    track(this.listener, cam.position, o.dt);
    this.fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.placeListener(ctx.listener, cam.position);

    this.applyLevel();
    this.updateRain(o.rainMmH, now);

    for (const [key, s] of this.sirens) {
      const isForgotten = this.clock - s.asked > SIREN_LEASE;
      if (isForgotten) {
        this.stopSiren(key, s);
        continue;
      }
      this.scheduleSiren(s, now);
      s.emitter.update(o.dt, this.listener, now);
    }
    for (const v of this.voices) if (v.busy) v.emitter.update(o.dt, this.listener, now);
    this.hornEmitter?.update(o.dt, this.listener, now);
    this.own?.exhaust.update(o.dt, this.listener, now);
    this.speaker?.update(o.dt, this.listener, now);

    if (this.clock - this.lastAssign >= ASSIGN_EVERY) {
      this.lastAssign = this.clock;
      this.assign(now);
    }
    for (const h of this.hums) if (h.key) h.emitter.update(o.dt, this.listener, now);
    for (const c of this.callers) {
      if (!c.key) continue;
      c.emitter.update(o.dt, this.listener, now);
      this.scheduleCall(c, now);
    }
  }

  /**
   * Keep a siren sounding from `anchor` while `on` is passed every frame; it stops when asked
   * with `on` false or when no longer asked (the vehicle was removed).
   */
  siren(key: object, on: boolean, anchor: Object3D, kind: SirenKind): void {
    const ctx = this.ctx;
    const world = this.world;
    if (!ctx || !world) return;
    const s = this.sirens.get(key);
    if (!on) {
      if (s) this.stopSiren(key, s);
      return;
    }
    if (s) {
      s.asked = this.clock;
      if (s.emitter.anchor !== anchor) s.emitter.follow(anchor, 0, 1.0, 0.4);
      return;
    }
    const emitter = new Emitter(ctx, world, this.hrtf);
    emitter.place(PLACE.siren, LEVEL.siren);
    emitter.follow(anchor, 0, 1.0, 0.4);
    const osc = new OscillatorNode(ctx, { type: "square" });
    // The rotor is a low thump (the blades passing), not a tone: only its low end gets through.
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: kind === "rotor" ? 260 : 2400 });
    osc.connect(lp).connect(emitter.input);
    emitter.addDetune(osc.detune);
    const siren: Siren = { kind, emitter, osc, until: ctx.currentTime, step: 0, asked: this.clock };
    this.scheduleSiren(siren, ctx.currentTime);
    osc.start();
    this.sirens.set(key, siren);
  }

  /** 警音器 while held, from the front of the player's car. */
  horn(on: boolean): void {
    const ctx = this.ctx;
    const e = this.hornEmitter;
    if (!ctx || !e) return;
    const isChanged = on !== this.hornOn;
    this.hornOn = on;
    if (!isChanged) return;
    // The emitter's own gain handles range; the horn's on/off is its level.
    e.level = on ? LEVEL.horn : 0;
  }

  /** The player's engine and tyres for the car's speed (km/h) and throttle (0–1). */
  playerCar(kmh: number, throttle: number, engineOff: boolean): void {
    const ctx = this.ctx;
    const c = this.own;
    if (!ctx || !c) return;
    const t = ctx.currentTime;
    const hz = engineHz(kmh);
    c.saw.frequency.setTargetAtTime(hz, t, 0.08);
    c.sub.frequency.setTargetAtTime(hz / 2, t, 0.08);
    // Inside: the firewall and the floor leave a low rumble.
    c.inLp.frequency.setTargetAtTime(140 + throttle * 120, t, 0.1);
    c.inEngine.gain.setTargetAtTime(engineOff ? 0 : 0.05 + throttle * 0.035, t, 0.1);
    // Outside: the exhaust's rasp opens up with the throttle.
    c.exLp.frequency.setTargetAtTime(500 + throttle * 1800 + hz * 4, t, 0.1);
    c.exEngine.gain.setTargetAtTime(engineOff ? 0 : 0.55 + throttle * 0.45, t, 0.1);
    const tyres = tyreLevel(kmh / 3.6);
    c.roadBp.frequency.setTargetAtTime(240 + Math.abs(kmh) * 2, t, 0.2);
    c.roadIn.gain.setTargetAtTime(0.045 * tyres, t, 0.2);
    c.tyreEx.gain.setTargetAtTime(0.5 * tyres, t, 0.2);
  }

  /**
   * A speaker in the player's car (the navi's TV) at `at` in the car's frame, into the interior bus:
   * heard from inside with the cabin's own reflections, not muffled as the street is, and not from
   * outside. Equal-power panning (why not HRTF: at 60 cm straight ahead it adds little, and it would
   * take one of the 12 positional voices). One speaker; asking again moves it.
   */
  cabinSpeaker(at: Vector3): AudioNode | null {
    const ctx = this.ctx;
    const interior = this.interior;
    if (!ctx || !interior) return null;
    if (!this.speaker) {
      this.speaker = new Emitter(ctx, interior, false);
      this.speaker.place(PLACE.cabin, 1);
    }
    this.speakerAt.copy(at);
    this.speaker.follow(this.car, at.x, at.y, at.z);
    return this.speaker.input;
  }

  /** A line spoken from `anchor` (a person's mouth, the patrol car's loudspeaker). */
  voiceFrom(anchor: Object3D, style: VoiceStyle): VoiceFrom {
    return () => this.openVoice(anchor, style);
  }

  /**
   * How loud a line from `p` would arrive (0–1), for the speechSynthesis fallback that cannot
   * be routed through WebAudio.
   */
  loudnessAt(p: Vector3, style: VoiceStyle): number {
    const place = PLACE[style];
    const l = this.listener.p;
    const d = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
    if (d > place.range) return 0;
    const loss = this.inside ? dbToGain(cabinAcoustics(this.windowOpen).insulationDb) : 1;
    return Math.min(1, inverseGain(d, place.ref, place.rolloff) * loss * 1.6);
  }

  /** What is playing and from where (for the dev hook and headless checks). */
  describe(): Record<string, unknown> {
    return {
      ready: this.ready,
      inside: this.inside,
      windowOpen: this.windowOpen,
      buses: {
        outside: this.outside?.gain.value,
        cabin: this.cabinGain?.gain.value,
        interior: this.interior?.gain.value,
        cabinCutoff: this.cabinLp?.frequency.value,
        master: this.master?.gain.value,
      },
      listener: {
        ...this.listener.p,
        speed: Math.hypot(this.listener.v.x, this.listener.v.y, this.listener.v.z),
      },
      sirens: [...this.sirens.values()].map((s) => ({ kind: s.kind, ...describeEmitter(s.emitter) })),
      voices: this.voices.filter((v) => v.busy).map((v) => describeEmitter(v.emitter)),
      horn: this.hornOn && this.hornEmitter ? describeEmitter(this.hornEmitter) : null,
      exhaust: this.own ? describeEmitter(this.own.exhaust) : null,
      cabinSpeaker: this.speaker ? describeEmitter(this.speaker) : null,
      ownCar: this.own && {
        engineInside: this.own.inEngine.gain.value,
        engineOutside: this.own.exEngine.gain.value,
        road: this.own.roadIn.gain.value,
        rainOutside: this.own.rainOut.gain.value,
        rainInside: this.own.rainIn.gain.value,
      },
      traffic: this.hums.filter((h) => h.key).map((h) => ({ cls: h.cls, ...describeEmitter(h.emitter) })),
      crosswalks: this.callers
        .filter((c) => c.key)
        .map((c) => ({ bird: c.bird, side: c.side, ...describeEmitter(c.emitter) })),
      positional: this.activeCount(),
      candidates: this.candCount,
    };
  }

  // ---------- internals ----------

  private placeListener(l: AudioListener, p: Vector3): void {
    // Firefox has no AudioParams on the listener yet: fall back to the deprecated setters.
    const hasParams = (l as Partial<AudioListener>).positionX !== undefined;
    if (!hasParams) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
      return;
    }
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
    l.forwardX.value = this.fwd.x;
    l.forwardY.value = this.fwd.y;
    l.forwardZ.value = this.fwd.z;
    l.upX.value = this.up.x;
    l.upY.value = this.up.y;
    l.upZ.value = this.up.z;
  }

  private setCabin(inside: boolean, windowOpen: boolean, now: number): void {
    this.inside = inside;
    this.windowOpen = windowOpen;
    const k = inside ? 1 : 0;
    const a = cabinAcoustics(windowOpen);
    this.outside?.gain.setTargetAtTime(1 - k, now, CROSSFADE);
    this.cabinGain?.gain.setTargetAtTime(k * dbToGain(a.insulationDb), now, CROSSFADE);
    this.interior?.gain.setTargetAtTime(k, now, CROSSFADE);
    this.cabinLp?.frequency.setTargetAtTime(a.cutoff, now, CROSSFADE);
    this.cabinShelf?.gain.setTargetAtTime(a.lowShelfDb, now, CROSSFADE);
  }

  private updateRain(mmH: number, now: number): void {
    const c = this.own;
    if (!c) return;
    const amount = mmH > 0 ? Math.log2(1 + mmH) : 0;
    // Outside a hiss (also heard, muffled, through the cabin); inside drops on roof and glass.
    c.rainOut.gain.setTargetAtTime(Math.min(0.08, 0.016 * amount), now, 0.5);
    c.rainIn.gain.setTargetAtTime(Math.min(0.2, 0.04 * amount), now, 0.5);
  }

  private activeCount(): number {
    let n = this.sirens.size + (this.hornOn ? 1 : 0) + (this.car ? 1 : 0);
    for (const v of this.voices) if (v.busy) n++;
    for (const h of this.hums) if (h.key) n++;
    for (const c of this.callers) if (c.key) n++;
    return n;
  }

  private essentialCount(): number {
    let n = this.sirens.size + (this.hornOn ? 1 : 0) + (this.car ? 1 : 0);
    for (const v of this.voices) if (v.busy) n++;
    return n;
  }

  /** Rolling schedule of the siren's pitch pattern, two seconds ahead of the clock. */
  private scheduleSiren(s: Siren, now: number): void {
    const f = s.osc.frequency;
    while (s.until < now + 2) {
      const t = Math.max(s.until, now);
      if (s.kind === "rotor") {
        // Five blades at about 4.6 turns a second: a square wave at the blade rate, steady.
        f.setValueAtTime(23, t);
        s.until = t + 2;
      } else if (s.kind === "ambulance") {
        // 救急車 「ピーポー」: ~960 Hz / ~770 Hz, 0.65 s each.
        f.setValueAtTime(s.step % 2 ? 770 : 960, t);
        s.until = t + 0.65;
      } else {
        // パトカー 「ウー」: up from ~450 to ~1,200 Hz in 1.5 s, back down in 1.1 s.
        f.setValueAtTime(450, t);
        f.linearRampToValueAtTime(1200, t + 1.5);
        f.linearRampToValueAtTime(450, t + 2.6);
        s.until = t + 2.6;
      }
      s.step++;
    }
  }

  private stopSiren(key: object, s: Siren): void {
    const ctx = this.ctx;
    this.sirens.delete(key);
    if (!ctx) return;
    // A short fade so it does not click off.
    s.emitter.free(ctx.currentTime);
    s.osc.stop(ctx.currentTime + 0.3);
    s.osc.addEventListener("ended", () => s.emitter.dispose());
  }

  private openVoice(anchor: Object3D, style: VoiceStyle): VoiceOutput | null {
    const ctx = this.ctx;
    const slot = this.voices.find((v) => !v.busy);
    if (!ctx || !slot) return null;
    slot.busy = true;
    const e = slot.emitter;
    e.place(PLACE[style], LEVEL[style]);
    // The mouth of someone standing (origin at the feet), or the loudspeaker on the roof.
    if (style === "voice") e.follow(anchor, 0, 1.55, 0.1);
    else e.follow(anchor, 0, 1.2, 0.8);
    return {
      attach: (src) => {
        e.addDetune(src.detune);
        // An officer's voice through the speaker, a little lower (the old speechSynthesis pitch 0.8).
        if (style === "loudspeaker") src.playbackRate.value = 0.94;
        return style === "voice" ? slot.plain : slot.megaphone;
      },
      release: () => {
        slot.busy = false;
        e.detunes.length = 0;
        e.free(ctx.currentTime);
      },
    };
  }

  /** Re-pick the traffic and crosswalk voices: loudest arriving first, within the budget. */
  private assign(now: number): void {
    this.candCount = 0;
    this.traffic?.(this.visitCar);
    this.crosswalks?.(this.visitSpeaker);
    const budget = Math.max(0, MAX_SOURCES - this.essentialCount());
    rankAudible(this.cands, this.candCount, budget, POOL_SIZES, this.used);
    for (const h of this.hums) h.keep = false;
    for (const c of this.callers) c.keep = false;
    // Keep voices whose source is still chosen, free the rest, then give free ones to newcomers.
    for (let i = 0; i < this.candCount; i++) {
      const c = this.cands[i];
      c.pending = false;
      if (!c.chosen) continue;
      const h = c.pool === POOL_TRAFFIC ? this.humFor(c.key) : null;
      const k = c.pool === POOL_CROSSWALK ? this.callerFor(c.key) : null;
      if (h) {
        h.keep = true;
        this.tuneHum(h, c.speed, now);
      } else if (k) k.keep = true;
      else c.pending = true;
    }
    for (const h of this.hums) {
      if (h.key && !h.keep) {
        h.key = null;
        h.emitter.free(now);
      }
    }
    for (const c of this.callers) {
      if (c.key && !c.keep) {
        c.key = null;
        c.emitter.free(now);
      }
    }
    for (let i = 0; i < this.candCount; i++) {
      const c = this.cands[i];
      if (!c.pending) continue;
      if (c.pool === POOL_TRAFFIC) {
        const h = this.humFor(null);
        if (h && c.anchor) this.bindHum(h, c, now);
      } else {
        const k = this.callerFor(null);
        if (k && c.speaker) this.bindCaller(k, c.speaker);
      }
    }
  }

  private humFor(key: object | null): Hum | null {
    for (const h of this.hums) if (h.key === key) return h;
    return null;
  }

  private callerFor(key: object | null): Caller | null {
    for (const c of this.callers) if (c.key === key) return c;
    return null;
  }

  private nextCandidate(): Ambient {
    if (this.candCount === this.cands.length)
      this.cands.push({
        pool: 0,
        distance: 0,
        level: 0,
        range: 0,
        held: false,
        score: 0,
        chosen: false,
        key: null,
        anchor: null,
        speaker: null,
        speed: 0,
        cls: "car",
        pending: false,
      });
    return this.cands[this.candCount++];
  }

  private readonly visitCar: CarVisitor = (object, speed, kind) => {
    const cls = humClass(kind);
    const voice = HUM[cls];
    const l = this.listener.p;
    const p = object.position;
    const d = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
    // Cull before ranking: most of the traffic is out of earshot.
    if (d > voice.range) return;
    const c = this.nextCandidate();
    c.pool = POOL_TRAFFIC;
    c.distance = d;
    // A car standing at the lights is quieter than one passing.
    c.level = voice.level * (0.4 + 0.6 * Math.min(1, tyreLevel(speed)));
    c.range = voice.range;
    c.held = this.humFor(object) !== null;
    c.key = object;
    c.anchor = object;
    c.speaker = null;
    c.speed = speed;
    c.cls = cls;
  };

  private readonly visitSpeaker = (s: WalkSpeaker): void => {
    const l = this.listener.p;
    const d = Math.hypot(s.at.x - l.x, s.at.y - l.y, s.at.z - l.z);
    if (d > PLACE.crosswalk.range) return;
    const c = this.nextCandidate();
    c.pool = POOL_CROSSWALK;
    c.distance = d;
    c.level = 1.2;
    c.range = PLACE.crosswalk.range;
    c.held = this.callerFor(s) !== null;
    c.key = s;
    c.anchor = null;
    c.speaker = s;
    c.speed = 0;
    c.cls = "car";
  };

  private bindHum(h: Hum, c: Ambient, now: number): void {
    const voice = HUM[c.cls];
    h.key = c.key;
    h.cls = c.cls;
    h.emitter.place(HUM_PLACE[c.cls], LEVEL.hum * voice.level);
    h.emitter.follow(c.anchor, 0, 0.1, 0);
    h.osc.type = voice.wave;
    h.lp.frequency.setValueAtTime(voice.cutoff, now);
    h.tyreBp.frequency.setValueAtTime(voice.tyreHz, now);
    this.tuneHum(h, c.speed, now);
  }

  private tuneHum(h: Hum, speed: number, now: number): void {
    const voice = HUM[h.cls];
    h.osc.frequency.setTargetAtTime(voice.engineHz(speed), now, 0.2);
    h.engine.gain.setTargetAtTime(0.5 + 0.3 * Math.min(1, speed / 14), now, 0.2);
    h.tyre.gain.setTargetAtTime(0.9 * tyreLevel(speed), now, 0.2);
  }

  private bindCaller(k: Caller, s: WalkSpeaker): void {
    k.key = s;
    k.bird = birdFor(s.across);
    k.side = s.side;
    k.nextAt = 0;
    k.emitter.place(PLACE.crosswalk, LEVEL.crosswalk);
    k.emitter.at(s.at);
  }

  /** Queue this end's next call a little ahead of the clock, at the pitch Doppler gives now. */
  private scheduleCall(k: Caller, now: number): void {
    const ctx = this.ctx;
    const calls = this.calls;
    if (!ctx || !calls) return;
    if (k.nextAt < now) k.nextAt = nextCallAt(now + 0.02, k.side);
    if (k.nextAt > now + LOOKAHEAD) return;
    const src = new AudioBufferSourceNode(ctx, {
      buffer: calls[k.bird][k.side === 1 ? 0 : 1],
      detune: k.emitter.cents,
    });
    src.connect(k.emitter.input);
    src.start(k.nextAt);
    k.nextAt += CALL_CYCLE;
  }

  private buildHorn(ctx: BaseAudioContext, out: AudioNode): Emitter {
    const e = new Emitter(ctx, out, this.hrtf);
    e.place(PLACE.horn, 0);
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 2500 });
    const mix = new GainNode(ctx, { gain: 0.5 });
    for (const f of [415, 494]) {
      const osc = new OscillatorNode(ctx, { type: "square", frequency: f });
      osc.connect(mix);
      e.addDetune(osc.detune);
      osc.start();
    }
    mix.connect(lp).connect(e.input);
    return e;
  }

  private buildHum(ctx: BaseAudioContext, out: AudioNode): Hum {
    const emitter = new Emitter(ctx, out, this.hrtf);
    const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: 40 });
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 400, Q: 1.2 });
    const engine = new GainNode(ctx, { gain: 0.5 });
    osc.connect(lp).connect(engine).connect(emitter.input);
    // Tyre roar: the shared noise loop, from a different point for each voice.
    const noise = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
    const tyreBp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 700, Q: 0.8 });
    const tyre = new GainNode(ctx, { gain: 0 });
    noise.connect(tyreBp).connect(tyre).connect(emitter.input);
    osc.start();
    noise.start(0, Math.random() * 2);
    // Engine and tyres shift together: one Doppler for the whole car.
    emitter.addDetune(osc.detune, noise.detune);
    return { emitter, osc, lp, engine, tyreBp, tyre, key: null, cls: "car", keep: false };
  }

  private buildVoice(ctx: BaseAudioContext, out: AudioNode): VoiceSlot {
    const emitter = new Emitter(ctx, out, this.hrtf);
    const plain = new GainNode(ctx, { gain: 1 });
    plain.connect(emitter.input);
    // Loudspeaker: a horn speaker's narrow band and some clipping.
    const megaphone = new BiquadFilterNode(ctx, { type: "highpass", frequency: 420, Q: 0.7 });
    const presence = new BiquadFilterNode(ctx, { type: "peaking", frequency: 2000, Q: 1, gain: 6 });
    const clip = new WaveShaperNode(ctx, { curve: softClip(), oversample: "2x" });
    const top = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3800 });
    const megaphoneIn = new GainNode(ctx, { gain: 1.5 });
    megaphoneIn.connect(megaphone).connect(presence).connect(clip).connect(top).connect(emitter.input);
    return { emitter, plain, megaphone: megaphoneIn, busy: false };
  }

  private buildOwnCar(
    ctx: BaseAudioContext,
    buses: { interior: AudioNode; outside: AudioNode; world: AudioNode },
    noise: AudioBuffer,
    patter: AudioBuffer,
  ): OwnCar {
    const { interior, outside, world } = buses;
    const saw = new OscillatorNode(ctx, { type: "sawtooth", frequency: 60 });
    const sub = new OscillatorNode(ctx, { type: "sine", frequency: 30 });
    // Inside: both through a low low-pass.
    const inLp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 180, Q: 0.9 });
    const inEngine = new GainNode(ctx, { gain: 0 });
    saw.connect(inLp);
    sub.connect(inLp);
    inLp.connect(inEngine).connect(interior);
    // Outside: the exhaust, resonant and a little driven, from the back of the car.
    const exhaust = new Emitter(ctx, outside, this.hrtf);
    exhaust.place(PLACE.exhaust, LEVEL.exhaust);
    const exLp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 800, Q: 4 });
    const drive = new WaveShaperNode(ctx, { curve: softClip() });
    const exEngine = new GainNode(ctx, { gain: 0 });
    saw.connect(exLp).connect(drive).connect(exEngine).connect(exhaust.input);
    // Why no Doppler on the own car: the listener rides along with it (or it stands parked), so
    // the relative speed is ~0 and the shift would only add jitter from the chase camera's spring.
    const road = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
    const roadBp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 260, Q: 0.8 });
    const roadIn = new GainNode(ctx, { gain: 0 });
    road.connect(roadBp).connect(roadIn).connect(interior);
    const tyreBp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 0.7 });
    const tyreEx = new GainNode(ctx, { gain: 0 });
    road.connect(tyreBp).connect(tyreEx).connect(exhaust.input);
    // Rain: a hiss in the open (into `world`, so the cabin muffles it too), drops on the roof inside.
    const hiss = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true, playbackRate: 0.93 });
    const hissHp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 2500 });
    const hissLp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 9000 });
    const rainOut = new GainNode(ctx, { gain: 0 });
    hiss.connect(hissHp).connect(hissLp).connect(rainOut).connect(world);
    const drops = new AudioBufferSourceNode(ctx, { buffer: patter, loop: true });
    const dropsBp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1400, Q: 0.4 });
    const rainIn = new GainNode(ctx, { gain: 0 });
    drops.connect(dropsBp).connect(rainIn).connect(interior);
    for (const s of [saw, sub, road, hiss, drops]) s.start();
    return { saw, sub, inLp, inEngine, exLp, exEngine, roadBp, roadIn, tyreEx, rainOut, rainIn, exhaust };
  }
}

/** One source's state, rounded for reading. */
function describeEmitter(e: Emitter) {
  return {
    d: Math.round(e.distance * 10) / 10,
    doppler: Math.round(e.doppler * 10000) / 10000,
    cents: Math.round(dopplerCents(e.doppler)),
    gain: Math.round(e.input.gain.value * 1000) / 1000,
    speed: Math.round(Math.hypot(e.motion.v.x, e.motion.v.y, e.motion.v.z) * 10) / 10,
  };
}

/** tanh-like soft clipping (the loudspeaker's horn driver, the exhaust's bark). */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  return curve;
}
