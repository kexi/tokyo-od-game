import { MathUtils, Quaternion, Vector3, type PerspectiveCamera } from "three";

export type CameraMode = "chase" | "far" | "hood" | "cockpit";
const MODES: CameraMode[] = ["chase", "cockpit", "hood", "far"];
// The cockpit view places the camera at the driver's eye itself (game/cockpit.ts).
const OFFSETS: Record<CameraMode, Vector3> = {
  chase: new Vector3(0, 3.4, -8.5),
  far: new Vector3(0, 22, -34),
  hood: new Vector3(0, 1.1, 0.6),
  cockpit: new Vector3(0, 1.1, 0.6),
};

/** Spring-damped chase camera that follows the car's yaw but ignores its roll/pitch jitter. */
export class ChaseCamera {
  /** The driver's seat by default: the game is about driving as a driver does. */
  mode: CameraMode = "cockpit";
  /** Looking aside while a key is held (左右 Ctrl: ±90°, Z: behind), added to the car's yaw. */
  look = 0;
  private readonly position = new Vector3();
  private yaw = 0;
  private initialized = false;

  constructor(private readonly camera: PerspectiveCamera) {}

  cycle(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  /** Teleports/re-anchoring move the world; jump instead of easing across it. */
  snap(): void {
    this.initialized = false;
  }

  update(dt: number, carPos: Vector3, carRot: Quaternion, speed: number): void {
    const forward = new Vector3(0, 0, 1).applyQuaternion(carRot);
    const targetYaw = Math.atan2(forward.x, forward.z);
    if (!this.initialized) this.yaw = targetYaw;
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * (this.mode === "hood" ? 20 : 4));

    const yawQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw + this.look);
    const offset = OFFSETS[this.mode].clone();
    if (this.mode === "chase") offset.z -= MathUtils.clamp(Math.abs(speed) / 40, 0, 2.5);
    const desired = offset.applyQuaternion(yawQ).add(carPos);
    if (!this.initialized) {
      this.position.copy(desired);
      this.initialized = true;
    }
    this.position.lerp(desired, Math.min(1, dt * (this.mode === "hood" ? 30 : 6)));
    this.camera.position.copy(this.position);

    const look = new Vector3(0, this.mode === "hood" ? 1.0 : 1.4, this.mode === "hood" ? 12 : 2)
      .applyQuaternion(yawQ)
      .add(carPos);
    this.camera.lookAt(look);
    const fov = 62 + MathUtils.clamp(Math.abs(speed) / 6, 0, 14);
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Apply a rigid frame change so the camera does not visibly jump during re-anchoring. */
  transform(offset: (p: Vector3) => Vector3, rotation: Quaternion): void {
    offset(this.position);
    const f = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).applyQuaternion(rotation);
    this.yaw = Math.atan2(f.x, f.z);
  }
}
