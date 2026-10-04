import { Vector3 } from "three";
import { decideSanction } from "../src/game/sanctions";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import {
  SUSPENSION_POINTS,
  TrafficLaw,
  VIOLATIONS,
  injuryViolation,
  speedViolation,
} from "../src/game/traffic";
import { RoadGraph, estimatedLimit, leftOf, type RoadLine } from "../src/world/roads";

describe("Road Traffic Act scoring (普通車)", () => {
  it("grades speeding by how far over the limit", () => {
    expect(speedViolation(0.5)).toBeNull();
    expect(speedViolation(10)).toMatchObject({ points: 1, fine: 9000 });
    expect(speedViolation(17)).toMatchObject({ points: 1, fine: 12000 });
    expect(speedViolation(22)).toMatchObject({ points: 2, fine: 15000 });
    expect(speedViolation(27)).toMatchObject({ points: 3, fine: 18000 });
    // ≥30 km/h over on ordinary roads is not a 反則行為: criminal fine, 6 points.
    expect(speedViolation(35)).toMatchObject({ points: 6, fine: null });
  });

  it("uses the 9,000 yen 反則金 for 通行区分違反 and 35 points for ひき逃げ", () => {
    expect(VIOLATIONS.keepLeft).toMatchObject({ points: 2, fine: 9000 });
    expect(VIOLATIONS.hitAndRun).toMatchObject({ points: 35, fine: null });
  });

  it("adds accident points by injury severity (付加点数, driver solely at fault)", () => {
    expect(injuryViolation(15).points).toBe(3);
    expect(injuryViolation(30).points).toBe(6);
    expect(injuryViolation(50).points).toBe(9);
    expect(injuryViolation(70).points).toBe(13);
  });

  it("records each offence once per stop, and counts it only when caught", () => {
    const law = new TrafficLaw();
    const seen = law.commit(VIOLATIONS.signal, 0);
    expect(seen).not.toBeNull();
    expect(law.commit(VIOLATIONS.signal, 1000)).toBeNull(); // still the same offence
    expect(law.state.points).toBe(0); // 未検挙: nobody saw it
    law.cite(seen!, "patrol");
    law.cite(seen!, "patrol"); // one ticket per offence
    expect(law.state.points).toBe(VIOLATIONS.signal.points);
    expect(seen!.status).toBe("caught");
  });

  it("adds orbis notices to the points only when the post arrives", () => {
    const law = new TrafficLaw();
    const photo = law.commit(VIOLATIONS.signal, 0)!;
    law.notice(photo, "orbis");
    expect(law.state.points).toBe(0);
    expect(law.deliverNotices()).toEqual([photo]);
    expect(law.state.points).toBe(VIOLATIONS.signal.points);
  });

  it("reaches a 行政処分 at 6 caught points (前歴なし)", () => {
    const law = new TrafficLaw();
    law.book(VIOLATIONS.signal, 0);
    law.book(VIOLATIONS.keepLeft, 2000);
    law.book(VIOLATIONS.pedestrianCrossing, 3000);
    expect(law.state.points).toBe(SUSPENSION_POINTS);
    expect(law.isSanctioned).toBe(true);
    law.reset();
    expect(law.state).toMatchObject({ points: 0, suspended: false });
  });
});

describe("road graph", () => {
  const frame = new LocalFrame(35.68, 139.76, 40);
  // A plus-shaped junction: east-west avenue crossed by a north-south street.
  const ew: RoadLine = {
    coords: [139.758, 35.68, 139.76, 35.68, 139.762, 35.68],
    width: 16,
    oneway: 0,
    kind: "national",
  };
  const ns: RoadLine = { coords: [139.76, 35.678, 139.76, 35.68], width: 6, oneway: 1, kind: "local" };
  const graph = new RoadGraph([ew, ns], frame);

  it("splits the avenue where the street meets its middle, forming a 3-way junction", () => {
    expect(graph.segments).toHaveLength(3); // avenue west half, avenue east half, street
    const street = graph.segments[2];
    expect(graph.nodes.get(street.to)).toHaveLength(3);
  });

  it("measures lateral offset with left as positive (vehicles keep left in Japan)", () => {
    const seg = graph.segments[0]; // runs west → east (+X)
    const leftSide = graph
      .sample(seg, 100)
      .pos.clone()
      .add(leftOf(new Vector3(1, 0, 0), 3));
    const hit = graph.nearest(leftSide, 20);
    expect(hit?.lateral).toBeCloseTo(3, 1);
    // Facing east (+X), "left" is north, i.e. −Z in the game frame.
    expect(leftOf(new Vector3(1, 0, 0), 1).z).toBeCloseTo(-1, 6);
  });

  it("only enters one-way streets in their permitted direction", () => {
    const nsSeg = graph.segments[2];
    expect(graph.exits(nsSeg.from, -1).map((s) => s.id)).toContain(nsSeg.id);
    expect(graph.exits(nsSeg.to, -1).map((s) => s.id)).not.toContain(nsSeg.id);
  });

  it("applies the 2026-09-01 statutory limits: 60 km/h on major roads, 30 km/h on residential ones", () => {
    expect(estimatedLimit(ew)).toBe(60);
    expect(estimatedLimit(ns)).toBe(60);
    expect(estimatedLimit({ ...ns, width: 4.3 })).toBe(30);
  });
});

describe("行政処分 (施行令 別表第三)", () => {
  it("suspends for 30 days at 6 points without 前歴, 60 at 9, and revokes at 15", () => {
    expect(decideSanction(5, 0)).toEqual({ kind: "none" });
    expect(decideSanction(6, 0)).toMatchObject({ kind: "suspension", days: 30 });
    expect(decideSanction(9, 0)).toMatchObject({ kind: "suspension", days: 60 });
    expect(decideSanction(15, 0)).toMatchObject({ kind: "revocation" });
  });

  it("is stricter with 前歴: 4 points already suspend for 60 days", () => {
    expect(decideSanction(4, 1)).toMatchObject({ kind: "suspension", days: 60 });
    expect(decideSanction(10, 1)).toMatchObject({ kind: "revocation" });
  });
});
