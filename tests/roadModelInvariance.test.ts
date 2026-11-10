import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3, type BufferGeometry, type Object3D } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { laneCentre } from "../src/game/drivePath";
import { planRoute } from "../src/game/navigation";
import { LocalFrame } from "../src/geo/frame";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { lanesFor } from "../src/world/guidePlan";
import { laneBand, laneOfOffset, laneWidth } from "../src/world/laneChange";
import { computeRoadNetwork, restoreRoadNetwork } from "../src/world/roadNetworkData";
import type { RegulationData } from "../src/world/regulations";
import { laneOffset, speedLimit, type RoadGraph, type RoadLine, type Segment } from "../src/world/roads";
import { gameClock, readTime } from "../src/world/ruleTime";
import { TrafficAI } from "../src/world/traffic-ai";
import { TrafficControl } from "../src/world/trafficControl";

/**
 * What the road model (RoadGraph, the applied regulations, the painted lines, the routes, the
 * autopilot and the traffic AI's lanes) gives at three real places, pinned as hashes taken with
 * the code from before the road model was split into predicates, sections, MarkingPlan and
 * layered search (P2 of the road redesign, knowledge/road-model.md). P2 must not change any of it.
 *
 * Inputs are the frozen regulation and turn-lane tiles of tests/fixtures/sign-placement (sources
 * in its LICENSE.txt): GSI tiles are served for real-time use, so the roads are the regulation
 * tile's own lines, as in tests/signPlacement.test.ts. Unlike there, each line gets a kind, a
 * width class, a one-way and a 橋 flag from its index, so the expressway ("highway") branches,
 * one-way streets and every GSI width class run.
 *
 * When the snapshot may be updated (`vitest -u`): only for a change meant to alter the road
 * model's output (P8's lane and kerb corrections, for one), with the reason in the commit and the
 * rows of before and after diffed. Delete the test once a later phase replaces these places' pins
 * with tests of its own; a refactor (P2) must never update it.
 *
 * Why hashes, not readable rows: the rows run to tens of thousands of lines per place. On a
 * mismatch the rows are written to .qa/road-model/<place>/<aspect>.txt (not in git): run the test
 * on the old code too and diff the two folders.
 *
 * What it covers: the worker's reply (graph, applied regulations, diagnostics), lane arithmetic,
 * nearest / carriagewaysAt, every RoadSurface mesh (positions, aStreet, uv, index; surveyed and
 * not), 24 routes (4 on foot), 6 autopilot runs per place that actually drive, and the traffic
 * AI's lane points. What it does not: the signal controllers and pedestrian heads
 * (trafficControl.ts beyond the approaches the surface reads), guide signs (guidePlan.ts),
 * sidewalks, street lights, water and bridges, orbis and portable orbis, and the police patrol
 * and pursuit. Their own tests (signalPlacement, guideSigns, sidewalks, streetLights, water,
 * orbis, pursuit) are what pins them.
 */

// roadSurface.ts loads its asphalt maps at import; in Node there is no image to decode, and the
// geometry this test reads does not depend on them.
vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  class StubLoader {
    load() {
      return new three.Texture();
    }
  }
  return { ...three, TextureLoader: StubLoader };
});
// The 最高速度 numerals and lane arrows draw on a canvas; a context-less stub keeps their mesh.
vi.stubGlobal("document", {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
});

const FIXTURES = join(import.meta.dirname, "fixtures", "sign-placement");
const PLACES = [
  { name: "丸の内", tile: "14552-6451" },
  { name: "渋谷", tile: "14549-6452" },
  { name: "芝公園", tile: "14552-6453" },
] as const;

function tileData(tile: string): RegulationData {
  const regs = JSON.parse(readFileSync(join(FIXTURES, `regs-${tile}.json`), "utf8"));
  const lanesFile = join(FIXTURES, `turnlanes-${tile}.json`);
  const turnlanes = existsSync(lanesFile) ? JSON.parse(readFileSync(lanesFile, "utf8")) : [];
  return {
    speed: [],
    speedZone: [],
    oneway: [],
    crosswalk: [],
    stopLine: [],
    stopSign: [],
    sections: [],
    turns: [],
    closures: [],
    noOvertake: [],
    lanes: [],
    noLaneChange: [],
    laneArrows: [],
    signals: [],
    junctions: [],
    footbridges: [],
    ...regs,
    turnlanes,
  };
}

const WIDTHS = [2.5, 4.3, 5.5, 9, 13, 16, 22, 9, 6];
const KINDS: RoadLine["kind"][] = ["local", "national", "prefectural", "local", "narrow"];

/** The regulation tile's lines (each once) as road centrelines, varied by index. */
function roadsOf(data: RegulationData): RoadLine[] {
  const coordLists = [
    ...data.speed.map((r) => r.slice(1)),
    ...data.oneway.map((r) => r.slice(readTime(r, 0).next)),
    ...data.sections.map((r) => r.slice(readTime(r, 2).next)),
    ...data.closures.filter((r) => r[0] === 2).map((r) => r.slice(readTime(r, 2).next)),
    ...data.noOvertake,
    ...data.noLaneChange,
    ...data.lanes.map((r) => r.slice(1)),
    ...data.laneArrows.map((r) => r.slice(1)),
  ];
  const seen = new Set<string>();
  const lines: RoadLine[] = [];
  for (const coords of coordLists) {
    const key = coords.join(",");
    const isLine = coords.length >= 4 && !seen.has(key);
    if (!isLine) continue;
    seen.add(key);
    const i = lines.length;
    const isExpressway = i % 17 === 5;
    lines.push({
      coords,
      width: WIDTHS[i % WIDTHS.length],
      oneway: i % 11 === 3 ? 1 : i % 13 === 7 ? -1 : 0,
      kind: isExpressway ? ("highway" as RoadLine["kind"]) : KINDS[i % KINDS.length],
      ...(i % 19 === 2 ? { bridge: true } : {}),
    });
  }
  return lines;
}

const hash = (rows: readonly string[]) =>
  createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16);
const r3 = (v: number) => (Math.abs(v) < 5e-4 ? "0.000" : v.toFixed(3));
const p3 = (p: { x: number; y: number; z: number }) => `${r3(p.x)},${r3(p.y)},${r3(p.z)}`;

function placeFrame(tile: string): LocalFrame {
  const [x, y] = tile.split("-").map(Number);
  const lon = ((x + 0.5) / 2 ** 14) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** 14))) * 180) / Math.PI;
  return new LocalFrame(lat, lon, 40);
}

/** The worker's reply (graph snapshot and packed regulations), with its Maps as arrays. */
function wireRows(data: ReturnType<typeof computeRoadNetwork>): string[] {
  const { computeMs: _ms, ...rest } = data;
  const graph = {
    ...rest.graph,
    nodes: [...rest.graph.nodes],
    pieces: rest.graph.pieces ? [...rest.graph.pieces] : null,
  };
  return [
    ...graph.segments.map((s) => JSON.stringify(s)),
    JSON.stringify(graph.nodes),
    JSON.stringify(graph.pieces),
    JSON.stringify(rest.applied),
    JSON.stringify(rest.diagnostics),
  ];
}

/** Lane arithmetic per segment: laneChange.ts, drivePath laneCentre, laneOffset, guidePlan.lanesFor. */
function laneRows(graph: RoadGraph): string[] {
  return graph.segments.map((seg) => {
    const n = seg.lanes;
    const centres = [0, 1, 2, 3].map((i) => r3(laneCentre(seg, i)));
    const bands = [0, 1].map((i) => laneBand(seg, i, Math.max(n, 2)));
    const offsets = [-6, -2, 0, 1.5, 3, 7].map((o) => laneOfOffset(seg, o));
    return [
      seg.id,
      n,
      r3(laneWidth(seg)),
      r3(laneOffset(seg)),
      lanesFor(seg),
      speedLimit(seg),
      centres.join("/"),
      bands.map((b) => `${r3(b.min)}~${r3(b.max)}`).join("/"),
      offsets.join("/"),
    ].join(" ");
  });
}

/** nearest and carriagewaysAt on a 40 m grid over the place. */
function searchRows(graph: RoadGraph): string[] {
  const rows: string[] = [];
  for (let x = -600; x <= 600; x += 40) {
    for (let z = -600; z <= 600; z += 40) {
      const p = new Vector3(x, 0, z);
      const hit = graph.nearest(p, 30);
      const covers = graph.carriagewaysAt(p, 0.5).map((c) => `${c.seg.id}:${p3(c.dir)}`);
      rows.push(
        `${x},${z} ${hit ? `${hit.seg.id} ${r3(hit.s)} ${r3(hit.lateral)}` : "-"} | ${covers.join(" ")}`,
      );
    }
  }
  return rows;
}

type Recorded = { name: string; color: string; geometry: BufferGeometry };

/** The painted surface (asphalt, white and yellow lines, numerals, arrows) as roadSurface builds it. */
async function surfaceRows(
  graph: RoadGraph,
  applied: ReturnType<typeof restoreRoadNetwork>["applied"],
  approaches: TrafficControl["approaches"],
): Promise<string[]> {
  const { RoadSurface } = await import("../src/world/roadSurface");
  const added: Recorded[] = [];
  const scene = {
    add: (
      o: Object3D & {
        geometry: BufferGeometry;
        material: { name: string; color?: { getHexString(): string } };
      },
    ) =>
      added.push({
        name: o.material.name,
        color: o.material.color?.getHexString() ?? "",
        geometry: o.geometry,
      }),
    remove: () => {},
  } as unknown as Scene;
  new RoadSurface(scene, () => 0).rebuild(graph, applied, approaches);
  return added.map(({ name, color, geometry }) => {
    const pos = geometry.getAttribute("position").array;
    const st = geometry.getAttribute("aStreet").array;
    const idx = geometry.getIndex()?.array ?? [];
    const coords: string[] = [];
    for (let i = 0; i < pos.length; i++) coords.push(r3(pos[i]));
    const street: string[] = [];
    for (let i = 0; i < st.length; i++) street.push(r3(st[i]));
    const uvs = geometry.getAttribute("uv")?.array ?? [];
    const uv: string[] = [];
    for (let i = 0; i < uvs.length; i++) uv.push(r3(uvs[i]));
    const hashes = [hash(coords), hash(street), hash(uv), hash([...idx].map(String))].join(" ");
    return `${name}#${color} v${pos.length / 3} i${idx.length} ${hashes}`;
  });
}

const clock = gameClock(2026, 10, 1, 600);

/** A segment `depth` junctions away from `from` (the first one found breadth-first, both ways). */
function reachedFrom(graph: RoadGraph, from: Segment, depth: number): Segment {
  let frontier = [from];
  const seen = new Set([from.id]);
  for (let d = 0; d < depth; d++) {
    const next: Segment[] = [];
    for (const seg of frontier)
      for (const node of [seg.from, seg.to])
        for (const id of graph.nodes.get(node) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          next.push(graph.segments[id]);
        }
    if (next.length === 0) break;
    frontier = next;
  }
  return frontier[frontier.length - 1];
}

/** Car routes from fixed streets to streets a few junctions on, and a few on foot. */
function routeRows(
  graph: RoadGraph,
  applied: NonNullable<ReturnType<typeof restoreRoadNetwork>["applied"]>,
): string[] {
  const rows: string[] = [];
  const starts = graph.segments.filter((s) => s.line.width >= 5.5 && s.length > 20);
  for (let k = 0; k < 24; k++) {
    const from = starts[(k * 37 + 3) % starts.length];
    const to = reachedFrom(graph, from, 4 + (k % 5));
    const target = graph.sample(to, to.length / 2).pos.clone();
    const mode = k % 6 === 5 ? "walk" : "car";
    const route = planRoute(
      graph,
      { seg: from, s: from.length / 2, dir: k % 2 === 0 ? 1 : -1 },
      target,
      clock,
      applied.turnRules,
      mode,
      applied.laneUse,
    );
    if (!route) {
      rows.push(`${k} ${mode} none`);
      continue;
    }
    const steps = route.steps.map((s) => `${s.seg.id}${s.dir === 1 ? "+" : "-"}`).join(",");
    const points = route.points.map(p3);
    const lanes = route.lanes.map((l) => JSON.stringify(l));
    const turns = route.maneuvers.map((m) => `${m.turn}@${r3(m.at)}`).join(",");
    rows.push(`${k} ${mode} ${r3(route.length)} ${steps} ${hash(points)} ${hash(lanes)} ${turns}`);
  }
  return rows;
}

/** Runs that actually drive, per place: starts whose route cannot be driven are skipped. */
const AUTOPILOT_RUNS = 6;

/**
 * The autopilot driven by a kinematic bicycle model for 40 s, from fixed starts. A start is
 * skipped when no route is planned, or the route has a single point (the car stands on its
 * target: AutoDriver.pathAt then throws, a known fault outside P2); the rows count the skips.
 */
function autopilotRows(graph: RoadGraph, world: DriveWorld): string[] {
  const rows: string[] = [];
  const starts = graph.segments.filter((s) => s.line.width >= 5.5 && s.length > 40);
  let skipped = 0;
  for (let k = 0; rows.length < AUTOPILOT_RUNS && k < starts.length; k++) {
    const seg = starts[(k * 53 + 11) % starts.length];
    const to = reachedFrom(graph, seg, 6);
    const { pos: start, dir } = graph.sample(seg, seg.length / 2);
    const pos = start.clone();
    let yaw = Math.atan2(dir.x, dir.z);
    let v = 0;
    let steer = 0;
    // The manoeuvre search stops after PLAN_MS of wall time; a clock that ticks per call makes the
    // search, and so the drive, the same on every run.
    let ms = 0;
    const clockSpy = vi.spyOn(performance, "now").mockImplementation(() => (ms += 0.05));
    try {
      const driver = new AutoDriver();
      driver.place(pos, yaw);
      const isPlanned = driver.plan(world, graph.sample(to, to.length / 2).pos.clone());
      const isDrivableRoute = isPlanned && (driver.route?.points.length ?? 0) >= 2;
      if (!isDrivableRoute) {
        skipped++;
        continue;
      }
      const trace: string[] = [];
      const dt = 1 / 30;
      for (let t = 0; t < 40; t += dt) {
        const out = driver.update(dt, world, { position: pos, yaw, speed: v });
        const { input } = out;
        trace.push(`${p3(pos)} ${r3(input.throttle)} ${r3(input.brake)} ${r3(input.steer)} ${driver.lane}`);
        if (out.done || out.gaveUp) break;
        steer += (input.steer * steerLimit(v) - steer) * Math.min(1, dt * 8);
        v = Math.max(0, v + (input.throttle * 4.16 - 0.12 * v - input.brake * 7) * dt);
        yaw += ((v * Math.tan(steer)) / WHEELBASE) * dt;
        pos.x += Math.sin(yaw) * v * dt;
        pos.z += Math.cos(yaw) * v * dt;
      }
      rows.push(`${k} ${trace.length} ${hash(trace)}`);
    } finally {
      clockSpy.mockRestore();
    }
  }
  rows.push(`skipped ${skipped}`);
  return rows;
}

/** Where the traffic AI puts a car's lane centre, both ways along every segment. */
function trafficRows(graph: RoadGraph, ai: TrafficAI): string[] {
  const lanePoint = (
    ai as unknown as {
      lanePoint(graph: RoadGraph, seg: unknown, dir: 1 | -1, s: number): { pos: Vector3; dir: Vector3 };
    }
  ).lanePoint.bind(ai);
  return graph.segments.map((seg) => {
    const pts = [1, -1].flatMap((dir) =>
      [0.25, 0.5, 0.75].map((f) => p3(lanePoint(graph, seg, dir as 1 | -1, seg.length * f).pos)),
    );
    return `${seg.id} ${pts.join(" ")}`;
  });
}

/** Every row the road model gives at one place, by aspect. */
export async function rowsOf(tile: string): Promise<Record<string, string[]>> {
  const data = tileData(tile);
  const frame = placeFrame(tile);
  const wire = computeRoadNetwork({ lines: roadsOf(data), regs: data, origin: frame.origin });
  const { graph, applied } = restoreRoadNetwork(wire, frame);
  if (!applied) throw new Error("no regulations applied");
  graph.setClock(clock);
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    const control = new TrafficControl(scene, () => 0, world);
    control.rebuild(graph, applied);
    const unsurveyed = restoreRoadNetwork(
      computeRoadNetwork({ lines: roadsOf(data), regs: null, origin: frame.origin }),
      frame,
    );
    const drive: DriveWorld = {
      graph,
      control,
      turnRules: applied.turnRules,
      clock,
      obstacles: [],
      laneUse: applied.laneUse,
      crossings: applied.crossings,
    };
    return {
      wire: wireRows(wire),
      lanes: laneRows(graph),
      search: searchRows(graph),
      surface: await surfaceRows(graph, applied, control.approaches),
      surfaceUnsurveyed: await surfaceRows(unsurveyed.graph, null, []),
      routes: routeRows(graph, applied),
      autopilot: autopilotRows(graph, drive),
      traffic: trafficRows(graph, new TrafficAI(scene, world, () => 0, control)),
    };
  } finally {
    world.free();
  }
}

/** The rows behind a mismatching digest, for diffing against the old code's (not committed). */
function writeRows(place: string, rows: Record<string, string[]>): void {
  const dir = join(import.meta.dirname, "..", ".qa", "road-model", place);
  mkdirSync(dir, { recursive: true });
  for (const [aspect, lines] of Object.entries(rows))
    writeFileSync(join(dir, `${aspect}.txt`), lines.join("\n"));
}

describe("the road model at three places is unchanged by the P2 refactor", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  for (const place of PLACES) {
    it(`gives the same graph, regulations, lines, routes, autopilot and traffic lanes at ${place.name}`, async () => {
      const rows = await rowsOf(place.tile);
      expect(rows.wire.length).toBeGreaterThan(200);
      expect(rows.routes.filter((r) => !r.endsWith("none")).length).toBeGreaterThan(5);
      expect(rows.autopilot.length).toBe(AUTOPILOT_RUNS + 1);
      const digest = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, `${v.length} ${hash(v)}`]));
      try {
        expect({
          digest,
          surface: rows.surface,
          routes: rows.routes,
          autopilot: rows.autopilot,
        }).toMatchSnapshot();
      } catch (mismatch) {
        writeRows(place.name, rows);
        throw mismatch;
      }
    }, 60_000);
  }
});
