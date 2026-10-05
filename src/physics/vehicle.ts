import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3, type Group, type SpotLight } from "three";
import { createCarModel, WHEEL_RADIUS, type CarModel, type CarStyle } from "../game/carModel";
import { VEHICLE_SOLVER_GROUPS } from "./groups";
import { massContactsFor } from "./massContacts";
import { VEHICLE_SPECS, type MassClass, type VehicleSpec } from "./masses";

/**
 * Pedals and wheel. `brake` at a standstill means reverse for a player's keyboard; a driving
 * program sets `brakeOnly` to hold the car on the brake instead.
 */
export type DriveInput = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  brakeOnly?: boolean;
};

const HALF = { x: 0.92, y: 0.38, z: 2.15 };
const SUSPENSION_REST = 0.32;
export const MAX_STEER = 0.55;
export const WHEELBASE = 2.7;
// The game's off-throttle slowing (engine braking and rolling), kept as it was tuned: a linear
// damping of the chassis and a light brake on all wheels. On the throttle the engine force makes
// up the damping, so the car accelerates by its power and the real air drag (see driveForce).
const LINEAR_DAMPING = 0.12;
const ROLLING = 0.77; // m/s², the light brake with no pedal
const RIDE_HEIGHT = 0.86; // chassis centre above the road at rest
/** Steering lock at a speed (m/s): less at speed keeps highway driving stable. */
export const steerLimit = (speed: number) => MAX_STEER / (1 + Math.abs(speed) / 18);
const G = 9.81;
const DRIVELINE = 0.85; // share of the power that reaches the road (assumed)
// Below this the drive is limited by torque and grip rather than power (assumed: first gear's
// full power comes in around 36 km/h).
const POWER_FROM = 10;
const AIR = 1.2; // kg/m³
const REVERSE_ACCEL = 2.5; // m/s², reverse gear at full pedal
const HANDBRAKE = 1.5; // the rear wheels' share of a full brake, on top
const TOP_SPEED = 110 / 3.6; // m/s — Tokyo streets, not a racetrack
const FADE = 0.15; // the engine fades out over the last 15 % below top speed
// The chassis' mass properties were tuned at this mass; inertia scales with the mass.
const TUNED_KG = 1250;
const TUNED_INERTIA = { x: 1900, y: 2300, z: 650 };
const CHASSIS_COM = { x: 0, y: -0.35, z: 0.1 };

/**
 * Seats in the chassis frame (+X is the car's left, +Z forward; the chassis centre is 0.86 m above
 * the road): the driver sits on the right (右ハンドル), the seated body's centre about 0.8 m above
 * the road, front seats a little behind the middle of the wheelbase, rear seats 0.85 m further back.
 * A 白バイ's rider sits on the centre line, higher.
 */
export type Seat = "driver" | "front" | "rearLeft" | "rearRight" | "rider";
const SEATS: Record<Seat, { x: number; y: number; z: number }> = {
  driver: { x: -0.37, y: -0.06, z: -0.15 },
  front: { x: 0.37, y: -0.06, z: -0.15 },
  rearLeft: { x: 0.37, y: -0.04, z: -1.0 },
  rearRight: { x: -0.37, y: -0.04, z: -1.0 },
  rider: { x: 0, y: 0.25, z: -0.25 },
};
export type Occupant = { seat: Seat; kg: number };

/**
 * Engine force (N, all driven wheels) at full throttle and a forward speed: grip-limited at a launch,
 * power-limited from POWER_FROM on, less the air drag; plus what makes up the chassis' damping.
 */
export function driveForce(spec: VehicleSpec, kg: number, speed: number): number {
  const v = Math.max(0, speed);
  const traction = spec.launchG * G * kg;
  const power = (spec.powerKw * 1000 * DRIVELINE) / Math.max(v, POWER_FROM);
  const drag = 0.5 * AIR * spec.cdA * v * v;
  const fade = Math.min(1, Math.max(0, (TOP_SPEED - v) / (TOP_SPEED * FADE)));
  return Math.max(0, Math.min(traction, power) - drag) * fade + kg * LINEAR_DAMPING * v;
}
// Front wheels first (indices 0,1) so steering only touches those.
const WHEEL_POSITIONS: Array<[number, number, number]> = [
  [-0.82, -0.18, 1.35],
  [0.82, -0.18, 1.35],
  [-0.82, -0.18, -1.35],
  [0.82, -0.18, -1.35],
];

/**
 * Raycast-vehicle car on Rapier's DynamicRayCastVehicleController.
 * Chassis forward is +Z (three.js lookAt convention for non-camera objects).
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly chassis: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly object: Group;
  readonly headlights: SpotLight[];
  readonly model: CarModel;
  private steer = 0;
  private parked = false;
  private coasting = false;
  private coastSpeed = 0;
  private coastSpin = 0;
  private lastInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** The class's figures (masses.ts): mass, power and brakes. */
  readonly spec: VehicleSpec;
  private occupants: Occupant[] = [];
  /** Curb weight plus everyone aboard (kg), as given to the chassis collider. */
  private kg: number;
  private yawI: number;
  private readonly halfWidth: number;
  private readonly halfLength: number;

  constructor(
    private readonly world: RAPIER.World,
    style: CarStyle = {},
    readonly massClass: MassClass = "playerCar",
  ) {
    this.spec = VEHICLE_SPECS[massClass];
    this.kg = this.spec.curbKg;
    this.yawI = TUNED_INERTIA.y;
    this.halfWidth = style.halfWidth ?? HALF.x;
    this.halfLength = style.halfLength ?? HALF.z;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(LINEAR_DAMPING)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    // Mass, centre of mass (lowered, so the car is hard to roll in tight Tokyo corners) and inertia
    // come from applyMass: the class's curb weight and whoever is aboard.
    this.chassis = world.createCollider(
      RAPIER.ColliderDesc.cuboid(this.halfWidth, HALF.y, this.halfLength)
        .setFriction(0.4)
        .setRestitution(0.1)
        .setSolverGroups(VEHICLE_SOLVER_GROUPS)
        // Contacts with pedestrians/buses/traffic become accident events.
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.applyMass();
    massContactsFor(world).addCar(this.body, this.chassis, () => this.yawI);

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    for (const [x, y, z] of WHEEL_POSITIONS) {
      this.controller.addWheel(
        { x, y, z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        SUSPENSION_REST,
        WHEEL_RADIUS,
      );
    }
    for (let i = 0; i < WHEEL_POSITIONS.length; i++) {
      this.controller.setWheelSuspensionStiffness(i, 32);
      this.controller.setWheelSuspensionCompression(i, 2.6);
      this.controller.setWheelSuspensionRelaxation(i, 3.4);
      this.controller.setWheelMaxSuspensionTravel(i, 0.3);
      // Rapier scales the springs by the chassis mass (the ride height does not change with it), but
      // not this cap: it goes with the mass.
      this.controller.setWheelMaxSuspensionForce(i, (40000 * this.kg) / TUNED_KG);
      this.controller.setWheelFrictionSlip(i, i < 2 ? 2.4 : 2.2);
      this.controller.setWheelSideFrictionStiffness(i, 1.1);
    }
    this.model = createCarModel(style);
    this.object = this.model.root;
    this.headlights = this.model.headlights;
    for (const [i, w] of this.model.wheels.entries()) {
      const [x, y, z] = WHEEL_POSITIONS[i];
      w.position.set(x, y - SUSPENSION_REST, z);
      this.object.add(w);
    }
  }

  /**
   * Who is aboard. Their mass and the shift of the centre of mass (the driver on the right) go into
   * the chassis collider's mass properties, with the inertia by the parallel-axis rule.
   * Why not the body's additional mass properties: combined with a collider's own, Rapier 0.21
   * re-diagonalises the inertia and reorders its principal axes (measured: 1900/2300/650 came back
   * as 666/1909/2313 in a rotated frame; knowledge/mirror-charms.md has the same pitfall), and one
   * set on one collider stays exactly as given.
   */
  setOccupants(occupants: ReadonlyArray<Occupant>): void {
    // Called every frame by the game: the same people again is a plain loop, no work.
    let isSame = occupants.length === this.occupants.length;
    for (let i = 0; isSame && i < occupants.length; i++) {
      isSame = occupants[i].seat === this.occupants[i].seat && occupants[i].kg === this.occupants[i].kg;
    }
    if (isSame) return;
    this.occupants = occupants.map((o) => ({ ...o }));
    this.applyMass();
  }

  /** Total mass (kg): the class's curb weight and everyone aboard. */
  get massKg(): number {
    return this.kg;
  }

  get aboard(): ReadonlyArray<Occupant> {
    return this.occupants;
  }

  private applyMass(): void {
    const curb = this.spec.curbKg;
    // The tuned inertia, for this class's mass and footprint (a box's inertia goes with m·size²).
    const sx = this.halfWidth / HALF.x;
    const sz = this.halfLength / HALF.z;
    const k = curb / TUNED_KG;
    const base = {
      x: TUNED_INERTIA.x * k * sz * sz,
      y: TUNED_INERTIA.y * k * ((sx * sx + sz * sz) / 2),
      z: TUNED_INERTIA.z * k * sx * sx,
    };
    let kg = curb;
    let mx = curb * CHASSIS_COM.x;
    let my = curb * CHASSIS_COM.y;
    let mz = curb * CHASSIS_COM.z;
    for (const o of this.occupants) {
      const p = SEATS[o.seat];
      kg += o.kg;
      mx += o.kg * p.x;
      my += o.kg * p.y;
      mz += o.kg * p.z;
    }
    const com = { x: mx / kg, y: my / kg, z: mz / kg };
    // Parallel axes: each part's offset from the combined centre. A seated person's own inertia is
    // small next to that (and products of inertia from the driver's offset are left out).
    const offset = (m: number, p: { x: number; y: number; z: number }) => {
      const dx = p.x - com.x;
      const dy = p.y - com.y;
      const dz = p.z - com.z;
      return { x: m * (dy * dy + dz * dz), y: m * (dx * dx + dz * dz), z: m * (dx * dx + dy * dy) };
    };
    const inertia = { ...base };
    for (const [m, p] of [
      [curb, CHASSIS_COM] as const,
      ...this.occupants.map((o) => [o.kg, SEATS[o.seat]] as const),
    ]) {
      const d = offset(m, p);
      inertia.x += d.x;
      inertia.y += d.y;
      inertia.z += d.z;
    }
    this.kg = kg;
    this.yawI = inertia.y;
    this.chassis.setMassProperties(kg, com, inertia, { x: 0, y: 0, z: 0, w: 1 });
    // At once, not at the next step: forces this step and the readers (massKg, tests) see it.
    this.body.recomputeMassPropertiesFromColliders();
    // Not yet built during the constructor (its loop sets the same cap).
    const wheels = this.controller ? this.controller.numWheels() : 0;
    for (let i = 0; i < wheels; i++) {
      this.controller.setWheelMaxSuspensionForce(i, (40000 * kg) / TUNED_KG);
    }
  }

  /** Speed along the chassis forward axis in km/h (negative when reversing). */
  speedKmh(): number {
    return this.forwardSpeed() * 3.6;
  }

  /** Forward speed in m/s, from the physics or from the kinematic model. */
  forwardSpeed(): number {
    if (this.coasting) return this.coastSpeed;
    // A frozen body (no ground built yet) keeps its last velocity; it is not moving.
    const isMoving = !this.parked && this.body.isEnabled();
    if (!isMoving) return 0;
    // From the chassis velocity: the controller's cached speed goes stale while the body sleeps.
    const v = this.body.linvel();
    const f = new Vector3(0, 0, 1).applyQuaternion(this.quaternion());
    return v.x * f.x + v.y * f.y + v.z * f.z;
  }

  /** Front-wheel steering angle (radians, + to the left). */
  get steerAngle(): number {
    return this.steer;
  }

  get isCoasting(): boolean {
    return this.coasting;
  }

  /** Heading (radians, atan2(x, z) of the chassis forward axis). */
  yaw(): number {
    const f = new Vector3(0, 0, 1).applyQuaternion(this.quaternion());
    return Math.atan2(f.x, f.z);
  }

  /**
   * Far from the player there is no ground collider to drive on, so a computer-driven car runs on
   * a kinematic bicycle model there (see coast) and goes back to full physics, at the same speed,
   * once the ground is built under it.
   */
  setCoasting(coasting: boolean): void {
    if (coasting === this.coasting) return;
    const speed = this.forwardSpeed();
    this.coasting = coasting;
    this.setParked(coasting);
    this.coastSpeed = speed;
    if (coasting) return;
    const f = new Vector3(0, 0, 1).applyQuaternion(this.quaternion()).multiplyScalar(speed);
    this.body.setLinvel(f, true);
  }

  /**
   * Kinematic bicycle model: the same steering lock, engine and brake limits as the physics car;
   * the heading turns at v·tan(δ)/L and the car never slides sideways.
   */
  coast(dt: number, input: DriveInput, groundAt: (x: number, z: number) => number | null): void {
    this.lastInput = input;
    const v = this.coastSpeed;
    this.steer += (input.steer * steerLimit(v) - this.steer) * Math.min(1, dt * 8);
    // Reverse as update() has it (the brake pedal at a standstill without brakeOnly), so a
    // self-driving car can back up where there is no ground collider too.
    const isReversing = input.brake > 0 && v < 1.0 && !input.brakeOnly;
    const kg = this.kg;
    const engine = isReversing
      ? -input.brake * REVERSE_ACCEL * kg
      : input.throttle * driveForce(this.spec, kg, v);
    const accel = engine / kg - LINEAR_DAMPING * v;
    const decel = isReversing ? 0 : input.brake * this.spec.brake + (input.throttle === 0 ? 0.3 : 0);
    const pushed = v + accel * dt;
    // Brakes and rolling resistance slow the car to a stop, never past it.
    const slowed = pushed > 0 ? Math.max(0, pushed - decel * dt) : Math.min(0, pushed + decel * dt);
    this.coastSpeed = isReversing || v < 0 ? slowed : Math.max(0, slowed);
    const yaw = this.yaw() + ((v * Math.tan(this.steer)) / WHEELBASE) * dt;
    const t = this.body.translation();
    const x = t.x + Math.sin(yaw) * v * dt;
    const z = t.z + Math.cos(yaw) * v * dt;
    const y = (groundAt(x, z) ?? t.y - RIDE_HEIGHT) + RIDE_HEIGHT;
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setNextKinematicRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
    this.coastSpin += (v * dt) / WHEEL_RADIUS;
  }

  /**
   * A parked car (driver on foot) becomes a kinematic body: it still blocks pedestrians and
   * traffic, but no longer simulates. Terrain colliders only exist around the player, so a
   * dynamic car left behind would fall through the ground once the player walked away.
   */
  setParked(parked: boolean): void {
    if (parked === this.parked) return;
    this.parked = parked;
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setBodyType(
      parked ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic,
      true,
    );
  }

  update(dt: number, input: DriveInput): void {
    this.lastInput = input;
    const speed = this.controller.currentVehicleSpeed();
    // Less steering lock at speed keeps highway driving stable.
    const target = input.steer * steerLimit(speed);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);

    const isReversing = input.brake > 0 && speed < 1.0 && !input.brakeOnly;
    // Two driven (rear) wheels share the force; it fades out near top speed (driveForce).
    const kg = this.kg;
    let engine = (input.throttle * driveForce(this.spec, kg, speed)) / 2;
    let brake = 0;
    // Rapier's wheel brake is an impulse per step (N·s), measured: 4·b·60/m m/s² at 60 Hz. A full
    // pedal gives the class's deceleration over the four wheels.
    const fullBrake = (kg * this.spec.brake * dt) / 4;
    if (isReversing) engine = (-input.brake * REVERSE_ACCEL * kg) / 2;
    else brake = input.brake * fullBrake;
    if (input.throttle === 0 && input.brake === 0) brake = (kg * ROLLING * dt) / 4; // rolling resistance
    // After a few seconds on the brake the chassis sleeps, and the reverse force alone never woke
    // it (measured headlessly: the accelerator got the car going, reverse left it standing).
    if (engine !== 0) this.body.wakeUp();

    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      this.controller.setWheelSteering(i, isFront ? this.steer : 0);
      this.controller.setWheelEngineForce(i, isFront ? 0 : engine);
      const handbrake = !isFront && input.handbrake ? fullBrake * HANDBRAKE : 0;
      this.controller.setWheelBrake(i, brake + handbrake);
      this.controller.setWheelSideFrictionStiffness(i, !isFront && input.handbrake ? 0.45 : 1.1);
    }
    // Wheels ride on terrain/buildings only, never on pedestrians or buses (kinematic bodies).
    this.controller.updateVehicle(
      dt,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
  }

  syncVisuals(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(r.x, r.y, r.z, r.w);
    for (const [i, holder] of this.model.wheels.entries()) {
      const [x, y, z] = WHEEL_POSITIONS[i];
      if (this.coasting) {
        holder.position.set(x, y - SUSPENSION_REST, z);
        holder.rotation.y = i < 2 ? this.steer : 0;
        holder.children[0].rotation.x = this.coastSpin;
        continue;
      }
      const suspension = this.controller.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      holder.position.set(x, y - suspension, z);
      holder.rotation.y = this.controller.wheelSteering(i) ?? 0;
      holder.children[0].rotation.x = this.controller.wheelRotation(i) ?? 0;
    }
  }

  /** Brake/reverse/indicator lamps follow the driver's input; headlights follow the time of day. */
  updateLights(night: boolean, switches?: { left: boolean; right: boolean; highBeam: boolean }): void {
    const speed = this.controller.currentVehicleSpeed();
    const input = this.lastInput;
    const o = this.lightOverride;
    this.model.setLights({
      brake: o ? o.brake : input.brake > 0 && speed > 0.5,
      reverse: o ? (o.reverse ?? false) : input.brake > 0 && speed <= 0.5,
      left: o ? o.left : (switches?.left ?? input.steer > 0.45),
      right: o ? o.right : (switches?.right ?? input.steer < -0.45),
      night,
      highBeam: switches?.highBeam,
    });
  }

  /** While 自動運転モード drives, its brake lamps, 合図 and 後退灯 instead of the player's input. */
  lightOverride: { brake: boolean; left: boolean; right: boolean; reverse?: boolean } | null = null;

  position(target = new Vector3()): Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y, t.z);
  }

  quaternion(target = new Quaternion()): Quaternion {
    const r = this.body.rotation();
    return target.set(r.x, r.y, r.z, r.w);
  }

  teleport(position: Vector3, yaw: number): void {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    this.body.setTranslation(position, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Apply a rigid transform (frame re-anchoring) without disturbing the motion. */
  transform(offset: (p: Vector3) => Vector3, rotation: Quaternion): void {
    const p = offset(this.position());
    const q = rotation.clone().multiply(this.quaternion());
    const lv = this.body.linvel();
    const av = this.body.angvel();
    const v = new Vector3(lv.x, lv.y, lv.z).applyQuaternion(rotation);
    const w = new Vector3(av.x, av.y, av.z).applyQuaternion(rotation);
    this.body.setTranslation(p, false);
    this.body.setRotation(q, false);
    this.body.setLinvel(v, false);
    this.body.setAngvel(w, true);
  }

  setFrozen(frozen: boolean): void {
    this.body.setEnabled(!frozen);
  }

  dispose(): void {
    massContactsFor(this.world).removeCar(this.chassis);
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
