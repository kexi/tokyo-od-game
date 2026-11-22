import { describe, expect, it } from "vitest";
import { planeAt } from "../src/expressway/geo";
import { sameRoadJudgements, type XwSite } from "../src/world/expresswayRoads";
import type { RoadLine } from "../src/world/roads";

// A plane round (139.75, 35.65): x east, y north (m). Sites and streets drawn in it.
const plane = planeAt(139.75, 35.65);
const ll = (x: number, y: number) => plane.toLonLat(x, y);
const xy = plane.toXY;
const street = (pts: Array<[number, number]>, width = 4.3): RoadLine => ({
  coords: pts.flatMap(([x, y]) => ll(x, y)),
  width,
  oneway: 0,
  kind: "local",
});
/**
 * A ramp's at-grade chunk along y = `y` from x 0 to 200, its slab 2.875 m either side (the band,
 * with SITE_CLEARANCE_M, 3.875 m: the default range's 4848755:0), its run meeting the ground at x 0.
 */
const site = (chunk: string, y = 0, ends: number[] = [0], half = 2.875): XwSite => {
  const coords: number[] = [];
  const s: number[] = [];
  for (let x = 0; x <= 200; x += 10) {
    coords.push(...ll(x, y));
    s.push(x);
  }
  return {
    chunk,
    coords,
    s,
    z: s.map(() => 11),
    ground: s.map(() => 10),
    halfWidth: half,
    ends,
    prev: null,
    next: null,
  };
};
/** Far streets that set the edge of the streets read 1 km out each way, and a road out to it at x 20. */
const frame = () => [
  street([
    [-1000, 1000],
    [1000, 1000],
  ]),
  street([
    [-1000, -1000],
    [1000, -1000],
  ]),
  street([
    [20, 0.2],
    [20, -1000],
  ]),
];
const verdictOf = (lines: RoadLine[], sites: XwSite[], line: RoadLine) =>
  sameRoadJudgements(lines, sites, xy).find((j) => j.street === lines.indexOf(line))?.verdict ?? null;

describe("the same-road rule (P2.7 R1-2b M1, α): a line at a time", () => {
  it("takes out a thin line wholly inside the band along the site", () => {
    const thin = street([
      [20, 0.2],
      [180, 0.2],
    ]);
    const lines = [...frame(), thin];
    expect(verdictOf(lines, [site("A:0")], thin)).toBe("alpha");
  });

  it("keeps a line along the band but only partly inside it (9 m, 1.3 m off the site's centre)", () => {
    const wide = street(
      [
        [20, 1.3],
        [180, 1.3],
      ],
      9,
    );
    const lines = [...frame(), wide];
    expect(verdictOf(lines, [site("A:0")], wide)).toBe("partial");
  });

  it("keeps a line wholly within SITE_END_REACH_M of where the run meets the ground (the ramp's own street)", () => {
    const foot = street([
      [2, 0.2],
      [12, 0.2],
      [20, -50],
    ]);
    const lines = [...frame(), foot];
    expect(verdictOf(lines, [site("A:0")], foot)).toBe("at-foot");
  });

  it("takes out a long line reaching into the foot whole, not leaving its first 15 m in the band", () => {
    const long = street([
      [2, 0.2],
      [150, 0.2],
    ]);
    const lines = [...frame(), long];
    const j = sameRoadJudgements(lines, [site("A:0")], xy).find((d) => d.street === lines.indexOf(long))!;
    expect(j.verdict).toBe("alpha");
    expect(j.stretches[0].l0).toBe(0);
  });

  it("keeps a class 0 line (under 3 m: no width to judge)", () => {
    const narrow = street(
      [
        [20, 0],
        [180, 0],
      ],
      2.5,
    );
    const lines = [...frame(), narrow];
    expect(verdictOf(lines, [site("A:0")], narrow)).toBe("class-0");
  });

  it("never merges the bands of separate runs: a street between two ramps is a road of its own", () => {
    const between = street(
      [
        [20, 0],
        [180, 0],
      ],
      9,
    );
    const lines = [...frame(), between];
    const sites = [site("A:0", 3), site("B:0", -3)];
    expect(verdictOf(lines, sites, between)).not.toBe("alpha");
  });
});

describe("the same-road rule judges a line by its shape alone, not by what it joins (追記 3 F2)", () => {
  const thin = () =>
    street([
      [20, 0.2],
      [180, 0.2],
    ]);
  /** A side street off the line's end at x 180, going north to a dead end inside the streets read. */
  const stub = () =>
    street([
      [180, 0.2],
      [180, 60],
    ]);

  // Why not keep a line whose taking out cuts a street off (追記 2 D2): following the network gave
  // one line different answers in different windows of the streets read; islands are PR 3's.
  it("takes out an alpha line even when the street beyond its end is left cut off", () => {
    const line = thin();
    const lines = [...frame(), line, stub()];
    expect(verdictOf(lines, [site("A:0")], line)).toBe("alpha");
  });

  it("takes out both of two alpha lines in a row, each on its own samples", () => {
    const a = street([
      [20, 0.2],
      [100, 0.2],
    ]);
    const b = street([
      [100, 0.2],
      [180, 0.2],
    ]);
    const lines = [...frame(), a, b, stub()];
    const judged = sameRoadJudgements(lines, [site("A:0")], xy);
    const of = (l: RoadLine) => judged.find((j) => j.street === lines.indexOf(l))?.verdict;
    expect([of(a), of(b)]).toEqual(["alpha", "alpha"]);
  });
});
