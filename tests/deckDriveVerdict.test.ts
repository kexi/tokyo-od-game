import { describe, expect, it } from "vitest";
import { deckDriveFailures, type DeckDriveRide, MAX_SHORTFALL_KMH } from "../scripts/qa/deckDriveVerdict";

const ride = (over: Partial<DeckDriveRide> = {}): DeckDriveRide => ({
  fell: false,
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
