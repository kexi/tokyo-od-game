import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3, type BufferGeometry, type Object3D } from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AutoDriver, type DriveWorld } from "../src/game/autoDriver";
import { laneCentre } from "../src/game/drivePath";
import { planRoute } from "../src/game/navigation";
import { steerLimit, WHEELBASE } from "../src/physics/vehicle";
import { lanesFor } from "../src/world/guidePlan";
import { laneBand, laneOfOffset, laneWidth } from "../src/world/laneChange";
import { computeRoadNetwork, restoreRoadNetwork } from "../src/world/roadNetworkData";
import { laneOffset, speedLimit, type RoadGraph, type Segment } from "../src/world/roads";
import { gameClock } from "../src/world/ruleTime";
import { TrafficAI } from "../src/world/traffic-ai";
import { TrafficControl } from "../src/world/trafficControl";
import { PLACES, placeFrame, roadsOf, tileData } from "./roadFixtures";

/**
 * What the road model (RoadGraph, the applied regulations, the painted lines, the routes, the
 * autopilot and the traffic AI's lanes) gives at three real places, pinned as hashes taken with
 * the code from before the road model was split into predicates, sections, MarkingPlan and
 * layered search (P2 of the road redesign, knowledge/road-model.md). P2 must not change any of it.
 *
 * Updated once on purpose by P8 (one lane policy, carriageway and 路肩, 2026-11-11): every street
 * gets the lanes its JARTIC 車両通行帯 or OSM lanes (roadlanes-*.json, a new input) give, one lane
 * otherwise; every count is checked against the room the GSI 幅員 leaves (less two 3.5 m pavements
 * from 13 m), which also tells a JARTIC total from a count a direction; the carriageway is capped
 * at lanes × 3.25 m plus 0.5 m 路肩 (構造令 第5条・第8条) in that room; and the edge lines, lane
 * lines, stop lines and lane centres sit on that section. Against the P2 rows (ac0f603): the lane
 * count changed on 68 of 333 segments at 丸の内, 44 of 410 at 渋谷 and 58 of 333 at 芝公園 (mostly
 * 2 → 1 and 3 → 2: JARTIC counts on synthetic widths that now read as totals or do not fit the
 * room); the paths of 6, 5 and 3 of the 24 routes moved (no route changed its streets or turns,
 * only its lanes); 3, 4 and 3 of the 6 autopilot drives changed (the same starts drive); the
 * traffic AI's lane points moved on 188, 200 and 190 segments (the left lane's centre now sits
 * inside the 0.5 m shoulder). The darwin baseline (fingerprints.json, discrete.json) was retaken
 * with the P8 code.
 *
 * Inputs are the frozen regulation, turn-lane and street-lane tiles of
 * tests/fixtures/sign-placement (sources in its LICENSE.txt; read by tests/roadFixtures.ts): GSI tiles are served for real-time use, so the roads are the regulation
 * tile's own lines, as in tests/signPlacement.test.ts. Unlike there, each line gets a kind, a
 * width class, a one-way and a 橋 flag from its index, so the expressway ("highway") branches,
 * one-way streets and every GSI width class run.
 *
 * When the snapshot may be updated (`vitest -u` together with ROAD_MODEL_UPDATE=1, on darwin; it
 * rewrites tests/fixtures/road-model/fingerprints.json and discrete.json too): only for a change
 * meant to alter the road model's output (as P8 did, above), with the reason in the commit and
 * the rows of before and after compared; or for a change of how the rows
 * are made (as the rounding and the platform split below), then
 * taken again from the code before P2 (origin/main 1305f52) and matched by the new code. Delete
 * the test once a later phase replaces these places' pins with tests of its own; a refactor (P2)
 * must never update it to make it pass.
 *
 * Why numbers are rounded before hashing, and some kept as tolerant fingerprints: the same code
 * gives the last bits of a double differently on macOS (arm64) and Linux (x64, CI). Raw doubles in
 * JSON, `toFixed` on the lowest digit, coincident input lines (which of two equally near segments
 * wins) and samples landing exactly on a vertex (which edge's direction they take) made the hashes
 * machine-dependent (CI failed on Linux, 2026-11-10). The input now has no coincident lines, starts
 * and targets sit off segment midpoints, numbers are integers of a step (1e-3 m, 1e-6 for unit
 * vectors and ratios, 1e-9° for lon / lat), and the vertex-sensitive values are compared within a
 * tolerance. The last test nudges every input coordinate by one ulp and requires the same result.
 *
 * Which platform compares what: the float digests and fingerprints only on darwin, where the
 * baseline was taken (Linux x64 differs from macOS arm64 by more than an ulp in Math functions,
 * and no rounding or tolerance both absorbs that and still sees a change; CI failed on it). On
 * every platform: the discrete model (segment ends and junctions, one-way, lanes, limits, rule
 * codes and closures, applied regulations by segment, lane counts, nearest segment ids, meshes by
 * material, route step lists and turns, which autopilot starts drive), against
 * tests/fixtures/road-model/discrete.json, with one row per aspect of slack (DISCRETE_SLACK). A
 * test shakes every Math function by 1e-12 of its result to show those values survive another
 * platform's maths. The proof that P2 changed nothing is the darwin comparison with 1305f52.
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

const hash = (rows: readonly string[]) =>
  createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16);
/**
 * Numbers as integers of a step, -0 as 0. The same code gives the last bits of a double
 * differently on macOS (arm64) and Linux (x64, CI): Math functions, three's vector maths and
 * float32 buffers round differently there. Raw doubles (JSON) and `toFixed` on the lowest digit
 * made the hashes machine-dependent; steps far above those differences do not.
 */
const quantize = (v: number, step: number): string => {
  const n = Math.round(v / step);
  return String(n === 0 ? 0 : n);
};
/** Lengths and positions in metres, to the millimetre. */
const r3 = (v: number) => quantize(v, 1e-3);
/** Directions and ratios, to 1e-6. (Pedal inputs stay at 1e-3: a 40 s closed-loop drive grows differences.) */
const r6 = (v: number) => quantize(v, 1e-6);
const p3 = (p: { x: number; y: number; z: number }) => `${r3(p.x)},${r3(p.y)},${r3(p.z)}`;
const d6 = (p: { x: number; y: number; z: number }) => `${r6(p.x)},${r6(p.y)},${r6(p.z)}`;

/** Keys of the worker's reply that hold unit vectors (the rest of its numbers are metres). */
const UNIT_KEYS = new Set(["travel", "dir", "heading"]);
/** Keys holding lon / lat degrees: to 1e-9° (0.1 mm). */
const DEGREE_KEYS = new Set(["coords"]);

/** The step for the numbers under `key`, or the parent's `step`. */
function stepOf(key: string, step: number): number {
  if (UNIT_KEYS.has(key)) return 1e-6;
  if (DEGREE_KEYS.has(key)) return 1e-9;
  return step;
}

/**
 * JSON with computed numbers quantised (metres to 1e-3, unit vectors to 1e-6, degrees to 1e-9;
 * integers too, so a value that is 0 on one machine and 1e-15 on another reads the same).
 */
function stableJson(value: unknown): string {
  return JSON.stringify(quantizeTree(value, 1e-3));
}

/** A copy of `v` with every number quantised to its key's step. */
function quantizeTree(v: unknown, step: number): unknown {
  if (typeof v === "number") return quantize(v, step);
  if (Array.isArray(v)) return v.map((x) => quantizeTree(x, step));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = quantizeTree(x, stepOf(k, step));
    return out;
  }
  return v;
}

/** The double next to `v` towards +∞ (`dir` 1) or −∞ (−1): one unit in the last place. */
function nextDouble(v: number, dir: 1 | -1): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  const bits = view.getBigInt64(0);
  const isTowardsZero = v > 0 !== dir > 0;
  view.setBigInt64(0, bits + (isTowardsZero ? -1n : 1n));
  return view.getFloat64(0);
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
    ...graph.segments.map((s) => stableJson(s)),
    stableJson(graph.nodes),
    stableJson(graph.pieces),
    stableJson(rest.applied),
    stableJson(rest.diagnostics),
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
      const covers = graph.carriagewaysAt(p, 0.5).map((c) => `${c.seg.id}:${d6(c.dir)}`);
      rows.push(
        `${x},${z} ${hit ? `${hit.seg.id} ${r3(hit.s)} ${r3(hit.lateral)}` : "-"} | ${covers.join(" ")}`,
      );
    }
  }
  return rows;
}

type Recorded = { name: string; color: string; geometry: BufferGeometry };

/**
 * Numbers that must agree within PRINT_TOLERANCE, not to the bit, by key. Why not hash these:
 * where a sample lands exactly on a polyline vertex (graph.sample, `cum[i] < d`), which edge's
 * direction it takes is decided by the last bit of a double, and the strips drawn there and the
 * lane offsets planned there move by centimetres. That is the game's own behaviour, the same
 * before and after P2; it differs between machines (macOS arm64 vs Linux x64 in CI) and under a
 * one-ulp nudge of the input, so no rounding step makes a hash of those values stable.
 */
type Fingerprints = Record<string, number[]>;

/**
 * Per component of an interleaved buffer: the sum, the sum of absolute values and the sum of
 * squares. A real change (a line moved, a strip added or lost) moves them by far more than the
 * tolerance; a vertex-edge flip moves a handful of vertices by centimetres.
 */
function sums(values: ArrayLike<number>, stride: number): number[] {
  const out = Array.from({ length: stride * 3 }, () => 0);
  for (let i = 0; i < values.length; i++) {
    const c = i % stride;
    const v = values[i];
    out[c] += v;
    out[stride + c] += Math.abs(v);
    out[2 * stride + c] += v * v;
  }
  return out;
}

/** The painted surface (asphalt, white and yellow lines, numerals, arrows) as roadSurface builds it. */
async function surfaceRows(
  graph: RoadGraph,
  applied: ReturnType<typeof restoreRoadNetwork>["applied"],
  approaches: TrafficControl["approaches"],
  prints: Fingerprints,
  tag: string,
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
  return added.map(({ name, color, geometry }, m) => {
    const pos = geometry.getAttribute("position").array;
    const st = geometry.getAttribute("aStreet").array;
    const uvs = geometry.getAttribute("uv")?.array ?? [];
    const idx = geometry.getIndex()?.array ?? [];
    prints[`${tag}/${m}`] = [...sums(pos, 3), ...sums(st, 4), ...sums(uvs, 2)];
    return `${name}#${color} v${pos.length / 3} i${idx.length} ${hash([...idx].map(String))}`;
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
  prints: Fingerprints,
  discrete: string[],
): string[] {
  const rows: string[] = [];
  const starts = graph.segments.filter((s) => s.line.width >= 5.5 && s.length > 20);
  for (let k = 0; k < 24; k++) {
    const from = starts[(k * 37 + 3) % starts.length];
    const to = reachedFrom(graph, from, 4 + (k % 5));
    const target = graph.sample(to, to.length * 0.75).pos.clone();
    const mode = k % 6 === 5 ? "walk" : "car";
    const route = planRoute(
      graph,
      { seg: from, s: from.length * 0.25, dir: k % 2 === 0 ? 1 : -1 },
      target,
      clock,
      applied.turnRules,
      mode,
      applied.laneUse,
    );
    if (!route) {
      rows.push(`${k} ${mode} none`);
      discrete.push(`${k} ${mode} none`);
      continue;
    }
    const steps = route.steps.map((s) => `${s.seg.id}${s.dir === 1 ? "+" : "-"}`).join(",");
    const xz = route.points.flatMap((p) => [p.x, p.z]);
    prints[`routes/${k}`] = [
      route.points.length,
      ...sums(xz, 2),
      ...sums(
        route.lanes.map((l) => l.offset),
        1,
      ),
    ];
    const lanes = route.lanes.map((l) => `${l.lane}/${l.count}`);
    const turns = route.maneuvers.map((m) => `${m.turn}@${r3(m.at)}`).join(",");
    rows.push(`${k} ${mode} ${r3(route.length)} ${steps} ${hash(lanes)} ${turns}`);
    const turnKinds = route.maneuvers.map((m) => m.turn).join(",");
    // Lane counts met on the way, not the lane at each point: where a change happens moves with the maths.
    const laneCounts = [...new Set(route.lanes.map((l) => l.count))].join("/");
    discrete.push(`${k} ${mode} ${steps} ${laneCounts} ${turnKinds}`);
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
    const { pos: start, dir } = graph.sample(seg, seg.length * 0.25);
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
      const isPlanned = driver.plan(world, graph.sample(to, to.length * 0.75).pos.clone());
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

/** Segments and junctions as counted: ends, one-way, lanes, limits, rule codes, closures; and the nodes. */
function graphRows(graph: RoadGraph): string[] {
  const segs = graph.segments.map((seg) =>
    [
      seg.id,
      seg.from,
      seg.to,
      seg.pts.length,
      seg.oneway,
      seg.lanes,
      seg.limit ?? "-",
      seg.limitKind,
      seg.noOvertake,
      seg.noLaneChange,
      seg.rules.map((r) => r.code).join("/"),
      seg.closures.length,
      seg.closed,
    ].join(" "),
  );
  const nodes = [...graph.nodes].map(([node, ids]) => `${node}:${ids.join(",")}`);
  return [...segs, ...nodes];
}

type Applied = NonNullable<ReturnType<typeof restoreRoadNetwork>["applied"]>;

/** The applied regulations by what they are and which segment carries them. */
function regulationRows(applied: Applied): string[] {
  return [
    `crossings ${applied.crossings.map((c) => c.seg.id).join(",")}`,
    `signs ${applied.signs.map((s) => `${s.type}/${s.value}@${s.seg.id}`).join(",")}`,
    `turns ${applied.turnRules.map((r) => r.approach.id).join(",")}`,
    `stops ${applied.stopLines.map((l) => `${l.seg.id}${l.dir === 1 ? "+" : "-"}`).join(",")}`,
    `stopSigns ${applied.stopSigns.length} signals ${applied.signals.length}`,
    `junctions ${applied.junctionNames.map((n) => n.name).join(",")}`,
    `footbridges ${applied.footbridges.length}`,
    `laneUse ${applied.laneUse.map((l) => `${l.seg.id}${l.dir === 1 ? "+" : "-"}:${l.lanes.map((x) => x.join("+")).join("|")}`).join(",")}`,
    `markings ${applied.hasMarkings}`,
  ];
}

/**
 * Lane counts and which lane fixed offsets fall in. Width arithmetic only (+ − × ÷ of input
 * widths, exact on every machine), no trigonometry.
 */
function discreteLaneRows(graph: RoadGraph): string[] {
  return graph.segments.map((seg) => {
    const offsets = [-6, -2, 0, 1.5, 3, 7].map((o) => laneOfOffset(seg, o));
    return `${seg.id} ${seg.lanes} ${lanesFor(seg)} ${speedLimit(seg)} ${offsets.join("/")}`;
  });
}

/** The nearest segment to each point of a 40 m grid (ids only). */
function nearestRows(graph: RoadGraph): string[] {
  const rows: string[] = [];
  for (let x = -600; x <= 600; x += 40)
    for (let z = -600; z <= 600; z += 40)
      rows.push(`${x},${z} ${graph.nearest(new Vector3(x, 0, z), 30)?.seg.id ?? "-"}`);
  return rows;
}

/**
 * Every row the road model gives at one place, by aspect: `rows` and `prints` hold continuous
 * values (rounded, or as sums), `discrete` only what is counted or named (see the describe below).
 * `nudge` moves every road coordinate one unit in the last place (alternately up and down).
 */
export async function rowsOf(
  tile: string,
  nudge = false,
): Promise<{ rows: Record<string, string[]>; prints: Fingerprints; discrete: Record<string, string[]> }> {
  const data = tileData(tile);
  const frame = placeFrame(tile);
  const lines = roadsOf(data).map((l) =>
    nudge ? { ...l, coords: l.coords.map((c, i) => nextDouble(c, i % 2 === 0 ? 1 : -1)) } : l,
  );
  const wire = computeRoadNetwork({ lines, regs: data, origin: frame.origin });
  const { graph, applied } = restoreRoadNetwork(wire, frame);
  if (!applied) throw new Error("no regulations applied");
  graph.setClock(clock);
  const scene = new Scene();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    const control = new TrafficControl(scene, () => 0, world);
    control.rebuild(graph, applied);
    const unsurveyed = restoreRoadNetwork(
      computeRoadNetwork({ lines, regs: null, origin: frame.origin }),
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
    const prints: Fingerprints = {};
    const routesDiscrete: string[] = [];
    const rows = {
      wire: wireRows(wire),
      lanes: laneRows(graph),
      search: searchRows(graph),
      surface: await surfaceRows(graph, applied, control.approaches, prints, "surface"),
      surfaceUnsurveyed: await surfaceRows(unsurveyed.graph, null, [], prints, "surfaceUnsurveyed"),
      routes: routeRows(graph, applied, prints, routesDiscrete),
      autopilot: autopilotRows(graph, drive),
      traffic: trafficRows(graph, new TrafficAI(scene, world, () => 0, control)),
    };
    const discrete = {
      graph: graphRows(graph),
      regulations: regulationRows(applied),
      lanes: discreteLaneRows(graph),
      search: nearestRows(graph),
      // Which meshes are drawn, by material. Not their vertex or index counts: those count the
      // 2.5 m steps of each strip (ceil of a length), which a shake of the maths moves.
      surface: rows.surface.map((r) => r.split(" ")[0]),
      surfaceUnsurveyed: rows.surfaceUnsurveyed.map((r) => r.split(" ")[0]),
      routes: routesDiscrete,
      // Which starts the autopilot could drive from (the drive itself is continuous).
      autopilot: rows.autopilot.map((r) => r.split(" ")[0]),
    };
    return { rows, prints, discrete };
  } finally {
    world.free();
  }
}

/** The rows behind a mismatching digest, for diffing against the old code's (not committed). */
function writeRows(place: string, rows: Record<string, string[]>, prints: Fingerprints): void {
  const dir = join(import.meta.dirname, "..", ".qa", "road-model", place);
  mkdirSync(dir, { recursive: true });
  for (const [aspect, lines] of Object.entries(rows))
    writeFileSync(join(dir, `${aspect}.txt`), lines.join("\n"));
  writeFileSync(join(dir, "prints.json"), JSON.stringify(prints, null, 1));
}

/** Fingerprints taken with the code before P2 (ROAD_MODEL_UPDATE=1 rewrites them, same rules as -u). */
const PRINTS_FILE = join(import.meta.dirname, "fixtures", "road-model", "fingerprints.json");

/**
 * How far a fingerprint may move: an absolute part (the sums of values, metres or unit-free) and
 * a relative part (the sums of squares). Measured: a one-ulp nudge of the input moves them by at
 * 1e-9 of their size (no more than the relative part; the nudge test below); a line shifted 1 cm
 * over 100 vertices moves a sum by 1, which the absolute part still sees.
 */
const PRINT_ABS = 0.5;
const PRINT_REL = 1e-9;

/** Keys whose numbers differ by more than the tolerance, with the largest difference. */
function printMismatches(got: Fingerprints, want: Fingerprints): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const key of keys) {
    const a = got[key];
    const b = want[key];
    const isMissing = !a || !b || a.length !== b.length;
    if (isMissing) {
      out.push(`${key}: ${a?.length ?? "-"} vs ${b?.length ?? "-"} values`);
      continue;
    }
    const worst = a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]) - PRINT_REL * Math.abs(b[i])), 0);
    if (worst > PRINT_ABS) out.push(`${key}: off by ${worst}`);
  }
  return out;
}

/** The largest difference between two sets of fingerprints, beyond the relative part. */
function largestShift(a: Fingerprints, b: Fingerprints): number {
  let worst = 0;
  for (const [key, values] of Object.entries(a))
    values.forEach((v, i) => {
      worst = Math.max(
        worst,
        Math.abs(v - (b[key]?.[i] ?? Infinity)) - PRINT_REL * Math.abs(b[key]?.[i] ?? 0),
      );
    });
  return worst;
}

const digestOf = (rows: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, `${v.length} ${hash(v)}`]));

/**
 * The platform the float digests and fingerprints were taken on. Why not compare them everywhere:
 * Linux x64 (CI) gives Math.sin / cos / atan2 … results that differ from macOS arm64 by more than
 * one ulp, and those differences reach the rounded hashes and move the fingerprints past any
 * tolerance that would still catch a real change (CI failed twice, 2026-11-10 and -11). Why not
 * take a second baseline on Linux: there is no Linux to run the code from before P2 on but CI, and
 * a baseline taken from the new code would prove nothing. So the proof that P2 changes nothing is
 * the darwin comparison with 1305f52; on other platforms only the discrete values are compared.
 */
const isBaselinePlatform = process.platform === "darwin";

/**
 * How far the shaken maths is off: 1e-12 of each result, about 5,000 ulps (an ulp is 2.2e-16), so
 * a discrete value that survives it survives another platform's maths, which differ by a few.
 * Why not 1e-9: the geodetic conversion works on Earth-radius numbers, where 1e-9 is 6 mm, and at
 * that size a JARTIC closure at 渋谷 whose votes sit on the matching distance flips (measured):
 * a test of the data's edge cases, not of platform differences.
 */
const SHAKE = 1e-12;

/** Math functions whose results differ between platforms' implementations. */
const MATH_FUNCTIONS = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "pow",
  "hypot",
  "cbrt",
  "log2",
  "log10",
  "expm1",
  "log1p",
] as const;

/**
 * Runs `body` with every Math function above returning its result times (1 ± `rel`), the sign
 * alternating call by call: a stand-in for another platform's maths, much larger than theirs.
 */
async function withShakenMath<T>(rel: number, body: () => Promise<T>): Promise<T> {
  const spies = MATH_FUNCTIONS.map((name) => {
    const original = Math[name] as (...args: number[]) => number;
    let call = 0;
    return vi.spyOn(Math, name).mockImplementation((...args: number[]) => {
      call++;
      return original(...args) * (1 + (call % 2 === 0 ? rel : -rel));
    });
  });
  try {
    return await body();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/** Discrete rows taken with the code before P2, on darwin (ROAD_MODEL_UPDATE=1 rewrites them). */
const DISCRETE_FILE = join(import.meta.dirname, "fixtures", "road-model", "discrete.json");

/**
 * Rows of one aspect allowed to differ. Why any: the synthetic roads lie on the JARTIC lines they
 * came from, and where two overlapping records of a closure are almost equally near, which one
 * collects a segment's votes is decided by the maths' last bits (measured: one segment at 渋谷
 * flips under any shake, even 1e-12). Such a row can differ on another platform. Why not more: a
 * real change of the road model changes many rows; one row per aspect is the measured knife-edge.
 */
const DISCRETE_SLACK = 1;

/** Aspects whose row counts differ, or that differ in more than DISCRETE_SLACK rows (with the rows). */
function rowMismatches(got: Record<string, string[]>, want: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const aspect of new Set([...Object.keys(got), ...Object.keys(want)])) {
    const a = got[aspect] ?? [];
    const b = want[aspect] ?? [];
    if (a.length !== b.length) {
      out.push(`${aspect}: ${a.length} rows vs ${b.length}`);
      continue;
    }
    const differing = a.flatMap((row, i) => (row === b[i] ? [] : [`${row} ≠ ${b[i]}`]));
    if (differing.length > DISCRETE_SLACK)
      out.push(`${aspect}: ${differing.length} rows differ: ${differing.slice(0, 3).join(" | ")}`);
  }
  return out;
}

describe("the road model at three places is pinned (unchanged by P2, changed on purpose by P8)", () => {
  const isUpdate = process.env.ROAD_MODEL_UPDATE === "1";
  const stored: Record<string, Fingerprints> =
    isUpdate || !existsSync(PRINTS_FILE) ? {} : JSON.parse(readFileSync(PRINTS_FILE, "utf8"));
  const taken: Record<string, Fingerprints> = {};

  beforeAll(async () => {
    await RAPIER.init();
  });

  const storedDiscrete: Record<string, Record<string, string[]>> = isUpdate || !existsSync(DISCRETE_FILE)
    ? {}
    : JSON.parse(readFileSync(DISCRETE_FILE, "utf8"));
  const takenDiscrete: Record<string, Record<string, string[]>> = {};

  afterAll(() => {
    const isWriting = isUpdate && isBaselinePlatform;
    if (!isWriting) return;
    mkdirSync(dirname(PRINTS_FILE), { recursive: true });
    writeFileSync(PRINTS_FILE, `${JSON.stringify(taken, null, 1)}\n`);
    writeFileSync(DISCRETE_FILE, `${JSON.stringify(takenDiscrete, null, 1)}\n`);
  });

  for (const place of PLACES) {
    it(`keeps the discrete model (counts, links, rules, lanes, step lists) at ${place.name}, on any platform`, async () => {
      const { discrete } = await rowsOf(place.tile);
      takenDiscrete[place.name] = discrete;
      expect(discrete.graph.length).toBeGreaterThan(200);
      expect(discrete.autopilot).toHaveLength(AUTOPILOT_RUNS + 1);
      if (isUpdate) return;
      const want = storedDiscrete[place.name];
      expect(want, `no discrete rows for ${place.name} in ${DISCRETE_FILE}`).toBeDefined();
      expect(rowMismatches(discrete, want ?? {})).toEqual([]);
    }, 60_000);

    it.runIf(isBaselinePlatform)(
      `gives the same graph, regulations, lines, routes, autopilot and traffic lanes at ${place.name} (float digests, darwin)`,
      async () => {
        const { rows, prints } = await rowsOf(place.tile);
        taken[place.name] = prints;
        expect(rows.wire.length).toBeGreaterThan(200);
        expect(rows.routes.filter((r) => !r.endsWith("none")).length).toBeGreaterThan(5);
        expect(rows.autopilot.length).toBe(AUTOPILOT_RUNS + 1);
        // ROAD_MODEL_ROWS=1 writes the rows even when they match (to diff two machines' rows).
        const isDumpAsked = process.env.ROAD_MODEL_ROWS === "1";
        if (isDumpAsked) writeRows(place.name, rows, prints);
        try {
          expect({
            digest: digestOf(rows),
            surface: rows.surface,
            routes: rows.routes,
            autopilot: rows.autopilot,
          }).toMatchSnapshot();
          if (!isUpdate) expect(printMismatches(prints, stored[place.name] ?? {})).toEqual([]);
        } catch (mismatch) {
          writeRows(place.name, rows, prints);
          throw mismatch;
        }
      },
      60_000,
    );
  }

  for (const place of PLACES) {
    it(`keeps the discrete model at ${place.name} when every Math function is off by 1e-12 of its result`, async () => {
      const plain = await rowsOf(place.tile);
      const shaken = await withShakenMath(SHAKE, () => rowsOf(place.tile));
      try {
        expect(rowMismatches(shaken.discrete, plain.discrete)).toEqual([]);
      } catch (mismatch) {
        writeRows(`${place.name}-shaken`, shaken.discrete, {});
        writeRows(`${place.name}-plain`, plain.discrete, {});
        throw mismatch;
      }
    }, 120_000);
  }

  it.runIf(isBaselinePlatform)(
    "hashes and fingerprints the same when every input coordinate moves one unit in the last place (darwin)",
    async () => {
      const tile = PLACES[0].tile;
      const nudged = await rowsOf(tile, true);
      const plain = await rowsOf(tile);
      try {
        expect(digestOf(nudged.rows)).toEqual(digestOf(plain.rows));
        expect(printMismatches(nudged.prints, plain.prints)).toEqual([]);
      } catch (mismatch) {
        writeRows("nudged", nudged.rows, nudged.prints);
        writeRows("plain", plain.rows, plain.prints);
        throw mismatch;
      }
      // Recorded for the tolerance's comment: how far the nudge moved the fingerprints.
      expect(largestShift(nudged.prints, plain.prints)).toBeLessThan(PRINT_ABS);
    },
    120_000,
  );
});
