import type RAPIER from "@dimforge/rapier3d-compat";
import { Group, Object3D, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FILM_RANGE, MAX_FILMERS, planFilming } from "../src/game/witnessPhones";
import { FILM_GRIP, type HumanModel } from "../src/world/human";
import { type Pedestrian, Pedestrians, profileFor } from "../src/world/pedestrians";

/** The joint layout of human.glb (pivots at the shoulders, elbows, hips and knees), without meshes. */
function fakeHuman(): HumanModel {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const limb = (x: number, y: number, drop: number) => {
    const upper = new Group();
    upper.position.set(x, y, 0);
    const lower = new Group();
    lower.position.set(0, -drop, 0);
    upper.add(lower);
    body.add(upper);
    return [upper, lower] as const;
  };
  const [armR, foreR] = limb(-0.235, 1.4, 0.27);
  const [armL, foreL] = limb(0.235, 1.4, 0.27);
  const [legR, shinR] = limb(-0.095, 0.86, 0.42);
  const [legL, shinL] = limb(0.095, 0.86, 0.42);
  return {
    root,
    body,
    legs: [legR, legL],
    shins: [shinR, shinL],
    arms: [armR, armL],
    forearms: [foreR, foreL],
    umbrella: new Group(),
  };
}

let nextId = 1;
function person(peds: Pedestrians, x: number, z: number, heading = 0): Pedestrian {
  const model = fakeHuman();
  model.root.position.set(x, 0, z);
  const p: Pedestrian = {
    profile: profileFor(nextId++),
    object: model.root,
    model,
    heading,
    speed: 1.2,
    phase: 0,
    state: "walk",
    stateTime: 0,
    filmFor: 0,
    phone: null,
    body: null,
    groundCheck: 0,
    walk: null,
    blocked: 0,
  };
  peds.list.push(p);
  return p;
}

/** A street with flat ground; `isBuilding` marks ground covered by a building. */
function street(isBuilding: (x: number, z: number) => boolean = () => false): Pedestrians {
  // No physics: everyone stays farther than the kinematic-body radius from the focus point.
  const peds = new Pedestrians(
    new Scene(),
    {} as RAPIER.World,
    () => 0,
    (x, z) => !isBuilding(x, z),
  );
  peds.crowd = 0;
  return peds;
}

const FOCUS = new Vector3(0, 0, 150);
const FORWARD = new Vector3(1, 0, 0);
function run(peds: Pedestrians, seconds: number, car: Vector3, carSpeed = 0): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) peds.update(dt, FOCUS, car, carSpeed, FORWARD);
}
const phone = () => new Object3D();
const angleTo = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

describe("bystanders filming a violation: who films", () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 8) / 0x1000000;
  };

  it("nobody films when nobody can see the car, even if a dashcam posted it", () => {
    expect(planFilming([], 1, true, Math.random)).toEqual([]);
  });

  it("the person who posted it filmed it: at least one filmer when anyone could see", () => {
    const plan = planFilming(["a", "b", "c"], 0.1, true, () => 0);
    expect(plan.map((f) => f.who)).toEqual(["a"]);
  });

  it("an accident makes most of the crowd film; mild speeding almost nobody", () => {
    const crowd = Array.from({ length: 8 }, (_, i) => i);
    let accident = 0;
    let speeding = 0;
    const rand = seeded(7);
    for (let i = 0; i < 50; i++) {
      accident += planFilming(crowd, 1, false, rand).length;
      speeding += planFilming(crowd, 0.1, false, rand).length;
    }
    expect(accident / 50).toBeGreaterThan(6);
    expect(speeding / 50).toBeLessThan(0.6);
  });

  it("never more filmers than people who could see, nor than the cap", () => {
    for (const n of [0, 1, 3, 20]) {
      const plan = planFilming(
        Array.from({ length: n }, (_, i) => i),
        1,
        true,
        () => 0.99,
      );
      expect(plan.length).toBeLessThanOrEqual(Math.min(n, MAX_FILMERS));
    }
  });

  it("the nearest film first", () => {
    const plan = planFilming(["near", "mid", "far"], 0.6, false, () => 0.5);
    expect(plan.map((f) => f.who)).toEqual(["near", "mid", "far"].slice(0, plan.length));
  });

  it("films a few seconds; some keep filming much longer for serious violations", () => {
    const mild = planFilming(["a", "b", "c"], 0.3, true, () => 0.5);
    for (const f of mild) expect(f.seconds).toBeLessThan(10);
    const serious = planFilming(["a", "b", "c", "d"], 0.95, false, () => 0.5);
    expect(Math.max(...serious.map((f) => f.seconds))).toBeGreaterThan(18);
    expect(Math.min(...serious.map((f) => f.seconds))).toBeLessThan(10);
  });
});

describe("bystanders filming a violation: who can see it", () => {
  it(`counts those within ${FILM_RANGE} m, nearest first`, () => {
    const peds = street();
    const far = person(peds, 0, 80);
    const mid = person(peds, 0, 30);
    const near = person(peds, 0, 10);
    expect(peds.witnessesOf(new Vector3(0, 0, 0), FILM_RANGE)).toEqual([near, mid]);
    expect(peds.witnessesOf(new Vector3(0, 0, 0), FILM_RANGE)).not.toContain(far);
  });

  it("not through a building, but past a parked car", () => {
    // A building 10–30 m along +Z; a 2 m wide car (one sample) along −Z.
    const peds = street((_x, z) => (z > 10 && z < 30) || (z < -9 && z > -11));
    const behindBuilding = person(peds, 0, 40);
    const behindCar = person(peds, 0, -20);
    const seen = peds.witnessesOf(new Vector3(0, 0, 0), FILM_RANGE);
    expect(seen).toContain(behindCar);
    expect(seen).not.toContain(behindBuilding);
  });

  it("not someone talking to the player or lying hurt", () => {
    const peds = street();
    const talking = person(peds, 5, 5);
    talking.state = "talk";
    const hurt = person(peds, -5, 5);
    hurt.state = "injured";
    expect(peds.witnessesOf(new Vector3(0, 0, 0), FILM_RANGE)).toEqual([]);
  });
});

describe("bystanders filming a violation: what they do", () => {
  const car = new Vector3(20, 0.6, 0);

  it("stops, turns to the car and holds the phone up in front of the face", () => {
    const peds = street();
    const p = person(peds, 0, 0, Math.PI); // facing away from the car
    const held = phone();
    expect(peds.startFilming(p, 6, () => held)).toBe(true);
    const at = p.object.position.clone();
    run(peds, 2, car);
    expect(p.state).toBe("film");
    expect(p.object.position.distanceTo(at)).toBe(0);
    expect(Math.abs(angleTo(p.heading, Math.PI / 2))).toBeLessThan(0.05); // the car is due +X
    expect(held.parent).toBe(p.model.body);
    expect(held.position.distanceTo(FILM_GRIP)).toBeLessThan(1e-6);
    // Both hands are on the phone's ends (the forearms are raised to it).
    p.object.updateMatrixWorld(true);
    const phoneAt = held.getWorldPosition(new Vector3());
    for (const fore of p.model.forearms) {
      const hand = fore.localToWorld(new Vector3(0, -0.315, 0));
      expect(hand.distanceTo(phoneAt)).toBeLessThan(0.1);
      expect(hand.y).toBeGreaterThan(p.model.arms[0].getWorldPosition(new Vector3()).y);
    }
  });

  it("follows the car with the phone as it drives past", () => {
    const peds = street();
    const p = person(peds, 0, 0);
    peds.startFilming(p, 10, phone);
    run(peds, 1, new Vector3(10, 0.6, 10));
    run(peds, 1, new Vector3(-10, 0.6, 10));
    expect(Math.abs(angleTo(p.heading, Math.atan2(-10, 10)))).toBeLessThan(0.05);
  });

  it("puts the phone away after the time and walks on", () => {
    const peds = street();
    const p = person(peds, 0, 0);
    const held = phone();
    peds.startFilming(p, 4, () => held);
    run(peds, 4.2, car);
    expect(p.state).toBe("walk");
    expect(p.phone).toBeNull();
    expect(held.parent).toBeNull();
    const at = p.object.position.clone();
    run(peds, 1, car);
    expect(p.object.position.distanceTo(at)).toBeGreaterThan(0.5);
  });

  it("stops early once the car has gone", () => {
    const peds = street();
    const p = person(peds, 0, 0);
    peds.startFilming(p, 30, phone);
    run(peds, 1, car);
    run(peds, 1, new Vector3(200, 0.6, 0));
    expect(p.state).toBe("walk");
  });

  it("someone already filming films on for longer instead of taking out a second phone", () => {
    const peds = street();
    const p = person(peds, 0, 0);
    peds.startFilming(p, 3, phone);
    run(peds, 2, car);
    let made = 0;
    expect(
      peds.startFilming(p, 5, () => {
        made++;
        return phone();
      }),
    ).toBe(false);
    expect(made).toBe(0);
    run(peds, 3, car);
    expect(p.state).toBe("film");
    run(peds, 2.5, car);
    expect(p.state).toBe("walk");
  });

  it("jumps aside without the phone when the car comes straight at them", () => {
    const peds = street();
    const p = person(peds, 0, 0);
    if (p.profile.id % 5 === 0) p.profile = profileFor(p.profile.id + 1); // some never dodge
    const held = phone();
    peds.startFilming(p, 10, () => held);
    run(peds, 1, car);
    // 10 m away along +X and heading at them at 15 m/s.
    peds.update(1 / 30, FOCUS, new Vector3(-10, 0.6, 0), 15, new Vector3(1, 0, 0));
    expect(p.state).toBe("dodge");
    expect(held.parent).toBeNull();
  });

  it("puts the phone away when the player talks to them", () => {
    const peds = street();
    const p = person(peds, 0, 0);
    const held = phone();
    peds.startFilming(p, 10, () => held);
    run(peds, 1, car);
    peds.startTalk(p, new Vector3(1, 0, 1));
    expect(p.state).toBe("talk");
    expect(held.parent).toBeNull();
  });
});
