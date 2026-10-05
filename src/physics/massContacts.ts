import RAPIER from "@dimforge/rapier3d-compat";
import { MASSIVE_SOLVER_GROUPS } from "./groups";

/**
 * Collisions between the dynamic cars (the player's, the robotaxi, the police: Vehicle) and the
 * kinematic bodies that move on their own (traffic, pedestrians, 路上駐車), with both masses.
 *
 * Rapier gives a kinematic body infinite mass: a car that hits a pedestrian or a kei car stops as
 * at a wall. So those colliders are kept out of the solver for the cars (solver groups; contacts
 * and collision events still happen), and after every physics step this module does the
 * exchange itself: an impulse along the contact normal from the two masses (yaw inertia included)
 * and a coefficient of restitution, applied to the car at the contact point and to the other as a
 * velocity its owner then moves it by (a shove: sliding, slowing on its tyres or feet, settling).
 *
 * Why not make the traffic dynamic bodies: they drive on a lane model (and coast where the ground
 * has no collider), the wheels of the cars would have to see them, and a dynamic box that is
 * driven every frame by setting its velocity is a wall again until it is let go. Why not
 * Rapier's contact-modification hooks: they run per contact point inside the step and can only
 * scale or drop the solver's impulses, not give the kinematic side a mass.
 */

/** One impact: the first step of a contact, or a renewed blow after the two came apart. */
export type Impact = {
  /** Closing speed along the normal at the contact point (m/s). */
  closing: number;
  /** Velocity change of the car and of the other (m/s). */
  dvCar: number;
  dvOther: number;
  /** Kinetic energy turned into deformation and heat (J). */
  energy: number;
  carKg: number;
  otherKg: number;
};

/**
 * A kinematic body with a mass: its owner keeps position and velocity up to date each frame while
 * it moves on its own, and moves it by (vx, vz, w) while `shoved`, slowing it by `grip`.
 */
export class MassiveBody {
  /** Centre of mass on the ground plane, velocity (m/s) and yaw rate (rad/s, + to the left). */
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  w = 0;
  /** Set when a car pushed it: the owner moves it by its velocity until it has stopped. */
  shoved = false;
  /** The latest impact (fields reused) and the step it happened at (−1: never). */
  readonly impact: Impact = { closing: 0, dvCar: 0, dvOther: 0, energy: 0, carKg: 0, otherKg: 0 };
  impactStep = -1;
  /** Whose body this is (a Pedestrian, a traffic car): what a blow reports back to the game. */
  owner: unknown = null;

  constructor(
    public mass: number,
    public yawInertia: number,
    /** Sliding deceleration when shoved (m/s²): locked or skidding tyres, or feet and the ground. */
    public grip: number,
    /** People fold onto the bonnet and are carried (e = 0); vehicles bounce off a little. */
    readonly kind: "vehicle" | "person",
  ) {}

  /** The owner's motion of it this frame (when not shoved). */
  setMotion(x: number, z: number, vx: number, vz: number, w: number): void {
    this.x = x;
    this.z = z;
    if (this.shoved) return;
    this.vx = vx;
    this.vz = vz;
    this.w = w;
  }

  /**
   * One frame of a shove: slows the slide by its grip (the yaw rate with it) and returns whether it
   * still moves. The owner adds (vx, vz)·dt and w·dt to the pose before calling this.
   */
  slow(dt: number): boolean {
    const speed = Math.hypot(this.vx, this.vz);
    const slowed = Math.max(0, speed - this.grip * dt);
    const k = speed > 0 ? slowed / speed : 0;
    this.vx *= k;
    this.vz *= k;
    // The tyres scrub the spin away too: as a slide of the ends at the same grip.
    this.w *= Math.max(0, 1 - dt * 3);
    const isMoving = slowed > 0.05 || Math.abs(this.w) > 0.05;
    if (!isMoving) {
      this.shoved = false;
      this.vx = 0;
      this.vz = 0;
      this.w = 0;
    }
    return isMoving;
  }
}

/**
 * Coefficient of restitution of a car-to-car blow at a closing speed (m/s): about 0.4 at a few
 * km/h (bumpers spring back), falling to 0.1 from 40 km/h on (the structure crushes). Assumed —
 * crash tests report this trend; the figures are rounded, not taken from one source.
 */
export function restitution(closing: number, kind: MassiveBody["kind"]): number {
  if (kind === "person") return 0;
  const kmh = closing * 3.6;
  return Math.max(0.1, Math.min(0.4, 0.4 - ((kmh - 5) / 35) * 0.3));
}

/**
 * Central (head-on) impact of two masses at a closing speed: each one's Δv and the energy lost.
 * j = (1+e)·v / (1/m1 + 1/m2); Δv1 = j/m1, Δv2 = j/m2; E = ½·μ·v²·(1−e²), μ = m1m2/(m1+m2).
 */
export function centralImpact(m1: number, m2: number, closing: number, e: number) {
  const reduced = (m1 * m2) / (m1 + m2);
  const j = (1 + e) * reduced * closing;
  return { dv1: j / m1, dv2: j / m2, energy: 0.5 * reduced * closing * closing * (1 - e * e) };
}

type CarEntry = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Yaw inertia of the car (kg·m²), for the effective mass at an off-centre contact. */
  yawInertia: () => number;
  /** Step each MassiveBody was last touching this car (a new impact when it was not, the step before). */
  touching: Map<MassiveBody, number>;
};

/** Penetration slop (m) and the share of the rest pushed apart per step (Baumgarte). */
const SLOP = 0.02;
const BIAS = 0.1;
const MAX_BIAS_SPEED = 0.5;
/** A contact point counts from this separation (m); Rapier reports points a little before touching. */
const TOUCH = 0.02;

/** A blow this module resolved: which car, what it hit (its owner) and how hard. */
export type Blow = { car: RAPIER.Collider; body: MassiveBody; impact: Impact };
/** Blows kept until the game takes them (a frame has a few steps; more than this is a pile-up). */
const MAX_BLOWS = 32;

export class MassContacts {
  private readonly cars: CarEntry[] = [];
  private blows: Blow[] = [];
  private readonly massive = new Map<number, MassiveBody>();
  private step = 0;
  // Scratch for the visit callbacks (bound once; no allocation per step of ours).
  private car: CarEntry | null = null;
  private deepest = 0;
  private points = 0;
  private readonly sum = { x: 0, y: 0, z: 0 };
  private readonly normal = { x: 0, y: 0, z: 0 };
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly local = { x: 0, y: 0, z: 0 };
  private readonly impulse = { x: 0, y: 0, z: 0 };
  private readonly at = { x: 0, y: 0, z: 0 };
  private dt = 1 / 60;

  constructor(private readonly world: RAPIER.World) {}

  /** A dynamic car whose contacts with massive bodies this module resolves. */
  addCar(body: RAPIER.RigidBody, collider: RAPIER.Collider, yawInertia: () => number): void {
    this.cars.push({ body, collider, yawInertia, touching: new Map() });
  }

  removeCar(collider: RAPIER.Collider): void {
    const i = this.cars.findIndex((c) => c.collider === collider);
    if (i >= 0) this.cars.splice(i, 1);
  }

  /** A kinematic collider with a mass; its solver groups are set so the cars' solver skips it. */
  add(collider: RAPIER.Collider, body: MassiveBody): void {
    collider.setSolverGroups(MASSIVE_SOLVER_GROUPS);
    this.massive.set(collider.handle, body);
  }

  remove(collider: RAPIER.Collider): void {
    const body = this.massive.get(collider.handle);
    this.massive.delete(collider.handle);
    if (!body) return;
    for (const car of this.cars) car.touching.delete(body);
  }

  /** The massive body behind a collider, if it is one. */
  /**
   * The blows since the last call, oldest first. The game judges accidents from these, not from
   * Rapier's contact events: by the time those are read the body hit may already be gone (a person
   * bowled over drops their collider), and the event then named nobody — no accident was booked.
   */
  takeBlows(): Blow[] {
    const taken = this.blows;
    this.blows = [];
    return taken;
  }

  bodyOf(handle: number): MassiveBody | null {
    return this.massive.get(handle) ?? null;
  }

  /** The impact on this collider's body in the last `steps` physics steps (null: none). */
  recentImpact(handle: number, steps = 8): Impact | null {
    const m = this.massive.get(handle);
    const isRecent = m !== undefined && m.impactStep >= 0 && this.step - m.impactStep <= steps;
    return isRecent ? m.impact : null;
  }

  /** After each world.step: resolve every car's contacts with massive bodies. */
  afterStep(dt: number): void {
    this.step++;
    this.dt = dt;
    for (const car of this.cars) {
      const isSimulated = car.body.isEnabled() && car.body.isDynamic();
      if (!isSimulated) continue;
      this.car = car;
      this.world.contactPairsWith(car.collider, this.visitPair);
    }
    this.car = null;
  }

  private readonly visitPair = (collider: RAPIER.Collider): void => {
    const other = this.massive.get(collider.handle);
    const car = this.car;
    if (!other || !car) return;
    this.deepest = Number.POSITIVE_INFINITY;
    this.points = 0;
    this.sum.x = 0;
    this.sum.y = 0;
    this.sum.z = 0;
    this.world.contactPair(car.collider, collider, this.visitManifold);
    const isTouching = this.points > 0;
    if (!isTouching) return;
    // The blow acts at the middle of the touching points. Why not the deepest one: a bumper square
    // on a flat side touches at both corners, and one corner alone would make a lever of the half
    // width and take a third off the effective mass.
    this.sum.x /= this.points;
    this.sum.y /= this.points;
    this.sum.z /= this.points;
    this.toWorld(this.sum);
    const last = car.touching.get(other);
    const isNewBlow = last === undefined || last < this.step - 1;
    car.touching.set(other, this.step);
    this.resolve(car, other, isNewBlow);
  };

  /** Keeps the deepest point of the manifolds (world space, on the car) and the normal car → other. */
  private readonly visitManifold = (manifold: RAPIER.TempContactManifold, flipped: boolean): void => {
    const n = manifold.numContacts();
    for (let i = 0; i < n; i++) {
      const d = manifold.contactDist(i);
      if (d > TOUCH) continue;
      // The point on the car: shape 1 unless flipped.
      const p = flipped
        ? manifold.localContactPoint2(i, this.local)
        : manifold.localContactPoint1(i, this.local);
      if (!p) continue;
      this.sum.x += p.x;
      this.sum.y += p.y;
      this.sum.z += p.z;
      this.points++;
      if (d >= this.deepest) continue;
      this.deepest = d;
      manifold.normal(this.normal);
      if (flipped) {
        this.normal.x = -this.normal.x;
        this.normal.y = -this.normal.y;
        this.normal.z = -this.normal.z;
      }
    }
  };

  /** The car collider's local point to world space (rotation by its quaternion, then translation). */
  private toWorld(p: { x: number; y: number; z: number }): void {
    const c = this.car?.collider;
    if (!c) return;
    const q = c.rotation();
    const t = c.translation();
    // v' = v + 2w(u×v) + 2u×(u×v), u = (qx, qy, qz).
    const cx = q.y * p.z - q.z * p.y;
    const cy = q.z * p.x - q.x * p.z;
    const cz = q.x * p.y - q.y * p.x;
    this.point.x = t.x + p.x + 2 * (q.w * cx + q.y * cz - q.z * cy);
    this.point.y = t.y + p.y + 2 * (q.w * cy + q.z * cx - q.x * cz);
    this.point.z = t.z + p.z + 2 * (q.w * cz + q.x * cy - q.y * cx);
  }

  /**
   * The exchange on the ground plane at the contact point: closing speed from both bodies' motion
   * there, the effective mass from both masses and yaw inertias, a restitution only on a new blow,
   * and a push-apart for any overlap left over.
   */
  private resolve(car: CarEntry, other: MassiveBody, isNewBlow: boolean): void {
    const len = Math.hypot(this.normal.x, this.normal.z);
    // A contact from straight above or below (riding up on it): not a blow on the ground plane.
    if (len < 0.3) return;
    const nx = this.normal.x / len;
    const nz = this.normal.z / len;
    const com = car.body.worldCom();
    const v = car.body.linvel();
    const wy = car.body.angvel().y;
    const ax = this.point.x - com.x;
    const az = this.point.z - com.z;
    const bx = this.point.x - other.x;
    const bz = this.point.z - other.z;
    // Velocity of each body at the point: v + ω×r (yaw only: ω×r = (ω·rz, 0, −ω·rx)).
    const vax = v.x + wy * az;
    const vaz = v.z - wy * ax;
    const vbx = other.vx + other.w * bz;
    const vbz = other.vz - other.w * bx;
    const closing = (vax - vbx) * nx + (vaz - vbz) * nz;
    const depth = Math.max(0, -this.deepest - SLOP);
    const push = Math.min(MAX_BIAS_SPEED, (BIAS * depth) / this.dt);
    const isApproaching = closing > 0;
    if (!isApproaching && push <= 0) return;
    const carKg = car.body.mass();
    const ra = az * nx - ax * nz;
    const rb = bz * nx - bx * nz;
    const k = 1 / carKg + (ra * ra) / car.yawInertia() + 1 / other.mass + (rb * rb) / other.yawInertia;
    const e = isNewBlow ? restitution(closing, other.kind) : 0;
    // To part at e·closing (a new blow) or at least at the push-apart speed: nothing if they part
    // faster already.
    const bounce = isApproaching ? e * closing : 0;
    const j = Math.max(0, (closing + bounce + push) / k);
    if (j <= 0) return;
    // On the car at the contact point, but at the height of its centre of mass: a blow at bumper
    // height would pitch it over the solver's own contacts with the road.
    this.impulse.x = -j * nx;
    this.impulse.y = 0;
    this.impulse.z = -j * nz;
    this.at.x = this.point.x;
    this.at.y = com.y;
    this.at.z = this.point.z;
    car.body.applyImpulseAtPoint(this.impulse, this.at, true);
    other.vx += (j * nx) / other.mass;
    other.vz += (j * nz) / other.mass;
    other.w += (j * (bz * nx - bx * nz)) / other.yawInertia;
    other.shoved = true;
    const isBlow = isNewBlow && closing > 0.3;
    if (!isBlow) return;
    const reduced = 1 / k;
    const im = other.impact;
    im.closing = closing;
    im.dvCar = j / carKg;
    im.dvOther = j / other.mass;
    im.energy = 0.5 * reduced * closing * closing * (1 - e * e);
    im.carKg = carKg;
    im.otherKg = other.mass;
    other.impactStep = this.step;
    if (this.blows.length < MAX_BLOWS) this.blows.push({ car: car.collider, body: other, impact: { ...im } });
  }
}

const perWorld = new WeakMap<RAPIER.World, MassContacts>();

/** The one MassContacts of a physics world (cars, traffic and people register with it). */
export function massContactsFor(world: RAPIER.World): MassContacts {
  let m = perWorld.get(world);
  if (!m) {
    m = new MassContacts(world);
    perWorld.set(world, m);
  }
  return m;
}
