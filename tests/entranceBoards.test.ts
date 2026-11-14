import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { XwEntrance } from "../src/expressway/format";
import { LocalFrame } from "../src/geo/frame";
import { parseBoardContent } from "../src/signs/board/layout";
import { planEntranceBoards } from "../src/world/entranceBoards";
import { RoadGraph, type RoadLine } from "../src/world/roads";

const frame = new LocalFrame(35.68, 139.76, 40);
const M_LAT = 1 / 110_950;
const M_LON = M_LAT / Math.cos((35.68 * Math.PI) / 180);
/** A two-way street from (x0, z0) to (x1, z1), local metres (+x east, +z south). */
const line = (x0: number, z0: number, x1: number, z1: number): RoadLine => ({
  coords: [139.76 + x0 * M_LON, 35.68 - z0 * M_LAT, 139.76 + x1 * M_LON, 35.68 - z1 * M_LAT],
  width: 12,
  oneway: 0,
  kind: "national",
});
// An east-going street in three pieces (junctions at x = -60 and x = -160), the ramp leaving at x = 0.
const graph = new RoadGraph(
  [line(-400, 0, -160, 0), line(-160, 0, -60, 0), line(-60, 0, 0, 0), line(0, 0, 300, 0)],
  frame,
);
const entrance: XwEntrance = {
  run: "1",
  lon: 139.76,
  lat: 35.68,
  heading: 0.1, // a little north of east
  name: "芝公園",
  nameEn: "Shibakoen",
  route: "C1",
  routeName: "都心環状線",
  routeNameEn: "Inner Circular Route",
};

describe("103-A・104 before an entrance（entranceBoards.ts）", () => {
  const plans = planEntranceBoards(graph, [entrance], frame);
  const one = (kind: string) => plans.find((p) => p.board.kind === kind)!;

  it("stands 103-A at the ramp's mouth and 104 150 m back, across two junctions, on the left kerb", () => {
    expect(one("103-A").before).toBe(15);
    expect(one("104").before).toBe(150);
    expect(one("104").pos.x).toBeCloseTo(-150, 0);
    // Left of east-going traffic is north (−z): the kerb at 6 m + GUIDE_POLE_KERB.
    expect(one("104").pos.z).toBeLessThan(-6);
    expect(one("104").travel.x).toBeGreaterThan(0.99);
    expect(one("104").mount).toBe("roadside");
  });

  it("writes boards the schema accepts, with the fictional operator and the real names", () => {
    for (const p of plans) {
      expect(parseBoardContent(p.board).success).toBe(true);
      expect(p.board.operator).toBe("guide.operator");
      expect(p.board.entranceName?.ja).toBe("芝公園");
      expect(p.board.route).toEqual({ kind: "route", number: "C1" });
    }
    expect(one("104").board.distance).toBe(150);
  });

  it("moves a board off a post standing where it would go (its plates would hide it)", () => {
    const at104 = one("104").pos;
    const moved = planEntranceBoards(graph, [entrance], frame, [new Vector3(at104.x, 0, at104.z)]);
    const advance = moved.find((p) => p.board.kind === "104")!;
    expect(advance.before).not.toBe(150);
    expect(Math.hypot(advance.pos.x - at104.x, advance.pos.z - at104.z)).toBeGreaterThan(6);
  });

  it("stands them for the travel that turns left into a ramp across the street, the 103-A's arrow to the left", () => {
    // North (heading π/2) off an east–west street: east-going traffic turns left into it.
    const across = { ...entrance, heading: Math.PI / 2 };
    const crossing = planEntranceBoards(graph, [across], frame);
    const direction = crossing.find((p) => p.board.kind === "103-A")!;
    const advance = crossing.find((p) => p.board.kind === "104")!;
    expect(direction.travel.x).toBeGreaterThan(0.99);
    expect(advance.travel.x).toBeGreaterThan(0.99);
    expect(direction.board.angle).toBe(90);
    expect(advance.board.angle).toBeNull();
    for (const p of crossing) expect(parseBoardContent(p.board).success).toBe(true);
    // South off it: west-going traffic turns left into it.
    const south = planEntranceBoards(graph, [{ ...entrance, heading: -Math.PI / 2 }], frame);
    expect(south.find((p) => p.board.kind === "103-A")!.travel.x).toBeLessThan(-0.99);
    expect(south.find((p) => p.board.kind === "103-A")!.board.angle).toBe(90);
  });

  it("keeps the 103-A's arrow straight on for a ramp along the street", () => {
    expect(one("103-A").board.angle).toBe(0);
  });
});
