import { Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import type { Frame, Pose } from "../src/game/replay";
import { ClipPose, CLIP_AFTER_MS, CLIP_BEFORE_MS, cutClip } from "../src/game/replayClip";

// A recording at 15 Hz: the car drives east at 10 m/s from x = 100; a bus follows 20 m behind,
// and an untagged object (no model description) and a far-away person are around.
function recording(untilMs: number) {
  const bus = new Object3D();
  bus.userData.replay = { type: "vehicle", kind: "bus" };
  const anon = new Object3D();
  const far = new Object3D();
  far.userData.replay = {
    type: "human",
    colors: { shirt: 1, pants: 2, skin: 3, hair: 4, umbrella: 5 },
    height: 1,
    variant: 7,
  };
  const frames: Frame[] = [];
  for (let t = 0; t <= untilMs; t += 1000 / 15) {
    const x = 100 + (t / 1000) * 10;
    const others = new Map<Object3D, Pose>([
      [bus, { x: x - 20, y: 0, z: 0, yaw: Math.PI / 2 }],
      [anon, { x: x + 5, y: 0, z: 3, yaw: 0 }],
      [far, { x: 900, y: 0, z: 900, yaw: 0 }],
    ]);
    frames.push({ t, car: { x, y: 0.5, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 10 }, others });
  }
  return { frames, bus };
}

describe("違反の再現データ", () => {
  const frame = new LocalFrame(35.68, 139.76, 40);
  const moment = { ms: Date.UTC(2026, 9, 4, 2, 30), raining: true };

  it("waits until the 5 s after the violation are recorded", () => {
    const { frames } = recording(12_000);
    expect(cutClip(frames, 9_000, frame, { onFoot: false, moment })).toBeNull();
    expect(cutClip(frames, 7_000, frame, { onFoot: false, moment })).not.toBeNull();
  });

  it("keeps 5 s either side, the time and the rain", () => {
    const { frames } = recording(20_000);
    const clip = cutClip(frames, 10_000, frame, { onFoot: false, moment });
    expect(clip).not.toBeNull();
    if (!clip) return;
    expect(clip.t0).toBeGreaterThanOrEqual(10_000 - CLIP_BEFORE_MS);
    expect(clip.t0).toBeLessThan(10_000 - CLIP_BEFORE_MS + 100);
    expect(clip.t0 + (clip.count - 1) * clip.step).toBeGreaterThan(10_000 + CLIP_AFTER_MS - 100);
    expect(clip.moment).toEqual(moment);
  });

  it("keeps only nearby actors that can be built again", () => {
    const { frames } = recording(20_000);
    const clip = cutClip(frames, 10_000, frame, { onFoot: false, moment });
    expect(clip?.actors.map((a) => a.desc)).toEqual([{ type: "vehicle", kind: "bus" }]);
  });

  it("plays back where it happened, in a session whose frame has another origin", () => {
    const { frames } = recording(20_000);
    const clip = cutClip(frames, 10_000, frame, { onFoot: false, moment });
    if (!clip) throw new Error("no clip");
    // Saved as numbers only: a structured clone, as IndexedDB keeps it.
    const saved = structuredClone(clip);
    const later = new LocalFrame(35.69, 139.77, 30);
    const pose = new ClipPose(saved, later);
    const pos = new Vector3();
    const speed = pose.car(10_000 - saved.t0, pos, new Quaternion());
    const g = later.toGeodetic(pos);
    const original = frame.toGeodetic(new Vector3(200, 0.5, 0));
    expect(speed).toBeCloseTo(10, 3);
    expect(g.lat).toBeCloseTo(original.lat, 6);
    expect(g.lon).toBeCloseTo(original.lon, 6);
    // The bus is 20 m behind the car at that moment.
    const bus = pose.actor(0, 10_000 - saved.t0);
    expect(bus && Math.hypot(bus.x - pos.x, bus.z - pos.z)).toBeCloseTo(20, 0);
  });
});
