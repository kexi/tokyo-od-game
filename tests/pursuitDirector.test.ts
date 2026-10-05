import { Object3D, Quaternion, Vector3 } from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { decideSanction } from "../src/game/sanctions";
import type { PolicePatrol } from "../src/game/policePatrol";
import { BEHIND_M, PursuitDirector, SPOT_CLEAR_M, type PursuitHost } from "../src/game/pursuitDirector";
import type { PursuitScene } from "../src/game/pursuitScene";
import { HELI, heliStation, stepHeli } from "../src/game/pursuitScene";
import type { StopPhase } from "../src/game/socialTexts";
import type { ChoiceId } from "../src/game/trafficStop";
import { TrafficLaw, VIOLATIONS } from "../src/game/traffic";
import { recentLogs } from "../src/log";

/** A police unit as the director drives it (no physics): where it is and what state it is in. */
class FakeUnit {
  managed = false;
  target: Vector3 | null = null;
  seen: import("../src/game/traffic").ViolationRecord[] = [];
  state = "pursuing";
  releasedAt: number | null = null;
  readonly car = { object: new Object3D(), yaw: () => 0 };
  constructor(
    readonly kind: "patrol" | "shirobai" | "unmarked",
    readonly position: Vector3,
  ) {}
  placeAt(at: Vector3): void {
    this.position.copy(at);
    this.state = "ticketing";
  }
  hold(): void {
    this.state = "ticketing";
  }
  join(target: Vector3): void {
    this.state = "pursuing";
    this.managed = true;
    this.target = target;
  }
  giveUp(): void {
    this.state = "cruising";
    this.managed = false;
  }
  release(): void {
    this.state = "leaving";
    this.managed = false;
    this.releasedAt = 0;
  }
  /** Whether an officer is out of the car (their mass off the car's). */
  officerOut = false;
  setOfficerOut(out: boolean): void {
    this.officerOut = out;
  }
}

/** The scene's parts the director drives, with the officer's walk timed in seconds. */
class FakeScene {
  shot: string | null = null;
  choices: ChoiceId[] = [];
  onChoice: ((id: ChoiceId) => void) | null = null;
  heliEntered = 0;
  readonly heli = {
    active: false,
    state: "off",
    root: new Object3D(),
    update: () => undefined,
    enter: () => {
      this.heliEntered++;
      this.heli.active = true;
      this.heli.state = "in";
    },
    leave: () => {
      this.heli.state = "out";
    },
  };
  readonly checkpoint = {
    active: false,
    update: () => undefined,
    contains: () => false,
    place: () => (this.checkpoint.active = true),
    carSpot: () => ({ at: new Vector3(0, 0, 300), yaw: 0 }),
    clear: () => (this.checkpoint.active = false),
    officerPosition: () => null,
  };
  readonly officer = {
    model: null as object | null,
    state: "gone" as "walk" | "stand" | "back" | "gone",
    walked: 0,
    start: () => {
      this.officer.model = {};
      this.officer.state = "walk";
      this.officer.walked = 0;
    },
    back: () => {
      this.officer.state = "back";
      this.officer.walked = 0;
    },
    update: (dt: number) => {
      const o = this.officer;
      if (o.state !== "walk" && o.state !== "back") return;
      o.walked += dt;
      if (o.walked < 2) return;
      if (o.state === "walk") o.state = "stand";
      else this.officer.clear();
    },
    clear: () => {
      this.officer.model = null;
      this.officer.state = "gone";
    },
    setVisible: () => undefined,
    position: null,
  };
  setShot(shot: string | null): void {
    this.shot = shot;
  }
  showGuide(): void {}
  showDialogue(view: { choices: Array<{ id: ChoiceId }> } | null, onChoice?: (id: ChoiceId) => void): void {
    this.choices = view ? view.choices.map((c) => c.id) : [];
    this.onChoice = onChoice ?? null;
  }
  choosePrimary(): boolean {
    return false;
  }
  radio(): void {}
  showStory(): void {}
  drawStory(): void {}
  transform(): void {}
  onStoryNext: (() => void) | null = null;
  onStorySkip: (() => void) | null = null;
}

type World = {
  director: PursuitDirector;
  scene: FakeScene;
  units: FakeUnit[];
  law: TrafficLaw;
  player: { position: Vector3; speedKmh: number; throttle: number };
  ticket: (() => void) | null;
  posts: StopPhase[];
};

function world(): World {
  const scene = new FakeScene();
  const units: FakeUnit[] = [];
  const law = new TrafficLaw();
  const player = { position: new Vector3(), speedKmh: 0, throttle: 0 };
  const w = { scene, units, law, player, ticket: null, posts: [] } as unknown as World;
  const host: PursuitHost = {
    scene: scene as unknown as PursuitScene,
    player: () => ({
      position: player.position.clone(),
      quat: new Quaternion(),
      yaw: 0,
      forward: new Vector3(0, 0, 1),
      speedKmh: player.speedKmh,
      throttle: player.throttle,
    }),
    limit: () => 40,
    othersNear: () => 0,
    groundAt: () => 0,
    sight: () => true,
    night: () => false,
    month: () => 10,
    place: () => "千代田区 丸の内二丁目",
    graph: () => null,
    // The units only need one to drive off with (FakeUnit.release ignores it).
    driveWorld: () => ({}) as never,
    units: () => units as unknown as PolicePatrol[],
    spawnUnit: (kind, near) => {
      const u = new FakeUnit(kind, near.clone().add(new Vector3(300, 0, 0)));
      units.push(u);
      return u as unknown as PolicePatrol;
    },
    isClear: (p, radius, except) =>
      units.every((u) => u === (except as unknown) || u.position.distanceTo(p) >= radius) &&
      player.position.distanceTo(p) >= radius,
    stopPost: (phase) => {
      w.posts.push(phase);
      return true;
    },
    assist: () => "easy",
    leftSignalAgo: () => 0,
    hazards: () => true,
    setSignalLeft: () => undefined,
    setHazards: () => undefined,
    stopSite: () => ({ junction: false, crossing: false, noStopping: false, kerbGap: 0.3, rightLane: false }),
    law,
    book: (v, detail) => {
      const r = law.commit(v, performance.now(), 0, undefined);
      if (r) r.procedure = detail;
      if (r) w.director.witness(r);
      return r;
    },
    notify: () => undefined,
    toast: () => undefined,
    stamp: () => undefined,
    say: () => undefined,
    radioVoice: () => undefined,
    rotor: () => undefined,
    social: () => false,
    posts: () => [],
    tv: () => undefined,
    navAlert: () => undefined,
    chip: () => undefined,
    openTicket: (_records, onAccept) => {
      w.ticket = onAccept;
    },
    showClip: () => false,
    hitAndRunPending: () => false,
    endHitAndRunChase: () => undefined,
    endDay: () => undefined,
    arrestScreen: () => undefined,
    decideSanction: (points) => decideSanction(points, 0),
    keyOf: () => "G",
  };
  w.director = new PursuitDirector(host);
  return w;
}

/** Run the director `seconds` at 20 frames a second. */
function run(w: World, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) w.director.update(0.05, performance.now());
}

/** A unit `metres` behind the car that saw a red-light run and is on the car. */
function pursue(w: World, metres = 20): FakeUnit {
  const unit = new FakeUnit("patrol", new Vector3(0, 0, -metres));
  w.units.push(unit);
  const record = w.law.commit(VIOLATIONS.signal, performance.now(), 0);
  if (record) unit.seen.push(record);
  unit.managed = true;
  w.director.begin(unit as unknown as PolicePatrol);
  return unit;
}

/** Answer the officer with the first choice each time, accepting the ticket, until the stop ends. */
function answerAll(w: World): void {
  for (let i = 0; i < 40 && w.director.stop; i++) {
    run(w, 1);
    if (w.ticket) {
      const take = w.ticket;
      w.ticket = null;
      take();
    }
    const first = w.scene.choices[0];
    const fn = w.scene.onChoice;
    if (first && fn) fn(first);
  }
}

describe("the pursuit's director (pursuitDirector.ts)", () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it("stops the patrol car on a clear spot behind the car, not on another unit", () => {
    // Another unit already stands where the first spot would be.
    w.units.push(new FakeUnit("shirobai", new Vector3(0, 0, -BEHIND_M[0])));
    const unit = pursue(w, 18);
    run(w, 3);
    expect(w.director.stop).not.toBeNull();
    // 10 m is still within the clearance of the unit at 7.5 m: the next spot, 13 m.
    expect(-unit.position.z).toBe(BEHIND_M[2]);
    for (const other of w.units)
      if (other !== unit)
        expect(other.position.distanceTo(unit.position)).toBeGreaterThanOrEqual(SPOT_CLEAR_M);
  });

  it("walks the officer back and takes them out of the world when the stop ends, then lets the units go", () => {
    const unit = pursue(w);
    run(w, 3);
    expect(w.director.stop?.disposal).toBe("blue");
    answerAll(w);
    expect(w.director.stop).toBeNull();
    expect(w.scene.officer.model).toBeNull();
    expect(w.scene.shot).toBeNull();
    expect(unit.state).toBe("leaving");
    // People going past posted the car pulled over and the ticket.
    expect(w.posts).toEqual(["stopped", "ticket"]);
  });

  it("goes on by itself if the farewell is not answered", () => {
    pursue(w);
    run(w, 3);
    for (let i = 0; i < 30 && w.director.stop?.steps[w.director.stop.at]?.id !== "farewell"; i++) {
      run(w, 1);
      if (w.ticket) {
        const take = w.ticket;
        w.ticket = null;
        take();
      }
      const first = w.scene.choices[0];
      if (first && first !== "thanks") w.scene.onChoice?.(first);
    }
    expect(w.director.stop?.steps[w.director.stop.at]?.id).toBe("farewell");
    run(w, 16);
    expect(w.director.stop).toBeNull();
    expect(w.scene.officer.model).toBeNull();
  });

  it("never has a chase and a stop at once; a staged flee shows the stages, then the standing car gives up", () => {
    pursue(w);
    expect(w.director.debugAdvance(30)).toBe(true);
    run(w, 0.2);
    expect(w.director.debugAdvance(30)).toBe(true);
    for (let i = 0; i < 20 * 30; i++) {
      w.director.update(0.05, performance.now());
      const isBoth = w.director.chase !== null && w.director.stop !== null;
      expect(isBoth).toBe(false);
      if (w.director.chase) expect(w.director.chase.esc.stage).toBe(3);
    }
    expect(w.scene.heliEntered).toBe(1);
    // The car never moved: after the staged seconds it is a stop by a driver who had fled.
    expect(w.director.stop?.end).toBe("gaveUp");
    expect(w.director.stop?.fled).toBe(true);
    expect(w.director.stop?.disposal).toBe("red");
    expect(w.posts[0]).toBe("fledCaught");
  });

  it("logs the pursuit, the stop and the ticket as spans that lead back to the violation", () => {
    recentLogs.clear();
    const unit = pursue(w);
    const id = unit.seen[0]?.id;
    run(w, 3);
    answerAll(w);
    const chain = recentLogs.chain(`vio-${id}`);
    const events = chain.map((e) => e.event);
    expect(events).toEqual(
      expect.arrayContaining([
        "pursuit_begin",
        "pursuit_end",
        "stop_begin",
        "stop_ticket",
        "violation_cited",
        "stop_end",
      ]),
    );
    const begin = chain.find((e) => e.event === "pursuit_begin");
    const stop = chain.find((e) => e.event === "stop_begin");
    expect(begin).toMatchObject({ parentId: `vio-${id}`, violationIds: [id] });
    expect(stop?.parentId).toBe(begin?.spanId);
    expect(chain.find((e) => e.event === "stop_ticket")?.spanId).toBe(stop?.spanId);
    expect(chain.find((e) => e.event === "violation_cited")?.spanId).toBe(`vio-${id}`);
  });

  it("refuses a new pursuit while a stop is on, and clears a stray officer when one begins", () => {
    pursue(w);
    run(w, 6);
    expect(w.director.stop).not.toBeNull();
    const another = new FakeUnit("patrol", new Vector3(0, 0, -40));
    w.director.begin(another as unknown as PolicePatrol);
    expect(w.director.chase).toBeNull();
  });
});

/** Fly in from where enter() puts it toward a car going `kmh`; seconds until on station. */
function arrival(kmh: number): number {
  const car = new Vector3();
  const forward = new Vector3(0, 0, 1);
  const station = heliStation(car, forward, 0, 0);
  const pos = station
    .clone()
    .addScaledVector(forward, HELI.from)
    .setY(station.y + 40);
  const velocity = new Vector3();
  for (let t = 0; t < 120; t += 0.05) {
    car.z += (kmh / 3.6) * 0.05;
    const desired = heliStation(car, forward, 0, t);
    if (stepHeli(pos, velocity, desired, 0.05) < HELI.arrive) return t;
  }
  return Infinity;
}

describe("the helicopter's flight (pursuitScene.ts)", () => {
  it("reaches its station within half a minute, the car standing or driving at 50 km/h", () => {
    expect(arrival(0)).toBeLessThan(30);
    expect(arrival(50)).toBeLessThan(30);
  });

  it("keeps station low and far enough ahead to be in the chase camera's picture", () => {
    // The chase camera: 3.4 m up, 8.5 m behind, looking 11° down with a 31° half-height.
    const station = heliStation(new Vector3(), new Vector3(0, 0, 1), 0, 0);
    const elevation = (Math.atan2(station.y - 3.4, station.z + 8.5) * 180) / Math.PI;
    expect(elevation).toBeLessThan(31 - 11 - 3);
    expect(elevation).toBeGreaterThan(5);
  });
});
