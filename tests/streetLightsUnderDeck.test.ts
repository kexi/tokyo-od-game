import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Object3D, PerspectiveCamera, Quaternion, Scene } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { GIRDER_DEPTH } from "../src/expressway/assumptions";
import { LocalFrame } from "../src/geo/frame";
import { DeckOverhead, poleReachesDeck } from "../src/world/deckOverhead";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { isUnderDeck, placeLamps, StreetLights } from "../src/world/streetLights";

beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LON = 1 / 110_950 / Math.cos((35.68 * Math.PI) / 180);
const M_LAT = 1 / 110_950;
/** Height of the viaduct's road surface over the flat ground at 0 (24402611:27 is at about 7.2 m). */
const DECK_Y = 7.2;
/** A tunnel's road surface under the same place. */
const TUNNEL_Y = -8;
/** Half the viaduct's carriageway: lamps whose foot is within it (+ the slab) stand in its lanes. */
const DECK_HALF = 8;

const at = (x: number, z: number) => [139.76 + x * M_LON, 35.68 - z * M_LAT];
/**
 * An 18 m east–west street from x = 0 to 400 m at z = 0, along under the viaduct: its 12 m poles
 * stand 9.6 m off the centre, just beside the deck, with their luminaires 2.2 m in, under it.
 */
const street: RoadLine = { coords: [...at(0, 0), ...at(400, 0)], width: 18, oneway: 0, kind: "local" };
/** A 9 m street crossing under the viaduct at right angles (x = 600, z −150 … 150; 10 m poles). */
const cross: RoadLine = { coords: [...at(600, -150), ...at(600, 150)], width: 9, oneway: 0, kind: "local" };
/** A 22 m street 300 m to the south, out from under any deck. */
const open: RoadLine = { ...street, width: 22, coords: [...at(0, 300), ...at(400, 300)] };
/** A 4-lane viaduct (16 m between the parapets) along z = 0 over the first street and the crossing. */
const viaduct: RoadLine = {
  coords: [...at(-50, 0), ...at(700, 0)],
  width: 2 * DECK_HALF,
  oneway: 1,
  kind: "highway",
  source: "osm",
  cls: "expressway",
  structure: "viaduct",
  level: 1,
  xid: "24402611:27",
};
/** A tunnel along the same line deep under the street (a viaduct and a tunnel over each other). */
const tunnel: RoadLine = { ...viaduct, structure: "tunnel", level: -1, xid: "below:0" };

/** The graph with the viaduct's surface at `deckY` (the game sets Segment.elev from the chunks). */
const graphWith = (deckY: number, withTunnel = false): RoadGraph => {
  const graph = new RoadGraph([street, cross, open, viaduct, ...(withTunnel ? [tunnel] : [])], frame);
  for (const seg of graph.segments) {
    const isViaduct = seg.line.structure === "viaduct";
    const isTunnel = seg.line.structure === "tunnel";
    if (isViaduct) seg.elev = seg.pts.map(() => deckY);
    if (isTunnel) seg.elev = seg.pts.map(() => TUNNEL_Y);
  }
  graph.ground = () => 0;
  return graph;
};
const crossX = (graph: RoadGraph) =>
  graph.segments.find((s) => s.line === cross || s.line.width === 9)!.pts[0].x;

describe("isUnderDeck: which lamps a viaduct over them leaves out", () => {
  const none: number[] = [];
  it("leaves out a lamp with a deck over its foot at any height over the foot", () => {
    expect(isUnderDeck({ foot: [DECK_Y], head: none }, 0, 12)).toBe(true);
    // Over the lamp's top as well: the luminaire would sit in or just under the box girder.
    expect(isUnderDeck({ foot: [12 + 1], head: none }, 0, 12)).toBe(true);
    expect(isUnderDeck({ foot: [30], head: none }, 0, 12)).toBe(true);
    // The foot's own level, to the half metre.
    expect(isUnderDeck({ foot: [-0.49], head: none }, 0, 12)).toBe(true);
    expect(isUnderDeck({ foot: [-0.51], head: none }, 0, 12)).toBe(false);
  });

  it("does not count a tunnel or cut under the foot, also where a viaduct crosses over it", () => {
    expect(isUnderDeck({ foot: [TUNNEL_Y], head: [TUNNEL_Y] }, 0, 12)).toBe(false);
    expect(isUnderDeck({ foot: [TUNNEL_Y, DECK_Y], head: none }, 0, 12)).toBe(true);
    expect(isUnderDeck({ foot: none, head: [TUNNEL_Y, DECK_Y] }, 0, 12)).toBe(true);
  });

  it("leaves out a lamp beside a deck only when its luminaire would reach into the girder", () => {
    const top = 12 + GIRDER_DEPTH.value;
    expect(isUnderDeck({ foot: none, head: [top - 0.01] }, 0, 12)).toBe(true);
    expect(isUnderDeck({ foot: none, head: [top + 0.01] }, 0, 12)).toBe(false);
    expect(isUnderDeck({ foot: none, head: [-0.51] }, 0, 12)).toBe(false);
    expect(isUnderDeck({ foot: none, head: [-0.49] }, 0, 12)).toBe(true);
    expect(isUnderDeck({ foot: none, head: none }, 0, 12)).toBe(false);
  });
});

describe("street lights under an expressway viaduct", () => {
  it("records the viaduct over the poles and luminaires under it, and nothing over the open street", () => {
    const graph = graphWith(DECK_Y);
    const lamps = placeLamps(graph);
    const along = lamps.filter((l) => Math.abs(l.z) < 50 && l.x < 450);
    const x0 = crossX(graph);
    const crossing = lamps.filter((l) => Math.abs(l.x - x0) < 10);
    const outside = lamps.filter((l) => l.z > 250);
    expect(along.length).toBeGreaterThan(10);
    expect(outside.length).toBeGreaterThan(10);
    // Beside the deck: the foot is clear of it, the luminaire under it, and the lamp is left out.
    for (const l of along) {
      expect(l.overhead).toEqual({ foot: [], head: [DECK_Y] });
      expect(isUnderDeck(l.overhead, 0, l.spec.height)).toBe(true);
    }
    for (const l of outside) expect(l.overhead).toEqual({ foot: [], head: [] });
    // The crossing street: the poles standing in the viaduct's lanes, and none past its edge + 1.5 m.
    const inLanes = crossing.filter((l) => Math.abs(l.z) < DECK_HALF);
    const clear = crossing.filter((l) => Math.abs(l.z) > DECK_HALF + 1.5);
    expect(clear.length).toBeGreaterThan(4);
    expect(inLanes.length).toBeGreaterThan(0);
    for (const l of clear) expect(l.overhead.foot).toEqual([]);
    for (const l of inLanes) expect(l.overhead.foot).toEqual([DECK_Y]);
  });

  it("keeps every surface over a pole where a tunnel runs under the viaduct", () => {
    const graph = graphWith(DECK_Y, true);
    const x0 = crossX(graph);
    const lamps = placeLamps(graph).filter((l) => Math.abs(l.x - x0) < 10 && Math.abs(l.z) < DECK_HALF);
    expect(lamps.length).toBeGreaterThan(0);
    for (const l of lamps) {
      expect(l.overhead.foot.toSorted((a, b) => a - b)).toEqual([TUNNEL_Y, DECK_Y]);
      expect(isUnderDeck(l.overhead, 0, l.spec.height)).toBe(true);
    }
  });

  it("finds the same surfaces through its bounding boxes as by projecting onto every deck", () => {
    const graph = graphWith(DECK_Y, true);
    const decks = new DeckOverhead(graph);
    const all = graph.segments.filter((s) => s.elev !== undefined);
    for (let x = -100; x <= 750; x += 7.3)
      for (let z = -30; z <= 30; z += 1.7) {
        const p = { x, y: 0, z } as never;
        const brute = all
          .filter((s) => graph.nearestOn(s, p).dist < s.line.width / 2 + 1)
          .map((s) => graph.surfaceY(s, graph.nearestOn(s, p).s)!);
        expect(decks.surfacesOver(x, z, 1).toSorted()).toEqual(brute.toSorted());
      }
  });

  it("tells which poles reach a car on a deck over them (signals, orbis)", () => {
    expect(poleReachesDeck([DECK_Y], 0, 5)).toBe(false);
    expect(poleReachesDeck([DECK_Y], 0, 7.5)).toBe(true);
    expect(poleReachesDeck([TUNNEL_Y], 0, 7.5)).toBe(false);
    expect(poleReachesDeck([], 0, 7.5)).toBe(false);
  });
});

describe("StreetLights under a viaduct whose colliders are not built yet", () => {
  /** A game whose open-ground test sees no deck (the streamed deck colliders are not there). */
  const setup = () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    let groundY = 0;
    const lights = new StreetLights(new Scene(), world, {
      groundAt: () => groundY,
      isOpen: () => true,
      control: { approaches: [], state: () => "green" },
      traffic: { forEachCar: () => {} },
      player: { object: new Object3D(), headlights: [] },
    });
    /** Colliders in a slab 0.6 m thick at `y` over x0…x1, z0…z1 (the car's body on a deck). */
    const collidersIn = (y: number, x0: number, x1: number, z0: number, z1: number) => {
      world.step();
      let hits = 0;
      world.intersectionsWithShape(
        { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 },
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Cuboid((x1 - x0) / 2, 0.3, (z1 - z0) / 2),
        () => {
          hits++;
          return true;
        },
      );
      return hits;
    };
    const internals = lights as unknown as { lamps: Array<{ x: number; z: number }>; live: Uint8Array };
    /** How many lamps are lit (live) within the box. */
    const liveIn = (x0: number, x1: number, z0: number, z1: number) =>
      internals.lamps.filter(
        (l, i) => internals.live[i] === 1 && l.x > x0 && l.x < x1 && l.z > z0 && l.z < z1,
      ).length;
    return { world, lights, collidersIn, liveIn, setGround: (y: number) => (groundY = y) };
  };

  it("builds no pole into the deck's lanes, along it or across it, and keeps the open street's", () => {
    const { world, lights, collidersIn, liveIn } = setup();
    try {
      const graph = graphWith(DECK_Y);
      lights.rebuild(graph);
      const x0 = crossX(graph);
      const carY = DECK_Y + 0.6;
      // On the deck over the street along it, and over the crossing street: nothing of the lamps.
      expect(collidersIn(carY, -50, 700, -10, 10)).toBe(0);
      expect(liveIn(-50, 700, -10, 10)).toBe(0);
      // The crossing street's lamps past the deck, and the open street's, keep their poles and light.
      expect(collidersIn(carY, x0 - 10, x0 + 10, 20, 150)).toBeGreaterThan(1);
      expect(liveIn(x0 - 10, x0 + 10, 20, 150)).toBeGreaterThan(1);
      expect(collidersIn(carY, 0, 400, 280, 320)).toBeGreaterThan(10);
    } finally {
      lights.rebuild(null);
      world.free();
    }
  });

  it("carries the deck's height through a change of origin, so the lamps stay out after it", () => {
    const { world, lights, liveIn, setGround } = setup();
    try {
      lights.rebuild(graphWith(DECK_Y));
      // The origin moves 20 m down: everything, the ground and the deck, is 20 m higher in the new frame.
      const lift = 20;
      lights.reanchor(new Matrix4().makeTranslation(0, lift, 0), new Quaternion());
      // The terrain under the new frame, a few cm off the carried ground: every lamp is set again.
      setGround(lift + 0.1);
      const camera = new PerspectiveCamera();
      camera.position.set(300, lift, 0);
      const env = {
        wetness: 0,
        nightFactor: 1,
        weather: "clear",
        isRaining: () => false,
        getObservation: () => null,
      };
      lights.update(0.016, camera, env, performance.now() + 10_000);
      // Read from the lamps' light (live), not their colliders: a collider made after a re-anchor
      // is placed in the moved body's own coordinates (a separate defect, see the knowledge).
      // (Along the street the poles stand 9.6 m off the centre; across it, in the lanes.)
      const internals = lights as unknown as { lamps: Array<{ x: number; z: number }> };
      expect(internals.lamps.filter((l) => Math.abs(l.z) < 10).length).toBeGreaterThan(10);
      expect(liveIn(-50, 700, -10, 10)).toBe(0);
      // The open street's lamps near the camera were set again too, on the new ground, and light.
      expect(liveIn(0, 400, 280, 320)).toBeGreaterThan(5);
    } finally {
      lights.rebuild(null);
      world.free();
    }
  });
});
