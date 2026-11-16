import { describe, expect, it } from "vitest";
import { stopAheadWithin, type StopAheadWorld } from "../src/game/stopAhead";
import type { Segment } from "../src/world/roads";
import type { Approach } from "../src/world/trafficControl";

/**
 * stopAheadWithin (第75条の8第1項's 法令の規定による一時停止): what it guarantees is that a stop
 * line a car is waiting at counts whether it stands on the car's own segment or on the next one
 * (the 汐留出口 ramp's foot, D1), and that nothing beyond the range counts.
 */

const seg = (id: number, from: number, to: number, length: number) =>
  ({ id, from, to, length }) as unknown as Segment;

/** A ramp (0, 30 m, node 1 → 2) running into a street (1, node 2 → 3) with a light 4 m in. */
function world(lineOnStreet: number | null, lineOnRamp: number | null = null): StopAheadWorld {
  const ramp = seg(0, 1, 2, 30);
  const street = seg(1, 2, 3, 80);
  const lines = new Map<number, { at: number; dir: 1 | -1 }[]>([
    [0, lineOnRamp === null ? [] : [{ at: lineOnRamp, dir: 1 }]],
    [1, lineOnStreet === null ? [] : [{ at: lineOnStreet, dir: 1 }]],
  ]);
  return {
    nodes: new Map([
      [1, [0]],
      [2, [0, 1]],
      [3, [1]],
    ]),
    segments: [ramp, street],
    nextStop: (s, dir, at) => {
      const ahead = (lines.get(s.id) ?? []).filter((l) => l.dir === dir && l.at - at >= -0.5);
      const first = ahead.toSorted((a, b) => a.at - b.at)[0];
      return first ? { approach: { id: s.id } as unknown as Approach, dist: first.at - at } : null;
    },
  };
}

const ramp = (w: StopAheadWorld) => w.segments[0];

describe("the stop line a car waits at (stopAheadWithin)", () => {
  it("finds the light on the street the ramp runs into, from the ramp's last metres", () => {
    const w = world(4);
    // 26 m along the 30 m ramp: 4 m to its end, then 4 m into the street.
    expect(stopAheadWithin(w, ramp(w), 1, 26, 40)?.dist).toBeCloseTo(8, 9);
  });

  it("finds a line on the car's own segment first", () => {
    const w = world(4, 28);
    expect(stopAheadWithin(w, ramp(w), 1, 26, 40)?.dist).toBeCloseTo(2, 9);
  });

  it("counts nothing beyond the range: a car mid-ramp is not at the light", () => {
    const w = world(4);
    // 5 m along: 25 m to the ramp's end, 29 m to the line, 40 m range: in; 20 m range: out.
    expect(stopAheadWithin(w, ramp(w), 1, 5, 40)?.dist).toBeCloseTo(29, 9);
    expect(stopAheadWithin(w, ramp(w), 1, 5, 20)).toBeNull();
  });

  it("finds none where there is no line ahead (a car standing mid-ramp for no reason is booked)", () => {
    const w = world(null);
    expect(stopAheadWithin(w, ramp(w), 1, 26, 40)).toBeNull();
  });

  it("does not take a line for the other direction", () => {
    const w = world(4);
    // Going the other way along the ramp (to node 1, where nothing goes on).
    expect(stopAheadWithin(w, ramp(w), -1, 2, 40)).toBeNull();
  });
});
