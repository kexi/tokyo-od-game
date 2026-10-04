import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { charmOf, DEFAULT_PREFS, loadPrefs } from "../src/game/controlsHelp";
import {
  CharmRig,
  type CharmKind,
  CORDS,
  cordLayout,
  DEFAULT_CABIN,
  frameStep,
  MAX_ACCEL,
  twistAngle,
  type ChassisSample,
} from "../src/physics/charmRig";

const DEG = 180 / Math.PI;
const H = 1 / 60;
const sample = (over: Partial<ChassisSample> = {}): ChassisSample => ({
  at: new Vector3(),
  velocity: new Vector3(),
  rotation: new Quaternion(),
  angvel: new Vector3(),
  ...over,
});

describe("the cord's layout", () => {
  it("lays the segments end to end from the knot, the charm's loop at the end", () => {
    const top = new Vector3(0, 0.5, 0.17);
    const { joints, centres } = cordLayout(top, new Vector3(0, -1, 0), { segments: 5, segment: 0.024 });
    expect(joints).toHaveLength(6);
    expect(centres).toHaveLength(5);
    expect(joints[0].equals(top)).toBe(true);
    expect(joints[5].y).toBeCloseTo(0.5 - 0.12, 9);
    expect(centres[0].y).toBeCloseTo(0.5 - 0.012, 9);
    for (let i = 1; i < joints.length; i++) expect(joints[i].distanceTo(joints[i - 1])).toBeCloseTo(0.024, 9);
  });

  it("keeps the cords 9–16 cm in 4–6 segments", () => {
    for (const set of [CORDS.single, CORDS.pair])
      for (const cord of Object.values(set)) {
        const length = cord.segments * cord.segment;
        expect(cord.segments).toBeGreaterThanOrEqual(4);
        expect(cord.segments).toBeLessThanOrEqual(6);
        expect(length).toBeGreaterThanOrEqual(0.09);
        expect(length).toBeLessThanOrEqual(0.16);
      }
  });

  it("knots the cord where it hangs clear of the mirror housing and faces the charm to the driver", () => {
    const c = DEFAULT_CABIN;
    // The housing's back face (−Z of its frame) and its lower edge: the cord hangs straight down
    // from the knot, so it must clear the back at the height of the lower edge.
    const back = new Vector3(0, 0, -1).applyQuaternion(c.housing.rotation);
    const up = new Vector3(0, 1, 0).applyQuaternion(c.housing.rotation);
    const lowerBackEdge = c.housing.centre
      .clone()
      .addScaledVector(back, c.housing.half.z)
      .addScaledVector(up, -c.housing.half.y);
    const cordThere = new Vector3(c.hang.x, lowerBackEdge.y, c.hang.z);
    const clearance = cordThere.clone().sub(lowerBackEdge).dot(back);
    expect(clearance).toBeGreaterThan(0.002);
    expect(c.hang.y).toBeLessThan(c.roofY);
    // The face (+Z turned by faceYaw) points back and to the right, toward the driver's seat.
    const face = new Vector3(Math.sin(c.faceYaw), 0, Math.cos(c.faceYaw));
    expect(face.z).toBeLessThan(-0.5);
    expect(face.x).toBeLessThan(-0.5);
  });

  it("reads the twist about +Y out of a rotation, ignoring the swing", () => {
    const swing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.1);
    expect(twistAngle(swing)).toBeCloseTo(0, 9);
    const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
    expect(twistAngle(swing.clone().multiply(twist))).toBeCloseTo(0.4, 6);
    expect(twistAngle(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 3.5))).toBeCloseTo(
      3.5 - 2 * Math.PI,
      6,
    );
  });
});

describe("what the chassis' motion means for the charms (frameStep)", () => {
  it("passes real motion on as the knot's acceleration, capped", () => {
    const braking = frameStep(
      sample({ velocity: new Vector3(0, 0, 20) }),
      sample({ at: new Vector3(0, 0, 0.33), velocity: new Vector3(0, 0, 19.8) }),
      H,
    );
    expect(braking.kind).toBe("move");
    expect(braking.accel.z).toBeCloseTo(-12, 6);
    const crash = frameStep(
      sample({ velocity: new Vector3(0, 0, 14) }),
      sample({ at: new Vector3(0, 0, 0.12) }),
      H,
    );
    expect(crash.kind).toBe("move");
    expect(crash.accel.length()).toBeCloseTo(MAX_ACCEL, 6);
  });

  it("tells a re-anchored frame (kilometres away, still moving) from a teleport (stopped)", () => {
    const moving = sample({ velocity: new Vector3(0, 0, 14) });
    const recentred = frameStep(
      moving,
      sample({ at: new Vector3(0, 0, -1500), velocity: new Vector3(0, 0, 14) }),
      H,
    );
    expect(recentred.kind).toBe("shift");
    expect(recentred.accel.length()).toBe(0);
    const teleported = frameStep(moving, sample({ at: new Vector3(400, 0, 30) }), H);
    expect(teleported.kind).toBe("teleport");
    const turnedRound = frameStep(
      sample(),
      sample({ rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2) }),
      H,
    );
    expect(turnedRound.kind).toBe("teleport");
  });
});

type Car = { at: Vector3; v: Vector3; yaw: number; yawRate: number };

/** Drive a rig at 60 Hz; `drive` sets the car's velocity and yaw rate for each step. */
function simulate(kinds: CharmKind[], seconds: number, drive: (t: number, car: Car) => void) {
  const rig = new CharmRig(DEFAULT_CABIN, kinds);
  const car: Car = { at: new Vector3(), v: new Vector3(), yaw: 0, yawRate: 0 };
  const pose = () => {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), car.yaw);
    return { at: car.at.clone(), velocity: car.v.clone(), rotation, angvel: new Vector3(0, car.yawRate, 0) };
  };
  drive(0, car);
  rig.follow(pose(), 0);
  const nominal = rig.chains.map((c) => c.cord.segments * c.cord.segment);
  const rows: Array<{ t: number; fwd: number; side: number; stretch: number; finite: boolean }> = [];
  for (let i = 1; i <= Math.round(seconds / H); i++) {
    const t = i * H;
    drive(t, car);
    car.at.addScaledVector(car.v, H);
    car.yaw += car.yawRate * H;
    rig.follow(pose(), H);
    const p = rig.poses()[0];
    const d = p.points[p.points.length - 1].clone().sub(p.points[0]);
    let along = 0;
    for (let j = 1; j < p.points.length; j++) along += p.points[j].distanceTo(p.points[j - 1]);
    rows.push({
      t,
      fwd: Math.atan2(d.z, -d.y) * DEG,
      side: Math.atan2(d.x, -d.y) * DEG,
      stretch: along - nominal[0],
      finite: [d.x, d.y, d.z].every(Number.isFinite),
    });
  }
  return { rig, rows, between: (a: number, b: number) => rows.filter((r) => r.t >= a && r.t <= b) };
}
const max = (rows: Array<{ fwd: number }>, key: "fwd" | "side" | "stretch" = "fwd") =>
  Math.max(...rows.map((r) => (r as Record<string, number>)[key]));
const min = (rows: Array<{ fwd: number }>, key: "fwd" | "side" = "fwd") =>
  Math.min(...rows.map((r) => (r as Record<string, number>)[key]));

describe("the charms on their cords (Rapier, headless)", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });
  const rigs: CharmRig[] = [];
  afterEach(() => {
    for (const r of rigs.splice(0)) r.dispose();
  });
  const run = (...args: Parameters<typeof simulate>) => {
    const s = simulate(...args);
    rigs.push(s.rig);
    return s;
  };

  it("hangs still at rest: no jitter, the cord stretched under 2 mm", () => {
    const { between } = run(["plush"], 6, () => {});
    const late = between(3, 6);
    expect(max(late) - min(late)).toBeLessThan(0.01);
    expect(Math.abs(max(late))).toBeLessThan(0.05);
    expect(max(late, "stretch")).toBeLessThan(0.002);
  });

  it("swings forward on hard braking from 100 km/h and settles within 4 s of stopping", () => {
    const stop = 1 + 100 / 3.6 / 8;
    const { between, rows } = run(["plush"], stop + 5, (t, car) => {
      car.v.z = t < 1 ? 100 / 3.6 : Math.max(0, car.v.z - 8 * H);
    });
    expect(rows.every((r) => r.finite)).toBe(true);
    // 0.8 g: 39° at equilibrium, overshooting on the sudden onset; never past the glass.
    expect(max(between(1, stop))).toBeGreaterThan(39);
    expect(max(between(1, stop))).toBeLessThan(90);
    const settled = between(stop + 4, stop + 5);
    expect(Math.max(...settled.map((r) => Math.abs(r.fwd)))).toBeLessThan(1);
    expect(max(rows, "stretch")).toBeLessThan(0.004);
  });

  it("swings out to the right in a left turn (40 km/h, 30 m radius) and back after it", () => {
    const { between } = run(["plush"], 9, (t, car) => {
      const v = 40 / 3.6;
      car.yawRate = t > 1 && t < 5 ? v / 30 : 0;
      car.v.set(Math.sin(car.yaw) * v, 0, Math.cos(car.yaw) * v);
    });
    // 4.1 m/s² to the left: 23° outward at equilibrium.
    expect(min(between(1, 5), "side")).toBeLessThan(-20);
    expect(max(between(1, 5), "side")).toBeLessThan(2);
    expect(Math.max(...between(8, 9).map((r) => Math.abs(r.side)))).toBeLessThan(2);
  });

  it("leans back toward the driver when accelerating, stopped by the mirror housing", () => {
    const { between } = run(["plush"], 5, (t, car) => {
      car.v.z = Math.min(50 / 3.6, t * 2.5);
    });
    // 2.5 m/s² would lean it 14°; the cord comes to rest on the housing's lower edge first.
    expect(min(between(0.5, 5))).toBeLessThan(-5);
    expect(min(between(0.5, 5))).toBeGreaterThan(-14);
  });

  it("survives a crash (60 km/h to 0 in three steps): thrown up against the glass, the cord intact", () => {
    const { between, rows } = run(["plush"], 6, (t, car) => {
      const k = Math.floor((t - 1) / H);
      car.v.z = t < 1 ? 60 / 3.6 : k < 3 ? (60 / 3.6) * (1 - (k + 1) / 3) : 0;
    });
    expect(rows.every((r) => r.finite)).toBe(true);
    expect(max(between(1, 3))).toBeGreaterThan(60);
    expect(max(rows, "stretch")).toBeLessThan(0.01);
    expect(Math.max(...between(5, 6).map((r) => Math.abs(r.fwd)))).toBeLessThan(3);
  });

  it("is hung up afresh after a teleport, and carried on unchanged when the frame is re-anchored", () => {
    const teleported = run(["plush"], 3, (t, car) => {
      if (t < 1.5) {
        car.v.set(0, 0, 60 / 3.6);
        car.yawRate = 0.3;
        return;
      }
      if (Math.abs(t - 1.5) < H / 2) {
        car.at.set(500, 0, 200);
        car.yaw = 1.2;
      }
      car.v.set(0, 0, 0);
      car.yawRate = 0;
    });
    expect(
      Math.max(...teleported.between(1.52, 3).map((r) => Math.abs(r.fwd) + Math.abs(r.side))),
    ).toBeLessThan(0.05);
    const recentred = run(["plush"], 4, (t, car) => {
      car.v.z = 50 / 3.6;
      if (Math.abs(t - 2) < H / 2) car.at.z -= 1500;
    });
    expect(recentred.rig.lastStep).toBe("move");
    expect(Math.max(...recentred.rows.map((r) => Math.abs(r.fwd)))).toBeLessThan(0.05);
  });

  it("hangs the お守り and the bear side by side, leaning on each other and then still", () => {
    const rig = new CharmRig(DEFAULT_CABIN, ["omamori", "plush"]);
    rigs.push(rig);
    const still = sample();
    rig.follow(still, 0);
    for (let i = 0; i < 180; i++) rig.follow(still, H);
    const settled = rig.poses().map((p) => p.position.clone());
    for (let i = 0; i < 60; i++) rig.follow(still, H);
    const later = rig.poses();
    expect(later[0].position.distanceTo(settled[0])).toBeLessThan(0.00005);
    expect(later[1].position.distanceTo(settled[1])).toBeLessThan(0.00005);
    // Pouch on the driver's side (−X), the bear beside it, kept apart by their contact.
    expect(later[0].position.x).toBeLessThan(later[1].position.x - 0.02);
  });
});

/** This browser's storage holding a saved ミラーの飾り. */
const stored = (value: unknown) =>
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ charm: value }), setItem: () => {} });

describe("ミラーの飾り in the settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to the bear and keeps a stored choice, anything else falling back", () => {
    expect(DEFAULT_PREFS.charm).toBe("plush");
    expect(charmOf("both")).toBe("both");
    expect(charmOf("none")).toBe("none");
    expect(charmOf("dragon")).toBe("plush");
    expect(charmOf(undefined)).toBe("plush");
    stored("omamori");
    expect(loadPrefs().charm).toBe("omamori");
    stored(42);
    expect(loadPrefs().charm).toBe("plush");
  });
});
