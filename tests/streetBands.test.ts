import { describe, expect, it } from "vitest";
import { classify, mergeBands, offCentreLanes, type SectionNow } from "../src/world/streetBandRules";

/** A two-way street, one lane a way in a 7.5 m carriageway (lane centres ±1.6 m), 16 m 幅員. */
const narrow: SectionNow = {
  travel: 0,
  lanes: 1,
  carriageway: 7.5,
  median: 0,
  room: 16,
  centres: [1.6, -1.6],
};

describe("mergeBands: a segment's strips as bands (memo 3.2)", () => {
  it("keeps strips either side of a street apart when a lane fits between them (central's segment 1176)", () => {
    const bands = mergeBands([
      { right: 7.87, left: 15.74 },
      { right: -15.73, left: -7.81 },
    ]);
    expect(bands).toEqual([
      { right: -15.73, left: -7.81 },
      { right: 7.87, left: 15.74 },
    ]);
  });

  it("makes one band of strips that overlap, and of strips closer than a lane (2.75 m)", () => {
    expect(
      mergeBands([
        { right: 1, left: 4 },
        { right: 3, left: 6 },
        { right: 8.7, left: 10 },
      ]),
    ).toEqual([{ right: 1, left: 10 }]);
  });

  it("keeps a strip a lane or more from the last apart", () => {
    expect(
      mergeBands([
        { right: 1, left: 4 },
        { right: 6.75, left: 9 },
      ]),
    ).toHaveLength(2);
  });
});

describe("classify: R1-2a's classes (memo 3.3)", () => {
  it("leaves a street alone when no lane's centre lies in any of its bands (segment 1176: clear, not C)", () => {
    const bands = mergeBands([
      { right: 7.87, left: 15.74 },
      { right: -15.73, left: -7.81 },
    ]);
    const ruling = classify(narrow, bands, offCentreLanes(16, 0, 1, { right: -15.73, left: 15.74 }));
    expect(ruling.klass).toBe("clear");
    expect(ruling.carriageway).toBe(7.5);
  });

  it("gives a band over the centre line a median in the carriageway as it is, with fewer lanes where two do not fit", () => {
    const wide: SectionNow = {
      travel: 0,
      lanes: 2,
      carriageway: 27,
      median: 0,
      room: 33,
      centres: [11, 7.75, -11, -7.75],
    };
    const ruling = classify(wide, [{ right: -5, left: 7.9 }], 2);
    // A way: 27 / 2 − 0.5 − 15.8 / 2 = 5.1 m, one lane of 2.75 m; the outer edge stays at 27 m.
    expect(ruling).toEqual({ klass: "A", lanesAfter: 1, median: 15.8, carriageway: 27 });
  });

  it("caps the carriageway at a side band's inner edge (A'), and falls back to a median over it where the cap holds no lane", () => {
    const wide: SectionNow = {
      travel: 0,
      lanes: 1,
      carriageway: 7.5,
      median: 0,
      room: 33,
      centres: [1.6, -1.6],
    };
    // Cap 2 m holds nothing; a median of 18 m in the room leaves 7 m a way.
    expect(classify(wide, [{ right: 1, left: 9 }], 1)).toMatchObject({ klass: "A", median: 18 });
    // Four lanes a way in 28.64 m between two decks (central's 817): the nearer inner edge, 5.8 m,
    // caps it at 11.6 m, one lane a way; a moved line has no room to one side (offCentre 0).
    const between: SectionNow = {
      travel: 0,
      lanes: 4,
      carriageway: 28.64,
      median: 0,
      room: 33,
      centres: [12.09, 8.64, 5.18, 1.73, -12.09, -8.64, -5.18, -1.73],
    };
    const decks = [
      { right: -19.35, left: -10.59 },
      { right: 5.8, left: 15.38 },
    ];
    expect(offCentreLanes(33, 0, 4, { right: -19.35, left: 15.38 })).toBe(0);
    expect(classify(between, decks, 0)).toEqual({
      klass: "A'",
      lanesAfter: 1,
      median: 0,
      carriageway: 11.6,
    });
    // A one-way street the same way: lanes at −3.5, 0, 3.5 in a room no wider than the carriageway;
    // a band from 3.4 m caps it at 6.8 m, two lanes, as many as a moved line would keep.
    const oneWay: SectionNow = {
      travel: 1,
      lanes: 3,
      carriageway: 10.75,
      median: 0,
      room: 10.75,
      centres: [-3.5, 0, 3.5],
    };
    const band = { right: 3.4, left: 9 };
    expect(offCentreLanes(10.75, 1, 3, band)).toBe(2);
    expect(classify(oneWay, [band], 2)).toEqual({
      klass: "A'",
      lanesAfter: 2,
      median: 0,
      carriageway: 6.8,
    });
  });

  it("leaves a fitting section ungiven where a moved line keeps more lanes (B3, central's 1563)", () => {
    // Four lanes a way in 33 m, the band on one side only: a symmetric section narrows both ways
    // to one lane, a line moved off the band keeps three.
    const lopsided: SectionNow = {
      travel: 0,
      lanes: 4,
      carriageway: 33,
      median: 0,
      room: 33,
      centres: [14.4, 10.8, 7.2, 3.6, -14.4, -10.8, -7.2, -3.6],
    };
    const band = { right: -14.66, left: -4.22 };
    const offCentre = offCentreLanes(33, 0, 4, band);
    expect(offCentre).toBe(3);
    expect(classify(lopsided, [band], offCentre)).toEqual({
      klass: "B3",
      lanesAfter: 4,
      median: 0,
      carriageway: 33,
    });
    // The same band with no more room to move into than the symmetric section keeps: given (A').
    expect(classify(lopsided, [band], 1).klass).toBe("A'");
  });

  it("never resolves a one-way street whose band lies over its centre line: B1 where its lanes fit to one side, else C", () => {
    const oneWay: SectionNow = {
      travel: -1,
      lanes: 3,
      carriageway: 10.75,
      median: 0,
      room: 33,
      centres: [3.5, 0, -3.5],
    };
    expect(classify(oneWay, [{ right: -8, left: 4 }], 3).klass).toBe("B1");
    expect(classify(oneWay, [{ right: -8, left: 4 }], 0).klass).toBe("C");
  });
});
