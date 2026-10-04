import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  birdCall,
  birdFor,
  CABIN,
  cabinAcoustics,
  cabinImpulse,
  CALL_CYCLE,
  type Candidate,
  DOPPLER_MAX,
  DOPPLER_MIN,
  dopplerCents,
  dopplerFactor,
  hearsFromCabin,
  HOLD_BONUS,
  HUM,
  humClass,
  isInCabin,
  newMotion,
  nextCallAt,
  rankAudible,
  SPEED_OF_SOUND,
  track,
} from "../src/game/spatialMath";

const KMH50 = 50 / 3.6;
const still = { x: 0, y: 0, z: 0 };
const v = (x: number, y = 0, z = 0) => ({ x, y, z });

describe("Doppler", () => {
  it("raises the pitch of a source coming toward a standing listener and lowers it going away", () => {
    const listener = v(0);
    const approaching = dopplerFactor(v(-50), v(KMH50), listener, still);
    const receding = dopplerFactor(v(50), v(KMH50), listener, still);
    expect(approaching).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND - KMH50), 6);
    expect(receding).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND + KMH50), 6);
    expect(approaching).toBeGreaterThan(1);
    expect(receding).toBeLessThan(1);
  });

  it("drops a siren passing at 50 km/h by about 8 % (a semitone and a half)", () => {
    const before = dopplerFactor(v(-80, 0, 3), v(KMH50), v(0), still);
    const after = dopplerFactor(v(80, 0, 3), v(KMH50), v(0), still);
    const drop = 1 - after / before;
    expect(drop).toBeGreaterThan(0.075);
    expect(drop).toBeLessThan(0.09);
    const semitones = (dopplerCents(before) - dopplerCents(after)) / 100;
    expect(semitones).toBeGreaterThan(1.3);
    expect(semitones).toBeLessThan(1.6);
  });

  it("shifts by the listener's own motion toward a standing source: (c + v) / c", () => {
    const f = dopplerFactor(v(100), still, v(0), v(KMH50));
    expect(f).toBeCloseTo((SPEED_OF_SOUND + KMH50) / SPEED_OF_SOUND, 6);
  });

  it("leaves the pitch alone for motion across the line of sight, for a shared velocity and on top", () => {
    expect(dopplerFactor(v(0, 0, 30), v(KMH50), v(0), still)).toBeCloseTo(1, 9);
    expect(dopplerFactor(v(-30), v(KMH50), v(0), v(KMH50))).toBeCloseTo(1, 9);
    expect(dopplerFactor(v(0.2), v(40), v(0), still)).toBe(1);
  });

  it("clamps absurd speeds to a sane range", () => {
    expect(dopplerFactor(v(-50), v(400), v(0), still)).toBe(DOPPLER_MAX);
    expect(dopplerFactor(v(50), v(400), v(0), still)).toBe(DOPPLER_MIN);
  });
});

describe("velocity tracking", () => {
  it("settles on the true speed of a point moving at 50 km/h", () => {
    const m = newMotion();
    const p = v(0);
    for (let i = 0; i < 120; i++) {
      p.x += KMH50 / 60;
      track(m, p, 1 / 60);
    }
    expect(m.v.x).toBeCloseTo(KMH50, 3);
  });

  it("ignores a jump (re-anchoring, a teleport, a camera cut) instead of reading it as speed", () => {
    const m = newMotion();
    const p = v(0);
    for (let i = 0; i < 120; i++) {
      p.x += KMH50 / 60;
      track(m, p, 1 / 60);
    }
    p.x += 500;
    track(m, p, 1 / 60);
    expect(m.v.x).toBeCloseTo(KMH50, 3);
    expect(m.p.x).toBe(p.x);
  });
});

describe("in the cabin or outside", () => {
  const carPos = new Vector3(100, 40, -20);
  const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2.1);
  const inCarFrame = (x: number, y: number, z: number) =>
    new Vector3(x, y, z).applyQuaternion(turned).add(carPos);

  it("puts the driver's eye inside the cabin whatever way the car faces", () => {
    expect(isInCabin(inCarFrame(-0.37, 0.32, -0.22), carPos, turned)).toBe(true);
  });

  it("keeps the chase camera, the bonnet camera and a point beside the car outside", () => {
    expect(isInCabin(inCarFrame(0, 3.4, -8.5), carPos, turned)).toBe(false);
    expect(isInCabin(inCarFrame(0, 1.1, 0.6), carPos, turned)).toBe(false); // above the roof
    expect(isInCabin(inCarFrame(CABIN.halfWidth + 0.2, 0.3, 0), carPos, turned)).toBe(false);
  });

  it("hears from the cabin in the driver's seat or with the camera in the body, only when driving it", () => {
    expect(hearsFromCabin({ inCar: true, cockpit: true, cameraInCabin: false })).toBe(true);
    expect(hearsFromCabin({ inCar: true, cockpit: false, cameraInCabin: true })).toBe(true);
    expect(hearsFromCabin({ inCar: true, cockpit: false, cameraInCabin: false })).toBe(false);
    expect(hearsFromCabin({ inCar: false, cockpit: false, cameraInCabin: true })).toBe(false);
  });

  it("muffles outside sound behind closed windows (600–900 Hz, −15 to −20 dB) and less with one open", () => {
    const closed = cabinAcoustics(false);
    const open = cabinAcoustics(true);
    expect(closed.cutoff).toBeGreaterThanOrEqual(600);
    expect(closed.cutoff).toBeLessThanOrEqual(900);
    expect(closed.insulationDb).toBeLessThanOrEqual(-15);
    expect(closed.insulationDb).toBeGreaterThanOrEqual(-20);
    expect(open.cutoff).toBeGreaterThan(closed.cutoff);
    expect(open.insulationDb).toBeGreaterThan(closed.insulationDb);
  });

  it("gives the cabin a few milliseconds of early reflections and a tail that dies within 80 ms", () => {
    const sr = 48000;
    const [left, right] = cabinImpulse(sr);
    expect(left.length).toBe(right.length);
    expect(left.length / sr).toBeLessThanOrEqual(0.08);
    const energy = (ch: Float32Array, from: number, to: number) => {
      let e = 0;
      for (let i = Math.floor(from * sr); i < Math.floor(to * sr); i++) e += ch[i] ** 2;
      return e;
    };
    expect(energy(left, 0.0005, 0.006)).toBeGreaterThan(20 * energy(left, 0.05, 0.08));
  });
});

const cand = (pool: number, distance: number, level = 1, range = 100, held = false): Candidate => ({
  pool,
  distance,
  level,
  range,
  held,
  score: 0,
  chosen: false,
});

describe("which sources get a voice", () => {
  it("drops sources beyond their range and ranks the rest by how loud they arrive", () => {
    const far = cand(0, 120);
    const near = cand(0, 10);
    const loudBus = cand(0, 30, HUM.heavy.level);
    const mid = cand(0, 25);
    const list = [far, mid, near, loudBus];
    const n = rankAudible(list, list.length, 12, [6, 4], [0, 0]);
    expect(n).toBe(3);
    expect(list.slice(0, 3)).toEqual([near, loudBus, mid]);
    expect(far.chosen).toBe(false);
  });

  it("stays within the total budget and each pool's size, loudest first", () => {
    const cars = Array.from({ length: 10 }, (_, i) => cand(0, 10 + i * 5));
    const calls = Array.from({ length: 6 }, (_, i) => cand(1, 12 + i * 5));
    const list = [...calls, ...cars];
    const n = rankAudible(list, list.length, 8, [6, 4], [0, 0]);
    expect(n).toBe(8);
    const chosen = list.filter((c) => c.chosen);
    expect(chosen.filter((c) => c.pool === 0).length).toBeLessThanOrEqual(6);
    expect(chosen.filter((c) => c.pool === 1).length).toBeLessThanOrEqual(4);
    // Nothing left out is louder than anything taken in its own pool.
    for (const pool of [0, 1]) {
      const inPool = list.filter((c) => c.pool === pool);
      const minTaken = Math.min(...inPool.filter((c) => c.chosen).map((c) => c.score));
      const poolFull = inPool.filter((c) => c.chosen).length === [6, 4][pool];
      if (!poolFull) continue;
      for (const c of inPool.filter((x) => !x.chosen)) expect(c.score).toBeLessThanOrEqual(minTaken);
    }
  });

  it("keeps a playing source over a newcomer only slightly louder (no flapping)", () => {
    const playing = cand(0, 20, 1, 100, true);
    const newcomer = cand(0, 20 / (HOLD_BONUS - 0.1));
    const list = [newcomer, playing];
    rankAudible(list, 2, 1, [1, 0], [0, 0]);
    expect(playing.chosen).toBe(true);
    expect(newcomer.chosen).toBe(false);
  });

  it("gives buses and lorries the low, loud voice and motorbikes the high one", () => {
    expect(humClass("bus")).toBe("heavy");
    expect(humClass("truck10t")).toBe("heavy");
    expect(humClass("motorbike")).toBe("bike");
    expect(humClass(null)).toBe("car");
    expect(HUM.heavy.engineHz(10)).toBeLessThan(HUM.car.engineHz(10));
    expect(HUM.bike.engineHz(10)).toBeGreaterThan(HUM.car.engineHz(10));
    expect(HUM.heavy.level).toBeGreaterThan(HUM.car.level);
  });
});

describe("accessible crosswalk signals (音響式信号機)", () => {
  it("calls 「ピヨ」 for walking north–south and 「カッコー」 for east–west (+X east, −Z north)", () => {
    expect(birdFor({ x: 0.1, z: -1 })).toBe("piyo");
    expect(birdFor({ x: -1, z: 0.2 })).toBe("kakko");
  });

  it("answers from the far end half a cycle later (鳴き交わし)", () => {
    const near = nextCallAt(10.01, 1);
    const far = nextCallAt(near, -1);
    expect(near).toBeGreaterThanOrEqual(10.01);
    expect(far - near).toBeCloseTo(CALL_CYCLE / 2, 9);
    expect(nextCallAt(near + 0.001, 1) - near).toBeCloseTo(CALL_CYCLE, 9);
  });

  it("makes the answering end's call the doubled one (ピヨピヨ, カカッコー)", () => {
    const sr = 48000;
    expect(birdCall("piyo", true, sr).length).toBeGreaterThan(birdCall("piyo", false, sr).length);
    expect(birdCall("kakko", true, sr).length).toBeGreaterThan(birdCall("kakko", false, sr).length);
    expect(birdCall("kakko", false, sr).length / sr).toBeLessThan(CALL_CYCLE / 2);
  });
});
