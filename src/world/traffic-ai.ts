import RAPIER from "@dimforge/rapier3d-compat";
import { type Object3D, Quaternion, Vector3, type Group, type Scene } from "three";
import { QUALITY } from "../device";
import { createLowCar } from "../game/carModel";
import {
  createVehicle,
  hasVehicleModel,
  type VehicleInstance,
  type VehicleKind,
} from "../game/vehicleModels";
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
};

const COLORS = [0xf2f2f2, 0x111111, 0x8c939b, 0xb02a2a, 0x2a4fb0, 0xd7d2c5, 0x5b6b3a, 0x3a3f4a];
const MAX_CARS = QUALITY.maxAiCars;
const SPAWN_RADIUS = 350;
const DESPAWN_RADIUS = 450;
// Beyond this, cars may come and go even in view (fog and buildings hide it).
const FAR = 600;
const BODY_RADIUS = 120;
const LANE_FRACTION = 0.25; // centre of the left half of a two-way carriageway
// gapAhead targets a 7 m standstill gap to the next car's centre; a stop line is a "car" this far
// beyond the line so the front bumper (2.15 m ahead of the centre) halts just short of it.
const STOP_LINE_GAP = 4.5;
const COMFORT_DECEL = 5; // m/s², for deciding whether a yellow/red can still be stopped for

/**
 * Taxis and private cars driving on the left (道路交通法 第17条) along the road graph, keeping
 * gaps to the car ahead and to the player. Kinematic bodies near the player make them solid.
 */
type ParkedCar = { object: Group; body: RAPIER.RigidBody };

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

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
    private readonly control: TrafficControl | null = null,
  ) {}

  /**
   * Swap in a rebuilt graph (player moved / frame re-anchored). Cars are re-attached to the
   * matching segment of the new graph so traffic does not visibly pop; strays are removed.
   */
  setGraph(graph: RoadGraph | null): void {
    const kept: AiCar[] = [];
    for (const c of this.cars) {
      const hit = graph?.nearest(c.object.position, 4);
      if (!graph || !hit) {
        this.remove(c);
        continue;
      }
      const forward = new Vector3(Math.sin(c.object.rotation.y), 0, Math.cos(c.object.rotation.y));
      c.dir = forward.dot(hit.dir) >= 0 ? 1 : -1;
      c.seg = hit.seg;
      c.s = c.dir === 1 ? hit.s : hit.seg.length - hit.s;
      kept.push(c);
    }
    this.cars = kept;
    this.graph = graph;
    this.placeParked(graph);
  }

  /**
   * 路上駐車: cars left at the kerb of narrower streets. Chosen by a hash of each segment's
   * geometry, so re-anchoring rebuilds them at exactly the same spots.
   */
  private placeParked(graph: RoadGraph | null): void {
    for (const p of this.parked) {
      this.scene.remove(p.object);
      this.world.removeRigidBody(p.body);
    }
    this.parked = [];
    if (!graph) return;
    for (const seg of graph.segments) {
      if (this.parked.length >= PARKED_MAX) break;
      const isSideStreet = seg.line.width >= 4 && seg.line.width < 13 && seg.length > 25;
      const h = hashCoords(seg.line.coords);
      if (!isSideStreet || h % 6 !== 0) continue;
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
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(pos.x, ground + 0.86, pos.z)
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.92, 0.6, 2.15), body);
      this.parked.push({ object, body });
    }
  }

  /** Re-anchoring: shift cars rigidly; their graph is replaced right after. */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    for (const c of this.cars) {
      offset(c.object.position);
      c.object.rotation.y += yawDelta;
      if (c.body) {
        this.world.removeRigidBody(c.body);
        c.body = null;
      }
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

  count(): number {
    return this.cars.length;
  }

  isAiCollider(handle: number): boolean {
    return this.cars.some((c) => c.body?.collider(0)?.handle === handle);
  }

  update(dt: number, focus: Vector3, player: Vector3, playerForward: Vector3, playerSpeed: number): void {
    const graph = this.graph;
    if (!graph || graph.segments.length === 0) return;
    this.spawn(graph, focus);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const { pos, dir } = this.pose(graph, c);
      // Never vanish in front of the camera: only out of view, or very far.
      const away = pos.distanceTo(focus);
      if (away > FAR || (away > DESPAWN_RADIUS && !this.isSeen(pos))) {
        this.remove(c);
        this.cars.splice(i, 1);
        continue;
      }
      const limit = speedLimit(c.seg) / 3.6;
      const cruise = limit * (0.75 + (c.serial % 5) * 0.06);
      const gap = Math.min(
        this.gapAhead(c, pos, dir, player, playerForward, playerSpeed),
        this.stopGap(c, dt),
      );
      // 7 m centre to centre for cars; longer vehicles keep their own length clear.
      const standstill = 4.75 + c.half;
      const target =
        gap < standstill ? 0 : gap < standstill + 18 ? Math.min(cruise, (gap - standstill) * 0.8) : cruise;
      c.speed += Math.max(-6 * dt, Math.min(2.2 * dt, target - c.speed));
      c.s += c.speed * dt;
      if (c.s >= c.seg.length) this.advance(graph, c);

      c.groundCheck -= dt;
      if (c.groundCheck <= 0) {
        c.groundCheck = 0.3;
        c.ground = this.groundAt(pos.x, pos.z) ?? c.ground;
      }
      const yaw = Math.atan2(dir.x, dir.z);
      c.object.position.set(pos.x, c.ground + (c.vehicle ? 0 : 0.86), pos.z);
      for (const w of c.vehicle?.wheels ?? []) w.rotation.x += (c.speed * dt) / 0.45;
      c.object.rotation.set(0, yaw, 0);
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
        this.world.createCollider(box, c.body);
      } else if (!isNear && c.body) {
        this.world.removeRigidBody(c.body);
        c.body = null;
      }
      c.body?.setNextKinematicTranslation(c.object.position);
      c.body?.setNextKinematicRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
    }
  }

  /** World pose of a car: lane centre to the left of its travel direction. */
  private pose(graph: RoadGraph, c: AiCar): { pos: Vector3; dir: Vector3 } {
    const along = c.dir === 1 ? c.s : c.seg.length - c.s;
    const { pos, dir } = graph.sample(c.seg, along, this.tmpPos, this.tmpDir);
    if (c.dir === -1) dir.negate();
    const lane = c.seg.oneway === 0 ? c.seg.line.width * LANE_FRACTION : 0;
    pos.add(leftOf(dir, lane));
    return { pos: pos.clone(), dir: dir.clone() };
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
    const endNode = c.dir === 1 ? c.seg.to : c.seg.from;
    const options = graph.exits(endNode, c.seg.id);
    if (options.length === 0) {
      // Dead end or one-way trap: turn around.
      c.dir = c.dir === 1 ? -1 : 1;
      c.s = 0;
      return;
    }
    c.serial = (c.serial * 1103515245 + 12345) >>> 0;
    const next = options[c.serial % options.length];
    c.dir = next.from === endNode ? 1 : -1;
    c.s = c.s - c.seg.length;
    c.seg = next;
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
      });
    }
  }

  private remove(c: AiCar): void {
    this.scene.remove(c.object);
    if (c.body) this.world.removeRigidBody(c.body);
    c.body = null;
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
