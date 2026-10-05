/**
 * ジャイロ操作: how far the controller is turned like a steering wheel, from its accelerometer and
 * gyroscope (a complementary filter). The gyro is quick but drifts; gravity seen by the
 * accelerometer does not drift but shakes with every jolt of the hands — the gyro carries the
 * angle from frame to frame and gravity pulls it back slowly, more slowly the more the measured
 * acceleration differs from 1 g (the hands are moving it, gravity is not alone).
 *
 * The wheel's axis is found, not assumed: at 中央を合わせる (calibrate) the pad's left–right axis L
 * and gravity g0 give the axis A = L × g0 the hands turn it about. Held flat (face up) that is the
 * pad's forward axis; held upright (face towards you, like a Joy-Con wheel) it is the axis out of
 * the face. A turn to the right (right hand down) is a positive angle about A.
 *
 * Device axes (Pro Controller, as SDL's driver reads them — SDL_hidapi_switch.c SendSensorUpdate):
 * +X forward (towards the triggers), +Y left, +Z up out of the face; at rest the accelerometer
 * reads +1 g up. Units in: accelerometer in g, gyro in rad/s about the same axes (right-handed).
 */

export type Vec3 = readonly [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (a: Vec3): Vec3 => {
  const n = length(a);
  return n > 1e-9 ? scale(a, 1 / n) : [0, 0, 0];
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The pad's left–right axis (device frame): the steering wheel's rim runs along it at centre. */
export const LATERAL: Vec3 = [0, 1, 0];

/** Time constant of the pull towards gravity (s): long enough to ignore a hand's jolt. */
const TAU_S = 0.6;
/** Gravity is trusted fully at 1 g, not at all this far from it (g). */
const TRUST_SPAN_G = 0.35;
/** The gyro's bias is learnt as a running mean over about this long while held still (s). */
const BIAS_TAU_S = 2;
const STILL_RAD_S = 0.1;

/** The roll angle gravity alone gives, about `axis`, from `g0` to `g` (rad, + = right hand down). */
export function gravityRoll(g: Vec3, g0: Vec3, axis: Vec3): number {
  // Both into the plane the wheel turns in; the world's gravity turns the other way in the pad's
  // own frame, hence g × g0 rather than g0 × g.
  const gp = sub(g, scale(axis, dot(g, axis)));
  const g0p = sub(g0, scale(axis, dot(g0, axis)));
  return Math.atan2(dot(axis, cross(gp, g0p)), dot(gp, g0p));
}

/** The wheel's axis for a centre held with gravity `g0` (device frame). */
export function wheelAxis(g0: Vec3): Vec3 {
  const axis = normalize(cross(LATERAL, normalize(g0)));
  // Held on its side (the left–right axis vertical): no wheel to turn; the forward axis.
  const isDegenerate = length(axis) < 0.5;
  return isDegenerate ? [1, 0, 0] : axis;
}

export class TiltEstimator {
  /** The wheel's angle (rad), + when turned right. */
  roll = 0;
  private g0: Vec3 | null = null;
  private axis: Vec3 = [1, 0, 0];
  private bias: Vec3 = [0, 0, 0];
  private lastAccel: Vec3 | null = null;
  private wantsCentre = true;

  /** The next sample becomes the centre (and the gyro's bias is taken as it is held now). */
  calibrate(): void {
    this.wantsCentre = true;
  }

  get calibrated(): boolean {
    return this.g0 !== null;
  }

  update(accel: Vec3, gyro: Vec3, dt: number): number {
    const step = Math.min(0.1, Math.max(0, dt));
    const isCentring = this.wantsCentre || this.g0 === null;
    if (isCentring) {
      this.g0 = normalize(accel);
      this.axis = wheelAxis(this.g0);
      this.roll = 0;
      this.wantsCentre = false;
    }
    const g0 = this.g0 as Vec3;
    const rate = sub(gyro, this.bias);
    // Held still (no turn felt, gravity steady): the reading is the gyro's own bias; learn it.
    const isStill =
      length(rate) < STILL_RAD_S && this.lastAccel !== null && length(sub(accel, this.lastAccel)) < 0.02;
    if (isStill) {
      const k = step / BIAS_TAU_S;
      this.bias = [
        this.bias[0] + (gyro[0] - this.bias[0]) * k,
        this.bias[1] + (gyro[1] - this.bias[1]) * k,
        this.bias[2] + (gyro[2] - this.bias[2]) * k,
      ];
    }
    this.lastAccel = accel;
    const predicted = this.roll + dot(rate, this.axis) * step;
    const trust = Math.max(0, 1 - Math.abs(length(accel) - 1) / TRUST_SPAN_G);
    const towardsGravity = (1 - Math.exp(-step / TAU_S)) * trust;
    const measured = gravityRoll(accel, g0, this.axis);
    this.roll = wrap(predicted + wrap(measured - predicted) * towardsGravity);
    return this.roll;
  }
}

/**
 * The steering the wheel's angle asks for: + is left as DriveInput has it, so a turn to the right
 * steers right (negative). Full lock at `rangeDeg`, with a 1.5° dead band so a still pad is straight.
 */
export function tiltSteer(rollRad: number, rangeDeg: number, invert = false): number {
  const deg = (rollRad * 180) / Math.PI;
  const dead = 1.5;
  const mag = Math.max(0, Math.abs(deg) - dead) / Math.max(1, rangeDeg - dead);
  const steer = -Math.sign(deg) * Math.min(1, mag);
  return invert ? -steer : steer;
}
