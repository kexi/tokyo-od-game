import { describe, expect, it } from "vitest";
import { type DeckStall, judgeStalls, type StopTrace, WAIT_LIMIT_S } from "../scripts/qa/deckStops";

/**
 * The deck drive's stalls (scripts/qa/deckStops.ts): what this guarantees is that a car waiting at a
 * red light, by the game's own record, is no failure while it waits less than the light's cycle, and
 * that every other stand stays one: no reason logged, held, touching something, or waiting too long.
 */

const AT = { lat: 35.663022, lon: 139.762367 };

const stall = (over: Partial<DeckStall> = {}): DeckStall => ({
  ts: "2026-11-15T22:24:00.000Z",
  ...AT,
  xid: "24402125:2",
  frozen: false,
  carFrozen: false,
  touching: { buildings: 0, other: 0 },
  ...over,
});

const atRed = (cycleS = 45): StopTrace["why"] => ({
  blockBy: "stop",
  stop: { kind: "signal", action: "stop", cycleS },
  front: null,
  verdict: "clear",
});

const trace = (phase: StopTrace["phase"], ts: string, stillS: number, why: StopTrace["why"]): StopTrace => ({
  ts,
  phase,
  stillS,
  ...AT,
  why,
});

describe("stalls on the decks, told apart by the reason the game logged", () => {
  it("passes a wait at a red light shorter than the light's cycle", () => {
    const traces = [
      trace("still", "2026-11-15T22:24:00.100Z", 3, atRed()),
      trace("movedOff", "2026-11-15T22:24:10.000Z", 12.9, atRed()),
    ];
    const { unexplained, waits } = judgeStalls([stall()], traces);
    expect(unexplained).toEqual([]);
    expect(waits).toEqual([
      { xid: "24402125:2", reason: "signal", seconds: 12.9, limitS: 45, isOver: false },
    ]);
  });

  it("fails a wait at a light longer than its cycle", () => {
    const traces = [
      trace("still", "2026-11-15T22:24:00.100Z", 3, atRed()),
      trace("movedOff", "2026-11-15T22:25:00.000Z", 50, atRed()),
    ];
    expect(judgeStalls([stall()], traces).waits[0].isOver).toBe(true);
  });

  it("fails a wait the drive ended in (no end to measure)", () => {
    const traces = [trace("still", "2026-11-15T22:24:00.100Z", 3, atRed())];
    expect(judgeStalls([stall()], traces).waits[0].isOver).toBe(true);
  });

  it("keeps a stand with no reason logged as a failure, as before", () => {
    const none: StopTrace["why"] = { blockBy: null, stop: null, front: null, verdict: "clear" };
    const traces = [trace("still", "2026-11-15T22:24:00.100Z", 3, none)];
    expect(judgeStalls([stall()], traces).unexplained).toHaveLength(1);
    // A cruise drive (no autopilot, no traces) the same.
    expect(judgeStalls([stall()], []).unexplained).toHaveLength(1);
  });

  it("keeps a stand where the car was held or touched something, whatever the driver waited for", () => {
    const traces = [trace("still", "2026-11-15T22:24:00.100Z", 3, atRed())];
    expect(judgeStalls([stall({ touching: { buildings: 1, other: 0 } })], traces).unexplained).toHaveLength(
      1,
    );
    expect(judgeStalls([stall({ frozen: true })], traces).unexplained).toHaveLength(1);
  });

  it("does not let a trace elsewhere or at another time explain a stall", () => {
    const far = { ...trace("still", "2026-11-15T22:24:00.100Z", 3, atRed()), lat: AT.lat + 0.001 };
    const late = trace("still", "2026-11-15T22:24:09.000Z", 3, atRed());
    expect(judgeStalls([stall()], [far, late]).unexplained).toHaveLength(1);
  });

  it("gives a queue behind a car the general limit", () => {
    const queue: StopTrace["why"] = { blockBy: null, stop: null, front: { gap: 2.4 }, verdict: "queue" };
    const traces = [
      trace("still", "2026-11-15T22:24:00.100Z", 3, queue),
      trace("movedOff", "2026-11-15T22:24:20.000Z", 20, queue),
    ];
    expect(judgeStalls([stall()], traces).waits[0]).toMatchObject({
      reason: "queue",
      limitS: WAIT_LIMIT_S,
      isOver: false,
    });
  });
});
