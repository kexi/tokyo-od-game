import RAPIER from "@dimforge/rapier3d-compat";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
} from "three";
import type { XwChunk, XwMeta, XwTile } from "../src/expressway/format";
import { planeAt, tileKey } from "../src/expressway/geo";
import { LocalFrame } from "../src/geo/frame";
import { Buildings } from "../src/world/buildings";
import { CLEARANCE_M } from "../src/world/buildingCut";
import type { DeckCutGeodetic } from "../src/world/deckCuts";
import { ExpresswayDecks } from "../src/world/expresswayDeck";
import { BUILDING_GROUPS } from "../src/physics/groups";
import { Vehicle } from "../src/physics/vehicle";

/**
 * The deck cut-out end to end (P4): the decks announce every chunk's cut points as its tile is read,
 * a failing listener does not cost the decks, and the buildings cut the tiles they hold (shown or
 * hidden) and those loaded later, rebuilding the walls of a tile that had them.
 */

// The physics car without its glTF body (loaded by the browser), as tests/vehicleMass.test.ts.
vi.mock("../src/game/carModel", () => ({
  WHEEL_RADIUS: 0.36,
  createCarModel: () => {
    const wheels = [0, 1, 2, 3].map(() => new Group().add(new Group()));
    return { root: new Group(), wheels, headlights: [], setLights: () => {} };
  },
}));

beforeAll(() => RAPIER.init());

const plane = planeAt(139.75, 35.65);
const N = 36.9;
const ellipsoidal = (_lat: number, _lon: number, h: number) => h + N;
const frame = new LocalFrame(35.65, 139.751, 40);

// A 200 m chunk going east at T.P. 12 m over ground at T.P. 3 m (girder 2.2 m: soffit T.P. 9.8 m).
function chunk(): XwChunk {
  const st: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const [lon, lat] = plane.toLonLat(i * 10, 0);
    st.push(i * 10, lon, lat, 12, 0, 3, 0);
  }
  return {
    id: "1:0",
    run: "1",
    chain: "c1",
    k: 0,
    cls: "expressway",
    ref: "C1",
    name: null,
    structure: "viaduct",
    lanes: 2,
    laneWidth: 3.25,
    shoulderL: 1.25,
    shoulderR: 0.75,
    basis: "statute",
    V: 60,
    vh: 50,
    gmax: 0.05,
    g0: 0,
    g1: 0,
    h0: 0,
    h1: 0,
    girder: 2.2,
    st,
    piers: [],
    cross: [],
    blocked: [],
    decks: [],
    prev: null,
    next: null,
  };
}

describe("the decks tell the buildings where to cut (ExpresswayDecks.onCutPoints)", () => {
  const c = chunk();
  const key = tileKey(c.st[1], c.st[2], 14);
  const meta = {
    version: 2,
    zoom: 14,
    tiles: [key],
    range: null,
    extract: { url: "", timestamp: null },
    counts: { runs: 1, chunks: 1, stations: 21, piers: 0, crossings: 0 },
    bytes: 0,
    solver: { components: 0, solves: 0, unconverged: 0 },
    runs: [],
    diagnostics: [],
  } as unknown as XwMeta;
  const tile: XwTile = { chunks: [c] };
  beforeAll(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!.replace(".json", "");
      const body = name === "meta" ? meta : name === key ? tile : null;
      return { ok: body !== null, json: async () => body };
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  const settle = async (decks: ExpresswayDecks, lat: number, lon: number) => {
    decks.update(lat, lon);
    for (let i = 0; i < 400 && !decks.isSettledAt(lat, lon); i++) await new Promise((r) => setTimeout(r, 5));
  };
  const [lon, lat] = plane.toLonLat(100, 0);

  it("announces each chunk's points once, with the soffit and the road as ellipsoidal heights", async () => {
    const decks = new ExpresswayDecks(new Scene(), null, ellipsoidal, frame, "/");
    const calls: DeckCutGeodetic[][] = [];
    decks.onCutPoints = (points) => calls.push(points);
    await settle(decks, lat, lon);
    await settle(decks, ...(plane.toLonLat(150, 0).toReversed() as [number, number]));
    expect(calls).toHaveLength(1);
    expect(calls[0].length).toBeGreaterThan(100);
    for (const p of calls[0]) {
      expect(p.h).toBeCloseTo(12 - 2.2 + N, 6);
      expect(p.top).toBeCloseTo(12 + N, 6);
    }
  });

  it("still builds the decks when the buildings throw on the points", async () => {
    const decks = new ExpresswayDecks(new Scene(), null, ellipsoidal, frame, "/");
    decks.onCutPoints = () => {
      throw new Error("buildings broke");
    };
    await settle(decks, lat, lon);
    expect(decks.chunkCount()).toBe(1);
  });
});

/** An LOD1 box in ECEF, as a tile hands it over: from local (x0, z0)–(x1, z1), y 0 to `top`. */
function ecefBox(x0: number, z0: number, x1: number, z1: number, top: number): Group {
  const corners: Vector3[] = [];
  for (const y of [0, top])
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ])
      corners.push(new Vector3(x, y, z));
  // Relative to a centre on the mesh (as CESIUM_RTC does): ECEF in float32 alone is ~0.5 m coarse.
  const toEcef = frame.ecefToLocal.clone().invert();
  const centre = corners[0].clone().applyMatrix4(toEcef);
  const position = new Float32Array(
    corners.flatMap((v) => v.clone().applyMatrix4(toEcef).sub(centre).toArray()),
  );
  const quads = [
    [4, 5, 6, 7],
    [0, 1, 2, 3],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setAttribute("_batchid", new BufferAttribute(new Float32Array(8), 1));
  g.setIndex(quads.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]));
  const mesh = new Mesh(g, new MeshBasicMaterial());
  mesh.position.copy(centre);
  const group = new Group();
  group.add(mesh);
  return group;
}

/** The top of a tile's box in the local frame. */
function topOf(tile: Group): number {
  const mesh = tile.children[0] as Mesh;
  const pos = mesh.geometry.getAttribute("position");
  let top = -Infinity;
  const v = new Vector3();
  mesh.updateMatrixWorld(true);
  const toLocal = frame.ecefToLocal.clone().multiply(mesh.matrixWorld);
  for (let i = 0; i < pos.count; i++)
    top = Math.max(top, v.fromBufferAttribute(pos, i).applyMatrix4(toLocal).y);
  return top;
}

describe("the player's car meets the buildings on a deck too (P3's pass-through removed)", () => {
  it("has a chassis whose collision groups meet a building tile's", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const car = new Vehicle(world, {}, "playerCar");
    const groups = car.chassis.collisionGroups();
    const meets = (a: number, b: number) =>
      ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;
    expect(meets(groups, BUILDING_GROUPS)).toBe(true);
    // Nothing switches it on a deck any more.
    expect("setOnDeck" in car).toBe(false);
  });
});

describe("the buildings cut what stands into a deck (Buildings.cutAboveDecks)", () => {
  // A deck along local x at z = 0, its soffit at local y 10 and road at 12, 2 m apart over ±5 m.
  const points: DeckCutGeodetic[] = [];
  for (let x = -40; x <= 40; x += 2)
    for (const z of [-5, 0, 5]) {
      const g = frame.toGeodetic(new Vector3(x, 0, z));
      points.push({
        lat: g.lat,
        lon: g.lon,
        h: frame.toGeodetic(new Vector3(x, 10, z)).h,
        top: frame.toGeodetic(new Vector3(x, 12, z)).h,
      });
    }
  const make = () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const buildings = new Buildings(
      new Scene(),
      world,
      new PerspectiveCamera(60, 1, 0.5, 40000),
      { getSize: (v: Vector2) => v.set(1280, 720) },
      frame,
    );
    const load = (scene: Group) =>
      buildings.tiles.dispatchEvent({ type: "load-model", scene, tile: {}, url: "" } as never);
    const models = (buildings as unknown as { models: Map<Group, { collider: RAPIER.Collider | null }> })
      .models;
    return { world, buildings, load, models };
  };

  it("cuts a tile held but hidden (outside the tiles' group, its world matrix the ECEF one)", () => {
    const { buildings, load } = make();
    const tile = ecefBox(-6, -20, 6, 20, 30);
    load(tile);
    expect(tile.parent).toBeNull();
    buildings.cutAboveDecks(points);
    expect(topOf(tile)).toBeCloseTo(10 - CLEARANCE_M, 2);
  });

  it("cuts a tile loaded after the decks became known, and leaves one beside the deck", () => {
    const { buildings, load } = make();
    buildings.cutAboveDecks(points);
    const across = ecefBox(-6, -20, 6, 20, 30);
    const beside = ecefBox(-6, 8, 6, 30, 30);
    load(across);
    load(beside);
    expect(topOf(across)).toBeCloseTo(10 - CLEARANCE_M, 2);
    expect(topOf(beside)).toBeCloseTo(30, 2);
  });

  it("gives a cut tile that had walls new ones at once, shown or not", () => {
    const { buildings, load, models } = make();
    const tile = ecefBox(-6, -20, 6, 20, 30);
    load(tile);
    const model = models.get(tile)!;
    (buildings as unknown as { createCollider(m: unknown): void }).createCollider(model);
    const before = model.collider;
    expect(before).not.toBeNull();
    buildings.cutAboveDecks(points);
    expect(model.collider).not.toBeNull();
    expect(model.collider).not.toBe(before);
  });
});
