// The game's own sound for one section of the teaser, rendered in the page (window.__game of a
// development build) with the game's own audio code in an OfflineAudioContext: GameAudio and its
// SpatialAudio (the engine, tyres and rain of the player's car, the traffic hum, the sirens, the
// crosswalk calls, the cabin's muffling and reflections, HRTF panning, Doppler, the limiter), the
// stamps' thud (stamp.ts) and the navi TV's programme bed (naviTv.ts). Injected as source text,
// so it must not close over anything. The scene is data (sounds.mjs); the clock is driven at the
// game's 30 frames a second with OfflineAudioContext.suspend, as the game's loop would.
//
// Returns the section's stereo samples (44.1 kHz float32, interleaved) as base64, with `pad` s of
// sound either side of it for the crossfades at the cuts.
//
// Why not port the sounds to Python: every filter, the HRTF panner, the convolver and the
// compressor would have to be matched by hand; this way the sound is the game's, whatever it
// becomes, and only the scene (where things are, how fast they go) is the teaser's.
export async function renderSection(spec) {
  const G = window.__game;
  const SR = 44100;
  const FPS = 30;
  const DT = 1 / FPS;
  const PRE = 1.5;
  const pad = spec.pad ?? 0.02;
  const scene = spec.scene;
  const len = spec.seconds;
  const total = PRE + len + pad;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const encode = (buffer) => {
    const from = Math.round((PRE - pad) * SR);
    const n = Math.round((len + 2 * pad) * SR);
    const out = new Float32Array(n * 2);
    for (let c = 0; c < 2; c++) {
      const data = buffer ? buffer.getChannelData(c) : null;
      for (let i = 0; i < n; i++) out[i * 2 + c] = data ? (data[from + i] ?? 0) : 0;
    }
    const bytes = new Uint8Array(out.buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  if (scene.ear === "silent") return encode(null);

  // ---- the game's sound objects, on this context ----
  const GameAudio = G.audio.constructor;
  const audio = new GameAudio();
  audio.ctx = ctx;
  audio.spatial.init(ctx);
  const sp = audio.spatial;
  const Obj = G.vehicle.object.constructor;
  const V3 = G.camera.position.constructor;
  const car = new Obj();
  const cam = new G.camera.constructor(60, 16 / 9, 0.1, 2000);
  sp.car = car;
  // A context that reads `currentTime` as a given moment: one-shots asked for a little ahead of
  // their frame start exactly then (the stamps' thud and the chime read the clock themselves).
  const at = (time) =>
    new Proxy(ctx, {
      get: (target, key) => {
        if (key === "currentTime") return time;
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  let eventTime = 0;
  const stamps = new G.stamps.constructor(
    document.createElement("div"),
    () => at(eventTime),
    document.createElement("div"),
  );

  // ---- keyframes ----
  /** A number, or [[t, v] …] linear between keys (held before the first and after the last). */
  const value = (x, t, fallback = 0) => {
    if (x === undefined || x === null) return fallback;
    if (typeof x === "number" || typeof x === "boolean") return x;
    if (t <= x[0][0]) return x[0][1];
    for (let i = 1; i < x.length; i++) {
      if (t <= x[i][0]) {
        const [t0, v0] = x[i - 1];
        const [t1, v1] = x[i];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return x[x.length - 1][1];
  };
  /** A point: [x, y, z], or [[t, x, y, z] …] linear between keys. */
  const point = (p, t) => {
    if (!Array.isArray(p[0])) return new V3(p[0], p[1], p[2]);
    if (p.length === 1 || t <= p[0][0]) return new V3(p[0][1], p[0][2], p[0][3]);
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const a = p[i - 1];
        const b = p[i];
        const k = (t - a[0]) / (b[0] - a[0]);
        return new V3(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
      }
    }
    const l = p[p.length - 1];
    return new V3(l[1], l[2], l[3]);
  };
  /** Rain: steps [[t, mm] …] or a number. */
  const rainAt = (t) => {
    const r = scene.rain ?? 0;
    if (typeof r === "number") return r;
    let mm = r[0][1];
    for (const [t0, v] of r) if (t >= t0) mm = v;
    return mm;
  };

  // ---- the player's car: z by its speed (integrated from t = 0 both ways) ----
  const c = scene.car ?? { kmh: 0, throttle: 0 };
  const kmh = (t) => value(c.kmh, t);
  const STEP = 1 / 240;
  const zAt = (t) => {
    let z = c.z0 ?? 0;
    const dir = t >= 0 ? 1 : -1;
    for (let s = 0; dir * s < dir * t; s += dir * STEP) z += (dir * STEP * kmh(s)) / 3.6;
    return z;
  };
  const engineOff = (t) => c.off === true || (typeof c.off === "number" && t >= c.off);

  const inCar = scene.inCar ?? !(scene.ear === "foot");
  const smooth = (k) => {
    const x = Math.min(1, Math.max(0, k));
    return x * x * (3 - 2 * x);
  };
  const placeCamera = (t, carPos) => {
    if (scene.ear === "seat") {
      // The driver's eye of a right-hand drive car: right of centre (−x), inside the cabin box.
      cam.position.set(carPos.x - 0.37, carPos.y + 0.3, carPos.z - 0.15);
      cam.lookAt(carPos.x - 0.37, carPos.y + 0.2, carPos.z + 20);
      return;
    }
    if (scene.ear === "chase") {
      const from = point(scene.cam, t);
      const to = scene.camTo ? point(scene.camTo, t) : from;
      const k = smooth(t / len);
      cam.position.set(
        carPos.x + from.x + (to.x - from.x) * k,
        carPos.y + from.y + (to.y - from.y) * k,
        carPos.z + from.z + (to.z - from.z) * k,
      );
      cam.lookAt(carPos.x, carPos.y + 0.5, carPos.z + 4);
      return;
    }
    const base = scene.rel ? carPos : new V3();
    cam.position.copy(point(scene.cam, t)).add(base);
    const look = point(scene.look ?? [0, 0, 10], t).add(base);
    cam.lookAt(look.x, look.y, look.z);
  };

  // ---- the others: traffic, sirens, crosswalk calls ----
  // A car `pass`es level with the player's car under the cameras that ride it, else the camera's
  // own spot (z = 0) where the player's car is elsewhere (z0).
  const ridesCar = scene.ear === "seat" || scene.ear === "chase" || scene.rel === true;
  const traffic = (scene.traffic ?? []).map((v) => ({ ...v, object: new Obj() }));
  sp.traffic = (visit) => {
    for (const v of traffic) visit(v.object, Math.abs(v.v), v.kind);
  };
  const calls = (scene.calls ?? []).map((s) => ({
    at: new V3(...s.at),
    across: { x: s.across[0], z: s.across[1] },
    side: s.side,
  }));
  sp.crosswalks = (visit) => {
    for (const s of calls) visit(s);
  };
  const sirens = (scene.sirens ?? []).map((s) => ({ ...s, object: new Obj(), key: {}, on: false }));

  // ---- the navi TV's programme in the cabin (its own TvSound, through this context) ----
  let restoreTv = null;
  if (scene.tv) {
    const tv = G.naviTv;
    const saved = { audio: tv.deps.audio, sound: tv.sound, state: tv.state };
    tv.deps = { ...tv.deps, audio };
    tv.sound = null;
    tv.state = { ...tv.state, on: true };
    tv.ensureSound()?.play(scene.tv);
    restoreTv = () => {
      tv.deps = { ...tv.deps, audio: saved.audio };
      tv.sound = saved.sound;
      tv.state = saved.state;
    };
  }

  const events = (scene.events ?? []).map(([t, what]) => ({ t, what, done: false }));
  let last = -PRE - DT;
  /** One frame of the game's loop at section time t: move everything, then the audio update. */
  const frame = (t) => {
    const dt = t - last;
    last = t;
    const carPos = new V3(0, 0, zAt(t));
    car.position.copy(carPos);
    car.updateMatrixWorld();
    for (const v of traffic) {
      v.object.position.set(v.x, 0, (ridesCar ? zAt(v.pass) : 0) + v.v * (t - v.pass));
      // Facing the way it goes (yaw π: −z).
      v.object.rotation.set(0, v.v < 0 ? Math.PI : 0, 0);
    }
    for (const s of sirens) {
      const isOn = t >= (s.from ?? -Infinity) && t < (s.to ?? Infinity);
      if (isOn) {
        const p = point(s.path, t);
        if (s.rel) p.add(carPos);
        s.object.position.copy(p);
        sp.siren(s.key, true, s.object, s.kind);
      } else if (s.on) sp.siren(s.key, false, s.object, s.kind);
      s.on = isOn;
    }
    placeCamera(t, carPos);
    cam.updateMatrixWorld();
    sp.update({
      dt: Math.max(1e-3, dt),
      camera: cam,
      inCar,
      cockpit: scene.ear === "seat",
      windowOpen: false,
      rainMmH: rainAt(t),
    });
    const isOff = !inCar || engineOff(t);
    audio.update(isOff ? 0 : kmh(t), isOff ? 0 : value(c.throttle, t), isOff);
    // What happens before the next frame, at its own moment.
    for (const e of events) {
      if (e.done || e.t >= t + DT) continue;
      e.done = true;
      eventTime = PRE + e.t;
      if (e.what === "stamp") {
        // stamp.ts: the thud lands as the seal reaches the paper, 120 ms after it is pressed.
        eventTime += 0.12;
        stamps.thud(false);
      } else if (e.what === "chime") {
        audio.ctx = at(eventTime);
        audio.chime();
        audio.ctx = ctx;
      }
    }
  };

  frame(-PRE);
  const frames = Math.floor((total - 1e-6) * FPS);
  for (let i = 1; i <= frames; i++) {
    const time = i / FPS;
    ctx.suspend(time).then(() => {
      frame(time - PRE);
      ctx.resume();
    });
  }
  try {
    const buffer = await ctx.startRendering();
    return encode(buffer);
  } finally {
    restoreTv?.();
  }
}
