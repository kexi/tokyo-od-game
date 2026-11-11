import { describe, expect, it } from "vitest";
import { BACKOFF_MAX_MS, BACKOFF_MS, FaceLayerSlots } from "../src/world/faceLayerSlots";

/**
 * How the sign face pool hands out its layers (src/world/faceLayerSlots.ts): it decodes only what
 * can be shown, a face pushed out shows the stand-in at once, the least recently wanted goes
 * first, and a face that failed is not retried every frame (review C1).
 */

const wants = (...entries: Array<[string, number]>) => new Map(entries);

/** Runs the pool's per-frame loop: decode what is asked (all succeed), place it. */
function frames(slots: FaceLayerSlots, n: number, perFrame = 4) {
  let decodes = 0;
  let placed = 0;
  for (let f = 0; f < n; f++) {
    for (const key of slots.toDecode(perFrame, f * 16)) {
      slots.started(key);
      decodes++;
      if (slots.place(key) !== null) placed++;
    }
  }
  return { decodes, placed };
}

describe("the face layer slots", () => {
  it("decode only the most wanted that fit: 3 faces in 2 layers are 2 decodes over 100 frames, not one a frame", () => {
    const slots = new FaceLayerSlots(2);
    expect(slots.want(wants(["a", 1], ["b", 2], ["c", 3]))).toBe(3);
    const { decodes, placed } = frames(slots, 100);
    expect(decodes).toBe(2);
    expect(placed).toBe(2);
    expect(slots.has("c")).toBe(false);
  });

  it("report a shortage once per wanted-set size", () => {
    const slots = new FaceLayerSlots(1);
    expect(slots.want(wants(["a", 1], ["b", 2]))).toBe(2);
    expect(slots.want(wants(["a", 1], ["b", 2]))).toBeNull();
    expect(slots.want(wants(["a", 1]))).toBeNull();
  });

  it("do not start a face again while it decodes or waits to be placed", () => {
    const slots = new FaceLayerSlots(2);
    slots.want(wants(["a", 1]));
    expect(slots.toDecode(4, 0)).toEqual(["a"]);
    slots.started("a");
    expect(slots.toDecode(4, 16)).toEqual([]);
  });

  it("show layer 0 for a face the moment another takes its layer", () => {
    const slots = new FaceLayerSlots(1);
    slots.want(wants(["far", 50]));
    frames(slots, 1);
    expect(slots.layerOf("far")).toBe(1);
    slots.want(wants(["near", 5], ["far", 50]));
    frames(slots, 1);
    expect(slots.layerOf("near")).toBe(1);
    expect(slots.layerOf("far")).toBe(0);
  });

  it("give up the layer of the face unwanted the longest first (LRU), and keep wanted ones", () => {
    const slots = new FaceLayerSlots(3);
    slots.want(wants(["a", 1], ["b", 2], ["c", 3]));
    frames(slots, 1);
    slots.want(wants(["b", 2], ["c", 3])); // a unwanted from here
    slots.want(wants(["c", 3])); // b unwanted from here: a is the older
    slots.want(wants(["c", 3], ["d", 4]));
    frames(slots, 1);
    expect(slots.has("a")).toBe(false);
    expect(slots.has("b")).toBe(true);
    expect(slots.has("c")).toBe(true);
    expect(slots.has("d")).toBe(true);
  });

  it("drop a decoded face that is no longer among the most wanted", () => {
    const slots = new FaceLayerSlots(1);
    slots.want(wants(["a", 1]));
    const [key] = slots.toDecode(4, 0);
    slots.started(key);
    slots.want(wants(["b", 1], ["a", 2]));
    expect(slots.place("a")).toBeNull();
    expect(slots.toDecode(4, 16)).toEqual(["b"]);
  });

  it("back off from a failed face, doubling up to the limit, and forget it once placed", () => {
    const slots = new FaceLayerSlots(2);
    slots.want(wants(["a", 1]));
    slots.started("a");
    slots.failed("a", 0);
    expect(slots.toDecode(4, BACKOFF_MS - 1)).toEqual([]);
    expect(slots.toDecode(4, BACKOFF_MS)).toEqual(["a"]);
    slots.started("a");
    slots.failed("a", BACKOFF_MS);
    expect(slots.toDecode(4, BACKOFF_MS * 2)).toEqual([]);
    expect(slots.toDecode(4, BACKOFF_MS * 3)).toEqual(["a"]);
    for (let i = 0; i < 20; i++) slots.failed("a", 0);
    expect(slots.toDecode(4, BACKOFF_MAX_MS - 1)).toEqual([]);
    expect(slots.toDecode(4, BACKOFF_MAX_MS)).toEqual(["a"]);
    slots.started("a");
    expect(slots.place("a")).toBe(1);
  });
});
