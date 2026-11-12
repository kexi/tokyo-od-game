import { describe, expect, it } from "vitest";
import {
  HEIGHT_KM_STEP,
  HIGH_DECK_ABOVE_M,
  HIGH_DECK_MARGIN,
  HIGH_DECK_MIN_M,
} from "../src/expressway/allowlist";
import { STATION_STRIDE, type XwChunk } from "../src/expressway/format";
import { heightKmOf, highDeckStretches } from "../src/expressway/highDeck";
import {
  budgetOf,
  CAP_FIELDS,
  capKm,
  type LedgerSummary,
  summaryOf,
  withinCap,
  withinHeightBudget,
} from "../src/expressway/ledger";
import { TRACK_FREE_M } from "../src/expressway/report";

// The height budget (P2.7-5 4.3): no ceiling over the ground for every deck (a deck across a valley
// is high and right), but a ledger case for each stretch nothing forces that stands over 20 m for
// 50 m or more (high-deck), and a ratchet on the km over 15 and 20 m per district.

/** One run of 10 m stations from 0 to `length`, the deck `height(s)` over a ground at 0, one chunk per 300 m. */
function run(
  length: number,
  height: (s: number) => number,
  over: (k: number) => XwChunk["over"] = () => null,
): XwChunk[] {
  const chunks: XwChunk[] = [];
  for (let k = 0; k * 300 < length; k++) {
    const st: number[] = [];
    for (let s = k * 300; s <= Math.min(length, (k + 1) * 300) + 1e-9; s += 10)
      st.push(s, 139.75 + s * 1e-5, 35.65, height(s), 0, 0, 0);
    chunks.push({
      id: `r:${k}`,
      run: "r",
      k,
      structure: "viaduct",
      over: over(k),
      st,
      decks: [],
      cross: [],
    } as unknown as XwChunk);
  }
  return chunks;
}

/** A valley crossing: 10 m over the ground, `top` m over it from `a` to `b`. */
const valley = (a: number, b: number, top: number) => (s: number) => (s >= a && s <= b ? top : 10);

describe("high-deck の判定（highDeckStretches）", () => {
  const L = 3000;
  // Far from both ends (TRACK_FREE_M) so nothing forces the deck there.
  const mid = L / 2;

  it("finds a free stretch over 20 m for 50 m or more, with its ends, its largest height and its length", () => {
    const got = highDeckStretches(run(L, valley(mid, mid + 120, 24)));
    expect(got).toEqual([{ s0: mid, s1: mid + 120, heightM: 24, spanM: 120 }]);
  });

  it("not under 50 m long, and from 50 m on (HIGH_DECK_MIN_M)", () => {
    expect(HIGH_DECK_MIN_M).toBe(50);
    expect(highDeckStretches(run(L, valley(mid, mid + 40, 24)))).toEqual([]);
    expect(highDeckStretches(run(L, valley(mid, mid + 50, 24)))).toHaveLength(1);
  });

  it("not at 20 m itself, only over it (HIGH_DECK_ABOVE_M)", () => {
    expect(HIGH_DECK_ABOVE_M).toBe(20);
    expect(highDeckStretches(run(L, valley(mid, mid + 200, 20)))).toEqual([]);
    expect(highDeckStretches(run(L, valley(mid, mid + 200, 20.01)))).toHaveLength(1);
  });

  it("not where something forces the deck: within TRACK_FREE_M of the run's end", () => {
    const forcedFrom = L - TRACK_FREE_M;
    expect(highDeckStretches(run(L, valley(forcedFrom + 10, L - 10, 30)))).toEqual([]);
    // The part more than TRACK_FREE_M from the end still counts.
    const got = highDeckStretches(run(L, valley(L - TRACK_FREE_M - 200, L - TRACK_FREE_M - 10, 30)));
    expect(got).toHaveLength(1);
  });

  it("not on a structure's deck (a bridge's deck over the water is high by design)", () => {
    const bridge = (k: number) =>
      k === 5 ? ({ deck: "bridge", level: "upper" } as unknown as XwChunk["over"]) : null;
    expect(highDeckStretches(run(L, valley(1510, 1590, 40), bridge))).toEqual([]);
  });

  it("splits at a station that is not high: two stretches", () => {
    const twice = (s: number) => ((s >= 1200 && s <= 1300) || (s >= 1400 && s <= 1500) ? 25 : 10);
    expect(highDeckStretches(run(L, twice)).map((h) => [h.s0, h.s1])).toEqual([
      [1200, 1300],
      [1400, 1500],
    ]);
  });
});

describe("high-deck の台帳（cap と余裕）", () => {
  it("needs the height and the length in its cap", () => {
    expect(CAP_FIELDS["high-deck"]).toEqual(["heightM", "spanM"]);
  });

  it("keeps a decision while the height grows at most 0.5 m and the length 20 m (HIGH_DECK_MARGIN)", () => {
    expect(HIGH_DECK_MARGIN).toEqual({ heightM: 0.5, spanM: 20 });
    const cap = { heightM: 24, spanM: 120 };
    expect(withinCap({ s0: 0, s1: 140, heightM: 24.5, spanM: 140 }, cap)).toBe(true);
    expect(withinCap({ s0: 0, s1: 140, heightM: 24.51, spanM: 120 }, cap)).toBe(false);
    expect(withinCap({ s0: 0, s1: 141, heightM: 24, spanM: 140.1 }, cap)).toBe(false);
  });
});

describe("15・20 m 超の km のラチェット（budget.heightKm）", () => {
  const chunks = run(3000, valley(1000, 1500, 22));

  it("counts every viaduct chunk's km over 15 and 20 m per district, as the scorecard's height.over15Km", () => {
    const got = heightKmOf(new Map([["r", chunks]]), () => "central");
    expect(got).toEqual({ central: { over15Km: 0.51, over20Km: 0.51 } });
  });

  it("caps the km at the summary rounded up to HEIGHT_KM_STEP, so a rebuild's wobble stays under it", () => {
    expect(HEIGHT_KM_STEP).toBe(0.5);
    expect(capKm(0.51)).toBe(1);
    expect(capKm(1)).toBe(1);
    expect(capKm(0)).toBe(0);
    const summary: LedgerSummary = summaryOf([], 0, {}, { central: { over15Km: 13.335, over20Km: 9.369 } });
    const budget = budgetOf(summary);
    expect(budget.heightKm).toEqual({ central: { over15Km: 13.5, over20Km: 9.5 } });
    expect(withinHeightBudget(summary, budget)).toEqual([]);
  });

  it("fails above the cap, and a district without a cap", () => {
    const budget = budgetOf(summaryOf([], 0, {}, { central: { over15Km: 13.335, over20Km: 9.369 } }));
    const grown = summaryOf(
      [],
      0,
      {},
      { central: { over15Km: 13.6, over20Km: 9.4 }, east: { over15Km: 1, over20Km: 0 } },
    );
    expect(withinHeightBudget(grown, budget)).toEqual([
      "central: over 15 m 13.6 km > 13.5",
      "east: no cap in the budget",
    ]);
  });

  it("leaves a summary without heightKm (a ledger before P2.7-5) as it was", () => {
    const summary = summaryOf([], 0, {});
    expect("heightKm" in summary).toBe(false);
    expect("heightKm" in budgetOf(summary)).toBe(false);
  });
});

// Unused import guard: the stride is the station layout run() writes.
expect(STATION_STRIDE).toBe(7);
