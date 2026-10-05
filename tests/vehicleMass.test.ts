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

import {
  ADULT_KG,
  laden,
  OFFICER_KG,
  personKg,
  RIDER_KG,
  VEHICLE_SPECS,
  type MassClass,
} from "../src/physics/masses";
import { Vehicle, type Occupant } from "../src/physics/vehicle";
import { pedestrianKg } from "../src/world/pedestrians";

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
const BIKE = { halfWidth: 0.42, halfLength: 1.1 };

/** A car of a class on a flat 8 km road, settled on its springs. */
function carOf(cls: MassClass, occupants: Occupant[]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 0.5, 4000).setTranslation(0, -0.5, 0));
  const car = new Vehicle(world, cls === "shirobai" ? BIKE : {}, cls);
  car.setOccupants(occupants);
  car.teleport(new Vector3(0, 0.9, -3500), 0);
  const step = (throttle: number, brake: number) => {
    car.update(DT, { throttle, brake, steer: 0, handbrake: false, brakeOnly: true });
    world.step();
  };
  for (let i = 0; i < 120; i++) step(0, 0);
  return { world, car, step };
}

/** Seconds from a standstill to `kmh` at full throttle. */
function timeTo(cls: MassClass, occupants: Occupant[], kmh: number): number {
  const { car, step } = carOf(cls, occupants);
  for (let t = 0; t < 40; t += DT) {
    step(1, 0);
    if (car.speedKmh() >= kmh) return t;
  }
  return Infinity;
}

/** Metres to a stop at full brake from `kmh` (reached on the throttle first). */
function stoppingFrom(cls: MassClass, occupants: Occupant[], kmh: number): number {
  const { car, step } = carOf(cls, occupants);
  for (let t = 0; t < 40 && car.speedKmh() < kmh; t += DT) step(1, 0);
  const from = car.position();
  for (let t = 0; t < 20 && car.speedKmh() > 0.3; t += DT) step(0, 1);
  return car.position().distanceTo(from);
}

const DRIVER: Occupant[] = [{ seat: "driver", kg: ADULT_KG }];
const OFFICERS: Occupant[] = [
  { seat: "driver", kg: OFFICER_KG },
  { seat: "front", kg: OFFICER_KG },
];
const RIDER: Occupant[] = [{ seat: "rider", kg: RIDER_KG }];

/** A class's mass with nobody aboard. */
const curb = (cls: MassClass) => new Vehicle(new RAPIER.World({ x: 0, y: -9.81, z: 0 }), {}, cls).massKg;

describe("vehicle masses from the published figures (masses.ts)", () => {
  it("gives the player's car, the robotaxi and the police their class's curb weight", () => {
    // カローラ スポーツ G"Z", JPN TAXI 匠, 15 代目クラウン, CB1300 SB ABS + 白バイの装備.
    expect(curb("playerCar")).toBe(1390);
    expect(curb("jpnTaxi")).toBe(1420);
    expect(curb("patrol")).toBe(1690);
    expect(curb("unmarked")).toBe(1690);
    expect(curb("shirobai")).toBe(291);
    for (const cls of ["playerCar", "jpnTaxi", "patrol", "shirobai"] as MassClass[]) {
      expect(VEHICLE_SPECS[cls].source.length).toBeGreaterThan(10);
    }
  });

  it("loads traffic with its driver, passengers or freight, by the car's own number", () => {
    expect(laden("sedan", 0)).toBeCloseTo(1350 + ADULT_KG, 5);
    const buses = [0, 400, 800].map((n) => laden("bus", n));
    // 9.7 t empty plus 6–41 people: 10.1–12.2 t.
    for (const kg of buses) expect(kg).toBeGreaterThan(10_000);
    for (const kg of buses) expect(kg).toBeLessThan(12_300);
    expect(laden("truck10t", 800)).toBeGreaterThan(laden("truck10t", 0));
    expect(laden("truck10t", 800)).toBeLessThanOrEqual(11_340 + 13_500 + ADULT_KG);
  });

  it("weighs the crowd by age, sex and height at the 国民健康・栄養調査 means", () => {
    // 40 代男性 1.715 m at BMI 24.7: the table's mean weight is 72.8 kg.
    expect(personKg("40代", false)).toBeCloseTo(72.6, 0);
    expect(personKg("70代", true)).toBeCloseTo(51.1, 0);
    const kgs = Array.from({ length: 400 }, (_, i) => pedestrianKg(i + 1, 0.92 + ((i + 1) % 7) * 0.025));
    const mean = kgs.reduce((a, b) => a + b, 0) / kgs.length;
    expect(mean).toBeGreaterThan(55);
    expect(mean).toBeLessThan(66);
    expect(Math.min(...kgs)).toBeGreaterThan(38);
    expect(Math.max(...kgs)).toBeLessThan(90);
  });
});

describe("occupants change the car's mass and centre of mass (Vehicle.setOccupants)", () => {
  it("adds the driver on the right, the taxi's passenger behind on the left, two officers", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const player = new Vehicle(world, {}, "playerCar");
    const empty = player.body.localCom();
    player.setOccupants(DRIVER);
    expect(player.massKg).toBeCloseTo(1390 + ADULT_KG, 5);
    expect(player.body.mass()).toBeCloseTo(1390 + ADULT_KG, 1);
    const driven = player.body.localCom();
    // 右ハンドル: the driver is on the chassis' −X side.
    expect(driven.x).toBeLessThan(empty.x - 0.01);
    player.setOccupants([]);
    expect(player.body.mass()).toBeCloseTo(1390, 1);
    expect(player.body.localCom().x).toBeCloseTo(empty.x, 5);

    const taxi = new Vehicle(world, { taxi: true }, "jpnTaxi");
    const before = taxi.body.localCom();
    taxi.setOccupants([{ seat: "rearLeft", kg: ADULT_KG }]);
    expect(taxi.body.mass()).toBeCloseTo(1420 + ADULT_KG, 1);
    expect(taxi.body.localCom().x).toBeGreaterThan(before.x + 0.01);
    expect(taxi.body.localCom().z).toBeLessThan(before.z - 0.03);

    const patrol = new Vehicle(world, {}, "patrol");
    patrol.setOccupants(OFFICERS);
    expect(patrol.body.mass()).toBeCloseTo(1690 + 2 * OFFICER_KG, 1);
    // One on each side: the centre stays on the middle line.
    expect(Math.abs(patrol.body.localCom().x)).toBeLessThan(0.005);

    const bike = new Vehicle(world, BIKE, "shirobai");
    const low = bike.body.localCom().y;
    bike.setOccupants(RIDER);
    expect(bike.body.mass()).toBeCloseTo(291 + RIDER_KG, 1);
    expect(bike.body.localCom().y).toBeGreaterThan(low + 0.05);
  });

  it("keeps the ride height whatever the load (Rapier scales the springs by the mass)", () => {
    const empty = carOf("patrol", []).car.position().y;
    const full = carOf("patrol", OFFICERS).car.position().y;
    expect(Math.abs(full - empty)).toBeLessThan(0.01);
    const bike = carOf("shirobai", RIDER).car.position().y;
    expect(Math.abs(bike - empty)).toBeLessThan(0.01);
  });
});

describe("acceleration and braking by each class's power and brakes", () => {
  it("pulls away as such cars do: 0–100 km/h in 6–13 s, a 白バイ quicker", () => {
    const corolla = timeTo("playerCar", DRIVER, 100);
    const taxi = timeTo("jpnTaxi", [{ seat: "rearLeft", kg: ADULT_KG }], 100);
    const crown = timeTo("patrol", OFFICERS, 100);
    const bike = timeTo("shirobai", RIDER, 100);
    for (const t of [corolla, taxi, crown]) {
      expect(t).toBeGreaterThan(6);
      expect(t).toBeLessThan(13);
    }
    expect(bike).toBeLessThan(crown);
    // 180 kW in 1.84 t against 74 kW (system) in 1.48 t.
    expect(crown).toBeLessThan(corolla);
    expect(corolla).toBeLessThan(taxi);
    // A heavier load is slower, but never undrivable.
    const heavy = timeTo(
      "playerCar",
      [...DRIVER, { seat: "front", kg: 80 }, { seat: "rearLeft", kg: 80 }],
      100,
    );
    expect(heavy).toBeGreaterThan(corolla);
    expect(heavy).toBeLessThan(13);
  });

  it("stops from 100 km/h in about 36–45 m (0.8 g), the 白バイ a little longer", () => {
    for (const cls of ["playerCar", "jpnTaxi", "patrol"] as MassClass[]) {
      const d = stoppingFrom(cls, cls === "patrol" ? OFFICERS : DRIVER, 100);
      expect(d).toBeGreaterThan(32);
      expect(d).toBeLessThan(45);
    }
    const bike = stoppingFrom("shirobai", RIDER, 100);
    expect(bike).toBeGreaterThan(36);
    expect(bike).toBeLessThan(52);
  });
});
