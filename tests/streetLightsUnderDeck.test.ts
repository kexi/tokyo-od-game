import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Scene } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { isUnderDeck, placeLamps, StreetLights } from "../src/world/streetLights";

beforeAll(() => RAPIER.init());

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LON = 1 / 110_950 / Math.cos((35.68 * Math.PI) / 180);
const M_LAT = 1 / 110_950;
/** Height of the viaduct's road surface over the flat ground at 0 (24402611:27 is at about 7.2 m). */
const DECK_Y = 7.2;

/** A 22 m east–west street from x = 0 to 400 m (lamps on both sides, 12 m poles). */
const street: RoadLine = {
  coords: [139.76, 35.68, 139.76 + 400 * M_LON, 35.68],
  width: 22,
  oneway: 0,
  kind: "local",
};
/** A second street 300 m to the south, out from under any deck. */
const open: RoadLine = {
  ...street,
  coords: [139.76, 35.68 - 300 * M_LAT, 139.76 + 400 * M_LON, 35.68 - 300 * M_LAT],
};
/** A 4-lane viaduct over the whole first street, along its centreline. */
const viaduct: RoadLine = {
  coords: [139.76 - 50 * M_LON, 35.68, 139.76 + 450 * M_LON, 35.68],
  width: 16,
  oneway: 1,
  kind: "highway",
  source: "osm",
  cls: "expressway",
  structure: "viaduct",
  level: 1,
  xid: "24402611:27",
};

/** The graph with the viaduct's surface at `deckY` (the game sets Segment.elev from the chunks). */
const graphWith = (deckY: number): RoadGraph => {
  const graph = new RoadGraph([street, open, viaduct], frame);
  const deck = graph.segments.find((s) => s.line.xid !== undefined);
  if (!deck) throw new Error("no deck");
  deck.elev = deck.pts.map(() => deckY);
  graph.ground = () => 0;
  return graph;
};
/** Whether a lamp stands on the first street (under the viaduct), else on the open one. */
const isUnderViaduct = (z: number) => Math.abs(z) < 50;

describe("street lights under an expressway viaduct", () => {
  it("records the viaduct over the lamps of the street under it and none over the open street", () => {
    const lamps = placeLamps(graphWith(DECK_Y));
    const under = lamps.filter((l) => isUnderViaduct(l.z));
    const outside = lamps.filter((l) => !isUnderViaduct(l.z));
    expect(under.length).toBeGreaterThan(10);
    expect(outside.length).toBeGreaterThan(10);
    for (const l of under) expect(l.deckY).toBeCloseTo(DECK_Y, 6);
    for (const l of outside) expect(l.deckY).toBeNull();
  });

  it("leaves out a lamp the deck would cut through, and keeps one the deck passes high over", () => {
    // A 12 m pole on the ground under a deck at 7.2 m: through it.
    expect(isUnderDeck(DECK_Y, 0, 12)).toBe(true);
    // A deck 30 m up clears the same pole.
    expect(isUnderDeck(30, 0, 12)).toBe(false);
    // A road in a cut below the lamp's foot is not over it.
    expect(isUnderDeck(-6, 0, 12)).toBe(false);
    expect(isUnderDeck(null, 0, 12)).toBe(false);
  });

  it("builds no pole collider into the deck even while the deck's own colliders are not built yet", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    // isOpen always true: no deck collider for the open-ground ray to hit (the streamed decks are
    // built only near the car), the case where a pole stood through 24402611:27.
    const lights = new StreetLights(new Scene(), world, {
      groundAt: () => 0,
      isOpen: () => true,
      control: { approaches: [], state: () => "green" },
      traffic: { forEachCar: () => {} },
      player: { object: new Object3D(), headlights: [] },
    });
    try {
      const poleTopsAt = (y: number, zCentre: number) => {
        let hits = 0;
        world.intersectionsWithShape(
          { x: 200, y, z: zCentre },
          { x: 0, y: 0, z: 0, w: 1 },
          new RAPIER.Cuboid(200, 0.3, 12),
          () => {
            hits++;
            return true;
          },
        );
        return hits;
      };
      lights.rebuild(graphWith(DECK_Y));
      world.step();
      expect(lights.count).toBeGreaterThan(20);
      // At the car's height on the deck over the street: nothing of the lamps.
      expect(poleTopsAt(DECK_Y + 0.6, 0)).toBe(0);
      // The open street's lamps keep their poles (same height above the ground).
      expect(poleTopsAt(DECK_Y + 0.6, 300)).toBeGreaterThan(10);
      // The same street under a deck 30 m up keeps its poles too.
      lights.rebuild(graphWith(30));
      world.step();
      expect(poleTopsAt(DECK_Y + 0.6, 0)).toBeGreaterThan(10);
    } finally {
      lights.rebuild(null);
      world.free();
    }
  });
});
