import { Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Pedestrian } from "../src/world/pedestrians";
import { judgePedestrianBlow } from "../src/game/pedestrianBlow";

/** A 60 kg person walking at 5 km/h into the player's car: the blow massContacts.ts gives back. */
const walkingInto = { dvCar: 0.06 / 3.6, dvOther: 4.8 / 3.6 };
/** The car at 30 km/h hitting a standing person (Δv ≈ 0.96 of the speed, massContacts.test.ts). */
const hitAt30 = { dvCar: 1.2 / 3.6, dvOther: 28.8 / 3.6 };

describe("whether a blow with a person is the driver's accident", () => {
  it("is not an accident when a person walks into the standing car, however fast they close", () => {
    // The car's own speed after the blow is the shove the person gave it.
    expect(judgePedestrianBlow(0.2, walkingInto).isAccident).toBe(false);
    // A runner closing at 15 km/h is still their own bump.
    expect(judgePedestrianBlow(0, { dvCar: 0.2 / 3.6, dvOther: 14 / 3.6 }).isAccident).toBe(false);
  });

  it("is an accident when the moving car knocks a person down, as before", () => {
    const judged = judgePedestrianBlow(29, hitAt30);
    expect(judged.isAccident).toBe(true);
    // The speed booked is the car's own going into the blow, not the closing speed.
    expect(judged.carKmh).toBeCloseTo(30.2, 1);
    expect(judged.victimKmh).toBeCloseTo(28.8, 1);
  });

  it("counts a creeping car (above 1 km/h) as moving: only a standstill is the person's own bump", () => {
    expect(judgePedestrianBlow(2, walkingInto).isAccident).toBe(true);
    expect(judgePedestrianBlow(-2, walkingInto).isAccident).toBe(true); // reversing
  });

  it("is not an accident when the person is only nudged, even by a moving car", () => {
    expect(judgePedestrianBlow(10, { dvCar: 0, dvOther: 2 / 3.6 }).isAccident).toBe(false);
  });
});

describe("leaving the scene of an accident (ひき逃げ)", () => {
  let EmergencyResponse: typeof import("../src/game/emergency").EmergencyResponse;
  let LEAVE_DISTANCE: number;

  beforeAll(async () => {
    // The responders' side panels are drawn on a canvas; nothing is drawn in Node.
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    ({ EmergencyResponse, LEAVE_DISTANCE } = await import("../src/game/emergency"));
  });

  const scene = () => {
    const emergency = new EmergencyResponse(new Scene(), { siren: () => {} }, () => 0);
    const victim = { object: { position: new Vector3(0, 0, 0) } } as unknown as Pedestrian;
    emergency.start(victim, 0);
    return emergency;
  };
  const dt = 1 / 60;
  /** Drives the player from `from` along +x at `speed` m/s for `metres`; returns the events. */
  const drive = (emergency: ReturnType<typeof scene>, from: Vector3, speed: number, metres: number) => {
    const events: string[] = [];
    const at = from.clone();
    const frames = Math.ceil(metres / (speed * dt));
    for (let i = 0; i <= frames; i++) {
      const event = emergency.update(dt, i * dt * 1000, at, speed, () => {});
      if (event) events.push(event.type);
      at.x += speed * dt;
    }
    return { events, at };
  };

  it("books ひき逃げ when the player drives more than 80 m away without calling 119", () => {
    const emergency = scene();
    const { events } = drive(emergency, new Vector3(2, 0, 0), 10, LEAVE_DISTANCE + 5);
    expect(events).toContain("hitAndRun");
    expect(emergency.chasing).toBe(true);
  });

  it("does not book ひき逃げ while the player stays within 80 m", () => {
    const emergency = scene();
    const { events } = drive(emergency, new Vector3(2, 0, 0), 10, LEAVE_DISTANCE - 10);
    expect(events).not.toContain("hitAndRun");
  });

  it("does not count a jump (移動, 復帰, debug place) away from the scene as leaving it", () => {
    const emergency = scene();
    expect(emergency.update(dt, 0, new Vector3(2, 0, 0), 0, () => {})).toBeNull();
    // Put down 1.2 km away, standing.
    const far = new Vector3(1200, 0, 300);
    for (let i = 1; i <= 120; i++) {
      expect(emergency.update(dt, i * dt * 1000, far, 0, () => {})).toBeNull();
    }
    expect(emergency.chasing).toBe(false);
    expect(emergency.active).toBe(true);
  });

  it("still books ひき逃げ when the player then drives 80 m on from where they were put down", () => {
    const emergency = scene();
    emergency.update(dt, 0, new Vector3(2, 0, 0), 0, () => {});
    const { events } = drive(emergency, new Vector3(1200, 0, 300), 10, LEAVE_DISTANCE + 5);
    expect(events).toContain("hitAndRun");
  });

  it("keeps a fast car's frames as driving, not as jumps", () => {
    const emergency = scene();
    // 120 km/h on the expressway at 15 frames a second: 2.2 m a frame, well under the jump.
    const events: string[] = [];
    const at = new Vector3(2, 0, 0);
    const speed = 120 / 3.6;
    for (let i = 0; i < 60; i++) {
      const event = emergency.update(1 / 15, (i * 1000) / 15, at, speed, () => {});
      if (event) events.push(event.type);
      at.x += speed / 15;
    }
    expect(events).toContain("hitAndRun");
  });
});
