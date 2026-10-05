import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, type Group, type Object3D, type Scene } from "three";
import { animateHuman, createHuman, disposeHuman, FILM_GRIP, poseFilming, type HumanModel } from "./human";
import type { SidewalkNetwork, Walk } from "./sidewalks";

export type PedestrianProfile = {
  id: number;
  name: string;
  age: string;
  role: string;
  mood: string;
};

export type Pedestrian = {
  profile: PedestrianProfile;
  object: Group;
  model: HumanModel;
  heading: number;
  speed: number;
  phase: number;
  state: "walk" | "talk" | "fallen" | "dodge" | "injured" | "film";
  stateTime: number;
  /** While filming: stateTime at which the phone is back down (then they walk on). */
  filmFor: number;
  /** The phone held up while filming (a child of the body), or null. */
  phone: Object3D | null;
  body: RAPIER.RigidBody | null;
  groundCheck: number;
  /** On the pavement network; null for people wandering a plaza or park. */
  walk: Walk | null;
  /** Seconds spent held at a kerb they were not meant to step off. */
  blocked: number;
};

const FAMILY = [
  "佐藤",
  "鈴木",
  "高橋",
  "田中",
  "伊藤",
  "渡辺",
  "山本",
  "中村",
  "小林",
  "加藤",
  "吉田",
  "山田",
  "松本",
  "井上",
  "木村",
  "林",
  "清水",
  "斎藤",
];
const GIVEN = [
  "さくら",
  "健太",
  "美咲",
  "翔",
  "陽菜",
  "大輝",
  "結衣",
  "蓮",
  "葵",
  "悠斗",
  "花子",
  "誠",
  "真由美",
  "亮",
  "千尋",
  "勇気",
  "あおい",
  "修",
];
const AGES = ["10代", "20代", "30代", "40代", "50代", "60代", "70代"];
const ROLES = [
  "会社員",
  "大学生",
  "観光で来た人",
  "近所に住む人",
  "カフェの店員",
  "ジョギング中の人",
  "散歩中の人",
  "配達の途中の人",
  "お店の店主",
  "高校生",
  "仕事帰りの人",
  "旅行で来た外国出身の人",
];
const MOODS = [
  "明るくて話好き",
  "落ち着いていて丁寧",
  "ちょっと急いでいる",
  "のんびり屋",
  "物知りで少し自慢げ",
  "人見知りだけど親切",
];

// Filming the player's car with a phone (state "film").
const FILM_RAISE = 0.6; // seconds to get the phone out and up
const FILM_LOWER = 0.5; // seconds to put it away
const FILM_TRACK = 2.6; // rad/s: turning on the spot to keep the car in frame
const FILM_LOST = 120; // m: the car is gone, so they stop
// Sight lines: one ray per this many metres; two closed samples in a row are a building.
const SIGHT_STEP = 2.5;

const SPAWN_MIN = 30;
const SPAWN_MAX = 180;
const DESPAWN = 230;
const BODY_RADIUS = 70;

/** Deterministic profile from an id so the same NPC always has the same name and personality. */
export function profileFor(id: number): PedestrianProfile {
  const h = (n: number) => Math.abs(Math.imul(id + 1, 2654435761 + n * 97) >>> 0);
  return {
    id,
    name: `${FAMILY[h(1) % FAMILY.length]} ${GIVEN[h(2) % GIVEN.length]}`,
    age: AGES[h(3) % AGES.length],
    role: ROLES[h(4) % ROLES.length],
    mood: MOODS[h(5) % MOODS.length],
  };
}

const SHIRTS = [
  0xd94f45, 0x3d6fd9, 0xf2c14e, 0x4caf7a, 0xeeeeee, 0x333842, 0x9c5fd1, 0xf08bb0, 0x5aa9c9, 0xc98a4b,
];
const PANTS = [0x2b3445, 0x1e1e22, 0x5b4b3a, 0x7a8696, 0x3f5e3a];
const HAIR = [0x1a1410, 0x3b2a1f, 0x6b4a2f, 0x888888, 0xb08a5a];
const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68b62];

/**
 * Street crowd around the player. Most walk the pavements of the road network and cross at
 * crosswalks with the signals (SidewalkNetwork); people away from any street wander open ground
 * (ray-tested against building colliders). They dodge fast cars, can be bumped (kinematic
 * capsules near the car) and talked to.
 */
export class Pedestrians {
  readonly list: Pedestrian[] = [];
  /** Whether a point is in the camera's view (set by the game each frame). */
  isSeen: (p: Vector3) => boolean = () => false;
  private nextId = 1;
  private spawnSeed = 7;
  raining = false;
  /** Target crowd size; set from the 町丁 population density. */
  crowd = 30;
  private network: SidewalkNetwork | null = null;
  private car = { pos: new Vector3(), speed: 0, forward: new Vector3(0, 0, 1) };

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly isOpen: (x: number, z: number, groundY: number) => boolean,
  ) {}

  /** Re-anchoring moved the world: shift everyone by the same rigid transform. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    for (const p of this.list) {
      offset(p.object.position);
      p.heading += yawDelta;
      this.dropBody(p);
    }
  }

  /** New road network (area change or re-anchoring): everyone finds their street again. */
  setNetwork(network: SidewalkNetwork | null): void {
    this.network = network;
    for (const p of this.list) p.walk = null;
  }

  /** Pavement polygons arrived: walking lines are chosen again from the next street on. */
  pavementsChanged(): void {
    this.network?.forgetLaterals();
  }

  /** `focus` is where the player is (car or on foot); `car` is used for dodging. */
  update(dt: number, focus: Vector3, car: Vector3, carSpeed: number, carForward: Vector3): void {
    this.car.pos.copy(car);
    this.car.speed = carSpeed;
    this.car.forward.copy(carForward);
    this.fill(focus);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const pos = p.object.position;
      const dist = Math.hypot(pos.x - focus.x, pos.z - focus.z);
      // Only out of view (or far beyond it), so nobody vanishes in front of the camera.
      const isGone = dist > DESPAWN + 120 || (dist > DESPAWN && !this.isSeen(pos));
      if (isGone && p.state !== "injured") {
        this.remove(i);
        continue;
      }
      this.step(p, dt, car, carSpeed, carForward);
      const wantsBody = dist < BODY_RADIUS && p.state !== "fallen" && p.state !== "injured";
      if (wantsBody && !p.body) this.createBody(p);
      else if (!wantsBody) this.dropBody(p);
      p.body?.setNextKinematicTranslation({ x: pos.x, y: pos.y + 0.9, z: pos.z });
    }
  }

  /** Closest pedestrian within range of a point, for the talk prompt. */
  nearest(point: Vector3, range: number): Pedestrian | null {
    let best: Pedestrian | null = null;
    let bestD = range;
    for (const p of this.list) {
      if (p.state === "fallen" || p.state === "injured") continue;
      const d = p.object.position.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * People who can see `point` from where they stand: within `range`, on their feet and not busy
   * (talking, dodging, hurt), with no building in between. Nearest first. Those already filming
   * count (they film on).
   */
  witnessesOf(point: Vector3, range: number): Pedestrian[] {
    const isFree = (p: Pedestrian) => p.state === "walk" || p.state === "film";
    return this.list
      .filter((p) => isFree(p) && p.object.position.distanceTo(point) <= range)
      .filter((p) => this.hasSightLine(p.object.position, point))
      .toSorted((a, b) => a.object.position.distanceTo(point) - b.object.position.distanceTo(point));
  }

  /**
   * People walking across the carriageway in front of the car, within `range` metres ahead and a
   * lane or so either side: those a stopped car is letting cross (SocialFeed.maybePraise). Only
   * a crossing leg of the walk may step onto the carriageway, so being on it means crossing.
   */
  crossingAhead(car: Vector3, forward: Vector3, range: number): Pedestrian[] {
    const network = this.network;
    if (!network) return [];
    return this.list.filter((p) => {
      const pos = p.object.position;
      const dx = pos.x - car.x;
      const dz = pos.z - car.z;
      const ahead = dx * forward.x + dz * forward.z;
      const side = Math.abs(dx * forward.z - dz * forward.x);
      const isInFront = ahead > 1 && ahead < range && side < 4;
      return p.state === "walk" && isInFront && network.isRoadway(pos.x, pos.z);
    });
  }

  /**
   * Stop, turn to the car and film it for `seconds` (raising and lowering the phone included),
   * then walk on. Someone already filming just keeps at it for longer; `makePhone` is only called
   * for a new filmer. Returns whether this person started filming now.
   */
  startFilming(p: Pedestrian, seconds: number, makePhone: () => Object3D): boolean {
    if (p.state === "film") {
      p.filmFor = Math.max(p.filmFor, p.stateTime + seconds);
      return false;
    }
    const canFilm = p.state === "walk";
    if (!canFilm) return false;
    p.state = "film";
    p.stateTime = 0;
    p.filmFor = Math.max(FILM_RAISE + FILM_LOWER, seconds);
    p.phone = makePhone();
    return true;
  }

  /** Puts the phone away at once (dodging, being talked to, done). */
  stopFilming(p: Pedestrian): void {
    p.phone?.removeFromParent();
    p.phone = null;
    if (p.state !== "film") return;
    p.state = "walk";
    p.stateTime = 0;
  }

  /** How many are filming now. */
  filming(): number {
    return this.list.reduce((n, p) => n + (p.state === "film" ? 1 : 0), 0);
  }

  /**
   * Whether nothing big stands between a person (eye height) and a point. Samples the ground
   * every SIGHT_STEP metres with the same open-ground test the crowd walks by; one closed sample
   * is a parked car, a bus stop or a tree, two in a row (5 m and more) are a building.
   * Why not a ray between the two points: the colliders only know buildings as roofed volumes
   * hit from above, and isOpen already answers that for the pavements.
   */
  /**
   * An exact eye-to-point test through the solid world, set by the game (a ray through the building
   * and landmark colliders). Why preferred: the open-ground sampling below sees through walls that
   * have no roof, such as the landmarks' footprints.
   */
  lineOfSight: ((from: Vector3, to: Vector3) => boolean) | null = null;

  private hasSightLine(from: Vector3, to: Vector3): boolean {
    if (this.lineOfSight) return this.lineOfSight(from, to);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    // Skip the person's own spot and the last metres round the subject (the car itself).
    let closed = 0;
    for (let s = 1; s < dist - 3; s += SIGHT_STEP) {
      const x = from.x + (dx / dist) * s;
      const z = from.z + (dz / dist) * s;
      const g = this.groundAt(x, z);
      const isClosed = g !== null && !this.isOpen(x, z, g);
      closed = isClosed ? closed + 1 : 0;
      if (closed >= 2) return false;
    }
    return true;
  }

  /** Was this collider one of ours? Used to turn contacts into accident events. */
  byCollider(handle: number): Pedestrian | null {
    return this.list.find((p) => p.body && p.body.collider(0)?.handle === handle) ?? null;
  }

  /** Hit by a car: falls and stays down until the ambulance takes them (道路交通法 第72条). */
  knockDown(p: Pedestrian): void {
    if (p.state === "injured") return;
    p.state = "injured";
    p.stateTime = 0;
    this.dropBody(p);
  }

  /** Carried away by the ambulance. */
  rescue(p: Pedestrian): void {
    const i = this.list.indexOf(p);
    if (i >= 0) this.remove(i);
  }

  startTalk(p: Pedestrian, face: Vector3): void {
    this.stopFilming(p);
    p.state = "talk";
    p.heading = Math.atan2(face.x - p.object.position.x, face.z - p.object.position.z);
  }

  endTalk(p: Pedestrian): void {
    if (p.state === "talk") p.state = "walk";
  }

  private step(p: Pedestrian, dt: number, car: Vector3, carSpeed: number, carForward: Vector3): void {
    p.stateTime += dt;
    const pos = p.object.position;
    if (p.state === "injured") {
      const t = Math.min(1, p.stateTime / 0.4);
      p.object.rotation.set(t * (Math.PI / 2), p.heading, 0);
      return;
    }
    if (p.state === "fallen") {
      // Tip over, lie for a moment, then get back up.
      const t = p.stateTime;
      p.object.rotation.x =
        t < 0.4 ? (t / 0.4) * (Math.PI / 2) : t < 3 ? Math.PI / 2 : Math.max(0, Math.PI / 2 - (t - 3) * 2);
      if (t > 3.8) {
        p.state = "walk";
        p.object.rotation.x = 0;
      }
      return;
    }

    // A car coming at speed straight at them: hop aside (most of the time).
    const toPed = new Vector3(pos.x - car.x, 0, pos.z - car.z);
    const ahead = toPed.dot(carForward);
    const lateral = Math.abs(toPed.x * carForward.z - toPed.z * carForward.x);
    const isThreatened = carSpeed > 4 && ahead > 0 && ahead < carSpeed * 1.2 && lateral < 2.2;
    if (isThreatened && p.state !== "dodge" && p.profile.id % 5 !== 0) {
      this.stopFilming(p);
      p.state = "dodge";
      p.stateTime = 0;
      const side = toPed.x * carForward.z - toPed.z * carForward.x > 0 ? 1 : -1;
      p.heading = Math.atan2(carForward.z * side, -carForward.x * side);
    }
    if (p.state === "dodge" && p.stateTime > 0.9) p.state = "walk";
    if (p.state === "film") {
      this.stepFilming(p, dt);
      return;
    }

    let speed = p.state === "talk" ? 0 : p.state === "dodge" ? 4.5 : p.speed;
    const network = this.network;
    if (p.state === "walk" && network) p.walk ??= network.attach(pos, p.profile.id);
    if (p.state === "walk" && network && p.walk) {
      const step = network.advance(p.walk, speed * dt, p.profile.id, this.car, pos);
      const dx = step.target.x - pos.x;
      const dz = step.target.z - pos.z;
      const gap = Math.hypot(dx, dz);
      // Chase the walking line a little faster than the walk, so a dodge or a corner is made up.
      const pace = (step.crossing ? 1.25 : 1) * speed;
      const move = Math.min(gap, pace * 1.5 * dt);
      const nx = pos.x + (gap > 0.02 ? (dx / gap) * move : 0);
      const nz = pos.z + (gap > 0.02 ? (dz / gap) * move : 0);
      // Only a crossing leg may step onto the carriageway; anyone else stops at the kerb (and, if
      // that goes on, picks a walking line on their own side again).
      const isStepOff = !step.crossing && network.isRoadway(nx, nz) && !network.isRoadway(pos.x, pos.z);
      if (isStepOff) {
        p.blocked += dt;
        if (p.blocked > 1.5) {
          p.walk = null;
          p.blocked = 0;
        }
      } else if (gap > 0.02) {
        p.blocked = 0;
        pos.x = nx;
        pos.z = nz;
        p.heading = turnToward(p.heading, Math.atan2(dx, dz), dt * 6);
      }
      if (step.waiting && step.face) {
        p.heading = turnToward(p.heading, Math.atan2(step.face.x - pos.x, step.face.z - pos.z), dt * 4);
      }
      speed = step.waiting ? 0 : move / Math.max(dt, 1e-3);
    } else if (speed > 0) {
      const dx = Math.sin(p.heading) * speed * dt;
      const dz = Math.cos(p.heading) * speed * dt;
      const nx = pos.x + dx * 6; // look ~1 step ahead
      const nz = pos.z + dz * 6;
      const g = this.groundAt(nx, nz);
      // Wanderers keep off buildings and off the carriageway.
      const isBlocked = g === null || !this.isOpen(nx, nz, g) || (network?.isRoadway(nx, nz) ?? false);
      if (isBlocked) {
        p.heading += Math.PI * (0.5 + ((p.profile.id * 7 + Math.floor(p.stateTime * 10)) % 10) / 10);
      } else {
        pos.x += dx;
        pos.z += dz;
      }
      if (
        p.state === "walk" &&
        Math.floor(p.stateTime * 0.2 + p.profile.id) % 7 === 0 &&
        p.stateTime % 5 < dt
      ) {
        p.heading += (((p.profile.id * 13) % 7) - 3) * 0.25;
      }
    }
    p.groundCheck -= dt;
    if (p.groundCheck <= 0) {
      p.groundCheck = 0.25;
      const g = this.groundAt(pos.x, pos.z);
      if (g !== null) pos.y = g;
    }

    p.object.rotation.set(0, p.heading, 0);
    p.phase += dt * speed * 4.2;
    animateHuman(p.model, p.phase, speed, this.raining);
  }

  /**
   * Standing, turned to the car and following it with the phone: raised over FILM_RAISE, held,
   * lowered over the last FILM_LOWER seconds, then walking on. A car that is gone (FILM_LOST)
   * ends it early.
   */
  private stepFilming(p: Pedestrian, dt: number): void {
    const pos = p.object.position;
    const car = this.car.pos;
    const dx = car.x - pos.x;
    const dz = car.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const isLost = dist > FILM_LOST && p.filmFor > p.stateTime + FILM_LOWER;
    if (isLost) p.filmFor = p.stateTime + FILM_LOWER;
    const isDone = p.stateTime >= p.filmFor || !p.phone;
    if (isDone) {
      this.stopFilming(p);
      return;
    }
    if (dist > 0.5) p.heading = turnToward(p.heading, Math.atan2(dx, dz), dt * FILM_TRACK);
    p.object.rotation.set(0, p.heading, 0);
    // Standing (no umbrella: both hands are on the phone), then the arms go up to the phone.
    animateHuman(p.model, p.phase, 0, false);
    const raise = Math.min(p.stateTime / FILM_RAISE, (p.filmFor - p.stateTime) / FILM_LOWER, 1);
    const eye = pos.y + FILM_GRIP.y * p.object.scale.y;
    const pitch = Math.atan2(eye - car.y, Math.max(dist, 1));
    poseFilming(p.model, p.phone as Object3D, raise * raise * (3 - 2 * raise), Math.min(0.6, pitch));
  }

  private fill(car: Vector3): void {
    let attempts = 0;
    while (this.list.length < this.crowd && attempts < 6) {
      attempts++;
      this.spawnSeed = (this.spawnSeed * 1103515245 + 12345) >>> 0;
      const a = ((this.spawnSeed % 3600) / 3600) * Math.PI * 2;
      const r = SPAWN_MIN + (((this.spawnSeed >>> 12) % 1000) / 1000) * (SPAWN_MAX - SPAWN_MIN);
      let x = car.x + Math.cos(a) * r;
      let z = car.z + Math.sin(a) * r;
      // Mostly on a pavement: move the spot onto the nearest street's walking line.
      const walk = this.network?.attach(new Vector3(x, 0, z), this.nextId) ?? null;
      if (walk && this.network) {
        const at = this.network.point(walk.seg, walk.s, walk.side, walk.lateral);
        x = at.x;
        z = at.z;
      }
      const g = this.groundAt(x, z);
      if (g === null || !this.isOpen(x, z, g) || this.network?.isRoadway(x, z)) continue;
      // Appear only out of the camera's view.
      if (this.isSeen(new Vector3(x, g + 0.9, z))) continue;
      const p = this.spawn(new Vector3(x, g, z), a * 3.1);
      p.walk = walk;
    }
  }

  private spawn(at: Vector3, heading: number): Pedestrian {
    const profile = profileFor(this.nextId++);
    const pick = <T>(arr: T[], salt: number) => arr[Math.abs(Math.imul(profile.id, 31 + salt)) % arr.length];
    const colors = {
      shirt: pick(SHIRTS, 1),
      pants: pick(PANTS, 2),
      skin: pick(SKIN, 3),
      hair: pick(HAIR, 4),
      umbrella: pick([0x223355, 0xaa2233, 0x226644, 0xeeeeee], 5),
    };
    const height = 0.92 + (profile.id % 7) * 0.025;
    const model = createHuman(colors, height, profile.id);
    // How to build them again for a saved violation's replay (replayClip.ts).
    model.root.userData.replay = { type: "human", colors, height, variant: profile.id };
    model.root.position.copy(at);
    this.scene.add(model.root);
    this.list.push({
      profile,
      object: model.root,
      model,
      heading,
      speed: 1.1 + (profile.id % 5) * 0.12,
      phase: profile.id,
      state: "walk",
      stateTime: 0,
      filmFor: 0,
      phone: null,
      body: null,
      groundCheck: 0,
      walk: null,
      blocked: 0,
    });
    return this.list[this.list.length - 1];
  }

  private createBody(p: Pedestrian): void {
    const pos = p.object.position;
    p.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.28).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      p.body,
    );
  }

  private dropBody(p: Pedestrian): void {
    if (!p.body) return;
    this.world.removeRigidBody(p.body);
    p.body = null;
  }

  private remove(i: number): void {
    const p = this.list[i];
    this.dropBody(p);
    this.scene.remove(p.object);
    disposeHuman(p.model);
    this.list.splice(i, 1);
  }
}

/** Turn `from` toward `to` (radians) by at most `max`, the short way round. */
function turnToward(from: number, to: number, max: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, d));
}
