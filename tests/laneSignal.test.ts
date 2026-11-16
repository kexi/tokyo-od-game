import { describe, expect, it } from "vitest";
import { laneSignalSide } from "../src/game/autoDriver";

/**
 * The autopilot's 合図 (laneSignalSide). What this guarantees: while the car moves across lanes it
 * shows the side it moves to, even in the tail of a right turn's curve span or with a turn the other
 * way within 30 m (施行令 第21条: until the move is over), and once it is in its lane the curve's or
 * the turn's side comes on; with no move, the curve's side, then the turn's from 30 m as before, and
 * with neither, the path's own planned change.
 */

const none = () => null;

describe("the autopilot's indicator", () => {
  // 丸の内二丁目 (2026-11-17): turned right into a wide street, moving over two lanes to the left
  // while still in the curve's span, the car showed right and was booked for the lane change.
  it("shows left while it moves left after a right turn, still in the curve's span", () => {
    // The path's own move over (planned), the wheel on it (no gap), and the move itself (a gap).
    expect(laneSignalSide(0, "right", { turn: "left", inM: 480 }, () => "left")).toBe("left");
    expect(laneSignalSide(3.3, "right", { turn: "left", inM: 480 }, none)).toBe("left");
  });

  it("shows the curve's side through the curve itself (the car follows it: no move across)", () => {
    expect(laneSignalSide(0, "right", { turn: "left", inM: 20 }, none)).toBe("right");
  });

  it("shows left while it moves left across lanes, a right turn 20 m ahead notwithstanding", () => {
    expect(laneSignalSide(2.5, null, { turn: "right", inM: 20 }, none)).toBe("left");
  });

  it("shows the turn's side once it is in its lane (the move is over)", () => {
    expect(laneSignalSide(0.1, null, { turn: "right", inM: 20 }, none)).toBe("right");
  });

  it("shows the move's side when it is the turn's own (into the turn lane)", () => {
    expect(laneSignalSide(-2, null, { turn: "right", inM: 25 }, none)).toBe("right");
  });

  it("keeps the turn's 30 m when the car does not move across", () => {
    expect(laneSignalSide(0, null, { turn: "left", inM: 29 }, none)).toBe("left");
    expect(laneSignalSide(0, null, { turn: "slightLeft", inM: 10 }, none)).toBe("left");
    expect(laneSignalSide(0, null, { turn: "left", inM: 31 }, none)).toBeNull();
    expect(laneSignalSide(0, null, { turn: "straight", inM: 10 }, none)).toBeNull();
  });

  it("falls back to the path's planned change with no move and no turn near", () => {
    expect(laneSignalSide(0, null, null, () => "right")).toBe("right");
  });
});
