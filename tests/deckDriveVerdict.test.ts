import { describe, expect, it } from "vitest";
import {
  autoDriveFailures,
  type AutoDriveRide,
  deckDriveFailures,
  type DeckDriveRide,
  MAX_ABS_DY_M,
  MAX_SHORTFALL_KMH,
} from "../scripts/qa/deckDriveVerdict";

const ride = (over: Partial<DeckDriveRide> = {}): DeckDriveRide => ({
  fell: false,
  maxAbsDyM: 0.04,
  maxShortfallKmh: 4.9,
  maxShortfallAt: "207111988:0",
  maxDyAt: "207111988:2",
  chunks: ["207111988:0", "24402611:30", "24402125:0", "24402125:1"],
  ...over,
});
const seen = { crossed: 0, stalled: 0, reachedEnd: true };

describe("deckDriveFailures: what fails check-deck-drive", () => {
  it("passes a drive that reaches the street at the route's end with nothing wrong", () => {
    expect(deckDriveFailures(ride(), seen)).toEqual([]);
  });

  it("fails the drive that stood stopped at 汐留出口's 壁高欄 in 内回り's lane 0 (the 5 runs that exited 0)", () => {
    const stoppedDead = ride({
      maxShortfallKmh: 51,
      maxShortfallAt: "24402611:31",
      maxDyAt: "24402611:31",
      chunks: ["207111988:0", "24402611:30", "24402611:31"],
    });
    const failures = deckDriveFailures(stoppedDead, { crossed: 0, stalled: 1, reachedEnd: false });
    expect(failures).toHaveLength(3);
    expect(failures.join(" | ")).toMatch(/stalled.*slowed 51 km\/h.*24402611:31.*did not reach.*24402611:31/);
  });

  it("fails a crossed building, a fall, and a drop under the target beyond MAX_SHORTFALL_KMH, each on its own", () => {
    expect(deckDriveFailures(ride(), { ...seen, crossed: 2 })).toEqual(["building crossed on a deck (2)"]);
    expect(deckDriveFailures(ride({ fell: true }), seen)[0]).toMatch(/^fell off a deck/);
    expect(deckDriveFailures(ride({ maxShortfallKmh: MAX_SHORTFALL_KMH }), seen)).toEqual([]);
    expect(deckDriveFailures(ride({ maxShortfallKmh: MAX_SHORTFALL_KMH + 0.1 }), seen)).toHaveLength(1);
  });
});

describe("the ride's |dy| over the deck (P2.7-5 4.4)", () => {
  it("fails a ride whose height over the deck under it moved beyond MAX_ABS_DY_M (a step, a seam), and only that", () => {
    expect(MAX_ABS_DY_M).toBe(0.15);
    expect(deckDriveFailures(ride({ maxAbsDyM: MAX_ABS_DY_M }), seen)).toEqual([]);
    const bounced = deckDriveFailures(ride({ maxAbsDyM: 0.16, maxDyAt: "45019020:40" }), seen);
    expect(bounced).toEqual(["|dy| 0.16 m over 0.15 m (at 45019020:40)"]);
  });
});

describe("autoDriveFailures: what fails an autopilot route (P6's drives)", () => {
  const auto = (over: Partial<AutoDriveRide> = {}): AutoDriveRide => ({
    fell: false,
    maxAbsDyM: 0.05,
    maxDyAt: "45068172:1",
    arrived: true,
    gaveUp: null,
    violations: [],
    ...over,
  });
  const quiet = { crossed: 0, stalled: 0 };

  it("passes a route that arrives with no violation and nothing wrong on the decks", () => {
    expect(autoDriveFailures(auto(), quiet)).toEqual([]);
  });

  it("fails not arriving, a booked violation, a fall, a stall, a crossed building and a bounce, each on its own", () => {
    expect(autoDriveFailures(auto({ arrived: false, gaveUp: "no route" }), quiet)).toEqual([
      "did not arrive (no route)",
    ]);
    expect(autoDriveFailures(auto({ violations: ["speeding"] }), quiet)).toEqual([
      "violations booked: speeding",
    ]);
    expect(autoDriveFailures(auto({ fell: true }), quiet)).toHaveLength(1);
    expect(autoDriveFailures(auto(), { crossed: 0, stalled: 2 })).toEqual(["stalled on a deck (2)"]);
    expect(autoDriveFailures(auto(), { crossed: 1, stalled: 0 })).toEqual(["building crossed on a deck (1)"]);
    expect(autoDriveFailures(auto({ maxAbsDyM: 0.2 }), quiet)).toHaveLength(1);
  });
});
