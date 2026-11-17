import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Sphere, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LOAD_HOLD_MS, startLoad, stepLoad, type LoadState } from "../src/world/loadProgress";
import { countLeft, nearbyLoading, NearbyMarks, NEARBY_RADIUS_M, stepNearby } from "../src/world/nearbyLoad";

/** Bounds of a tile: a sphere at `x` m east of the origin (the load's centre) with `radius`. */
const bounds = (x: number, radius = 10) => {
  const s = new Sphere(new Vector3(x, 0, 0), radius);
  return {
    intersectsSphere: (other: Sphere) => s.intersectsSphere(other),
    distanceToPoint: (p: Vector3) => Math.max(0, s.distanceToPoint(p)),
  };
};

/** Judges each tile once with the marks, as LoadRegionPlugin does every frame; returns what it claimed. */
const judge = (marks: NearbyMarks, tiles: Array<[object, ReturnType<typeof bounds>]>) =>
  tiles.map(([tile, b]) => marks.intersectsTile(b as never, tile as never, null as never));

const marksAtOrigin = () => {
  const marks = new NearbyMarks();
  marks.sphere.center.set(0, 0, 0);
  return marks;
};

describe("the nearby tiles' marks", () => {
  it("counts only the loading tiles whose bounds reach the nearby sphere, none however many others load", () => {
    const marks = marksAtOrigin();
    const near = { id: "near" };
    const edge = { id: "edge" };
    const far = Array.from({ length: 50 }, (_, i) => ({ id: `far${i}` }));
    judge(marks, [
      [near, bounds(50)],
      [edge, bounds(NEARBY_RADIUS_M + 5, 10)],
      ...far.map((t, i) => [t, bounds(1000 + i * 100)] as [object, ReturnType<typeof bounds>]),
    ]);
    const isNearby = (t: object) => marks.distanceOf(t) !== undefined;
    expect(nearbyLoading([near, edge, ...far], isNearby)).toEqual(new Set([near, edge]));
    expect(nearbyLoading(far, isNearby).size).toBe(0);
  });

  it("counts the children of a tile reaching the sphere, as their parent stays shown until all are in", () => {
    const marks = marksAtOrigin();
    const parent = { parent: null };
    const child = { parent };
    const grandchild = { parent: child };
    judge(marks, [
      [parent, bounds(0, 500)],
      [child, bounds(NEARBY_RADIUS_M + 67)],
      [grandchild, bounds(NEARBY_RADIUS_M + 67)],
    ]);
    expect(marks.distanceOf(child)).toBe(NEARBY_RADIUS_M + 57);
    expect(marks.distanceOf(grandchild)).toBeUndefined();
    // While loading, the child outside the sphere is nearby remaining; the grandchild is not.
    const isNearby = (t: object) => marks.distanceOf(t) !== undefined;
    expect(nearbyLoading([child, grandchild], isNearby)).toEqual(new Set([child]));
  });

  it("never claims a tile, so what the renderer loads and shows is as without it", () => {
    const marks = marksAtOrigin();
    expect(
      judge(marks, [
        [{}, bounds(0)],
        [{}, bounds(5000)],
      ]),
    ).toEqual([false, false]);
    expect(marks.mask).toBe(false);
  });

  it("unmarks a tile judged outside later (the car moved), and keeps the mark of one not judged again", () => {
    const marks = marksAtOrigin();
    const moved = {};
    const kept = {};
    judge(marks, [
      [moved, bounds(0)],
      [kept, bounds(100)],
    ]);
    marks.sphere.center.set(2000, 0, 0);
    judge(marks, [[moved, bounds(0)]]);
    expect(marks.distanceOf(moved)).toBeUndefined();
    expect(marks.distanceOf(kept)).toBe(90);
  });

  it("counts as finished the tiles that left the nearby loading set", () => {
    const [a, b, c] = [{}, {}, {}];
    expect(countLeft(new Set([a, b]), new Set([b, c]))).toBe(1);
  });
});

/** Steps the nearby and the whole near town together through frames of [ms, nearby left, all left, finished]. */
const both = (frames: Array<[number, number, number, number]>, isRootLoaded = true) => {
  let nearby: LoadState = startLoad(0);
  let all: LoadState = startLoad(0);
  for (const [t, nearbyLeft, allLeft, finished] of frames) {
    nearby = stepNearby(nearby, { remaining: nearbyLeft, finished, isRootLoaded }, t);
    all = stepLoad(all, { remaining: allLeft, finished }, t);
  }
  return { nearby: nearby.progress, all: all.progress };
};

describe("the nearby load progress", () => {
  it("is 1 once nothing nearby has remained for the hold, while far tiles still load and the whole is under 1", () => {
    const p = both([
      [0, 3, 40, 0],
      [100, 0, 30, 3],
      [100 + LOAD_HOLD_MS, 0, 20, 13],
    ]);
    expect(p.nearby).toBe(1);
    expect(p.all).toBeLessThan(1);
  });

  it("stays under 1 while a single nearby tile remains", () => {
    const p = both([
      [0, 5, 5, 0],
      [100, 1, 1, 4],
      [100 + LOAD_HOLD_MS * 5, 1, 1, 4],
    ]);
    expect(p.nearby).toBeLessThan(1);
  });

  it("is not 1 before the root tileset is in, though nothing remains (nothing is requested yet)", () => {
    const p = both(
      [
        [0, 0, 0, 0],
        [LOAD_HOLD_MS * 10, 0, 0, 0],
      ],
      false,
    );
    expect(p.nearby).toBe(0);
  });

  it("is 1 after the hold once the root is in with nothing nearby to load (no building here: no wait)", () => {
    let s = startLoad(0);
    s = stepNearby(s, { remaining: 0, finished: 0, isRootLoaded: false }, 0);
    s = stepNearby(s, { remaining: 0, finished: 1, isRootLoaded: true }, 100);
    expect(s.progress).toBeLessThan(1);
    s = stepNearby(s, { remaining: 0, finished: 1, isRootLoaded: true }, 100 + LOAD_HOLD_MS);
    expect(s.progress).toBe(1);
  });
});

const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");

/** The source from `from` to the next `to` (a block of code to check). */
const block = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(to, start));
};

describe("which progress each part of the game reads", () => {
  const main = read("src/main.ts");

  it("the loading screen and the warp's landing wait for the nearby town", () => {
    const screen = block(main, "const tilesProgress =", "const isReady");
    expect(screen).toMatch(/buildings\.nearbyLoadProgress\(\)/);
    const warp = block(main, "const finishWarp =", "if (!isGroundReady || !isTownReady)");
    expect(warp).toMatch(/isTownReady = buildings\.nearbyLoadProgress\(\) >= 0\.999/);
    expect(warp).not.toMatch(/buildings\.loadProgress\(\)/);
  });

  it("settled and the far skyline's start still read the whole town's progress", () => {
    expect(main).toMatch(/buildingsProgress: buildings\.loadProgress\(\)/);
    expect(main).toMatch(/farProgress: buildings\.farLoadProgress\(\)/);
    const buildings = read("src/world/buildings.ts");
    expect(buildings).toMatch(/isTownLoaded = this\.loadedCount > 0 && this\.loadProgress\(\) >= 0\.999/);
  });
});
