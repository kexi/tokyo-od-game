import { MathUtils, type Object3D, type PerspectiveCamera, Quaternion, Vector3 } from "three";

/**
 * リプレイ: the last minutes of driving, recorded 15 times a second (the player's car, traffic,
 * people and the signal clock), played back from many camera angles — chase, bumper, side, a
 * roadside camera the car drives past, a helicopter, a low wheel shot — either chosen by the
 * player or cut automatically like a broadcast. Violation records jump to their moment.
 */
export type ReplayCamera = "auto" | "chase" | "front" | "side" | "roadside" | "heli" | "wheel" | "cockpit";
export const CAMERA_LABEL: Record<ReplayCamera, string> = {
  auto: "自動",
  chase: "追従",
  front: "正面",
  side: "横",
  roadside: "沿道",
  heli: "ヘリ",
  wheel: "低い位置",
  cockpit: "車内",
};

export type Pose = { x: number; y: number; z: number; yaw: number };
export type Frame = {
  t: number; // game-loop ms
  car: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; speed: number };
  others: Map<Object3D, Pose>;
};

const RATE = 1000 / 15;
const KEEP_MS = 5 * 60_000;

export class ReplayRecorder {
  readonly frames: Frame[] = [];
  private last = -Infinity;

  /** Sample the scene if it is time to (call every frame while playing). */
  capture(now: number, car: Object3D, speed: number, others: Iterable<Object3D>): void {
    if (now - this.last < RATE) return;
    this.last = now;
    const p = car.position;
    const q = car.quaternion;
    const map = new Map<Object3D, Pose>();
    for (const o of others)
      map.set(o, { x: o.position.x, y: o.position.y, z: o.position.z, yaw: o.rotation.y });
    this.frames.push({
      t: now,
      car: { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, speed },
      others: map,
    });
    while (this.frames.length && now - this.frames[0].t > KEEP_MS) this.frames.shift();
  }

  get start(): number {
    return this.frames[0]?.t ?? 0;
  }

  get end(): number {
    return this.frames[this.frames.length - 1]?.t ?? 0;
  }

  /** Interpolated frame pair for a time. */
  at(t: number): { a: Frame; b: Frame; k: number } | null {
    const f = this.frames;
    if (f.length === 0) return null;
    let lo = 0;
    let hi = f.length - 1;
    if (t <= f[0].t) return { a: f[0], b: f[0], k: 0 };
    if (t >= f[hi].t) return { a: f[hi], b: f[hi], k: 0 };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo];
    const b = f[hi];
    return { a, b, k: (t - a.t) / Math.max(1, b.t - a.t) };
  }
}

/** Cuts between camera angles like a broadcast replay. */
export class ReplayDirector {
  private shot: Exclude<ReplayCamera, "auto"> = "chase";
  private shotUntil = 0;
  private roadside: Vector3 | null = null;
  private seed = 7;

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return (this.seed >>> 8) / 0x1000000;
  }

  /** Aim the camera at the car for this moment. `marks` are times worth showing (violations). */
  place(
    camera: PerspectiveCamera,
    choice: ReplayCamera,
    t: number,
    car: { pos: Vector3; quat: Quaternion; speed: number },
    marks: readonly number[],
    groundAt: (x: number, z: number) => number | null,
  ): void {
    const fwd = new Vector3(0, 0, 1).applyQuaternion(car.quat).setY(0).normalize();
    const left = new Vector3(fwd.z, 0, -fwd.x);
    const p = car.pos;
    let shot = choice === "auto" ? this.shot : choice;
    if (choice === "auto") {
      const nearMark = marks.some((m) => Math.abs(m - t) < 4000);
      const passed = this.roadside && this.roadside.clone().sub(p).dot(fwd) < -12;
      if (t > this.shotUntil || (shot === "roadside" && passed)) {
        const pool: Array<Exclude<ReplayCamera, "auto">> = nearMark
          ? ["roadside", "chase", "front", "roadside"]
          : ["chase", "side", "roadside", "heli", "wheel", "front", "roadside", "cockpit"];
        let next = pool[Math.floor(this.rand() * pool.length)];
        if (next === shot) next = pool[(pool.indexOf(next) + 1) % pool.length];
        shot = next;
        this.shot = shot;
        this.shotUntil = t + 2800 + this.rand() * 3200;
        this.roadside = null;
      }
    }
    camera.fov = 55;
    switch (shot) {
      case "chase":
        camera.position
          .copy(p)
          .addScaledVector(fwd, -9)
          .add(new Vector3(0, 3.2, 0));
        camera.lookAt(
          p
            .clone()
            .add(new Vector3(0, 1.2, 0))
            .addScaledVector(fwd, 4),
        );
        break;
      case "front":
        camera.position
          .copy(p)
          .addScaledVector(fwd, 7.5)
          .add(new Vector3(0, 1.0, 0));
        camera.lookAt(p.clone().add(new Vector3(0, 0.9, 0)));
        camera.fov = 48;
        break;
      case "side":
        camera.position
          .copy(p)
          .addScaledVector(left, 6.5)
          .addScaledVector(fwd, 1.5)
          .add(new Vector3(0, 1.3, 0));
        camera.lookAt(p.clone().add(new Vector3(0, 0.9, 0)));
        break;
      case "wheel":
        camera.position
          .copy(p)
          .addScaledVector(left, 2.2)
          .addScaledVector(fwd, -3.2)
          .add(new Vector3(0, 0.35, 0));
        camera.lookAt(
          p
            .clone()
            .addScaledVector(fwd, 6)
            .add(new Vector3(0, 0.6, 0)),
        );
        camera.fov = 70;
        break;
      case "heli": {
        const a = t / 9000;
        camera.position.set(p.x + Math.cos(a) * 45, p.y + 38, p.z + Math.sin(a) * 45);
        camera.lookAt(p);
        camera.fov = 40;
        break;
      }
      case "cockpit":
        camera.position
          .copy(p)
          .addScaledVector(left, -0.37)
          .add(new Vector3(0, 0.45, 0))
          .addScaledVector(fwd, -0.2);
        camera.lookAt(camera.position.clone().addScaledVector(fwd, 10));
        camera.fov = 62;
        break;
      case "roadside": {
        // A camera on the pavement ahead that the car drives past.
        if (!this.roadside) {
          const spot = p
            .clone()
            .addScaledVector(fwd, 22 + car.speed * 1.2)
            .addScaledVector(left, 6);
          spot.y = (groundAt(spot.x, spot.z) ?? p.y) + 1.6;
          this.roadside = spot;
        }
        camera.position.copy(this.roadside);
        camera.lookAt(p.clone().add(new Vector3(0, 0.8, 0)));
        const d = this.roadside.distanceTo(p);
        camera.fov = MathUtils.clamp(70 - d * 0.8, 24, 62);
        break;
      }
    }
    camera.updateProjectionMatrix();
  }
}
