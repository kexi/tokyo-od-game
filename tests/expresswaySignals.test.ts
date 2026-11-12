import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_DIR, readExpresswayFiles } from "../scripts/expresswayFiles";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { LocalFrame } from "../src/geo/frame";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { expresswayRoadInput, joinExpressway } from "../src/world/expresswayRoads";
import { laneChangeSide, laneCountedIn, runOf, type HeldLane, type LaneLink } from "../src/world/laneLinks";
import { RoadGraph, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import type { TrafficControl } from "../src/world/trafficControl";

// The generated test section (public/data/expressway): the autopilot driven by wheel and pedals
// (the physics car's limits, as tests/drivePath.test.ts) through every merge and diverge, 350 m
// before to 350 m after, with the 合図不履行 check of main.ts looking five times a second.
const { chunks, runs } = readExpresswayFiles(DEFAULT_DATA_DIR);
const graph = new RoadGraph(
  joinExpressway(
    [],
    expresswayRoadInput(chunks, runs, (_a, _b, h) => h + 36.9),
    () => {},
  ),
  new LocalFrame(35.6537, 139.7508, 40),
);
const clock = gameClock(2026, 11, 11, 600);
const noSignals = { nextStop: () => null, state: () => "green" } as unknown as TrafficControl;

/** `m` metres along the run from `seg`'s end backwards (−) or its start forwards (+). */
function alongRun(seg: Segment, m: number): { seg: Segment; s: number } {
  let cur = seg;
  let left = Math.abs(m);
  const isBack = m < 0;
  for (;;) {
    if (left <= cur.length) return { seg: cur, s: isBack ? cur.length - left : left };
    const next = graph.segments.find(
      (p) => p.oneway !== 0 && runOf(p) === runOf(cur) && (isBack ? p.to === cur.from : p.from === cur.to),
    );
    if (!next) return { seg: cur, s: isBack ? 0 : cur.length };
    left -= cur.length;
    cur = next;
  }
}

type Drive = {
  booked: string[];
  signals: Array<{ at: number; signal: "left" | "right" | null }>;
  linkAt: number;
};

/** The autopilot from 350 m before `link`'s node to 350 m past it, and what main.ts would book. */
function driveThrough(link: LaneLink): Drive {
  const a = alongRun(graph.segments[link.from], -350);
  const b = alongRun(graph.segments[link.to], 350);
  const driver = new AutoDriver();
  const st = graph.sample(a.seg, a.s);
  const pos = st.pos.clone();
  pos.y = (graph.surfaceY(a.seg, a.s) ?? 0) + 0.86;
  let yaw = Math.atan2(st.dir.x, st.dir.z);
  let v = 0;
  let steer = 0;
  driver.place(pos, yaw);
  const world = (): DriveWorld => ({ graph, control: noSignals, turnRules: [], clock, obstacles: [] });
  if (!driver.plan(world(), graph.sample(b.seg, b.s).pos)) throw new Error("no route");
  const node = driver.route!.links!.find((l) => l.kind === link.kind)!.at;
  const seen = { left: -Infinity, right: -Infinity };
  const booked: string[] = [];
  const signals: Drive["signals"] = [];
  let held: HeldLane | null = null;
  let lastLook = -Infinity;
  const dt = 1 / 30;
  for (let t = 0; t < 150; t += dt) {
    const out = driver.update(dt, world(), { position: pos, yaw, speed: v });
    if (out.done || out.gaveUp) break;
    steer += (out.input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
    v = Math.max(0, v + (out.input.throttle * 4.16 - 0.12 * v - out.input.brake * 7) * dt);
    yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
    pos.x += Math.sin(yaw) * v * dt;
    pos.z += Math.cos(yaw) * v * dt;
    const under = graph.locate(pos, 15);
    const y = under ? graph.surfaceY(under.seg, under.s) : null;
    if (y !== null) pos.y = y + 0.86;
    const now = t * 1000;
    if (driver.signal) seen[driver.signal] = now;
    const at = driver.route ? (driver as unknown as { at: number }).at : 0;
    if (signals.at(-1)?.signal !== driver.signal) signals.push({ at, signal: driver.signal });
    const isLook = now - lastLook > 200;
    if (!isLook) continue;
    lastLook = now;
    const hit = graph.locate(pos, 30);
    const onRoad = hit && Math.abs(hit.lateral) < hit.seg.line.width / 2 + 1.5 ? hit : null;
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const counted: HeldLane | null =
      v * 3.6 > 15 ? laneCountedIn(graph, pos, forward, held, onRoad, true, () => true) : null;
    const side = counted ? laneChangeSide(held, counted) : null;
    if (side && now - seen[side] > 6000)
      booked.push(`${counted!.seg.line.xid} ${held!.lane}→${counted!.lane} at ${Math.round(at - node)} m`);
    held = counted;
  }
  return { booked, signals, linkAt: node };
}

const branches = graph.laneLinks.filter(
  (l, i, all) =>
    l.kind !== "through" &&
    all.findIndex((o) => o.kind === l.kind && o.from === l.from && o.to === l.to) === i &&
    // 4848889 → 45177681 has no route on in the loaded section (its road on is not in the file).
    // By run, not by chunk id: v2 (P2.7-5) wrote 4848889 in 4 chunks, so its last is :3, not :4.
    !(
      graph.segments[l.from].line.xid?.startsWith("4848889:") &&
      graph.segments[l.to].line.xid?.startsWith("45177681:")
    ),
);

describe("合図 (第53条) through every merge and diverge of the generated data", () => {
  it("drives each of them with the indicator on wherever main.ts counts a lane change", () => {
    expect(branches.length).toBeGreaterThanOrEqual(15);
    const booked = branches.flatMap((l) => {
      const key = `${l.kind} ${graph.segments[l.from].line.xid}→${graph.segments[l.to].line.xid}`;
      return driveThrough(l).booked.map((b) => `${key}: ${b}`);
    });
    expect(booked).toEqual([]);
  }, 60_000);

  it("signals right, never left, before the right-hand branch at 浜崎橋 JCT (24402611:22 → 4848762:0)", () => {
    const link = branches.find(
      (l) =>
        graph.segments[l.from].line.xid === "24402611:22" && graph.segments[l.to].line.xid === "4848762:0",
    )!;
    expect(link.side).toBe("right");
    const { signals, linkAt } = driveThrough(link);
    const before = signals.filter((s) => s.at > 60 && s.at < linkAt);
    expect(before.map((s) => s.signal)).toContain("right");
    expect(before.map((s) => s.signal)).not.toContain("left");
  }, 30_000);
});
