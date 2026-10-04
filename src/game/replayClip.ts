import { Quaternion, Vector3, type Object3D } from "three";
import type { LocalFrame } from "../geo/frame";
import type { HumanColors } from "../world/human";
import type { Frame } from "./replay";
import type { VehicleKind } from "./vehicleModels";

/**
 * 違反の再現データ: what is needed to play a violation again after the page is reloaded — the
 * player's car and the traffic and people around it, sampled from the replay recording from a few
 * seconds before to a few after, plus where and when it was (so the world, the sun and the rain
 * come back) and the signal clock. No video: the game renders it again from these numbers.
 *
 * Positions are stored as offsets from the violation's spot, whose latitude/longitude is kept, so a
 * clip plays in any later session even though each session's local frame has its own origin.
 * Actors carry a description of their model (`userData.replay`, set where they are made) so they
 * can be built again.
 */
export type ActorDesc =
  | { type: "vehicle"; kind: VehicleKind }
  | { type: "lowCar"; color: number; taxi?: boolean }
  | { type: "human"; colors: HumanColors; height: number; variant: number };

export type ReplayClip = {
  /** Where the violation happened (the offsets' origin). */
  origin: { lat: number; lon: number; h: number };
  /** Game-loop time (ms) of the first sample in the original session: the signals' clock. */
  t0: number;
  /** The violation's moment, in the same clock. */
  at: number;
  /** ms between samples. */
  step: number;
  count: number;
  /** Per sample: dx dy dz qx qy qz qw speed (m/s). */
  car: Float32Array;
  /** Whether the player was on foot (then `car` is the walker). */
  onFoot: boolean;
  /** Per actor and sample: present (0/1), dx, dy, dz, yaw. */
  actors: Array<{ desc: ActorDesc; poses: Float32Array }>;
  /** The game's date and time (epoch ms) and the rain, for the sky. */
  moment: { ms: number; raining: boolean };
};

const CAR_STRIDE = 8;
const ACTOR_STRIDE = 5;
/** Actors further than this from the violation's spot are not kept. */
const NEAR_M = 120;
const MAX_ACTORS = 60;

export const CLIP_BEFORE_MS = 5000;
export const CLIP_AFTER_MS = 5000;

/** Cut a clip around `at` from the recording; null when the recording does not cover it yet. */
export function cutClip(
  frames: readonly Frame[],
  at: number,
  frame: LocalFrame,
  opts: { onFoot: boolean; moment: { ms: number; raining: boolean } },
): ReplayClip | null {
  const span = frames.filter((f) => f.t >= at - CLIP_BEFORE_MS && f.t <= at + CLIP_AFTER_MS);
  const isCovered = span.length > 4 && span[span.length - 1].t >= at + CLIP_AFTER_MS - 200;
  if (!isCovered) return null;
  const pivot = span.reduce((best, f) => (Math.abs(f.t - at) < Math.abs(best.t - at) ? f : best));
  const o = new Vector3(pivot.car.x, pivot.car.y, pivot.car.z);
  const origin = frame.toGeodetic(o);
  const count = span.length;
  const step = (span[count - 1].t - span[0].t) / Math.max(1, count - 1);
  const car = new Float32Array(count * CAR_STRIDE);
  span.forEach((f, i) => {
    const c = f.car;
    car.set([c.x - o.x, c.y - o.y, c.z - o.z, c.qx, c.qy, c.qz, c.qw, c.speed], i * CAR_STRIDE);
  });
  // The actors seen near the spot, with a model description, closest first.
  const seen = new Map<Object3D, number>();
  for (const f of span)
    for (const [obj, p] of f.others) {
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      const isNear = d < NEAR_M && obj.userData.replay !== undefined;
      if (isNear) seen.set(obj, Math.min(seen.get(obj) ?? Infinity, d));
    }
  const chosen = [...seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, MAX_ACTORS);
  const actors = chosen.map(([obj]) => {
    const poses = new Float32Array(count * ACTOR_STRIDE);
    span.forEach((f, i) => {
      const p = f.others.get(obj);
      if (p) poses.set([1, p.x - o.x, p.y - o.y, p.z - o.z, p.yaw], i * ACTOR_STRIDE);
    });
    return { desc: obj.userData.replay as ActorDesc, poses };
  });
  return {
    origin: { lat: origin.lat, lon: origin.lon, h: origin.h },
    t0: span[0].t,
    at,
    step,
    count,
    car,
    onFoot: opts.onFoot,
    actors,
    moment: opts.moment,
  };
}

/** Where the clip's samples are at clip time t (ms from t0): the two samples and the blend. */
function blend(clip: ReplayClip, t: number): { i: number; j: number; k: number } {
  const x = Math.max(0, Math.min(clip.count - 1, t / clip.step));
  const i = Math.floor(x);
  return { i, j: Math.min(clip.count - 1, i + 1), k: x - i };
}

/** Plays a saved clip in the current session's local frame. */
export class ClipPose {
  readonly base: Vector3;

  constructor(
    readonly clip: ReplayClip,
    frame: LocalFrame,
  ) {
    this.base = frame.toLocal(clip.origin.lat, clip.origin.lon, clip.origin.h);
  }

  get duration(): number {
    return (this.clip.count - 1) * this.clip.step;
  }

  car(t: number, pos: Vector3, quat: Quaternion): number {
    const { i, j, k } = blend(this.clip, t);
    const c = this.clip.car;
    const a = i * CAR_STRIDE;
    const b = j * CAR_STRIDE;
    pos.set(
      this.base.x + c[a] + (c[b] - c[a]) * k,
      this.base.y + c[a + 1] + (c[b + 1] - c[a + 1]) * k,
      this.base.z + c[a + 2] + (c[b + 2] - c[a + 2]) * k,
    );
    quat
      .set(c[a + 3], c[a + 4], c[a + 5], c[a + 6])
      .slerp(new Quaternion(c[b + 3], c[b + 4], c[b + 5], c[b + 6]), k);
    return c[a + 7] + (c[b + 7] - c[a + 7]) * k;
  }

  /** An actor's pose at t, or null when it was not there then. */
  actor(index: number, t: number): { x: number; y: number; z: number; yaw: number } | null {
    const { i, j, k } = blend(this.clip, t);
    const p = this.clip.actors[index].poses;
    const a = i * ACTOR_STRIDE;
    const b = p[j * ACTOR_STRIDE] ? j * ACTOR_STRIDE : a;
    if (!p[a]) return null;
    const turn = Math.atan2(Math.sin(p[b + 4] - p[a + 4]), Math.cos(p[b + 4] - p[a + 4]));
    return {
      x: this.base.x + p[a + 1] + (p[b + 1] - p[a + 1]) * k,
      y: this.base.y + p[a + 2] + (p[b + 2] - p[a + 2]) * k,
      z: this.base.z + p[a + 3] + (p[b + 3] - p[a + 3]) * k,
      yaw: p[a + 4] + turn * k,
    };
  }
}
