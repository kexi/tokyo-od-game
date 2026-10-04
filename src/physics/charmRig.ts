import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";

/**
 * ミラーの飾り: a plush toy and/or an お守り hanging on a cord from the stay of the player's
 * rear-view mirror, simulated with Rapier: a cord of short capsules joined by spherical joints and
 * the charm at its end, swinging in the cabin as the car accelerates, brakes, corners and bumps.
 *
 * How: a small Rapier world of its own whose origin rides on the knot under the stay and whose axes
 * stay those of the game world (a translating, non-rotating frame). In such a frame the only
 * inertial force is uniform, so the car's motion enters exactly as a changed gravity,
 * g − a(knot), with a(knot) from the chassis velocity at the knot each physics step; the car's
 * turning enters as the kinematic anchor (and the mirror housing, windscreen and roof on it)
 * rotating with the chassis, which twists the cord through its joint springs.
 *
 * Why not bodies in the main world, the anchor a kinematic body on the chassis: the main world is
 * centred up to 1.5 km away (f32 positions there are ~0.1 mm apart, the size of the joint error
 * that makes a 3 mm cord shimmer at rest), the frame is re-anchored and the car teleported by
 * main.ts (each would need its own hook to carry the cord along), every scene query in the game
 * that does not filter by group would hit the cord, and a crash hands the chassis a 10 m/s change
 * in one step that the cord cannot be shielded from. Here the solver settings fit 0.3–30 g bodies,
 * the crash load is capped, and the frame's jumps are told apart from motion (frameStep).
 */
export type CharmKind = "plush" | "omamori";

type Vec3 = readonly [number, number, number];

/** A charm's body: its frame hangs along −Y from the loop at the origin, the face toward +Z. */
export type CharmBody = {
  /** kg */
  mass: number;
  /** Centre of mass below the loop (m). */
  com: Vec3;
  /** Principal moments of inertia about the centre of mass (kg·m²). */
  inertia: Vec3;
  /** The one collider, which also carries the mass properties (see addChain). */
  shape:
    | { kind: "capsule"; at: Vec3; halfHeight: number; radius: number }
    | { kind: "box"; at: Vec3; half: Vec3; border: number };
  /** Air drag and the cord rubbing on the stay, as Rapier's linear damping (1/s). */
  damping: number;
};

export type CordSpec = {
  segments: number;
  /** Length of each segment (m). */
  segment: number;
  /** Cord radius (m). */
  radius: number;
  /** Mass of each segment (kg). */
  mass: number;
};

/**
 * A small round bear (scripts/blender/mirror_charms.py): 5.8 cm from the loop to the feet, 3.6 cm
 * wide, 30 g (plush keyrings sold as mirror charms weigh 20–40 g). One capsule from the crown to
 * the feet for the contacts; the inertia is that of its head and body as two balls.
 */
export const PLUSH: CharmBody = {
  mass: 0.03,
  com: [0, -0.029, 0],
  inertia: [7.5e-6, 3.2e-6, 7.5e-6],
  shape: { kind: "capsule", at: [0, -0.03, 0], halfHeight: 0.012, radius: 0.016 },
  damping: 2.4,
};

/**
 * An お守り: a brocade pouch 4.4 × 6.6 × 1.0 cm under its knot, 6 g (cloth over a card insert).
 * A round box for the pouch; the inertia is the box's.
 */
export const OMAMORI: CharmBody = {
  mass: 0.006,
  com: [0, -0.046, 0],
  inertia: [2.3e-6, 1.0e-6, 3.2e-6],
  shape: { kind: "box", at: [0, -0.046, 0], half: [0.022, 0.033, 0.005], border: 0.003 },
  // Flat and light: the air slows it more than the plush.
  damping: 3,
};

export const BODIES: Record<CharmKind, CharmBody> = { plush: PLUSH, omamori: OMAMORI };

/**
 * Cords: 3 mm braided cord in segments of 2–2.5 cm. Each segment is heavier than real cord
 * (0.3–0.5 g against ~0.08 g). Why not the real mass: at 400:1 to the plush the iterative solver
 * lets the chain stretch and buzz; at 60:1 the 12 cm cord stretches 1.4 mm.
 */
export const CORDS: Record<"single" | "pair", Record<CharmKind, CordSpec>> = {
  // Alone: the bear's head 2.5 cm under the mirror; the pouch on a shorter cord.
  single: {
    plush: { segments: 5, segment: 0.024, radius: 0.0015, mass: 0.0005 },
    omamori: { segments: 4, segment: 0.025, radius: 0.0015, mass: 0.0003 },
  },
  // Together on the one stay: side by side on their own cords, the pouch a little higher; they
  // lean on each other and splay apart a little, as two charms on one stay do.
  pair: {
    plush: { segments: 5, segment: 0.025, radius: 0.0015, mass: 0.0005 },
    omamori: { segments: 4, segment: 0.0225, radius: 0.0015, mass: 0.0003 },
  },
};

/** Where the charms hang and what they can touch, in the car's frame (+Y up, +Z forward, +X left). */
export type Cabin = {
  /** The knot under the mirror stay: the top of the cord. */
  hang: Vector3;
  housing: { centre: Vector3; half: Vector3; rotation: Quaternion };
  /** The inner windscreen near the mirror: a point on it and its normal into the cabin. */
  glass: { point: Vector3; inward: Vector3 };
  /** Height of the roof lining just behind the stay. */
  roofY: number;
  /** The charms' rest heading about the car's up (radians): their faces toward the driver's eye. */
  faceYaw: number;
};

/**
 * The cabin around the mirror from Mirror_Rear (its centre and driver-facing normal, car frame)
 * and the driver's eye, after scripts/blender/cockpit.py: the stay runs from 2 cm above the mirror
 * centre to its mount on the glass at centre + (0.012, 0.072, 0.045); the housing is
 * 25.2 × 7.2 × 3.4 cm behind the mirror face. The cord is knotted 95% of the way up the stay,
 * where it hangs clear of the housing's back (3 mm at its lower edge); lower on the stay it would
 * rest on it. The glass plane and the roof height were measured on cockpit.glb (ray casts at
 * x = 0: the inner glass at y 0.40 / 0.50 is at z 0.518 / 0.298; the lining behind the stay is at
 * y 0.515–0.527).
 */
export function cabinFromMirror(centre: Vector3, normal: Vector3, eye: Vector3): Cabin {
  const n = normal.clone().normalize();
  const stayLow = centre.clone().add(new Vector3(0, 0.02, 0));
  const mount = centre.clone().add(new Vector3(0.012, 0.072, 0.045));
  const knot = stayLow.lerp(mount, 0.95).add(new Vector3(0, -0.009, 0));
  // The housing's frame as cockpit.py's facing(): +Z the normal, +Y as near up as it can be.
  const up = new Vector3(0, 1, 0);
  const y = up
    .clone()
    .sub(n.clone().multiplyScalar(up.dot(n)))
    .normalize();
  const x = y.clone().cross(n);
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, n));
  const toEye = eye.clone().sub(knot);
  return {
    hang: knot,
    housing: {
      centre: centre.clone().addScaledVector(n, -0.017),
      half: new Vector3(0.126, 0.036, 0.017),
      rotation,
    },
    glass: { point: new Vector3(0, 0.45, 0.4105), inward: new Vector3(0, -0.91, -0.413).normalize() },
    roofY: 0.515,
    faceYaw: Math.atan2(toEye.x, toEye.z),
  };
}

/** Mirror_Rear and the eye as cockpit.glb has them (for tests and before the model loads). */
export const DEFAULT_CABIN = cabinFromMirror(
  new Vector3(-0.012, 0.444, 0.1325),
  new Vector3(-0.3733, -0.1448, -0.9163),
  new Vector3(-0.37, 0.351, -0.073),
);

/**
 * The cord laid straight from `top` along `down` (unit): its joint points (the top, the joints
 * between segments, the charm's loop at the end) and the segment centres.
 */
export function cordLayout(
  top: Vector3,
  down: Vector3,
  cord: Pick<CordSpec, "segments" | "segment">,
): { joints: Vector3[]; centres: Vector3[] } {
  const at = (s: number) => top.clone().addScaledVector(down, s * cord.segment);
  const joints = Array.from({ length: cord.segments + 1 }, (_, i) => at(i));
  const centres = Array.from({ length: cord.segments }, (_, i) => at(i + 0.5));
  return { joints, centres };
}

/** The chassis at the knot, in the game world: where it is, how fast it moves and turns. */
export type ChassisSample = {
  at: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  angvel: Vector3;
};

/**
 * Over this the knot's acceleration is capped (m/s²): about 8 g. A crash then throws the charm up
 * against the glass (a 60 km/h stop in 3 steps: an 83° swing) and it still hangs together; at
 * 150 m/s² the cord stretched 5 mm and the bear spun round.
 */
export const MAX_ACCEL = 80;
/** A position this far off the step's own motion is a jump of the frame, not motion (m). */
const JUMP_M = 1;
/** A turn this much more than the angular velocity explains is a jump too (rad). */
const JUMP_RAD = 0.35;
/** Stopped dead by a jump: what Vehicle.teleport leaves (m/s, rad/s). */
const STILL = 0.05;

/**
 * What one stretch of the chassis' motion means for the charms. `move`: real motion, with the
 * knot's acceleration (capped at `limit`: a crash in this game stops the chassis in one 1/60 s
 * step, 600 m/s², which a 30 g charm on a cord would answer by wrapping the stay). `shift`: the
 * frame was re-anchored (main.ts recenter: positions jump by kilometres, the motion carries on), so
 * no acceleration. `teleport`: put somewhere else and stopped (respawn, warp, street spawn), so
 * the charms are hung up afresh.
 */
export function frameStep(
  prev: ChassisSample,
  now: ChassisSample,
  dt: number,
  limit = MAX_ACCEL,
): { kind: "move" | "shift" | "teleport"; accel: Vector3 } {
  const travelled = prev.velocity
    .clone()
    .add(now.velocity)
    .multiplyScalar(dt / 2);
  const offPath = now.at.distanceTo(prev.at.clone().add(travelled));
  const spin = Math.max(prev.angvel.length(), now.angvel.length()) * dt;
  const turned = prev.rotation.angleTo(now.rotation);
  const isJump = offPath > JUMP_M || turned > spin + JUMP_RAD;
  const isStopped = now.velocity.length() < STILL && now.angvel.length() < STILL;
  if (isJump && isStopped) return { kind: "teleport", accel: new Vector3() };
  if (isJump) return { kind: "shift", accel: new Vector3() };
  const accel = now.velocity.clone().sub(prev.velocity).divideScalar(Math.max(dt, 1e-4));
  const isOverLimit = accel.length() > limit;
  if (isOverLimit) accel.setLength(limit);
  return { kind: "move", accel };
}

// Collision groups (membership << 16 | filter): the cabin touches cords and charms, cords only
// the cabin (their own joints carry them), charms the cabin and each other.
const CABIN = 0x1;
const CORD = 0x2;
const CHARM = 0x4;
const groups = (member: number, filter: number) => (member << 16) | filter;
const ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * The charm world steps at 120 Hz with 16 solver iterations (Rapier's TGS substeps): the cord then
 * stretches 1.4 mm under the bear (1.2%); 8 iterations gave 5.8 mm, a visibly bouncing cord.
 */
const DT = 1 / 120;
const ITERATIONS = 16;
const GRAVITY = 9.81;
/**
 * The cord's friction at each joint (Rapier ForceBased velocity motors, N·m·s/rad, on all three
 * axes): it damps the light segments' wiggle. No joint springs: Why not the twist as position
 * motors on each joint's Y: in series their stiffness and damping depend on the segment count and
 * on the segments' raised inertia, while the cord's torsion acts on the charm (twistBack) in one
 * place; and AccelerationBased motors scale by the joint's effective inertia, the 0.5 g segment's,
 * which the charm at the end would barely feel.
 */
const CORD_FRICTION = 2e-6;
/**
 * Torsion of the cord (N·m/rad for a 1 m cord, so k = TORSION / length): a braided cord turns back
 * once twisted. On the bear's 12 cm cord, 6.4e-5 N·m/rad: a twist swings back and forth in ~1.4 s.
 * Its damping is TWIST_DAMPING of critical, so a twist settles in a few swings.
 */
const TORSION = 7.7e-6;
const TWIST_DAMPING = 0.25;
/** Smooths the knot's acceleration (s): the suspension's 60 Hz chatter is not the car's motion. */
const ACCEL_SMOOTH = 0.03;

export type Chain = {
  kind: CharmKind;
  cord: CordSpec;
  /** The knot of this cord in the car frame (two charms hang side by side). */
  top: Vector3;
  segments: RAPIER.RigidBody[];
  body: RAPIER.RigidBody;
  /** The cord's torsion spring and damper on the charm (N·m/rad, N·m·s/rad). */
  twist: { k: number; c: number };
};

export type ChainPose = {
  /** The cord's joint points from the knot to the charm's loop, in the car frame. */
  points: Vector3[];
  position: Vector3;
  quaternion: Quaternion;
};

/** The charms hanging in the car: build with the kinds to hang, then follow the chassis. */
export class CharmRig {
  readonly cabin: Cabin;
  readonly world: RAPIER.World;
  readonly chains: Chain[] = [];
  private readonly anchor: RAPIER.RigidBody;
  /** The anchor's rotation is the car's turned by this, so the charms' rest faces the driver. */
  private readonly rest: Quaternion;
  private last: ChassisSample | null = null;
  private readonly accel = new Vector3();
  private carRotation = new Quaternion();
  /** What happened on the last follow (for the dev hook and tests). */
  lastStep: "move" | "shift" | "teleport" | "seat" = "seat";

  constructor(cabin: Cabin, kinds: readonly CharmKind[]) {
    this.cabin = cabin;
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = DT;
    // Tolerances for 3 mm cords and 5 cm charms (the defaults are for metre-sized bodies).
    this.world.lengthUnit = 0.1;
    this.world.numSolverIterations = ITERATIONS;
    this.rest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), cabin.faceYaw);
    this.anchor = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.addCabin();
    const layout = kinds.length > 1 ? CORDS.pair : CORDS.single;
    // Side by side on the stay when both hang: their knots 12 mm either side, along the car's X.
    for (const [i, kind] of kinds.entries()) {
      const side = kinds.length > 1 ? (i === 0 ? -0.012 : 0.012) : 0;
      this.addChain(kind, layout[kind], new Vector3(side, 0, 0));
    }
    this.seat(new Quaternion());
  }

  /** The anchor's frame for a point given in the car frame relative to the knot. */
  private local(carOffset: Vector3): Vector3 {
    return carOffset.clone().applyQuaternion(this.rest.clone().invert());
  }

  /** The mirror housing, the windscreen and the roof, carried by the anchor. */
  private addCabin(): void {
    const c = this.cabin;
    const unrest = this.rest.clone().invert();
    const put = (desc: RAPIER.ColliderDesc, carAt: Vector3, carRotation: Quaternion) => {
      const at = this.local(carAt.clone().sub(c.hang));
      desc
        .setTranslation(at.x, at.y, at.z)
        .setRotation(unrest.clone().multiply(carRotation))
        .setCollisionGroups(groups(CABIN, CORD | CHARM))
        .setFriction(0.6)
        .setRestitution(0.05);
      this.world.createCollider(desc, this.anchor);
    };
    // The housing's bevelled edges (1.2 cm) as a round box.
    const h = c.housing.half;
    put(
      RAPIER.ColliderDesc.roundCuboid(h.x - 0.008, h.y - 0.008, h.z - 0.008, 0.008),
      c.housing.centre,
      c.housing.rotation,
    );
    // The glass: a slab whose inner face is the windscreen's plane near the mirror.
    const glassRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), c.glass.inward);
    put(
      RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.01),
      c.glass.point.clone().addScaledVector(c.glass.inward, -0.01),
      glassRotation,
    );
    put(
      RAPIER.ColliderDesc.cuboid(0.4, 0.01, 0.3),
      new Vector3(0, c.roofY + 0.01, c.hang.z - 0.25),
      new Quaternion(),
    );
  }

  private addChain(kind: CharmKind, cord: CordSpec, top: Vector3): void {
    const spec = BODIES[kind];
    const segments: RAPIER.RigidBody[] = [];
    // Each segment: local +Y up the cord, its joints at ±half a segment.
    const half = cord.segment / 2;
    const rodInertia = (cord.mass * cord.segment * cord.segment) / 12;
    for (let i = 0; i < cord.segments; i++) {
      // The twist inertia raised to the bending one: Why not a thin rod's real m r²/2 (40 times
      // smaller): the joint friction would then spin it at kHz rates, past what 120 Hz follows.
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.6).setAngularDamping(0.2).setCanSleep(false),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.capsule(Math.max(0.0005, half - cord.radius), cord.radius)
          .setMassProperties(cord.mass, ZERO, { x: rodInertia, y: rodInertia, z: rodInertia }, IDENTITY)
          .setFriction(0.5)
          .setCollisionGroups(groups(CORD, CABIN)),
        body,
      );
      segments.push(body);
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(spec.damping).setAngularDamping(0.3).setCanSleep(false),
    );
    // All the mass on the one collider. Why not RigidBodyDesc.setAdditionalMassProperties with
    // massless colliders: Rapier 0.21 merges the two into a wrong principal frame (Ixx and Iyy
    // swapped), and the bear, no longer round about its cord, wound itself up on every swing.
    const [ax, ay, az] = spec.shape.at;
    const [cx, cy, cz] = spec.com;
    const [ix, iy, iz] = spec.inertia;
    const shape =
      spec.shape.kind === "capsule"
        ? RAPIER.ColliderDesc.capsule(spec.shape.halfHeight, spec.shape.radius)
        : RAPIER.ColliderDesc.roundCuboid(
            spec.shape.half[0] - spec.shape.border,
            spec.shape.half[1] - spec.shape.border,
            spec.shape.half[2] - spec.shape.border,
            spec.shape.border,
          );
    this.world.createCollider(
      shape
        .setTranslation(ax, ay, az)
        .setMassProperties(
          spec.mass,
          { x: cx - ax, y: cy - ay, z: cz - az },
          { x: ix, y: iy, z: iz },
          IDENTITY,
        )
        .setFriction(0.7)
        .setRestitution(0.05)
        .setCollisionGroups(groups(CHARM, CABIN | CHARM)),
      body,
    );
    // Spherical joints: anchor → segments → charm, each with the cord's friction.
    const links: Array<[RAPIER.RigidBody, Vector3, RAPIER.RigidBody, Vector3]> = [];
    links.push([this.anchor, this.local(top), segments[0], new Vector3(0, half, 0)]);
    for (let i = 1; i < segments.length; i++)
      links.push([segments[i - 1], new Vector3(0, -half, 0), segments[i], new Vector3(0, half, 0)]);
    links.push([segments[segments.length - 1], new Vector3(0, -half, 0), body, new Vector3()]);
    for (const [a, pa, b, pb] of links) {
      const created = this.world.createImpulseJoint(RAPIER.JointData.spherical(pa, pb), a, b, true);
      // Rapier 0.21 reports a spherical joint's raw type as Generic, so createImpulseJoint hands
      // back a GenericImpulseJoint without the per-axis motors: wrap the same handle.
      const joint = new RAPIER.SphericalImpulseJoint(
        this.world.impulseJoints.raw,
        this.world.bodies,
        created.handle,
      );
      joint.setContactsEnabled(false);
      for (const axis of [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ]) {
        joint.configureMotorModel(axis, RAPIER.MotorModel.ForceBased);
        joint.configureMotorVelocity(axis, 0, CORD_FRICTION);
      }
    }
    const k = TORSION / (cord.segments * cord.segment);
    const c = 2 * TWIST_DAMPING * Math.sqrt(k * iy);
    this.chains.push({ kind, cord, top, segments, body, twist: { k, c } });
  }

  /**
   * Hang every charm straight down (the game world's down, the car turned as `rotation`), at rest,
   * facing the driver: when the game starts, after a teleport, or when the choice changes.
   */
  seat(rotation: Quaternion): void {
    this.carRotation.copy(rotation);
    const anchorRotation = rotation.clone().multiply(this.rest);
    this.anchor.setRotation(anchorRotation, false);
    this.anchor.setNextKinematicRotation(anchorRotation);
    const down = new Vector3(0, -1, 0);
    // The cord's frame: the anchor's, swung from the car's down onto the world's.
    const carDown = down.clone().applyQuaternion(rotation);
    const hanging = new Quaternion().setFromUnitVectors(carDown, down).multiply(anchorRotation);
    const zero = { x: 0, y: 0, z: 0 };
    for (const chain of this.chains) {
      const top = chain.top.clone().applyQuaternion(rotation);
      const { joints, centres } = cordLayout(top, down, chain.cord);
      for (const [i, s] of chain.segments.entries()) {
        s.setTranslation(centres[i], false);
        s.setRotation(hanging, false);
        s.setLinvel(zero, false);
        s.setAngvel(zero, true);
      }
      chain.body.setTranslation(joints[joints.length - 1], false);
      chain.body.setRotation(hanging, false);
      chain.body.setLinvel(zero, false);
      chain.body.setAngvel(zero, true);
    }
    this.accel.set(0, 0, 0);
    this.world.gravity = { x: 0, y: -GRAVITY, z: 0 };
    this.lastStep = "seat";
  }

  /**
   * Advance by `elapsed` seconds of the game's physics, the chassis now as `now` (its velocity
   * and turn at the knot). The first call seats the charms.
   */
  follow(now: ChassisSample, elapsed: number): void {
    const prev = this.last;
    this.last = {
      at: now.at.clone(),
      velocity: now.velocity.clone(),
      rotation: now.rotation.clone(),
      angvel: now.angvel.clone(),
    };
    if (!prev) {
      this.seat(now.rotation);
      return;
    }
    if (elapsed <= 0) return;
    const step = frameStep(prev, now, elapsed);
    this.lastStep = step.kind;
    if (step.kind === "teleport") {
      this.seat(now.rotation);
      return;
    }
    // A re-anchored frame keeps the smoothed acceleration as it was.
    if (step.kind === "move") this.accel.lerp(step.accel, 1 - Math.exp(-elapsed / ACCEL_SMOOTH));
    this.world.gravity = { x: -this.accel.x, y: -GRAVITY - this.accel.y, z: -this.accel.z };
    const steps = Math.max(1, Math.round(elapsed / DT));
    this.world.timestep = elapsed / steps;
    const from = this.carRotation.clone();
    for (let i = 1; i <= steps; i++) {
      const turn = from
        .clone()
        .slerp(now.rotation, i / steps)
        .multiply(this.rest);
      this.anchor.setNextKinematicRotation(turn);
      for (const chain of this.chains) twistBack(chain, turn, now.angvel);
      this.world.step();
    }
    this.carRotation.copy(now.rotation);
  }

  /** The knot's acceleration the charms feel now (smoothed and capped, m/s²). */
  feltAcceleration(): Vector3 {
    return this.accel.clone();
  }

  /** Each chain's cord and charm in the car frame (relative to the car body's origin). */
  poses(): ChainPose[] {
    const inv = this.carRotation.clone().invert();
    const toCar = (p: { x: number; y: number; z: number }) =>
      new Vector3(p.x, p.y, p.z).applyQuaternion(inv).add(this.cabin.hang);
    return this.chains.map((chain) => {
      const points = [toCar(chain.top.clone().applyQuaternion(this.carRotation))];
      const half = chain.cord.segment / 2;
      for (const s of chain.segments) {
        const r = s.rotation();
        const q = new Quaternion(r.x, r.y, r.z, r.w);
        const t = s.translation();
        points.push(toCar(new Vector3(0, -half, 0).applyQuaternion(q).add(new Vector3(t.x, t.y, t.z))));
      }
      const r = chain.body.rotation();
      return {
        points,
        position: toCar(chain.body.translation()),
        quaternion: inv.clone().multiply(new Quaternion(r.x, r.y, r.z, r.w)),
      };
    });
  }

  dispose(): void {
    this.world.free();
  }
}

/**
 * The cord's torsion on the charm: the twist of the charm about its own up axis relative to the
 * anchor (the swing-twist split of their relative rotation), sprung back toward the rest heading
 * and damped against the car's own turn (the cord's top turns with the car). Explicit: with the
 * charm's inertia this is a 4–9 rad/s oscillator, which a 120 Hz step follows easily.
 */
function twistBack(chain: Chain, anchor: Quaternion, carSpin: Vector3): void {
  const r = chain.body.rotation();
  const q = new Quaternion(r.x, r.y, r.z, r.w);
  const rel = anchor.clone().invert().multiply(q);
  const angle = twistAngle(rel);
  const axis = new Vector3(0, 1, 0).applyQuaternion(q);
  const w = chain.body.angvel();
  const spin = new Vector3(w.x, w.y, w.z).sub(carSpin).dot(axis);
  const torque = axis.multiplyScalar(-(chain.twist.k * angle + chain.twist.c * spin));
  chain.body.resetTorques(false);
  chain.body.addTorque(torque, true);
}

/** The twist about local +Y of a rotation (the swing-twist split), in (−π, π]. */
export function twistAngle(q: Quaternion): number {
  const a = 2 * Math.atan2(q.y, q.w);
  return Math.atan2(Math.sin(a), Math.cos(a));
}
