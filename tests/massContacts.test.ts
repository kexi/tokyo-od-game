import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The real physics car, without its glTF body (loaded by the browser): wheels and lamps only.
vi.mock("../src/game/carModel", () => ({
  WHEEL_RADIUS: 0.36,
  createCarModel: () => {
    const wheels = [0, 1, 2, 3].map(() => new Group().add(new Group()));
    return { root: new Group(), wheels, headlights: [], setLights: () => {} };
  },
}));

import { injuryViolation } from "../src/game/traffic";
import { centralImpact, MassiveBody, massContactsFor, restitution } from "../src/physics/massContacts";
import { ADULT_KG, laden, VEHICLE_SPECS, yawInertia } from "../src/physics/masses";
import { Vehicle } from "../src/physics/vehicle";

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;

type Target = { body: RAPIER.RigidBody; collider: RAPIER.Collider; mass: MassiveBody };

/**
 * The player's car (with its driver) driving at `kmh` along +Z into a kinematic body with a mass,
 * on a flat road, the game's way round: world.step, then massContacts.afterStep; the target's
 * owner moves it by its shove each step, as TrafficAI and Pedestrians do each frame.
 */
function crash(kmh: number, makeTarget: (world: RAPIER.World) => Target, seconds = 1.5) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const contacts = massContactsFor(world);
  const car = new Vehicle(world);
  car.setOccupants([{ seat: "driver", kg: ADULT_KG }]);
  car.teleport(new Vector3(0, 0.9, 0), 0);
  for (let i = 0; i < 90; i++) {
    car.update(DT, { throttle: 0, brake: 1, steer: 0, handbrake: false, brakeOnly: true });
    world.step();
  }
  const target = makeTarget(world);
  contacts.add(target.collider, target.mass);
  const events = new RAPIER.EventQueue(true);
  car.body.setLinvel({ x: 0, y: 0, z: kmh / 3.6 }, true);
  let started = 0;
  // Coasting (no pedal: the game's light rolling brake) through the blow.
  for (let t = 0; t < seconds; t += DT) {
    car.update(DT, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    world.step(events);
    contacts.afterStep(DT);
    const m = target.mass;
    if (m.shoved) {
      const p = target.body.translation();
      target.body.setNextKinematicTranslation({ x: p.x + m.vx * DT, y: p.y, z: p.z + m.vz * DT });
      m.slow(DT);
      m.x = p.x + m.vx * DT;
      m.z = p.z + m.vz * DT;
    }
    events.drainCollisionEvents((h1, h2, isStart) => {
      const isOurs = [h1, h2].includes(car.chassis.handle) && [h1, h2].includes(target.collider.handle);
      if (isStart && isOurs) started++;
    });
  }
  return { car, impact: contacts.recentImpact(target.collider.handle, 10_000), started, target };
}

/** A standing pedestrian (the game's capsule) 6 m ahead. */
const pedestrian = (kg: number) => (world: RAPIER.World) => {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.9, 6));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(0.55, 0.28).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  const mass = new MassiveBody(kg, kg * 0.025, 0.6 * 9.81, "person");
  mass.setMotion(0, 6, 0, 0, 0);
  return { body, collider, mass };
};

/** A parked vehicle of `kg` across the lane, 8 m ahead (the car hits its side). */
const parked = (kg: number, length: number, width: number, height: number) => (world: RAPIER.World) => {
  const z = 8 + width / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(0, 0.86, z)
      .setRotation({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, height / 2, length / 2).setTranslation(0, height / 2 - 0.86, 0),
    body,
  );
  const mass = new MassiveBody(kg, yawInertia(kg, length, width), 0.35 * 9.81, "vehicle");
  mass.setMotion(0, z, 0, 0, 0);
  return { body, collider, mass };
};

describe("collisions by both masses (massContacts.ts)", () => {
  it("lets a 60 kg pedestrian barely slow a car at 30 km/h, and throws them at nearly its speed", () => {
    const { car, impact, started } = crash(30, pedestrian(60), 0.5);
    // The same half second with nobody in the way (the target far off the road).
    const free = crash(
      30,
      (world) => {
        const t = pedestrian(60)(world);
        t.body.setTranslation({ x: 50, y: 0.9, z: 6 }, true);
        return t;
      },
      0.5,
    ).car.forwardSpeed();
    expect(started).toBeGreaterThan(0);
    expect(impact).not.toBeNull();
    if (!impact) return;
    // The car loses 60/(1450+60) of its speed at the blow (≈ 1.2 km/h), plus half a second's rolling.
    expect(impact.dvCar * 3.6).toBeLessThan(2);
    expect(car.forwardSpeed() / free).toBeGreaterThan(0.95);
    // Carried at the car's speed: Δv = m_car/(m_car + 60)·v, about 0.96 of the closing speed (the
    // car has coasted to about 27 km/h by the time it gets there).
    expect(impact.closing * 3.6).toBeGreaterThan(25);
    expect(impact.dvOther / impact.closing).toBeGreaterThan(0.93);
    expect(impact.dvOther / impact.closing).toBeLessThan(1);
  });

  it("gives clearly different Δv for a parked kei car and a bus", () => {
    const kei = crash(30, parked(VEHICLE_SPECS.kei.curbKg, 3.4, 1.48, 1.8));
    const bus = crash(30, parked(laden("bus", 0), 10.43, 2.49, 3.05));
    expect(kei.impact && bus.impact).toBeTruthy();
    if (!kei.impact || !bus.impact) return;
    // Kei: about 970/(1450+970) of the closing speed (and a little bounce) on the car; bus: nearly all.
    expect(bus.impact.dvCar).toBeGreaterThan(2 * kei.impact.dvCar);
    expect(kei.impact.dvOther).toBeGreaterThan(4 * bus.impact.dvOther);
    // Into the kei car the car carries on pushing it; the bus stops it, or bounces it back.
    expect(kei.car.forwardSpeed()).toBeGreaterThan(0.5);
    expect(bus.car.forwardSpeed()).toBeLessThan(0.5);
    expect(kei.target.body.translation().z).toBeGreaterThan(8 + 0.74 + 0.5);
  });

  it("still reports the contact as a collision event (the solver groups only drop the forces)", () => {
    expect(crash(20, parked(1350, 4.3, 1.84, 1.2)).started).toBeGreaterThan(0);
  });
});

/** The speed (km/h) a blow at `kmh` gives a person, from both masses. */
const victimKmh = (strikerKg: number, kmh: number, victimKg = 60) => {
  const closing = kmh / 3.6;
  return centralImpact(strikerKg, victimKg, closing, restitution(closing, "person")).dv2 * 3.6;
};

/** Energy (J) a 60 kg person takes from a striker of `kg` at 22 km/h. */
const energy = (kg: number) => centralImpact(kg, 60, 22 / 3.6, 0).energy;

describe("injury severity from the blow, not the car's speed", () => {
  it("keeps the old tiers for a car hitting a pedestrian (Δv ≈ 0.96 of the speed)", () => {
    const car = 1390 + ADULT_KG;
    expect(injuryViolation(victimKmh(car, 15)).points).toBe(3);
    expect(injuryViolation(victimKmh(car, 30)).points).toBe(6);
    expect(injuryViolation(victimKmh(car, 50)).points).toBe(9);
    expect(injuryViolation(victimKmh(car, 70)).points).toBe(13);
  });

  it("hurts more from a heavier vehicle at the same speed, less from a light one", () => {
    const bike = VEHICLE_SPECS.motorbike.curbKg + ADULT_KG;
    const car = 1390 + ADULT_KG;
    const bus = laden("bus", 400);
    // At 22 km/h: a car gives 21 km/h (6 points), a 250 cc bike with its rider 17.6 km/h (3 points).
    expect(injuryViolation(victimKmh(car, 22)).points).toBe(6);
    expect(injuryViolation(victimKmh(bike, 22)).points).toBe(3);
    expect(victimKmh(bus, 22)).toBeGreaterThan(victimKmh(car, 22));
    // And the energy taken by the person grows with the striker's mass at the same speed.
    expect(energy(bus)).toBeGreaterThan(energy(car));
    expect(energy(car)).toBeGreaterThan(energy(bike));
    // A child (30 kg) takes more Δv than a heavy adult (90 kg) from the same bike.
    expect(victimKmh(bike, 22, 30)).toBeGreaterThan(victimKmh(bike, 22, 90));
  });

  it("bounces cars off each other a little at low speed and hardly at all in a hard crash", () => {
    expect(restitution(5 / 3.6, "vehicle")).toBeCloseTo(0.4, 5);
    expect(restitution(60 / 3.6, "vehicle")).toBeCloseTo(0.1, 5);
    expect(restitution(30 / 3.6, "person")).toBe(0);
  });
});
