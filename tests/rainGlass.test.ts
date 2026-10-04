import { describe, expect, it } from "vitest";
import {
  GLASS_H,
  GLASS_W,
  RainSim,
  SLIDE_RADIUS,
  WIPER_BLADES,
  rainFlux,
  type RainEnv,
} from "../src/game/rainGlass";

const PARKED = WIPER_BLADES.map((b) => b.park);
const still = (speed = 0): RainEnv => ({ rainMmH: 0, speed, blades: PARKED });
const run = (sim: RainSim, seconds: number, env: RainEnv, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) sim.step(dt, env);
};
/** Where a 4 mm drop has slid to after a second of frames dt apart. */
const slidAfterOneSecond = (dt: number) => {
  const sim = new RainSim({ seed: 6 });
  sim.add(0.7, 0.7, 4.0e-3);
  run(sim, 1, still(), dt);
  return sim.y[0];
};
/** A point on the glass at radius r from blade b's pivot, arm angle phi. */
const onBlade = (b: number, r: number, phi: number): [number, number] => {
  const [ox, oy] = WIPER_BLADES[b].pivot;
  return [ox - Math.cos(phi) * r, oy + Math.sin(phi) * r];
};

describe("rain on the windscreen: drop physics", () => {
  it("merges touching drops into one with the summed volume", () => {
    const sim = new RainSim({ seed: 3 });
    sim.add(0.5, 0.4, 1.0e-3);
    sim.add(0.5015, 0.4, 0.8e-3);
    sim.add(0.9, 0.3, 1.2e-3); // far away: stays separate
    const before = sim.dropVolume();
    // One physics step (in rain, so nothing evaporates).
    sim.step(1 / 120, { rainMmH: 1e-9, speed: 0, blades: PARKED });
    expect(sim.count).toBe(2);
    expect(Math.abs(sim.dropVolume() - before) / before).toBeLessThan(1e-12);
    const merged = Math.cbrt(1.0e-3 ** 3 + 0.8e-3 ** 3);
    expect(Array.from(sim.a.slice(0, sim.count)).some((a) => Math.abs(a - merged) < 1e-9)).toBe(true);
  });

  it("holds small drops in place and lets drops past the critical size slide down", () => {
    expect(SLIDE_RADIUS).toBeGreaterThan(2e-3);
    expect(SLIDE_RADIUS).toBeLessThan(3e-3);
    const sim = new RainSim({ seed: 4 });
    sim.add(0.3, 0.6, 1.0e-3);
    sim.add(1.1, 0.6, 4.5e-3);
    run(sim, 1, still());
    const small = Array.from(sim.a.slice(0, sim.count)).findIndex((a) => a < 2e-3);
    const large = Array.from(sim.a.slice(0, sim.count)).findIndex((a) => a > 4e-3);
    expect(sim.y[small]).toBeCloseTo(0.6, 9);
    expect(sim.y[large]).toBeLessThan(0.6 - 0.02);
  });

  it("carries drops up the glass at highway speed, but not at town speed", () => {
    const town = new RainSim({ seed: 5 });
    town.add(0.7, 0.3, 2.0e-3);
    run(town, 1, still(40 / 3.6));
    expect(town.y[0]).toBeCloseTo(0.3, 9);
    const highway = new RainSim({ seed: 5 });
    highway.add(0.7, 0.3, 2.0e-3);
    run(highway, 1, still(100 / 3.6));
    expect(highway.y[0]).toBeGreaterThan(0.3 + 0.05);
  });

  it("does not depend on the frame rate", () => {
    expect(slidAfterOneSecond(1 / 30)).toBeCloseTo(slidAfterOneSecond(1 / 144), 6);
  });

  it("leaves a trail of tiny droplets behind a sliding drop", () => {
    const sim = new RainSim({ seed: 7 });
    sim.add(0.7, 0.75, 5.0e-3);
    run(sim, 1.5, still());
    expect(sim.count).toBeGreaterThan(3);
    const tiny = Array.from(sim.a.slice(0, sim.count)).filter((a) => a < 1.5e-3);
    expect(tiny.length).toBeGreaterThan(2);
  });

  it("clears the band the blade sweeps and leaves drops outside it", () => {
    const sim = new RainSim({ seed: 8 });
    const blade = WIPER_BLADES[0];
    const inside = onBlade(0, 0.5, 40 * (Math.PI / 180));
    const beyond = onBlade(0, blade.rOut + 0.04, 40 * (Math.PI / 180));
    sim.add(...inside, 1.2e-3);
    sim.add(...beyond, 1.2e-3);
    // One up-stroke of the driver's-side blade, the other one parked.
    for (let k = 1; k <= 30; k++) {
      sim.step(1 / 60, { rainMmH: 0, speed: 0, blades: [blade.park + (blade.sweep * k) / 30, PARKED[1]] });
    }
    const remaining = [...Array(sim.count).keys()].map((i) => [sim.x[i], sim.y[i]]);
    expect(remaining.some(([x, y]) => Math.hypot(x - inside[0], y - inside[1]) < 1e-3)).toBe(false);
    expect(remaining.some(([x, y]) => Math.hypot(x - beyond[0], y - beyond[1]) < 1e-3)).toBe(true);
  });

  it("never holds more simulated drops than its cap, even in a downpour", () => {
    const sim = new RainSim({ maxDrops: 300, seed: 9 });
    let most = 0;
    for (const speed of [0, 30]) {
      for (let t = 0; t < 10; t += 1 / 60) {
        sim.step(1 / 60, { rainMmH: 50, speed, blades: PARKED });
        most = Math.max(most, sim.count);
      }
    }
    expect(most).toBe(300);
  });

  it("gets more rain on the glass when driving into it", () => {
    const standing = rainFlux(8, 0);
    const driving = rainFlux(8, 80 / 3.6);
    expect(driving.drops).toBeGreaterThan(standing.drops * 2.5);
    expect(driving.microRate).toBeGreaterThan(standing.microRate * 2.5);
    expect(rainFlux(0, 20).drops).toBe(0);
  });

  it("keeps the glass dry when it is not raining", () => {
    const sim = new RainSim({ seed: 10 });
    run(sim, 2, still(20));
    expect(sim.isDry()).toBe(true);
  });

  it("fills the glass from the edges of the frame: drops land anywhere on it", () => {
    const sim = new RainSim({ seed: 11 });
    run(sim, 3, { rainMmH: 8, speed: 0, blades: PARKED });
    const xs = Array.from(sim.x.slice(0, sim.count));
    const ys = Array.from(sim.y.slice(0, sim.count));
    expect(Math.min(...xs)).toBeLessThan(GLASS_W * 0.1);
    expect(Math.max(...xs)).toBeGreaterThan(GLASS_W * 0.9);
    expect(Math.min(...ys)).toBeLessThan(GLASS_H * 0.1);
    expect(Math.max(...ys)).toBeGreaterThan(GLASS_H * 0.9);
  });
});
