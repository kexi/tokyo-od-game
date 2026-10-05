import RAPIER from "@dimforge/rapier3d-compat";
import { type Object3D, Quaternion, Vector3, type Group, type Scene } from "three";
import { QUALITY } from "../device";
import { createLowCar } from "../game/carModel";
import { FrameWork } from "../game/frameWork";
import {
  createVehicle,
  hasVehicleModel,
  type VehicleInstance,
  type VehicleKind,
} from "../game/vehicleModels";
import { MassiveBody, massContactsFor } from "../physics/massContacts";
import { laden, VEHICLE_SPECS, yawInertia, type MassClass } from "../physics/masses";
import { leftOf, speedLimit, type RoadGraph, type Segment } from "./roads";
import type { TrafficControl } from "./trafficControl";

type AiCar = {
  object: Group;
  seg: Segment;
  dir: 1 | -1; // along / against the segment's coordinate order
  s: number; // distance travelled along the segment in travel direction
  speed: number; // m/s
  taxi: boolean;
  /** A bus, truck or motorbike model (null: an ordinary car, origin at chassis height). */
  vehicle: VehicleInstance | null;
  /** Half the length, for the gap kept to the car ahead and the collider. */
  half: number;
  body: RAPIER.RigidBody | null;
  ground: number;
  groundCheck: number;
  serial: number;
  served: number; // id of the stop-sign approach already stopped at
  waited: number; // seconds standing at the current stop line
  /** Where it drives as a vehicle with wheels: rear axle, heading, front-wheel angle, bike lean. */
  rear: Vector3;
  yaw: number;
  steer: number;
  lean: number;
  wheelbase: number;
  /** Front wheel nodes that turn with the steering (the low car has none). */
  front: Object3D[];
  /** The roads after this one, chosen ahead so a turn can be driven before the junction. */
  route: Array<{ seg: Segment; dir: 1 | -1 }>;
  /** Seconds standing at a dead end (no way on): it leaves once out of view. */
  deadEnd: number;
  /** Its class, mass with driver, people and load, and motion for the collisions (massContacts). */
  massClass: MassClass;
  mass: MassiveBody;
  /** Everyday acceleration and braking (m/s²): a bus pulls away slower than a taxi. */
  accel: number;
  decel: number;
  /** Seconds it still stands after being shoved (the driver collects themselves), then drives on. */
  hold: number;
};

const COLORS = [0xf2f2f2, 0x111111, 0x8c939b, 0xb02a2a, 0x2a4fb0, 0xd7d2c5, 0x5b6b3a, 0x3a3f4a];
const MAX_CARS = QUALITY.maxAiCars;
const SPAWN_RADIUS = 350;
const DESPAWN_RADIUS = 450;
// Beyond this, cars may come and go even in view (fog and buildings hide it).
const FAR = 600;
const BODY_RADIUS = 120;
const LANE_FRACTION = 0.25; // centre of the left half of a two-way carriageway
const GRAVITY = 9.81;
// Steering locks: about 35° for cars, buses and trucks, 25° for a bike at street speeds.
const MAX_STEER = 0.6;
const MAX_STEER_BIKE = 0.45;
const MAX_LEAN = 0.6; // rad, a bike leaned well over in a tight turn
const FRONT_WHEEL = /^Wheel(F[LR]?|Front)$/;
// gapAhead targets a 7 m standstill gap to the next car's centre; a stop line is a "car" this far
// beyond the line so the front bumper (2.15 m ahead of the centre) halts just short of it.
const STOP_LINE_GAP = 4.5;
const COMFORT_DECEL = 5; // m/s², for deciding whether a yellow/red can still be stopped for

/**
 * Taxis and private cars driving on the left (道路交通法 第17条) along the road graph, keeping
 * gaps to the car ahead and to the player. Kinematic bodies near the player make them solid.
 */
type ParkedCar = { key: string; object: Group; body: RAPIER.RigidBody; mass: MassiveBody };

// A shoved car: its driver stands on the brake, the tyres skid (about 0.7 g). A parked one holds
// only by the parking brake or P on one axle (half that). Assumed, as the brakes in masses.ts.
const SKID = 0.7 * 9.81;
const PARKED_GRIP = 0.35 * 9.81;
/** Seconds a shoved car stands before driving on: 2 s, and 2 s more per m/s of the blow, at most 20. */
const holdAfter = (dv: number) => Math.min(20, 2 + 2 * dv);
const UP = new Vector3(0, 1, 0);

const PARKED_MAX = 16;

export class TrafficAI {
  /** Whether a point is in the camera's view (set by the game each frame). */
  isSeen: (p: Vector3) => boolean = () => false;
  private cars: AiCar[] = [];
  /** Other vehicles the AI must not drive into (the robotaxi), set every frame. */
  extraObstacles: Vector3[] = [];
  private parked: ParkedCar[] = [];
  private graph: RoadGraph | null = null;
  private serial = 1;
  private readonly tmpPos = new Vector3();
  private readonly tmpDir = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly contacts: ReturnType<typeof massContactsFor>;

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly control: TrafficControl | null = null,
  ) {
    this.contacts = massContactsFor(world);
  }

  /**
   * Swap in a rebuilt graph (player moved / frame re-anchored). Cars are re-attached to the
   * matching segment of the new graph so traffic does not visibly pop; strays are removed.
   */
  setGraph(graph: RoadGraph | null, rebuildParked = true): void {
    const kept: AiCar[] = [];
    const byGeometry = new Map(graph?.segments.map((seg) => [seg.line.coords.join(","), seg]));
    for (const c of this.cars) {
      const matching = byGeometry.get(c.seg.line.coords.join(","));
      const projection = matching && graph?.nearestOn(matching, c.object.position);
      const isOnSameRoad = matching && projection && projection.dist < 4;
      const hit = isOnSameRoad
        ? { seg: matching, s: projection.s, dir: graph!.sample(matching, projection.s).dir }
        : graph?.nearest(c.object.position, 4);
      if (!graph || !hit) {
        this.remove(c);
        continue;
      }
      const forward = new Vector3(Math.sin(c.object.rotation.y), 0, Math.cos(c.object.rotation.y));
      c.dir = forward.dot(hit.dir) >= 0 ? 1 : -1;
      c.seg = hit.seg;
      c.s = c.dir === 1 ? hit.s : hit.seg.length - hit.s;
      c.route = [];
      kept.push(c);
    }
    this.cars = kept;
    this.graph = graph;
    if (rebuildParked) {
      for (const _ of this.parkedSteps(graph)) {
        /* synchronous compatibility path */
      }
    }
  }

  rebuildParkedAsync(graph: RoadGraph | null, work: FrameWork): Promise<void> {
    return work.run(this.parkedSteps(graph));
  }

  /**
   * 路上駐車: cars left at the kerb of narrower streets. Chosen by a hash of each segment's
   * geometry, so re-anchoring rebuilds them at exactly the same spots.
   */
  private *parkedSteps(graph: RoadGraph | null): Generator<void | boolean> {
    const remaining = new Map(this.parked.map((p) => [p.key, p]));
    const kept: ParkedCar[] = [];
    for (const seg of graph?.segments ?? []) {
      if (kept.length >= PARKED_MAX) break;
      yield;
      const isSideStreet = seg.line.width >= 4 && seg.line.width < 13 && seg.length > 25;
      const h = hashCoords(seg.line.coords);
      if (!isSideStreet || h % 6 !== 0) continue;
      const key = `${seg.line.width}/${seg.line.coords.join(",")}`;
      const existing = remaining.get(key);
      if (existing) {
        remaining.delete(key);
        kept.push(existing);
        continue;
      }
      if (!graph) continue;
      const { pos, dir } = graph.sample(seg, seg.length * (0.3 + ((h >>> 4) % 40) / 100));
      const side = (h >>> 9) % 2 ? 1 : -1;
      pos.add(leftOf(dir, side * (seg.line.width / 2 - 1.1)));
      const ground = this.groundAt(pos.x, pos.z);
      if (ground === null) continue;
      const yaw = Math.atan2(dir.x, dir.z) + (side < 0 ? Math.PI : 0);
      const color = COLORS[(h >>> 13) % COLORS.length];
      const object = createLowCar({ color });
      object.userData.replay = { type: "lowCar", color };
      object.position.set(pos.x, ground + 0.86, pos.z);
      object.rotation.y = yaw;
      this.scene.add(object);
      // Kinematic, not fixed: a car that hits it shoves it by both masses (massContacts) and it
      // slides on its parking brake, then stands again (a kinematic body that is not moved costs
      // nothing in the step).
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(pos.x, ground + 0.86, pos.z)
          .setRotation(new Quaternion().setFromAxisAngle(UP, yaw)),
      );
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.92, 0.6, 2.15), body);
      const kg = VEHICLE_SPECS.sedan.curbKg;
      const mass = new MassiveBody(kg, yawInertia(kg, 4.3, 1.84), PARKED_GRIP, "vehicle");
      mass.setMotion(pos.x, pos.z, 0, 0, 0);
      this.contacts.add(collider, mass);
      const parked = { key, object, body, mass };
      this.parked.push(parked);
      kept.push(parked);
      yield true;
    }
    for (const p of remaining.values()) {
      this.scene.remove(p.object);
      const collider = p.body.collider(0);
      if (collider) this.contacts.remove(collider);
      this.world.removeRigidBody(p.body);
    }
    this.parked = kept;
  }

  /** Re-anchoring: shift cars rigidly; their graph is replaced right after. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    for (const c of this.cars) {
      offset(c.object.position);
      offset(c.rear);
      c.yaw += yawDelta;
      c.object.rotation.y += yawDelta;
      if (c.body) this.dropBody(c);
    }
    const cos = Math.cos(yawDelta);
    const sin = Math.sin(yawDelta);
    for (const p of this.parked) {
      offset(p.object.position);
      p.object.rotation.y += yawDelta;
      p.body.setTranslation(p.object.position, false);
      p.body.setRotation(p.object.quaternion, false);
      p.body.setNextKinematicTranslation(p.object.position);
      p.body.setNextKinematicRotation(p.object.quaternion);
      const { vx, vz } = p.mass;
      p.mass.x = p.object.position.x;
      p.mass.z = p.object.position.z;
      p.mass.vx = cos * vx + sin * vz;
      p.mass.vz = -sin * vx + cos * vz;
    }
  }

  /** Where the traffic cars are, for vehicles outside the AI (the robotaxi) to keep clear of. */
  /** The cars' scene objects (for the replay recorder). */
  objects(): Object3D[] {
    return this.cars.map((c) => c.object);
  }

  positions(): Vector3[] {
    return this.cars.map((c) => c.object.position);
  }

  /** 路上駐車 cars (they never move off), for self-driving cars to tell from traffic (read-only). */
  parkedPoses(): Array<{ position: Vector3; yaw: number; key: object }> {
    return this.parked.map((p) => ({ position: p.object.position, yaw: p.object.rotation.y, key: p.object }));
  }

  /** Visit each car for the traffic hum: its object (identity and pose), speed (m/s), model kind. */
  forEachCar(visit: (object: Object3D, speed: number, kind: VehicleKind | null) => void): void {
    for (const c of this.cars) visit(c.object, c.speed, c.vehicle?.kind ?? null);
  }

  count(): number {
    return this.cars.length;
  }

  isAiCollider(handle: number): boolean {
    return this.cars.some((c) => c.body?.collider(0)?.handle === handle);
  }

  update(dt: number, focus: Vector3, player: Vector3, playerForward: Vector3, playerSpeed: number): void {
    const graph = this.graph;
    if (!graph || graph.segments.length === 0) return;
    for (const p of this.parked) this.slideParked(p, dt);
    this.spawn(graph, focus);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const { pos, dir } = this.pose(graph, c);
      // Never vanish in front of the camera: only out of view, or very far (or stuck at a dead end).
      const away = pos.distanceTo(focus);
      const isGoneUnseen = (away > DESPAWN_RADIUS || c.deadEnd > 0) && !this.isSeen(pos);
      if (away > FAR || isGoneUnseen) {
        this.remove(c);
        this.cars.splice(i, 1);
        continue;
      }
      const isShoved = c.mass.shoved || c.hold > 0;
      const centre = isShoved
        ? this.shove(c, dt)
        : this.follow(graph, c, pos, dir, dt, player, playerForward, playerSpeed);
      const yaw = c.yaw;
      c.object.position.set(centre.x, c.ground + (c.vehicle ? 0 : 0.86), centre.z);
      for (const w of c.vehicle?.wheels ?? []) w.rotation.x += (c.speed * dt) / 0.45;
      for (const w of c.front) w.rotation.y = c.steer;
      // Bikes lean into the turn about their ground contact (their origin is on the ground).
      c.object.rotation.set(0, yaw, -c.lean);
      // Its motion for the collisions: along its heading, turning at v·tan(δ)/L.
      const yawRate = (c.speed * Math.tan(c.steer)) / c.wheelbase;
      c.mass.setMotion(centre.x, centre.z, Math.sin(yaw) * c.speed, Math.cos(yaw) * c.speed, yawRate);
      const isNear = pos.distanceTo(player) < BODY_RADIUS;
      if (isNear && !c.body) {
        c.body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, c.ground + 0.86, pos.z),
        );
        const v = c.vehicle;
        const box = v
          ? RAPIER.ColliderDesc.cuboid(v.width / 2, v.height / 2, v.length / 2).setTranslation(
              0,
              v.height / 2 - 0.86,
              0,
            )
          : RAPIER.ColliderDesc.cuboid(0.92, 0.6, 2.15);
        this.contacts.add(this.world.createCollider(box, c.body), c.mass);
      } else if (!isNear && c.body) {
        this.dropBody(c);
      }
      c.body?.setNextKinematicTranslation(c.object.position);
      c.body?.setNextKinematicRotation(this.tmpQuat.setFromAxisAngle(UP, yaw));
    }
  }

  /** Its own driving along the lane this frame (speed, gaps, signals, steering); returns the centre. */
  private follow(
    graph: RoadGraph,
    c: AiCar,
    pos: Vector3,
    dir: Vector3,
    dt: number,
    player: Vector3,
    playerForward: Vector3,
    playerSpeed: number,
  ): Vector3 {
    const limit = speedLimit(c.seg) / 3.6;
    const cruise = limit * (0.75 + (c.serial % 5) * 0.06);
    const gap = Math.min(this.gapAhead(c, pos, dir, player, playerForward, playerSpeed), this.stopGap(c, dt));
    // 7 m centre to centre for cars; longer vehicles keep their own length clear.
    const standstill = 4.75 + c.half;
    const target =
      c.deadEnd > 0
        ? 0
        : gap < standstill
          ? 0
          : gap < standstill + 18
            ? Math.min(cruise, (gap - standstill) * 0.8)
            : cruise;
    const turnSafe = this.cornerSpeed(graph, c);
    c.speed += Math.max(-c.decel * dt, Math.min(c.accel * dt, Math.min(target, turnSafe) - c.speed));
    const isPlaced = Number.isFinite(c.rear.x);
    if (!isPlaced) c.s += c.speed * dt;
    if (c.s >= c.seg.length) this.advance(graph, c);

    c.groundCheck -= dt;
    if (c.groundCheck <= 0) {
      c.groundCheck = 0.3;
      c.ground = this.groundAt(pos.x, pos.z) ?? c.ground;
    }
    const centre = this.drive(graph, c, pos, dir, dt);
    // Where along its lane the car really is: its centre projected onto the road. Why not count the
    // distance driven: a car rounding a corner cuts it, and the count ran ahead of the car until it
    // aimed behind itself.
    if (isPlaced) {
      const along = graph.nearestOn(c.seg, centre).s;
      const projected = c.dir === 1 ? along : c.seg.length - along;
      c.s = Math.max(c.s - 2, Math.min(c.s + c.speed * dt * 2 + 0.05, projected));
      if (c.s >= c.seg.length - 0.05) {
        c.s = c.seg.length + 0.05;
        this.advance(graph, c);
      }
    }
    return centre;
  }

  /**
   * Shoved by a car (massContacts): it slides by the velocity of the blow and spins by its yaw rate,
   * slowing on skidding tyres; then it stands for a moment and drives on from where it came to rest
   * (pure pursuit steers it back to its lane). Returns the centre.
   */
  private shove(c: AiCar, dt: number): Vector3 {
    const m = c.mass;
    const centre = this.tmpPos.copy(c.rear).addScaledVector(this.forwardOf(c.yaw), c.wheelbase / 2);
    if (m.shoved) {
      centre.x += m.vx * dt;
      centre.z += m.vz * dt;
      c.yaw += m.w * dt;
      const isMoving = m.slow(dt);
      if (!isMoving) c.hold = holdAfter(m.impact.dvOther);
    } else {
      c.hold = Math.max(0, c.hold - dt);
    }
    c.rear.copy(centre).addScaledVector(this.forwardOf(c.yaw), -c.wheelbase / 2);
    c.speed = 0;
    c.steer = 0;
    c.lean = 0;
    return centre;
  }

  private readonly tmpFwd = new Vector3();
  private forwardOf(yaw: number): Vector3 {
    return this.tmpFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  }

  /** A 路上駐車 car shoved by a car slides on its parking brake, then stands (and is never moved again). */
  private slideParked(p: ParkedCar, dt: number): void {
    const m = p.mass;
    const o = p.object;
    m.setMotion(o.position.x, o.position.z, 0, 0, 0);
    if (!m.shoved) return;
    o.position.x += m.vx * dt;
    o.position.z += m.vz * dt;
    o.rotation.y += m.w * dt;
    m.slow(dt);
    const ground = this.groundAt(o.position.x, o.position.z);
    if (ground !== null) o.position.y = ground + 0.86;
    p.body.setNextKinematicTranslation(o.position);
    p.body.setNextKinematicRotation(this.tmpQuat.setFromAxisAngle(UP, o.rotation.y));
  }

  private dropBody(c: AiCar): void {
    if (!c.body) return;
    const collider = c.body.collider(0);
    if (collider) this.contacts.remove(collider);
    this.world.removeRigidBody(c.body);
    c.body = null;
  }

  /** World pose of a car: lane centre to the left of its travel direction. */
  private pose(graph: RoadGraph, c: AiCar): { pos: Vector3; dir: Vector3 } {
    return this.lanePoint(graph, c.seg, c.dir, c.s);
  }

  /** The lane centre `s` metres along a segment in a travel direction. */
  private lanePoint(graph: RoadGraph, seg: Segment, dir: 1 | -1, s: number): { pos: Vector3; dir: Vector3 } {
    const along = dir === 1 ? s : seg.length - s;
    const sample = graph.sample(seg, Math.max(0, Math.min(seg.length, along)), this.tmpPos, this.tmpDir);
    if (dir === -1) sample.dir.negate();
    const lane = seg.oneway === 0 ? seg.line.width * LANE_FRACTION : 0;
    sample.pos.add(leftOf(sample.dir, lane));
    return { pos: sample.pos.clone(), dir: sample.dir.clone() };
  }

  /**
   * Drive it as a vehicle with wheels, not a point on a line: pure pursuit steers the front wheels
   * toward a point a little ahead on the lane (into the next road near a junction), and the kinematic
   * bicycle model moves the rear axle and turns the body from that steering. Corners come out round,
   * the rear cuts in as it does on a real car, and the front wheels show the angle. Returns the centre.
   * Why not snap to the lane and its tangent (as before): the polylines meet at sharp corners, so a car
   * pivoted on the spot at every junction.
   */
  private drive(graph: RoadGraph, c: AiCar, lane: Vector3, laneDir: Vector3, dt: number): Vector3 {
    const fwd = new Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const centre = c.rear.clone().addScaledVector(fwd, c.wheelbase / 2);
    // Far off its lane (just spawned, re-anchored, turned round): put it back on the lane.
    // A frame without time (paused, a second call in the same frame) leaves it where it is.
    if (dt <= 0 && Number.isFinite(centre.x)) return centre;
    // Put back only where nobody sees it jump (or when hopelessly lost); in view it drives on and
    // pure pursuit brings it round to its lane — a hairpin of short road pieces is tighter than
    // a car can turn.
    const offLane = Math.hypot(centre.x - lane.x, centre.z - lane.z);
    const isAdrift = !(offLane <= 8) && (!this.isSeen(centre) || !(offLane <= 25));
    if (isAdrift) {
      c.yaw = Math.atan2(laneDir.x, laneDir.z);
      c.rear.copy(lane).addScaledVector(laneDir, -c.wheelbase / 2);
      c.steer = 0;
      c.lean = 0;
      return lane.clone();
    }
    const isBike = c.vehicle?.kind === "motorbike";
    const lock = isBike ? MAX_STEER_BIKE : MAX_STEER;
    // The tightest circle the car can drive: a target inside it can never be reached, and pure
    // pursuit then circles it at full lock for ever (seen at junctions of short road pieces and on
    // very wide carriageways, where a car off its lane had its target beside it). Such a target is
    // moved on along the route until the car can steer to it.
    const maxCurvature = Math.tan(lock) / c.wheelbase;
    const base = Math.max(3.5, Math.min(12, 3 + c.speed * 0.55));
    let curvatureWanted = 0;
    for (let extra = 0; ; extra += 4) {
      const target = this.ahead(graph, c, c.wheelbase / 2 + base + extra);
      const dx = target.x - c.rear.x;
      const dz = target.z - c.rear.z;
      const along = dx * fwd.x + dz * fwd.z;
      const leftward = dx * fwd.z - dz * fwd.x;
      const reach = Math.max(1, Math.hypot(dx, dz));
      curvatureWanted = (2 * Math.sin(Math.atan2(leftward, along))) / reach;
      const isReachable = Math.abs(curvatureWanted) <= maxCurvature * 0.9;
      if (isReachable || extra >= 40) break;
    }
    const wanted = Math.max(-lock, Math.min(lock, Math.atan(curvatureWanted * c.wheelbase)));
    // A steering wheel turns at a finite rate.
    c.steer += Math.max(-2.5 * dt, Math.min(2.5 * dt, wanted - c.steer));
    const curvature = Math.tan(c.steer) / c.wheelbase;
    c.yaw += c.speed * curvature * dt;
    c.rear.addScaledVector(new Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw)), c.speed * dt);
    if (isBike) {
      const lean = Math.atan((c.speed * c.speed * curvature) / GRAVITY);
      const target = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, lean));
      c.lean += (target - c.lean) * Math.min(1, dt * 6);
    }
    return c.rear.clone().addScaledVector(new Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw)), c.wheelbase / 2);
  }

  /**
   * The speed to be at now so the turn at the end of this road can be driven: a sharp turn wants
   * about 15–20 km/h at the junction (lateral grip ~2.5 m/s², radius from the turn's angle), braked
   * for comfortably (2.5 m/s²) from wherever the car is. Straight on: no limit.
   */
  private cornerSpeed(graph: RoadGraph, c: AiCar): number {
    const left = c.seg.length - c.s;
    if (left > 60) return Number.POSITIVE_INFINITY;
    const next = this.peekNext(graph, c);
    if (!next) return Math.sqrt(2 * 2.5 * Math.max(0, left - 2));
    // The whole turn: the way in, and the way out 12 m past the junction (short pieces included).
    const end = this.lanePoint(graph, c.seg, c.dir, c.seg.length).dir;
    const out = this.aheadPose(graph, c, left + 12).dir;
    const angle = Math.acos(Math.max(-1, Math.min(1, end.dot(out))));
    if (angle < 0.3) return Number.POSITIVE_INFINITY;
    const radius = Math.max(5, 12 / angle);
    const atTurn = Math.max(3.5, Math.sqrt(2.5 * radius));
    return Math.sqrt(atTurn * atTurn + 2 * 2.5 * Math.max(0, left - 3));
  }

  /** The lane centre `metres` ahead of where the car is along its route (into the next road). */
  private ahead(graph: RoadGraph, c: AiCar, metres: number): Vector3 {
    return this.aheadPose(graph, c, metres).pos;
  }

  /** Lane point and direction `metres` ahead along the route, through as many roads as it takes. */
  private aheadPose(graph: RoadGraph, c: AiCar, metres: number): { pos: Vector3; dir: Vector3 } {
    let s = c.s + metres;
    let seg = c.seg;
    let dir = c.dir;
    for (let k = 0; s > seg.length && k < 8; k++) {
      const next = this.upcoming(graph, c, k);
      if (!next) {
        s = seg.length;
        break;
      }
      s -= seg.length;
      seg = next.seg;
      dir = next.dir;
    }
    return this.lanePoint(graph, seg, dir, Math.min(s, seg.length));
  }

  /** The road it will take at the end of this one (chosen once, kept until it gets there). */
  private peekNext(graph: RoadGraph, c: AiCar): { seg: Segment; dir: 1 | -1 } | null {
    return this.upcoming(graph, c, 0);
  }

  /** The road `k` steps after this one (0: the next), chosen ahead and kept until reached. */
  private upcoming(graph: RoadGraph, c: AiCar, k: number): { seg: Segment; dir: 1 | -1 } | null {
    while (c.route.length <= k) {
      const last = c.route.at(-1) ?? { seg: c.seg, dir: c.dir };
      const endNode = last.dir === 1 ? last.seg.to : last.seg.from;
      const arriving = this.lanePoint(graph, last.seg, last.dir, last.seg.length).dir;
      // Not back the way it came: on a dual carriageway the other one-way line can be the only exit,
      // a hairpin no car drives at a junction (more than 120°: a dead end for it instead).
      const options = graph.exits(endNode, last.seg.id).filter((seg) => {
        const dir: 1 | -1 = seg.from === endNode ? 1 : -1;
        return this.lanePoint(graph, seg, dir, 0).dir.dot(arriving) > -0.5;
      });
      if (options.length === 0) return null;
      c.serial = (c.serial * 1103515245 + 12345) >>> 0;
      const seg = options[c.serial % options.length];
      c.route.push({ seg, dir: seg.from === endNode ? 1 : -1 });
    }
    return c.route[k];
  }

  /**
   * Virtual obstacle at the next stop line: red/yellow signals (unless too close to stop, as
   * 施行令 第2条 allows on yellow) and 一時停止, released after a full stop.
   */
  private stopGap(c: AiCar, dt: number): number {
    const next = this.control?.nextStop(c.seg, c.dir, c.s);
    if (!next || !this.control) return Infinity;
    const { approach, dist } = next;
    if (approach.kind === "signal") {
      const state = this.control.state(approach);
      const canStop = dist > (c.speed * c.speed) / (2 * COMFORT_DECEL);
      return state !== "green" && canStop ? dist + STOP_LINE_GAP : Infinity;
    }
    if (c.served === approach.id) return Infinity;
    const isStanding = dist < 3 && c.speed < 0.2;
    c.waited = isStanding ? c.waited + dt : 0;
    if (c.waited > 1.2) {
      c.served = approach.id;
      c.waited = 0;
      return Infinity;
    }
    return dist + STOP_LINE_GAP;
  }

  /** Distance to the nearest obstacle ahead in this lane (other cars, the player). */
  private gapAhead(c: AiCar, pos: Vector3, dir: Vector3, player: Vector3, pf: Vector3, ps: number): number {
    let gap = Infinity;
    const consider = (p: Vector3, width = 2.2) => {
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const ahead = dx * dir.x + dz * dir.z;
      const lateral = Math.abs(dx * dir.z - dz * dir.x);
      if (ahead > 0 && lateral < width) gap = Math.min(gap, ahead);
    };
    for (const o of this.cars) if (o !== c) consider(o.object.position);
    // Kerbside parked cars only block when they actually sit in this lane.
    for (const p of this.parked) consider(p.object.position, 0.9);
    for (const p of this.extraObstacles) consider(p);
    // Yield to the player unless they are clearly driving away ahead of us.
    const isPlayerFleeing = ps > c.speed + 2 && pf.dot(dir) > 0.8;
    if (!isPlayerFleeing) consider(player);
    return gap;
  }

  private advance(graph: RoadGraph, c: AiCar): void {
    const next = this.peekNext(graph, c);
    if (next) c.route.shift();
    if (!next) {
      // Dead end or one-way trap: stop at the end and leave once nobody is looking. Why not turn
      // round on the spot (as before): a car does not spin 180° in place. Only one kept in view
      // for long turns round (a three-point turn is not modelled).
      c.s = c.seg.length;
      c.deadEnd += 1 / 60;
      if (c.deadEnd < 25) return;
      c.deadEnd = 0;
      c.dir = c.dir === 1 ? -1 : 1;
      c.s = 0;
      return;
    }
    c.deadEnd = 0;
    c.dir = next.dir;
    c.s = c.s - c.seg.length;
    c.seg = next.seg;
  }

  private spawn(graph: RoadGraph, focus: Vector3): void {
    let tries = 0;
    while (this.cars.length < MAX_CARS && tries < 4) {
      tries++;
      this.serial = (this.serial * 1664525 + 1013904223) >>> 0;
      const seg = graph.segments[this.serial % graph.segments.length];
      const isCarRoad = seg.line.width >= 4 && seg.line.kind !== "highway";
      if (!isCarRoad) continue;
      const s = (((this.serial >>> 8) % 1000) / 1000) * seg.length;
      const { pos } = graph.sample(seg, s);
      const d = pos.distanceTo(focus);
      // Appear only where the camera is not looking (open-world spawning), so cars never pop in.
      if (d > SPAWN_RADIUS || d < 60 || this.isSeen(pos)) continue;
      const dir: 1 | -1 = seg.oneway === -1 ? -1 : seg.oneway === 1 ? 1 : this.serial % 2 ? 1 : -1;
      // Tokyo's mix: route buses and trucks on the wider roads, motorbikes anywhere.
      const roll = (this.serial >>> 4) % 100;
      const isWide = seg.line.width >= 9;
      const kind: VehicleKind | null =
        isWide && roll < 6
          ? "bus"
          : isWide && roll < 10
            ? "truck10t"
            : isWide && roll < 14
              ? "truck8t"
              : roll < 22
                ? "motorbike"
                : null;
      const vehicle = kind && hasVehicleModel(kind) ? createVehicle(kind) : null;
      const taxi = !vehicle && this.serial % 5 < 2;
      const color = taxi ? 0x1d2a4a : COLORS[this.serial % COLORS.length];
      const object = vehicle?.object ?? createLowCar({ color, taxi });
      // How to build it again for a saved violation's replay (replayClip.ts).
      object.userData.replay = vehicle && kind ? { type: "vehicle", kind } : { type: "lowCar", color, taxi };
      this.scene.add(object);
      this.cars.push({
        object,
        seg,
        dir,
        s: dir === 1 ? s : seg.length - s,
        speed: 5,
        taxi,
        vehicle,
        half: vehicle ? vehicle.length / 2 : 2.25,
        body: null,
        ground: this.groundAt(pos.x, pos.z) ?? 0,
        groundCheck: 0,
        serial: this.serial,
        served: -1,
        waited: 0,
        // Placed on its lane by drive() on the first update (isAdrift).
        rear: new Vector3(Number.POSITIVE_INFINITY, 0, 0),
        yaw: 0,
        steer: 0,
        lean: 0,
        wheelbase: kind === "motorbike" ? 1.45 : Math.max(2.4, (vehicle ? vehicle.length : 4.4) * 0.58),
        front: (vehicle?.wheels ?? []).filter((w) => FRONT_WHEEL.test(w.name)),
        route: [],
        deadEnd: 0,
        ...this.massOf(kind && vehicle ? kind : taxi ? "jpnTaxi" : "sedan", vehicle, this.serial),
      });
      for (const w of this.cars.at(-1)?.front ?? []) w.rotation.order = "YXZ";
    }
  }

  /**
   * Mass (with driver, people and load), yaw inertia and everyday acceleration and braking of a
   * traffic vehicle of a class: half its launch (grip or power from 36 km/h, as Vehicle drives) and
   * three quarters of its full brake, within what the traffic always did (2.2 and 6 m/s²).
   */
  private massOf(kind: VehicleKind | MassClass, vehicle: VehicleInstance | null, serial: number) {
    const massClass: MassClass =
      kind === "patrol" || kind === "unmarked" || kind === "shirobai" ? "sedan" : kind;
    const spec = VEHICLE_SPECS[massClass];
    const kg = laden(massClass, serial);
    const length = vehicle ? vehicle.length : 4.3;
    const width = vehicle ? vehicle.width : 1.84;
    const launch = Math.min(spec.launchG * 9.81, (spec.powerKw * 850) / (10 * kg));
    return {
      massClass,
      mass: new MassiveBody(kg, yawInertia(kg, length, width), SKID, "vehicle"),
      accel: Math.min(2.2, launch / 2),
      decel: Math.min(6, spec.brake * 0.75),
      hold: 0,
    };
  }

  /** Class and mass of each car (for tests and the accident record), by its scene object. */
  massOfObject(object: Object3D): { massClass: MassClass; kg: number } | null {
    const c = this.cars.find((car) => car.object === object);
    return c ? { massClass: c.massClass, kg: c.mass.mass } : null;
  }

  private remove(c: AiCar): void {
    this.scene.remove(c.object);
    this.dropBody(c);
  }
}

function hashCoords(coords: number[]): number {
  let h = 2166136261;
  for (let i = 0; i < Math.min(coords.length, 8); i++) {
    h ^= Math.round(coords[i] * 1e5);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
