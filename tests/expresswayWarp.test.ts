import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { XwMeta, XwTile } from "../src/expressway/format";
import { deckLanding, deckPose, expresswaySpots } from "../src/game/expresswayWarp";
import { hasOperatorWord, OPERATOR_WORDS } from "../src/game/roadNames";
import { LocalFrame } from "../src/geo/frame";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads";
import { laneOfOffset } from "../src/world/laneChange";
import { classOf } from "../src/world/roadClass";
import { RoadGraph } from "../src/world/roads";

// The published decks (public/data/expressway): the spots 移動 offers with ?expressway.
const DIR = join(__dirname, "../public/data/expressway");
const meta = JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) as XwMeta;
const tiles = meta.tiles.map((key) => JSON.parse(readFileSync(join(DIR, `${key}.json`), "utf8")) as XwTile);
const chunks = tiles.flatMap((t) => t.chunks);
const runs = [...new Map(tiles.flatMap((t) => t.runs).map((r) => [r.id, r])).values()];
const chunkById = new Map(chunks.map((c) => [c.id, c]));
const ellipsoidal = (_lat: number, _lon: number, h: number) => h;

describe("expresswaySpots: the expressway's places for 移動", () => {
  const spots = expresswaySpots(tiles);

  it("offers the named entrances, exits and routes of the published range, each once", () => {
    const names = spots.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["汐留入口", "汐留出口", "芝公園入口", "芝公園出口", "都心環状線"]),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(spots.find((s) => s.name === "汐留出口")?.role).toBe("exit");
    expect(spots.find((s) => s.name === "芝公園入口")?.role).toBe("entrance");
    expect(spots.find((s) => s.name === "都心環状線")?.role).toBe("route");
  });

  it("uses only the facilities' own names from the data, never an operator's", () => {
    const named = new Set([
      ...chunks.map((c) => c.name),
      ...tiles.flatMap((t) => (t.entrances ?? []).map((e) => (e.name ? `${e.name}入口` : null))),
    ]);
    for (const s of spots) {
      expect(named.has(s.name)).toBe(true);
      expect(hasOperatorWord(s.name)).toBe(false);
    }
  });

  it("passes the names through the name layer: an operator's name before one is taken off", () => {
    const operator = OPERATOR_WORDS[0];
    const named = tiles.map((t) => ({
      ...t,
      chunks: t.chunks.map((c) => (c.name === "汐留出口" ? { ...c, name: `${operator}汐留出口` } : c)),
      entrances: (t.entrances ?? []).map((e) =>
        e.name === "芝公園" ? { ...e, name: `${operator} 芝公園` } : e,
      ),
    }));
    const names = expresswaySpots(named).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["汐留出口", "芝公園入口"]));
    for (const name of names) expect(hasOperatorWord(name)).toBe(false);
  });

  it("anchors every spot on a main line's chunk (the ramps' open ends lie within 100 m of one)", () => {
    for (const s of spots) {
      const chunk = chunkById.get(s.xid);
      expect(chunk, s.name).toBeDefined();
      expect(chunk!.cls, s.name).toBe("expressway");
    }
  });

  it("gives no spot for an entrance without a name (no name is made up)", () => {
    const unnamed = tiles.flatMap((t) => t.entrances ?? []).filter((e) => e.name === null);
    expect(unnamed.length).toBeGreaterThan(0);
    for (const e of unnamed) expect(spots.some((s) => s.xid.startsWith(`${e.run}:`))).toBe(false);
  });
});

describe("deckLanding + deckPose: a spot's car is put on the deck, in its left lane, facing the traffic", () => {
  const spots = expresswaySpots(tiles);
  for (const spot of spots) {
    it(`${spot.name}: on ${spot.xid}'s surface, facing the way it runs`, () => {
      const frame = new LocalFrame(spot.lat, spot.lon, 0);
      const graph = new RoadGraph(
        joinExpressway([], expresswayRoadInput(chunks, runs, ellipsoidal), () => {}),
        frame,
      );
      const p = frame.toLocal(spot.lat, spot.lon, 0);
      const landing = deckLanding(graph, spot.xid, p, () => true);
      expect(landing).not.toBeNull();
      const pose = deckPose(graph, landing!.seg, landing!.s);
      expect(pose).not.toBeNull();
      // Near the spot's own point (the chunk's station there).
      expect(Math.hypot(pose!.at.x - p.x, pose!.at.z - p.z)).toBeLessThan(15);
      // The deck the game finds under the car 0.9 m up is this chunk, its surface within 5 cm.
      const car = pose!.at.clone().setY(pose!.surfaceY + 0.9);
      const hit = graph.nearestOnSurface(car, 15, (seg) => seg.line.xid !== undefined);
      expect(hit?.seg.line.xid).toBe(spot.xid);
      expect(classOf(hit!.seg.line)).toBe("expressway");
      expect(Math.abs(graph.surfaceY(hit!.seg, hit!.s)! - pose!.surfaceY)).toBeLessThan(0.05);
      // Facing the chunk's direction (its traffic: a deck runs one way), in the left lane.
      expect(hit!.seg.oneway).not.toBe(-1);
      const forward = new Vector3(Math.sin(pose!.yaw), 0, Math.cos(pose!.yaw));
      expect(forward.dot(hit!.dir)).toBeGreaterThan(0.999);
      expect(laneOfOffset(hit!.seg, hit!.lateral)).toBe(0);
    });
  }

  it("waits (null) while the chunk is not in the graph or has no collider", () => {
    const spot = spots[0];
    const frame = new LocalFrame(spot.lat, spot.lon, 0);
    const graph = new RoadGraph(
      joinExpressway([], expresswayRoadInput(chunks, runs, ellipsoidal), () => {}),
      frame,
    );
    const p = frame.toLocal(spot.lat, spot.lon, 0);
    expect(deckLanding(graph, spot.xid, p, () => false)).toBeNull();
    expect(deckLanding(graph, "no-such:0", p, () => true)).toBeNull();
  });
});
