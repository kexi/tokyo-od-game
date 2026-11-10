import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backAlongPath,
  bearingOf,
  bearingVector,
  eyeBearing,
  offCentre,
  placeView,
  type FoundTarget,
  type Vec3,
} from "../scripts/qa/viewGeometry";
import { loadsOf, loadUrl, parseViewTable, shotKeys, ViewSchema, type View } from "../scripts/qa/viewTable";

const VIEWS_DIR = join(import.meta.dirname, "..", "scripts", "qa", "views");
const view = (v: unknown): View => ViewSchema.parse(v);
const near = (a: Vec3, b: Vec3, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;

describe("the view tables in scripts/qa/views", () => {
  const files = readdirSync(VIEWS_DIR).filter((f) => f.endsWith(".json"));

  it("are there for signs, signals, landmarks, the expressway and roads", () => {
    expect(files.toSorted()).toEqual(
      expect.arrayContaining([
        "expressway.json",
        "landmarks.json",
        "roads.json",
        "signals.json",
        "signs.json",
      ]),
    );
  });

  it.each(files)("%s parses, its name is its file name, and its sun is fixed (defaults.moment)", (file) => {
    const table = parseViewTable(JSON.parse(readFileSync(join(VIEWS_DIR, file), "utf8")));
    expect(`${table.name}.json`).toBe(file);
    expect(table.defaults.moment).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

const drive = (id: string, target: unknown = { landmark: "x" }) => ({ id, camera: "driver", target });

describe("the view table schema", () => {
  const MOMENT = "2026-11-10T11:00:00+09:00";
  const tableWith = (sessions: unknown[], over: Record<string, unknown> = {}) => ({
    name: "t",
    description: "",
    defaults: { moment: MOMENT },
    sessions,
    ...over,
  });
  const withViews = (views: unknown[], over: Record<string, unknown> = {}) =>
    tableWith([{ id: "s", start: [35.68, 139.76], views }], over);

  it("fills the defaults a table leaves out (size, field of view, the settle timeout)", () => {
    const t = parseViewTable(withViews([drive("a")]));
    expect(t.defaults).toMatchObject({ width: 1280, height: 720, fov: 50, settleTimeoutS: 90 });
    expect(t.sessions[0].views[0]).toMatchObject({ eyeHeightM: 1.2, angleDeg: 0, lateralM: 0 });
  });

  it("requires defaults.moment, so the sun does not follow the day a round is shot", () => {
    expect(() => parseViewTable({ ...withViews([drive("a")]), defaults: {} })).toThrow(/moment/);
  });

  it("rejects a mistyped key, also inside a target, so a typo does not shoot the default view", () => {
    expect(() => parseViewTable(withViews([{ ...drive("a"), distanseM: 30 }]))).toThrow(/distanseM/);
    expect(() => parseViewTable(withViews([drive("a", { sign: "323", noet: true })]))).toThrow();
  });

  it("rejects a target that names two kinds at once", () => {
    expect(() => parseViewTable(withViews([drive("a", { landmark: "x", sign: "323" })]))).toThrow();
  });

  it("rejects a standing view with neither a target nor a place to stand", () => {
    expect(() => parseViewTable(withViews([{ id: "a", camera: "pedestrian" }]))).toThrow(
      /give a target or at/,
    );
  });

  it("rejects the same view id twice anywhere in the table (a finding names its view)", () => {
    const two = tableWith(["s1", "s2"].map((id) => ({ id, start: [35, 139], views: [drive("front")] })));
    expect(() => parseViewTable(two)).toThrow(/duplicate view front/);
  });

  it("rejects view ids that cannot name a file", () => {
    expect(() => parseViewTable(withViews([drive("A b")]))).toThrow(/kebab-case/);
  });

  it("holds a signal's step only on a signal target", () => {
    expect(() => parseViewTable(withViews([{ ...drive("a"), state: { signalStep: "arrow" } }]))).toThrow(
      /needs a signal target/,
    );
    const t = parseViewTable(withViews([{ ...drive("a", { signal: {} }), state: { signalStep: 2 } }]));
    expect(t.sessions[0].views[0].state).toEqual({ signalStep: 2 });
  });

  it("requires a limit on a table's required metric", () => {
    expect(() => parseViewTable(withViews([drive("a")], { metrics: [{ name: "px" }] }))).toThrow(
      /min or max/,
    );
  });

  it("shoots each session once per look and names the shots <session>.<look>--<view>", () => {
    const t = parseViewTable(
      withViews([drive("a"), drive("b")], {
        defaults: { moment: MOMENT, looks: [{ id: "day" }, { id: "night", time: "night" }] },
      }),
    );
    expect(loadsOf(t).map((l) => l.prefix)).toEqual(["s.day", "s.night"]);
    expect(shotKeys(t)).toEqual(["s.day--a", "s.day--b", "s.night--a", "s.night--b"]);
  });

  it("names the shots <session>--<view> without looks", () => {
    expect(shotKeys(parseViewTable(withViews([drive("a")])))).toEqual(["s--a"]);
  });

  it("puts the start, the look and extra parameters such as ?expressway in the load's URL", () => {
    const t = parseViewTable(
      withViews([drive("a")], {
        defaults: { moment: MOMENT, time: "night", weather: "rain", seed: 7, params: { expressway: "" } },
      }),
    );
    const url = new URL(loadUrl("http://localhost:5173/tokyo-od-game/", t, loadsOf(t)[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start: "35.68,139.76",
      time: "night",
      weather: "rain",
      seed: "7",
      expressway: "",
    });
  });
});
describe("bearings (compass degrees in the local frame: +X east, −Z north)", () => {
  it("point north at 0° and east at 90°", () => {
    expect(near(bearingVector(0), { x: 0, y: 0, z: -1 })).toBe(true);
    expect(near(bearingVector(90), { x: 1, y: 0, z: 0 })).toBe(true);
  });

  it("read back the bearing of a vector", () => {
    for (const deg of [0, 45, 135, 225, 300]) expect(bearingOf(bearingVector(deg))).toBeCloseTo(deg, 6);
  });
});

describe("where a view puts the eye", () => {
  // A plate 2.6 m up at the origin, facing south (towards +Z): the traffic it addresses comes north.
  const plate: FoundTarget = { point: { x: 0, y: 2.6, z: 0 }, normal: { x: 0, y: 0, z: 1 }, size: 0.9 };
  const ctx = { fov: 50, car: { x: 100, y: 0, z: 0 } };

  it("stands in front of a facing target, at its distance and eye height (the G1c fix: from its normal)", () => {
    const p = placeView(
      view({ id: "a", camera: "driver", target: { sign: "323" }, distanceM: 30 }),
      plate,
      ctx,
    );
    expect(p.eye.x).toBeCloseTo(0, 6);
    expect(p.eye.z).toBeCloseTo(30, 6);
    expect(p.eye.above).toBe(1.2);
    expect(p.lookAt).toEqual(plate.point);
  });

  it("turns round the target by angleDeg (clockwise from above) and steps aside by lateralM", () => {
    const p = placeView(
      view({
        id: "a",
        camera: "pedestrian",
        target: { sign: "323" },
        distanceM: 10,
        angleDeg: 90,
        lateralM: 2,
      }),
      plate,
      ctx,
    );
    // The front is bearing 180 (south); +90° is west. Facing the plate (east), the right is south.
    expect(p.eye.x).toBeCloseTo(-10, 6);
    expect(p.eye.z).toBeCloseTo(2, 6);
    expect(p.eye.above).toBe(1.6);
  });

  it("stands a round target's views on the side of the car (where the world has streamed in)", () => {
    const tower: FoundTarget = { point: { x: 0, y: 160, z: 0 }, normal: null, size: 333 };
    expect(eyeBearing({}, tower, ctx.car)).toBeCloseTo(90, 6);
    const p = placeView(view({ id: "a", camera: "driver", target: { landmark: "tokyo_tower" } }), tower, ctx);
    // No distance given: stood back 1.2 × its size.
    expect(p.eye.x).toBeCloseTo(333 * 1.2, 6);
  });

  it("puts 後方追従's car at the distance and the eye backM behind and heightM above it", () => {
    const p = placeView(
      view({ id: "a", camera: "chase", target: { sign: "323" }, distanceM: 30 }),
      plate,
      ctx,
    );
    expect(p.car).toMatchObject({ x: expect.closeTo(0, 6), z: expect.closeTo(30, 6) });
    // Facing north (−Z): the game's yaw atan2(dx, dz) is ±π.
    expect(Math.abs(p.car?.yaw ?? 0)).toBeCloseTo(Math.PI, 6);
    expect(p.eye.z).toBeCloseTo(37, 6);
    expect(p.eye.above).toBe(2.8);
  });

  it("looks straight down from altitudeM above the target at a 90° 俯角", () => {
    const p = placeView(
      view({ id: "a", camera: "overhead", target: { sign: "323" }, altitudeM: 80, pitchDeg: 90 }),
      plate,
      ctx,
    );
    expect(p.eye).toEqual({ x: 0, z: 0, y: 82.6 });
  });

  it("backs off altitude / tan(俯角) along the bearing for an oblique 俯瞰", () => {
    const p = placeView(
      view({
        id: "a",
        camera: "overhead",
        target: { sign: "323" },
        altitudeM: 100,
        pitchDeg: 45,
        bearingDeg: 90,
      }),
      plate,
      ctx,
    );
    expect(p.eye.x).toBeCloseTo(100, 6);
    expect(p.eye.y).toBeCloseTo(102.6, 6);
  });

  it("rides a deck path back from the target, so the eye is on the deck on a grade", () => {
    // A deck climbing north at 5 %: stations every 10 m.
    const path = Array.from({ length: 11 }, (_, i) => ({ x: 0, y: 10 + i * 0.5, z: -i * 10 }));
    const deck: FoundTarget = { point: path[8], normal: { x: 0, y: 0, z: 1 }, size: 9, path, pathIndex: 8 };
    const p = placeView(
      view({ id: "a", camera: "driver", target: { expressway: "1:0" }, distanceM: 35 }),
      deck,
      ctx,
    );
    expect(p.eye.z).toBeCloseTo(-45, 6);
    expect(p.eye.y).toBeCloseTo(10 + 4.5 * 0.5 + 1.2, 6);
    expect(p.eye.above).toBeUndefined();
  });

  it("parks the 後方追従 car on the deck, not on the street under it", () => {
    const path = Array.from({ length: 11 }, (_, i) => ({ x: 0, y: 10 + i * 0.5, z: -i * 10 }));
    const deck: FoundTarget = { point: path[8], normal: { x: 0, y: 0, z: 1 }, size: 9, path, pathIndex: 8 };
    const p = placeView(
      view({ id: "a", camera: "chase", target: { expressway: "1:0" }, distanceM: 25 }),
      deck,
      ctx,
    );
    expect(p.car?.z).toBeCloseTo(-55, 6);
    expect(p.car?.surfaceY).toBeCloseTo(10 + 5.5 * 0.5, 6);
  });

  it("extends a deck path straight past its first station", () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const { at, forward } = backAlongPath(path, 1, 25);
    expect(near(at, { x: -15, y: 0, z: 0 })).toBe(true);
    expect(near(forward, { x: 1, y: 0, z: 0 })).toBe(true);
  });

  it("stands at a place with a heading when there is no target, looking lookAheadM ahead", () => {
    const p = placeView(
      view({ id: "a", camera: "driver", at: { lat: 35.68, lon: 139.76, headingDeg: 90, lookAheadM: 40 } }),
      null,
      { ...ctx, atLocal: { x: 5, y: 3, z: 5 } },
    );
    expect(p.eye).toEqual({ x: 5, z: 5, above: 1.2 });
    expect(p.lookAt.x).toBeCloseTo(45, 6);
  });
});

describe("how far off the middle the aim point fell", () => {
  it("is the distance from the centre in normalised device coordinates (a camera that took its pose: ~0)", () => {
    expect(offCentre({ x: 0, y: 0 })).toBe(0);
    expect(offCentre({ x: 0.3, y: 0.4 })).toBe(0.5);
  });
});
