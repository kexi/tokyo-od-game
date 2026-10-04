import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Vector3, type PerspectiveCamera, type Scene } from "three";
import { animateHuman, createHuman, type HumanModel } from "../world/human";

export type WalkInput = { forward: number; right: number; run: boolean; jump: boolean; turn: number };

const RADIUS = 0.3;
const HALF_HEIGHT = 0.55; // capsule: total height ≈ 1.7 m
const WALK = 1.6;
const RUN = 4.2;
const GRAVITY = -9.81;

/**
 * The player on foot: a kinematic capsule driven by Rapier's character controller (auto-step for
 * kerbs, snap-to-ground, slope limits) plus a third-person camera that orbits with ←/→.
 */
export class Walker {
  readonly model: HumanModel;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private vy = 0;
  private heading = 0;
  private camYaw = 0;
  private phase = 0;
  private readonly camPos = new Vector3();
  private camReady = false;
  speed = 0;
  active = false;

  constructor(scene: Scene, world: RAPIER.World) {
    this.model = createHuman({
      shirt: 0xffd23f,
      pants: 0x1f2a44,
      skin: 0xf1c9a5,
      hair: 0x1a1410,
      umbrella: 0x2255aa,
    });
    this.model.root.visible = false;
    scene.add(this.model.root);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setEnabled(false));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.45, 0.2, false); // kerbs and steps
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle(MathUtils.degToRad(50));
    this.controller.setMinSlopeSlideAngle(MathUtils.degToRad(35));
    this.controller.setApplyImpulsesToDynamicBodies(true);
  }

  /** Feet position (the capsule centre sits HALF_HEIGHT + RADIUS above). */
  position(target = new Vector3()): Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y - HALF_HEIGHT - RADIUS, t.z);
  }

  forward(target = new Vector3()): Vector3 {
    return target.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  enter(at: Vector3, heading: number): void {
    this.active = true;
    this.heading = heading;
    this.camYaw = heading;
    this.vy = 0;
    this.camReady = false;
    this.body.setEnabled(true);
    this.body.setTranslation({ x: at.x, y: at.y + HALF_HEIGHT + RADIUS + 0.05, z: at.z }, true);
    this.model.root.visible = true;
  }

  leave(): void {
    this.active = false;
    this.body.setEnabled(false);
    this.model.root.visible = false;
  }

  /** Rigid frame change (floating origin). */
  transform(offset: (p: Vector3) => Vector3, yawDelta: number): void {
    const p = offset(this.position().add(new Vector3(0, HALF_HEIGHT + RADIUS, 0)));
    this.body.setTranslation(p, false);
    this.heading += yawDelta;
    this.camYaw += yawDelta;
    offset(this.camPos);
  }

  update(dt: number, input: WalkInput, raining: boolean): void {
    if (!this.active) return;
    this.camYaw += input.turn * dt * 2.2;
    // Movement is relative to the camera so W always walks "into the screen".
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const move = new Vector3(fx * input.forward - fz * input.right, 0, fz * input.forward + fx * input.right);
    const isMoving = move.lengthSq() > 0.01;
    const target = isMoving ? (input.run ? RUN : WALK) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 8);
    if (isMoving) {
      move.normalize();
      const want = Math.atan2(move.x, move.z);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 10);
    }
    const grounded = this.controller.computedGrounded();
    if (grounded && this.vy < 0) this.vy = -1;
    if (grounded && input.jump) this.vy = 4.2;
    this.vy += GRAVITY * dt;
    const step = this.forward().multiplyScalar(this.speed * dt);
    step.y = this.vy * dt;
    // Collide with terrain, buildings, cars and buses; pedestrians are pushed around by hand.
    this.controller.computeColliderMovement(this.collider, step, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });

    const feet = this.position();
    this.model.root.position.copy(feet);
    this.model.root.rotation.set(0, this.heading, 0);
    this.phase += dt * this.speed * 4.2;
    animateHuman(this.model, this.phase, this.speed, raining);
  }

  updateCamera(camera: PerspectiveCamera, dt: number): void {
    const feet = this.position();
    // Slowly swing the camera behind the walking direction unless the player is turning it.
    let diff = this.heading - this.camYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (this.speed > 0.5) this.camYaw += diff * Math.min(1, dt * 0.8);
    const desired = new Vector3(-Math.sin(this.camYaw) * 4.2, 2.3, -Math.cos(this.camYaw) * 4.2).add(feet);
    if (!this.camReady) {
      this.camPos.copy(desired);
      this.camReady = true;
    }
    this.camPos.lerp(desired, Math.min(1, dt * 8));
    camera.position.copy(this.camPos);
    camera.lookAt(feet.x, feet.y + 1.5, feet.z);
    if (Math.abs(camera.fov - 60) > 0.1) {
      camera.fov += (60 - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }
  }
}
