import type RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3, type Scene } from "three";
import { Vehicle, type DriveInput } from "../physics/vehicle";
import { createVehicle, setBeacons, type VehicleInstance } from "./vehicleModels";
import type { RoadGraph, Segment } from "../world/roads";
import { AutoDriver, type DriveWorld } from "./autoDriver";
import type { ViolationRecord } from "./traffic";

/**
 * 巡回中のパトカー. Violations only count once the police see them (現認): a patrol that sees one
 * turns on its 赤色の警光灯 and siren, follows the car and calls it over by loudspeaker
 * (「前の車、左に寄って止まってください」); once the driver pulls over beside it the officer
 * issues the ticket (青切符, or 赤切符 for non-反則 offences) and the patrol drives on. A driver
 * who gets away is still identified by the number plate: the record becomes a notice by post.
 *
 * Driving goes through the same AutoDriver and physics as the robotaxi; in pursuit it may go
 * on at red signals after slowing (緊急自動車, 第39条第2項).
 */
export type PatrolState = "cruising" | "pursuing" | "ticketing" | "leaving";
export type PatrolEvent = "pursuit" | "callout" | "ticket" | "lost" | null;

const SIGHT = 70; // m: how far an officer in the car notices a violation ahead
const SIGHT_NEAR = 25; // m: noticed in any direction (mirrors, side windows)
const FIELD = Math.cos((75 * Math.PI) / 180);
const LOST = 450; // m: the car got away (the plate was read, so a notice follows)
const STOPPED = 2.5; // s the pursued car must stand still near the patrol
const CALLOUT_EVERY = 9000; // ms between loudspeaker calls
const RIDE_HEIGHT = 0.86;

export class PolicePatrol {
  state: PatrolState = "cruising";
  readonly car: Vehicle;
  /** Violations it saw and will ticket. */
  readonly seen: ViolationRecord[] = [];
  private readonly driver = new AutoDriver();
  private input: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false, brakeOnly: true };
  private readonly bar: Mesh;
  private readonly model: VehicleInstance | null;
  private readonly barMaterial: MeshStandardMaterial;
  private stoppedFor = 0;
  private lastCallout = -Infinity;
  private cruiseTarget: Vector3 | null = null;
  private leaveUntil = 0;

  constructor(
    private readonly scene: Scene,
    world: RAPIER.World,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    // The physics car drives; the 白黒パトカー model (scripts/blender/police_car.py) is what is
    // seen. Its origin is on the ground, the physics body's at chassis height.
    this.car = new Vehicle(world, { color: 0xf4f4f2 });
    this.barMaterial = new MeshStandardMaterial({ color: 0x550000, emissive: 0x000000 });
    this.bar = new Mesh(new BoxGeometry(1.1, 0.14, 0.32), this.barMaterial);
    this.model = createVehicle("patrol");
    if (this.model) {
      for (const child of this.car.object.children) child.visible = false;
      this.model.object.position.y = -RIDE_HEIGHT;
      this.car.object.add(this.model.object);
    } else {
      this.bar.position.set(0, 0.86, -0.15);
      this.car.object.add(this.bar);
    }
    scene.add(this.car.object);
  }

  get position(): Vector3 {
    return this.car.object.position;
  }

  /** Put the patrol on a street 250–450 m from `near`, cruising. */
  spawn(graph: RoadGraph, world: DriveWorld, near: Vector3): boolean {
    const streets = graph.segments.filter((seg) => {
      if (seg.line.kind === "highway" || seg.line.width < 5.5 || seg.length < 40 || seg.closed) return false;
      const d = graph.sample(seg, seg.length / 2).pos.distanceTo(near);
      return d > 250 && d < 450;
    });
    const seg: Segment | undefined = streets[Math.floor(Math.random() * streets.length)];
    if (!seg) return false;
    const dir: 1 | -1 = seg.oneway !== 0 ? (seg.oneway as 1 | -1) : Math.random() < 0.5 ? 1 : -1;
    const { pos, dir: d } = graph.sample(seg, seg.length / 2);
    const travel = d.multiplyScalar(dir);
    const at = pos.add(new Vector3(travel.z, 0, -travel.x).multiplyScalar(seg.line.width * 0.25));
    at.y = (this.groundAt(at.x, at.z) ?? at.y) + RIDE_HEIGHT;
    this.car.setCoasting(true);
    this.car.teleport(at, Math.atan2(travel.x, travel.z));
    this.car.syncVisuals();
    this.driver.place(at, Math.atan2(travel.x, travel.z));
    return this.cruise(world, near);
  }

  /** Whether the officers would notice something happening at `p`. */
  sees(p: Vector3): boolean {
    if (this.state === "ticketing") return false;
    const here = this.car.position();
    const dx = p.x - here.x;
    const dz = p.z - here.z;
    const d = Math.hypot(dx, dz);
    if (d < SIGHT_NEAR) return true;
    if (d > SIGHT) return false;
    const yaw = this.car.yaw();
    return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d > FIELD;
  }

  /** A violation it saw: chase the car. */
  witness(record: ViolationRecord): PatrolEvent {
    this.seen.push(record);
    if (this.state === "pursuing") return null;
    this.state = "pursuing";
    this.stoppedFor = 0;
    return "pursuit";
  }

  /** The ticket was handed over: drive on, siren off. */
  release(world: DriveWorld, near: Vector3): void {
    this.seen.length = 0;
    this.state = "leaving";
    this.leaveUntil = performance.now() + 20000;
    this.cruise(world, near);
  }

  step(timestep: number): void {
    if (!this.car.isCoasting) this.car.update(timestep, this.input);
  }

  dispose(): void {
    this.scene.remove(this.car.object);
    this.car.dispose();
  }

  update(
    dt: number,
    world: DriveWorld,
    ground: { hasCollider: boolean; night: boolean },
    player: { position: Vector3; speed: number },
    now: number,
  ): PatrolEvent {
    let event: PatrolEvent = null;
    const isPursuing = this.state === "pursuing" || this.state === "ticketing";
    const here = this.car.position();
    const gap = Math.hypot(player.position.x - here.x, player.position.z - here.z);
    if (this.state === "pursuing") {
      // Follow the car: re-plan toward it as it moves.
      if (!this.driver.route || this.driver.remaining < 15 || now % 2000 < dt * 1000) {
        this.driver.plan({ ...world, isEmergency: true }, player.position);
      }
      if (now - this.lastCallout > CALLOUT_EVERY) {
        this.lastCallout = now;
        event = "callout";
      }
      const isPulledOver = gap < 22 && Math.abs(player.speed) < 1;
      this.stoppedFor = isPulledOver ? this.stoppedFor + dt : 0;
      if (this.stoppedFor > STOPPED) {
        this.state = "ticketing";
        event = "ticket";
      }
      if (gap > LOST) {
        this.state = "cruising";
        event = "lost";
      }
    } else if (this.state === "leaving" && now > this.leaveUntil) {
      this.state = "cruising";
    }
    if (this.state === "cruising" || this.state === "leaving") {
      const isArrived = !this.driver.route || this.driver.remaining < 20;
      if (isArrived) this.cruise(world, player.position);
    }
    this.car.setCoasting(!ground.hasCollider);
    const pose = { position: this.car.position(), yaw: this.car.yaw(), speed: this.car.forwardSpeed() };
    const drive = { ...world, isEmergency: isPursuing };
    const { input } = this.driver.update(dt, drive, pose);
    // Ticketing: stand behind the stopped car.
    this.input = this.state === "ticketing" ? { ...input, throttle: 0, brake: 1, brakeOnly: true } : input;
    if (!ground.hasCollider) this.car.coast(dt, this.input, this.groundAt);
    this.car.syncVisuals();
    this.car.lightOverride = {
      brake: this.driver.braking,
      left: this.driver.signal === "left",
      right: this.driver.signal === "right",
    };
    this.car.updateLights(ground.night);
    // 赤色の警光灯: flashing while pursuing and while issuing the ticket.
    const isFlashOn = isPursuing && Math.floor(now / 180) % 2 === 0;
    this.barMaterial.emissive.setHex(isFlashOn ? 0xff1a1a : 0x000000);
    if (this.model) {
      setBeacons(this.model, isPursuing, now);
      for (const w of this.model.wheels) w.rotation.x += (this.car.forwardSpeed() * dt) / 0.334;
    }
    return event;
  }

  /** A random street 500–900 m away to patrol toward. */
  private cruise(world: DriveWorld, near: Vector3): boolean {
    const graph = world.graph;
    const here = this.car.position();
    const streets = graph.segments.filter((seg) => {
      if (seg.line.kind === "highway" || seg.line.width < 5.5 || seg.closed) return false;
      const p = graph.sample(seg, seg.length / 2).pos;
      const d = p.distanceTo(here);
      return d > 300 && d < 900 && p.distanceTo(near) < 900;
    });
    const seg = streets[Math.floor(Math.random() * streets.length)];
    if (!seg) return false;
    this.cruiseTarget = graph.sample(seg, seg.length / 2).pos.clone();
    return this.driver.plan(world, this.cruiseTarget);
  }
}
