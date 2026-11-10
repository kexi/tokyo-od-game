import { Scene, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Pedestrian } from "../src/world/pedestrians";

// Whether a blow is the driver's accident is tested with the real physics in massContacts.test.ts.

describe("leaving the scene of an accident (ひき逃げ, emergency.ts)", () => {
  let EmergencyResponse: typeof import("../src/game/emergency").EmergencyResponse;
  let LEAVE_DISTANCE: number;
  let REPORT_LIMIT_MS: number;

  beforeAll(async () => {
    // The responders' side panels are drawn on a canvas; nothing is drawn in Node.
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    ({ EmergencyResponse, LEAVE_DISTANCE, REPORT_LIMIT_MS } = await import("../src/game/emergency"));
  });

  const DT = 1 / 60;
  /** An accident at the origin at t = 0, the player beside the victim, and a clock to move them by. */
  const accident = () => {
    const emergency = new EmergencyResponse(new Scene(), { siren: () => {} }, () => 0);
    const victim = { object: { position: new Vector3(0, 0, 0) } } as unknown as Pedestrian;
    emergency.start(victim, 0);
    const player = new Vector3(2, 0, 0);
    let now = 0;
    const events: string[] = [];
    const frame = (speed: number) => {
      const event = emergency.update(DT, now, player, speed, () => {});
      if (event) events.push(event.type);
      now += DT * 1000;
    };
    return {
      emergency,
      player,
      events,
      now: () => now,
      /** Drives `metres` along `dir` at 10 m/s, frame by frame. */
      drive(metres: number, dir = new Vector3(1, 0, 0)) {
        const frames = Math.ceil(metres / (10 * DT));
        for (let i = 0; i < frames; i++) {
          player.addScaledVector(dir, 10 * DT);
          frame(10);
        }
      },
      /** Stands where they are for `seconds`. */
      wait(seconds: number) {
        for (let t = 0; t < seconds; t += DT) frame(0);
      },
      /** Put down elsewhere in one frame (移動, 復帰, debug place). */
      jump(to: Vector3) {
        player.copy(to);
        frame(0);
      },
    };
  };

  it("books ひき逃げ when the player drives more than 80 m away without calling 119", () => {
    const a = accident();
    a.wait(0.1);
    a.drive(LEAVE_DISTANCE + 5);
    expect(a.events).toContain("hitAndRun");
    expect(a.emergency.chasing).toBe(true);
  });

  it("does not book ひき逃げ while the player stays within 80 m and inside the deadline", () => {
    const a = accident();
    a.drive(LEAVE_DISTANCE - 10);
    a.wait(5);
    expect(a.events).not.toContain("hitAndRun");
  });

  it("books ひき逃げ when 119 is not called within the deadline at the scene", () => {
    const a = accident();
    a.wait(REPORT_LIMIT_MS / 1000 + 1);
    expect(a.events).toContain("hitAndRun");
  });

  it("holds the leaving check and the 119 deadline while a jump keeps the player away", () => {
    const a = accident();
    a.wait(10);
    const left = a.emergency.secondsLeft(a.now());
    a.jump(new Vector3(1200, 0, 300));
    // Well past the deadline, 1.2 km from the scene.
    a.wait(REPORT_LIMIT_MS / 1000 + 30);
    expect(a.events).not.toContain("hitAndRun");
    expect(a.emergency.chasing).toBe(false);
    expect(a.emergency.active).toBe(true);
    // (The second rounds up: the jump's own frame may tip it by one.)
    expect(a.emergency.secondsLeft(a.now())).toBeGreaterThanOrEqual(left - 1);
    // Driving about where they were put down is still being away by the jump.
    a.drive(200);
    expect(a.events).not.toContain("hitAndRun");
  });

  it("resumes once the player is back within 80 m, and then books ひき逃げ for driving 80 m away", () => {
    const a = accident();
    a.wait(0.1);
    a.jump(new Vector3(0, 0, 150));
    a.wait(90);
    // Back towards the scene by driving: within 80 m the hold ends.
    a.drive(100, new Vector3(0, 0, -1));
    expect(a.events).not.toContain("hitAndRun");
    a.drive(LEAVE_DISTANCE + 60, new Vector3(0, 0, 1));
    expect(a.events).toContain("hitAndRun");
  });

  it("leaves the held time out of the deadline after the player is back", () => {
    const a = accident();
    a.wait(30);
    a.jump(new Vector3(1200, 0, 0));
    a.wait(100);
    a.jump(new Vector3(2, 0, 0));
    a.wait(25);
    expect(a.events).not.toContain("hitAndRun");
    a.wait(10);
    expect(a.events).toContain("hitAndRun");
  });

  it("does not take a re-anchoring (the world and the player moved together) for a jump", () => {
    const a = accident();
    // 119 called: driving away is not ひき逃げ, so the player can be away without a jump.
    a.emergency.dispatch("ambulance", null);
    // (Before the ambulance, 130 m off, gets there in 12 s and the scene closes.)
    a.drive(LEAVE_DISTANCE + 5);
    const shift = new Vector3(-3000, 0, 1500);
    a.emergency.transform((p) => p.add(shift));
    a.player.add(shift);
    const before = a.emergency.secondsLeft(a.now());
    a.wait(2);
    // Not held: the deadline runs on.
    expect(a.emergency.active).toBe(true);
    expect(a.emergency.secondsLeft(a.now())).toBeLessThanOrEqual(before - 1);
  });

  it("does not take a fast car's frames for jumps (240 km/h at the longest frame, 0.05 s)", () => {
    const a = accident();
    const speed = 240 / 3.6;
    for (let i = 0; i < 40; i++) {
      a.player.x += speed * 0.05;
      a.emergency.update(0.05, i * 50, a.player, speed, () => {});
    }
    expect(a.emergency.chasing).toBe(true);
  });
});
