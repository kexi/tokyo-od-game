import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { classifyTurn } from "../src/game/navigation";
import {
  type IndicatorMemory,
  isInTurn,
  isSignalOmitted,
  isTurnSignalOmitted,
  noteIndicators,
  TURN_JUDGED_M,
  type TurnWatch,
  turnSignalSide,
} from "../src/game/signalOmission";
import { isLaneChangeBanned, laneOfOffset } from "../src/world/laneChange";
import { laneChangeSide, laneCountedIn, type HeldLane } from "../src/world/laneLinks";
import { RoadGraph, type RoadLine } from "../src/world/roads";

// Local frame: x east, z south. These helpers take x east, y north metres.
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const at = (x: number, y: number) => frame.toLocal(35.68 + y * LAT, 139.76 + x * LON, frame.origin.h).setY(0);
const line = (pts: Array<[number, number]>): RoadLine => ({
  coords: pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]),
  width: 14,
  oneway: 0,
  kind: "local",
});

/** A crossroads of 14 m two-way streets at (0, 0), 2 lanes each way (3.5 m each). */
const crossroads = (banned = false) => {
  const graph = new RoadGraph(
    [
      line([
        [0, -300],
        [0, 0],
      ]),
      line([
        [0, 0],
        [0, 300],
      ]),
      line([
        [0, 0],
        [300, 0],
      ]),
      line([
        [-300, 0],
        [0, 0],
      ]),
    ],
    frame,
  );
  for (const seg of graph.segments) {
    seg.lanes = 2;
    seg.noLaneChange = banned;
  }
  return graph;
};

type Mark = { x: number; y: number; left: boolean; right: boolean };

/** Points every 0.25 m: straight lines between `pts`, a right-hand quarter circle where asked. */
const path = (parts: Array<{ to: [number, number] } | { arcRight: number }>, from: [number, number]) => {
  const pts: Array<[number, number]> = [from];
  let [x, y] = from;
  let heading = Math.PI / 2; // north, in x/y
  for (const part of parts) {
    if ("to" in part) {
      const [tx, ty] = part.to;
      const n = Math.max(1, Math.round(Math.hypot(tx - x, ty - y) / 0.25));
      for (let i = 1; i <= n; i++) pts.push([x + ((tx - x) * i) / n, y + ((ty - y) * i) / n]);
      heading = Math.atan2(ty - y, tx - x);
      [x, y] = part.to;
      continue;
    }
    const r = part.arcRight;
    const steps = Math.round(((Math.PI / 2) * r) / 0.25);
    for (let i = 0; i < steps; i++) {
      heading -= Math.PI / 2 / steps;
      x += Math.cos(heading) * 0.25;
      y += Math.sin(heading) * 0.25;
      pts.push([x, y]);
    }
  }
  return pts;
};

/**
 * The car along `pts` at `speedAt` (m/s, default 5: 18 km/h), with the indicators `signal` gives,
 * through main.ts's checks as they stand: the turn judged TURN_JUDGED_M past the junction
 * (isTurnSignalOmitted), the lane counted (laneCountedIn) for 合図 and 進路変更禁止 except while
 * isInTurn on the street under the car. Returns what was booked.
 */
const drive = (
  graph: RoadGraph,
  pts: Array<[number, number]>,
  signal: (x: number, y: number) => Omit<Mark, "x" | "y">,
  speedAt: (x: number, y: number) => number = () => 5,
) => {
  const booked: string[] = [];
  const memory: IndicatorMemory = { left: -Infinity, right: -Infinity };
  let turnAt: TurnWatch | null = null;
  let held: HeldLane | null = null;
  let track: { seg: (typeof graph.segments)[number]; lane: number } | null = null;
  let now = 0;
  for (let i = 1; i < pts.length; i++) {
    const v = speedAt(...pts[i]);
    const speed = v * 3.6;
    now += (0.25 * 1000) / v;
    const pos = at(...pts[i]);
    const prev = at(...pts[i - 1]);
    // Past a jump the heading is the way on from the new spot.
    const hasJumped = prev.distanceTo(pos) >= 30;
    const ahead = at(...pts[Math.min(pts.length - 1, i + 1)]);
    const forward = (hasJumped ? ahead.sub(pos) : pos.clone().sub(prev)).normalize();
    if (hasJumped) {
      turnAt = null;
      held = null;
      track = null;
    }
    const s = signal(...pts[i]);
    noteIndicators(memory, s.left, s.right, now);
    const hit = graph.nearest(pos, 8);
    const onRoad = hit && Math.abs(hit.lateral) < hit.seg.line.width / 2 + 1.5 ? hit : null;
    const align = onRoad ? forward.dot(onRoad.dir) : 0;
    if (onRoad && Math.abs(align) > 0.7) {
      const dir = align > 0 ? 1 : -1;
      const node = dir === 1 ? onRoad.seg.to : onRoad.seg.from;
      const toNode = dir === 1 ? onRoad.seg.length - onRoad.s : onRoad.s;
      const isJunction = (graph.nodes.get(node)?.length ?? 0) >= 3;
      if (isJunction && toNode < 20 && !turnAt)
        turnAt = {
          tIn: onRoad.dir.clone().multiplyScalar(dir),
          node: graph.sample(onRoad.seg, dir === 1 ? onRoad.seg.length : 0).pos,
          since: now,
        };
    }
    if (turnAt && Math.hypot(pos.x - turnAt.node.x, pos.z - turnAt.node.z) > TURN_JUDGED_M) {
      const watch = turnAt;
      const side = turnSignalSide(classifyTurn(watch.tIn, forward));
      turnAt = null;
      if (isTurnSignalOmitted(side, now, memory, watch)) booked.push(`turn ${side} no signal`);
    }
    const roadAlong = onRoad ? onRoad.dir.clone().multiplyScalar(align >= 0 ? 1 : -1) : null;
    const isTurning = isInTurn(turnAt, pos, roadAlong);
    const counted: HeldLane | null =
      speed > 15 && !isTurning ? laneCountedIn(graph, pos, forward, held, onRoad, false, () => true) : null;
    const changedTo = counted ? laneChangeSide(held, counted) : null;
    if (isSignalOmitted(changedTo, now, memory)) booked.push(`lane change ${changedTo} no signal`);
    held = counted;
    const seg = onRoad?.seg;
    if (onRoad && seg && isLaneChangeBanned(seg) && Math.abs(align) > 0.8 && !isTurning) {
      const lane = laneOfOffset(seg, onRoad.lateral * Math.sign(align));
      const isChange =
        track !== null && track.seg === seg && track.lane !== lane && lane >= 0 && lane < seg.lanes;
      if (isChange) booked.push("lane change over a yellow line");
      track = { seg, lane };
    } else track = null;
  }
  return booked;
};

const rightOn = () => ({ left: false, right: true });
const none = () => ({ left: false, right: false });
// North in the right lane (x = -1.75), a right turn of radius 6 into the east street's lane by the
// centre line (y = 1.75), then over to its left lane (y = 5.25) within 12 m, along the street.
const rightTurnIntoLeftLane = () =>
  path([{ to: [-1.75, -4.25] }, { arcRight: 6 }, { to: [16.25, 5.25] }, { to: [80, 5.25] }], [-1.75, -80]);

describe("lane checks through a turn (isInTurn)", () => {
  it("books nothing for a right turn that ends in the left lane with the right indicator on", () => {
    expect(drive(crossroads(), rightTurnIntoLeftLane(), rightOn)).toEqual([]);
    expect(drive(crossroads(true), rightTurnIntoLeftLane(), rightOn)).toEqual([]);
  });

  it("still books a lane change with no 合図 once the turn is over", () => {
    const pts = path(
      [
        { to: [-1.75, -4.25] },
        { arcRight: 6 },
        { to: [16.25, 5.25] },
        { to: [70, 5.25] },
        { to: [82, 1.75] },
        { to: [120, 1.75] },
      ],
      [-1.75, -80],
    );
    // Right indicator until the turn is judged, none for the move right 70 m on (past SIGNAL_RECENT_MS).
    const signal = (x: number) => (x < 26 ? rightOn() : none());
    expect(drive(crossroads(), pts, signal)).toEqual(["lane change right no signal"]);
  });

  it("still books a turn made with no 合図", () => {
    expect(drive(crossroads(), rightTurnIntoLeftLane(), none)).toEqual(["turn right no signal"]);
  });

  it("still books a lane change with no 合図 straight on through the junction", () => {
    const pts = path([{ to: [-1.75, -15] }, { to: [-5.25, -3] }, { to: [-5.25, 80] }], [-1.75, -80]);
    expect(drive(crossroads(), pts, none)).toEqual(["lane change left no signal"]);
  });

  it("still books a lane change at 25° just before the junction, on the approach", () => {
    // Over to the left lane between 20 and 12.5 m before the junction (3.5 m in 7.5 m: 25°, inside
    // the turn watch), then straight on.
    const pts = path([{ to: [-1.75, -20] }, { to: [-5.25, -12.5] }, { to: [-5.25, 80] }], [-1.75, -80]);
    expect(drive(crossroads(), pts, none)).toEqual(["lane change left no signal"]);
    expect(drive(crossroads(true), pts, none)).toEqual([
      "lane change left no signal",
      "lane change over a yellow line",
    ]);
  });

  it("books no missed 合図 for a turn signalled and then crawled out of", () => {
    // Right indicator until the car runs along the east street, then off; 1 m/s from there to
    // past the point 25 m on (about 20 s, past SIGNAL_RECENT_MS), as in a queue past the junction.
    const signal = (x: number) => (x < 4 ? rightOn() : none());
    const speed = (x: number) => (x < 4 ? 5 : 1);
    expect(drive(crossroads(), rightTurnIntoLeftLane(), signal, speed)).toEqual([]);
  });

  it("judges no turn for a jump away from the junction the car was coming up to", () => {
    // North to 10 m before the junction (the turn watch on), then placed on the east street 60 m
    // on, heading east: as a view table re-places the car.
    const pts = [...path([{ to: [-1.75, -10] }], [-1.75, -80]), ...path([{ to: [120, 1.75] }], [60, 1.75])];
    expect(drive(crossroads(), pts, none)).toEqual([]);
  });

  it("counts the lane again past the point the turn is judged at", () => {
    const watch: TurnWatch = { tIn: new Vector3(0, 0, -1), node: new Vector3(0, 0, 0), since: 0 };
    const east = new Vector3(1, 0, 0);
    expect(isInTurn(watch, new Vector3(10, 0, 0), east)).toBe(true);
    expect(isInTurn(watch, new Vector3(TURN_JUDGED_M + 1, 0, 0), east)).toBe(false);
    expect(isInTurn(watch, new Vector3(0, 0, -10), new Vector3(0, 0, -1))).toBe(false);
    expect(isInTurn(null, new Vector3(), east)).toBe(false);
    expect(isInTurn(watch, new Vector3(10, 0, 0), null)).toBe(false);
  });
});
