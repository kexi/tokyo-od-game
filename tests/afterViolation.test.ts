import { describe, expect, it } from "vitest";
import { Color } from "three";
import { Busy, DueQueue, FrameGate } from "../src/game/frameSlices";
import { developRows, type Look } from "../src/game/photoDevelop";
import { SocialFeed, type SocialPost } from "../src/game/social";
import { VIOLATIONS, type ViolationRecord } from "../src/game/traffic";
import { PROBE_SHOWN, probeSees } from "../src/game/witnessShot";
import { acesInverse } from "../src/render/untonemapped";

// The work after a violation, spread over the frames that follow it (frameSlices.ts, main's book
// and afterViolations, witnessShot.ts): what each piece guarantees.

/** Lets every pending promise callback run (a turn's work runs in the microtasks after a tick). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A promise settled from outside. */
function deferred() {
  const ends: { resolve?: () => void; reject?: (e: Error) => void } = {};
  const promise = new Promise<void>((resolve, reject) => Object.assign(ends, { resolve, reject }));
  return { promise, resolve: () => ends.resolve?.(), reject: (e: Error) => ends.reject?.(e) };
}

describe("FrameGate: one off-screen render a frame, never in the frame that asked", () => {
  it("does not grant a turn in the frame it was asked for, only at a later frame's tick", async () => {
    const gate = new FrameGate();
    let went = false;
    // Asked during frame 1 (a violation in the game's update), before that frame's tick.
    void gate.turn().then(() => (went = true));
    expect(gate.tick()).toBe(false);
    await settle();
    expect(went).toBe(false);
    expect(gate.tick()).toBe(true);
    await settle();
    expect(went).toBe(true);
  });

  it("grants one turn per tick, first come first served", async () => {
    const gate = new FrameGate();
    const order: number[] = [];
    for (const n of [1, 2, 3]) void gate.turn().then(() => order.push(n));
    gate.tick(); // the frame they were asked in
    const perTick: number[][] = [];
    for (let i = 0; i < 4; i++) {
      gate.tick();
      await settle();
      perTick.push([...order]);
    }
    expect(perTick).toEqual([[1], [1, 2], [1, 2, 3], [1, 2, 3]]);
    expect(gate.queued).toBe(0);
  });

  it("grants every turn at once when open (the old, unsliced way)", async () => {
    const gate = new FrameGate();
    gate.isOpen = true;
    let went = 0;
    for (let i = 0; i < 3; i++) void gate.turn().then(() => went++);
    await settle();
    expect(went).toBe(3);
  });
});

describe("DueQueue: posts a few seconds later, one a frame, in the order they happened", () => {
  it("hands nothing out before it is due", () => {
    const q = new DueQueue<string>();
    q.push("a", 1000);
    expect(q.take(999)).toBeNull();
    expect(q.take(1000)).toBe("a");
    expect(q.take(5000)).toBeNull();
  });

  it("hands out one per take even when several are due", () => {
    const q = new DueQueue<string>();
    q.push("a", 100);
    q.push("b", 100);
    expect(q.take(200)).toBe("a");
    expect(q.size).toBe(1);
    expect(q.take(200)).toBe("b");
  });

  it("keeps a later item with a shorter delay behind the ones queued before it", () => {
    const q = new DueQueue<string>();
    q.push("first", 5000);
    q.push("second", 2600);
    expect(q.take(3000)).toBeNull();
    expect(q.take(5000)).toBe("first");
    expect(q.take(5000)).toBe("second");
  });
});

describe("Busy: the on-device AI waits for the shots in flight", () => {
  it("is idle at once with nothing in flight", async () => {
    let idle = false;
    void new Busy().idle().then(() => (idle = true));
    await settle();
    expect(idle).toBe(true);
  });

  it("becomes idle only when all tracked work has settled, failed work included", async () => {
    const busy = new Busy();
    const a = deferred();
    const b = deferred();
    void busy.track(a.promise);
    busy.track(b.promise).catch(() => {});
    let idle = false;
    void busy.idle().then(() => (idle = true));
    a.resolve();
    await settle();
    expect(idle).toBe(false);
    expect(busy.active).toBe(1);
    b.reject(new Error("readback lost"));
    await settle();
    expect(idle).toBe(true);
  });
});

const record = (kind: keyof typeof VIOLATIONS): ViolationRecord => ({
  ...VIOLATIONS[kind],
  at: 0,
  status: "uncaught",
  context: {
    clock: "10/4(日) 11:30",
    place: "千代田区 丸の内二丁目",
    lat: 35.68,
    lon: 139.76,
    kmh: 50,
    limit: 40,
    limitKind: "sign",
  },
});

/** A drafted post with a picture (a few drafts may come out as words only). */
function draftOne(feed: SocialFeed, at: number): SocialPost {
  for (let i = 0; i < 40; i++) {
    const p = feed.draftPost(record("hitAndRun"), 6, at);
    if (p && p.media !== "text") return p;
  }
  throw new Error("no media post drafted");
}

describe("SocialFeed: a post drafted at the violation and published seconds later", () => {
  it("keeps a draft off the timeline, unshot and unwritten until it is published", () => {
    const feed = new SocialFeed();
    const shot: number[] = [];
    let written = 0;
    feed.camera = (p) => shot.push(p.id);
    feed.writer = async () => {
      written++;
      return null;
    };
    const draft = draftOne(feed, 1000);
    expect(feed.posts).not.toContain(draft);
    expect(shot).toEqual([]);
    expect(written).toBe(0);
    feed.publish(draft, 4000);
    expect(feed.posts[0]).toBe(draft);
    expect(draft.postedAt).toBe(4000);
    expect(shot).toEqual([draft.id]);
    expect(written).toBe(1);
  });

  it("spreads a published post from when it went up, not from the violation", () => {
    const feed = new SocialFeed();
    const draft = draftOne(feed, 0);
    feed.publish(draft, 60_000);
    feed.update(60_000);
    expect(draft.reposts).toBe(0);
  });
});

describe("photoDevelop: the darkroom develops the same picture in one go or in slices", () => {
  const look: Look = {
    exposure: 1.05,
    warmth: 0.04,
    noise: 0.5,
    tilt: 0.03,
    barrel: 0.08,
    blur: 0,
    streak: 0,
    seed: 7919 * 3,
    stamp: null,
  };
  const rw = 96;
  const rh = 54;
  const src = new Uint8Array(rw * rh * 4).map((_, i) => (i * 37) % 251);

  it("gives the same pixels when developed row band by row band (the grain's state carried)", () => {
    const whole = new Uint8ClampedArray(64 * 36 * 4);
    developRows(src, rw, rh, 64, 36, look, whole);
    const sliced = new Uint8ClampedArray(64 * 36 * 4);
    let seed = look.seed >>> 0;
    for (let y = 0; y < 36; y += 10)
      seed = developRows(src, rw, rh, 64, 36, look, sliced, y, Math.min(36, y + 10), seed);
    expect(sliced).toEqual(whole);
  });

  it("makes an opaque picture", () => {
    const out = new Uint8ClampedArray(64 * 36 * 4);
    developRows(src, rw, rh, 64, 36, look, out);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
});

/** A 64×36 probe read back with `pixels` first and black after. */
function probe(pixels: Array<readonly number[]>, total = 64 * 36): Uint8Array {
  const out = new Uint8Array(total * 4);
  pixels.forEach((p, i) => out.set([...p, 255], i * 4));
  return out;
}

describe("the shot's probe: the car painted in one colour that tone-maps back to itself", () => {
  it("uses a colour ACES can show from some radiance (so the probe material shows it exactly)", () => {
    const c = new Color().setRGB(PROBE_SHOWN[0] / 255, PROBE_SHOWN[1] / 255, PROBE_SHOWN[2] / 255, "srgb");
    expect(acesInverse([c.r, c.g, c.b]).every((x) => x >= 0)).toBe(true);
  });

  it("sees the car when a few dozen pixels (0.4 % and more) come back in the probe colour", () => {
    expect(probeSees(probe(Array.from({ length: 10 }, () => [221, 31, 208])))).toBe(true);
    expect(probeSees(probe(Array.from({ length: 9 }, () => [221, 31, 208])))).toBe(false);
  });

  it("does not take a wall, the sky or a pink sign for the car", () => {
    const town = [
      [128, 128, 128],
      [40, 60, 90],
      [255, 105, 180],
      [200, 60, 120],
      [0, 0, 0],
    ];
    expect(probeSees(probe(Array.from({ length: 64 * 36 }, (_, i) => town[i % town.length])))).toBe(false);
  });
});
