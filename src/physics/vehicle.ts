import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3, type Group, type SpotLight } from "three";
import { createCarModel, WHEEL_RADIUS, type CarModel } from "../game/carModel";

export type DriveInput = { throttle: number; brake: number; steer: number; handbrake: boolean };

const HALF = { x: 0.92, y: 0.38, z: 2.15 };
const SUSPENSION_REST = 0.32;
const MAX_STEER = 0.55;
const ENGINE_FORCE = 5200;
const BRAKE_FORCE = 70;
const REVERSE_FORCE = 2600;
const TOP_SPEED = 110 / 3.6; // m/s — Tokyo streets, not a racetrack
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
  private readonly model: CarModel;
  private steer = 0;
  private lastInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  constructor(private readonly world: RAPIER.World) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.12).setAngularDamping(0.8).setCcdEnabled(true),
    );
    // Lower the centre of mass so the car is hard to roll in tight Tokyo corners.
    this.chassis = world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z)
        .setMassProperties(
          1250,
          { x: 0, y: -0.35, z: 0.1 },
          { x: 1900, y: 2300, z: 650 },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.4)
        .setRestitution(0.1)
        // Contacts with pedestrians/buses/traffic become accident events.
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

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
      this.controller.setWheelMaxSuspensionForce(i, 40000);
      this.controller.setWheelFrictionSlip(i, i < 2 ? 2.4 : 2.2);
      this.controller.setWheelSideFrictionStiffness(i, 1.1);
    }
    this.model = createCarModel();
    this.object = this.model.root;
    this.headlights = this.model.headlights;
    for (const [i, w] of this.model.wheels.entries()) {
      const [x, y, z] = WHEEL_POSITIONS[i];
      w.position.set(x, y - SUSPENSION_REST, z);
      this.object.add(w);
    }
  }

  /** Speed along the chassis forward axis in km/h (negative when reversing). */
  speedKmh(): number {
    return this.controller.currentVehicleSpeed() * 3.6;
  }

  update(dt: number, input: DriveInput): void {
    this.lastInput = input;
    const speed = this.controller.currentVehicleSpeed();
    // Less steering lock at speed keeps highway driving stable.
    const steerLimit = MAX_STEER / (1 + Math.abs(speed) / 18);
    const target = input.steer * steerLimit;
    this.steer += (target - this.steer) * Math.min(1, dt * 8);

    const isReversing = input.brake > 0 && speed < 1.0;
    // Fade engine force out near top speed instead of hard-capping velocity.
    const headroom = Math.max(0, 1 - Math.max(0, speed) / TOP_SPEED);
    let engine = input.throttle * ENGINE_FORCE * Math.min(1, headroom * 3);
    let brake = 0;
    if (isReversing) engine = -input.brake * REVERSE_FORCE;
    else brake = input.brake * BRAKE_FORCE;
    if (input.throttle === 0 && input.brake === 0) brake = 4; // rolling resistance

    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      this.controller.setWheelSteering(i, isFront ? this.steer : 0);
      this.controller.setWheelEngineForce(i, isFront ? 0 : engine);
      const handbrake = !isFront && input.handbrake ? BRAKE_FORCE * 1.5 : 0;
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
      const suspension = this.controller.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      holder.position.set(x, y - suspension, z);
      holder.rotation.y = this.controller.wheelSteering(i) ?? 0;
      holder.children[0].rotation.x = this.controller.wheelRotation(i) ?? 0;
    }
  }

  /** Brake/reverse/indicator lamps follow the driver's input; headlights follow the time of day. */
  updateLights(night: boolean): void {
    const speed = this.controller.currentVehicleSpeed();
    const input = this.lastInput;
    this.model.setLights({
      brake: input.brake > 0 && speed > 0.5,
      reverse: input.brake > 0 && speed <= 0.5,
      left: input.steer > 0.45,
      right: input.steer < -0.45,
      night,
    });
  }

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
    this.world.removeRigidBody(this.body);
  }
}
