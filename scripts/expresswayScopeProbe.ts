// The shipped scope read off the plan, without solving it (R1-1a 2): per main-line chain the operator's
// ways in order and where they end (the nodes U10 cuts at), the unmarked ways between two of them, the
// ramps scope v2 takes in over the v1 rule, the refs the districts' table misses and the C2 runs the
// yamate box cuts. One JSON file and one log line.
//   pnpm exec tsx scripts/expresswayScopeProbe.ts [--below pruned|all] [--run-borders keep|cut] [--out <file>]
// The plan is the build's first one (no ramp feet cut: those need the roads read around the runs, and
// a cut only shortens a run or leaves a ramp out, never changes a chain or a run id).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AreaIndex, type AreaFile } from "../src/geo/areas.ts";
import { endPlan, planNetwork, type Plan } from "../src/expressway/compile.ts";
import { checkExtract, pinnedExtractName } from "../src/expressway/extract.ts";
import { assignDistricts, boxBorderRuns, DISTRICT_REFS, districtOfRef } from "../src/expressway/districts.ts";
import { wayLength } from "../src/expressway/network.ts";
import {
  nearWards,
  planDistrictRuns,
  rampsReachedFrom,
  scopeExtent,
  shipRuns,
} from "../src/expressway/scope.ts";
import { log } from "../src/log.ts";
import { readExpresswayInput, readStructures } from "./expresswayNetwork.ts";
import { readReplicationTimestamp } from "./osm-pbf.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const below = flag("below") ?? "pruned";
const isBelowMode = below === "pruned" || below === "all";
if (!isBelowMode) throw new Error(`unknown --below ${below} (pruned, all)`);
const runBorders = flag("run-borders") ?? "keep";
const isSplitMode = runBorders === "keep" || runBorders === "cut";
if (!isSplitMode) throw new Error(`unknown --run-borders ${runBorders} (keep, cut)`);
const out = flag("out") ?? `.qa/expressway/scope-probe-${below}-${runBorders}.json`;

const root = join(import.meta.dirname, "..");
const file = new Uint8Array(await readFile(join(root, ".cache", "osm", pinnedExtractName())));
const check = checkExtract(readReplicationTimestamp(file), false);
if (!check.ok) throw new Error(check.reason);
const structures = await readStructures(true);
const { net, outsideNodes } = readExpresswayInput(file, structures);
const areas = new AreaIndex(
  JSON.parse(await readFile(join(root, "public", "data", "areas.json"), "utf8")) as AreaFile,
);
const inWards = (lon: number, lat: number) => areas.lookup(lat, lon) != null;
// The build's plan options by default (scripts/expressway.ts): the ones that change which runs exist.
// Planned twice, for scope v2 (shipRuns) and for v1 (the ramps over the wards reached from any operated
// main line), each with its runs at grade grown in as the build grows them (planNetwork's wanted).
const planFor = (wanted: (p: Plan) => ReadonlySet<string>, borders = runBorders) =>
  planNetwork(net, outsideNodes, null, structures, {
    pruneBelow: below === "pruned",
    structures: "height",
    ground: "compile",
    touchdown: "all",
    ...(borders === "cut" ? { runBorders: "cut" as const } : {}),
    wanted,
  });
const plan: Plan = planFor((p) => shipRuns(p, inWards).all);
const ship = shipRuns(plan, inWards);
/** What the build writes: the scope and the runs at grade it hangs from (plan.wanted). */
const shipped = plan.wanted;
const shippedMain = new Set([...shipped].filter((id) => plan.runs.get(id)!.cls === "expressway"));
const shippedRamps = new Set([...shipped].filter((id) => plan.runs.get(id)!.cls === "ramp"));

const km = (m: number) => Math.round(m) / 1000;
const runOfWay = new Map<number, string>();
for (const rp of plan.runs.values()) for (const w of rp.run.ways) runOfWay.set(w, rp.run.id);
/** A ref the operator numbers its own routes with (C1, C2, the radials' digits, S, K, B, Y). */
const OPERATOR_REF = /^(C1|C2|\d|S|K|B|Y)/;

// 1. The operator's ways along each chain with a shipped main line.
type WayRow = {
  way: number;
  operated: boolean;
  cls: string;
  ref: string | null;
  m: number;
  run: string | null;
};
const cuts: Array<{
  chain: string;
  side: "before" | "after";
  node: number;
  lon: number;
  lat: number;
  junction: string | null;
  refInside: string | null;
  refOutside: string | null;
  clsOutside: string;
  /** Chains through the cut's node (more than 1: a junction there). */
  chainsAtNode: number;
  /** Of the ways cut off: all of them, and those in a shipped main line (what the cut takes out). */
  cutKm: number;
  cutShippedKm: number;
  refsCutShipped: string[];
  /** The run the cut falls in, and how much of its operated side is left (m). */
  run: string | null;
  operatedLeftM: number | null;
}> = [];
const sandwiched: Array<{
  chain: string;
  way: number;
  ref: string | null;
  m: number;
  run: string | null;
  shipped: boolean;
}> = [];
const chainsOut: Array<{ chain: string; closed: boolean; ways: WayRow[] }> = [];
for (const chain of [...plan.chains.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const hasShippedMain = chain.ways.some((w) => shippedMain.has(runOfWay.get(w) ?? ""));
  if (!hasShippedMain) continue;
  const rows: WayRow[] = chain.ways.map((w) => {
    const way = net.ways.get(w)!;
    return {
      way: w,
      operated: way.operated,
      cls: way.cls,
      ref: way.ref,
      m: Math.round(wayLength(net, way)),
      run: runOfWay.get(w) ?? null,
    };
  });
  chainsOut.push({ chain: chain.id, closed: chain.closed, ways: rows });
  const f = rows.findIndex((r) => r.operated);
  const l = rows.findLastIndex((r) => r.operated);
  for (let i = f + 1; i < l; i++) {
    const r = rows[i];
    if (r.operated) continue;
    sandwiched.push({
      chain: chain.id,
      way: r.way,
      ref: r.ref,
      m: r.m,
      run: r.run,
      shipped: shipped.has(r.run ?? ""),
    });
  }
  const cutAt = (
    side: "before" | "after",
    wayIndex: number,
    inside: WayRow,
    outsideRow: WayRow,
    cutRows: WayRow[],
  ) => {
    const node = chain.nodes[chain.wayStarts[wayIndex]];
    const n = net.nodes.get(node)!;
    const shippedRows = cutRows.filter((r) => shippedMain.has(r.run ?? ""));
    const run = inside.run;
    const leftRows = run === null ? [] : rows.slice(f, l + 1).filter((r) => r.run === run);
    cuts.push({
      chain: chain.id,
      side,
      node,
      lon: n.lon,
      lat: n.lat,
      junction: n.junctionName,
      refInside: inside.ref,
      refOutside: outsideRow.ref,
      clsOutside: outsideRow.cls,
      chainsAtNode: plan.nodeChains.get(node)?.length ?? 0,
      cutKm: km(cutRows.reduce((s, r) => s + r.m, 0)),
      cutShippedKm: km(shippedRows.reduce((s, r) => s + r.m, 0)),
      refsCutShipped: [...new Set(shippedRows.map((r) => r.ref ?? "(none)"))].sort(),
      run,
      operatedLeftM: run === null ? null : leftRows.reduce((s, r) => s + r.m, 0),
    });
  };
  const isLoop = chain.closed;
  if (isLoop) continue;
  if (f > 0) cutAt("before", f, rows[f], rows[f - 1], rows.slice(0, f));
  if (l < rows.length - 1) cutAt("after", l + 1, rows[l], rows[l + 1], rows.slice(l + 1));
}
const operatorRefCuts = cuts.filter((c) => c.refsCutShipped.some((r) => OPERATOR_REF.test(r)));

// 2. Ramps: v1 (over the wards, reached from any operated main line) against scope v2.
const overWards = (p: Plan, id: string) => {
  const rp = p.runs.get(id)!;
  for (let i = rp.run.from; i <= rp.run.to; i++) {
    const node = net.nodes.get(rp.chain.nodes[i])!;
    const isOver = nearWards(inWards, node.lon, node.lat);
    if (isOver) return true;
  }
  return false;
};
const isOperatedMainOf = (p: Plan) =>
  [...p.runs.values()]
    .filter((rp) => rp.cls === "expressway" && rp.run.ways.some((w) => net.ways.get(w)?.operated === true))
    .map((rp) => rp.run.id);
const v1Scope = (p: Plan) => {
  const operated = isOperatedMainOf(p);
  const main = operated.filter((id) => overWards(p, id));
  const ramps = [...rampsReachedFrom(p, operated)].filter((id) => overWards(p, id));
  const streets = [...p.runs.values()]
    .filter((rp) => rp.cls === "street")
    .map((rp) => rp.run.id)
    .filter((id) => overWards(p, id));
  return new Set([...main, ...ramps, ...streets]);
};
// v1 as main has it: the runs by structure alone (a ramp keeps its id whichever way the main lines are cut).
const planV1 = planFor(v1Scope, "keep");
const v1Ramps = new Set([...planV1.wanted].filter((id) => planV1.runs.get(id)!.cls === "ramp"));
const added = [...shippedRamps].filter((id) => !v1Ramps.has(id)).sort();
/** Whether a run has a ground end (a foot onto the streets: an entrance or exit, not a link). */
const hasFoot = (id: string) =>
  [true, false].some((atStart) => endPlan(plan, plan.runs.get(id)!, atStart).kind === "ground");
/** Where a dropped ramp leaves (or joins) a shipped run: that run and its run distance there. */
const branchOf = (id: string) => {
  const rp = plan.runs.get(id)!;
  for (const atStart of [true, false]) {
    const e = endPlan(plan, rp, atStart);
    const isJoined = e.kind === "junction" || e.kind === "seam";
    if (!isJoined || !shipped.has(e.parent)) continue;
    const pp = plan.runs.get(e.parent)!;
    const sM = pp.align.s[pp.align.vertexSample[e.parentNodeIndex]] - pp.align.s[pp.i0];
    return { run: e.parent, ref: pp.ref, sM: Math.round(sM) };
  }
  return null;
};
const dropped = [...ship.rampsDropped].sort().map(([id, d]) => {
  const pp = plan.runs.get(d.parent)!;
  return {
    run: id,
    km: km(plan.runs.get(id)!.length),
    round: d.round,
    parent: d.parent,
    parentCls: pp.cls,
    parentRef: pp.ref,
    foot: hasFoot(id),
    branch: branchOf(id),
  };
});
const lost = [...v1Ramps].filter((id) => !shippedRamps.has(id)).sort();
const lengthOf = (ids: Iterable<string>) => [...ids].reduce((n, id) => n + plan.runs.get(id)!.length, 0);
/** Runs of a set whose junction or seam parent is not in it (the plan's dangling, before any solve). */
const danglingIn = (p: Plan, set: ReadonlySet<string>) => {
  const outList: Array<{
    run: string;
    end: "start" | "end";
    km: number;
    parent: string;
    parentCls: string;
    parentRef: string | null;
    parentOperated: boolean;
    parentOverWards: boolean;
    junction: string | null;
    lon: number;
    lat: number;
  }> = [];
  for (const id of [...set].sort()) {
    const rp = p.runs.get(id)!;
    for (const atStart of [true, false]) {
      const e = endPlan(p, rp, atStart);
      const isJoined = e.kind === "junction" || e.kind === "seam";
      if (!isJoined || set.has(e.parent)) continue;
      const pp = p.runs.get(e.parent)!;
      const node = net.nodes.get(rp.chain.nodes[e.nodeIndex])!;
      outList.push({
        run: id,
        end: atStart ? "start" : "end",
        km: km(rp.length),
        parent: e.parent,
        parentCls: pp.cls,
        parentRef: pp.ref,
        parentOperated: pp.run.ways.some((w) => net.ways.get(w)!.operated),
        parentOverWards: overWards(p, e.parent),
        junction: node.junctionName,
        lon: node.lon,
        lat: node.lat,
      });
    }
  }
  return outList;
};

// 3. Refs of the shipped main lines, and the districts from the plan.
const districtRuns = planDistrictRuns(plan, shipped);
const districts = assignDistricts(districtRuns);
const refRuns = new Map<string, { runs: number; km: number }>();
const wayRefs = new Map<string, number>();
const mixed: Array<{ run: string; districts: string[]; refs: string[] }> = [];
for (const id of shippedMain) {
  const rp = plan.runs.get(id)!;
  const key = rp.ref ?? "(none)";
  const t = refRuns.get(key) ?? { runs: 0, km: 0 };
  t.runs++;
  t.km += rp.length / 1000;
  refRuns.set(key, t);
  const ds = new Set<string>();
  const refs = new Set<string>();
  for (const w of rp.run.ways) {
    const way = net.ways.get(w)!;
    const r = way.ref ?? "(none)";
    wayRefs.set(r, (wayRefs.get(r) ?? 0) + wayLength(net, way));
    refs.add(r);
    const mid = net.nodes.get(way.nodes[way.nodes.length >> 1])!;
    const d = districtOfRef(way.ref, mid.lon, mid.lat);
    if (d) ds.add(d);
  }
  if (ds.size > 1) mixed.push({ run: id, districts: [...ds].sort(), refs: [...refs].sort() });
}
const known = new Set<string>([...DISTRICT_REFS.central, ...DISTRICT_REFS.east, "C2"]);
const missingRefs = [...wayRefs.keys()].filter((r) => !known.has(r)).sort();
const e4 = [...shippedMain].flatMap((id) => {
  const rp = plan.runs.get(id)!;
  return rp.run.ways
    .filter((w) => (net.ways.get(w)!.ref ?? "").split(";").includes("E4"))
    .map((w) => {
      const way = net.ways.get(w)!;
      const lats = way.nodes.map((n) => net.nodes.get(n)!.lat);
      return {
        run: id,
        runRef: rp.ref,
        way: w,
        ref: way.ref,
        operated: way.operated,
        m: Math.round(wayLength(net, way)),
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
      };
    });
});
const byDistrict: Record<
  string,
  { runs: number; km: number; main: number; ramps: number; addedRamps: number; addedKm: number }
> = {};
for (const id of shipped) {
  const d = districts.get(id) ?? "outside";
  const t = (byDistrict[d] ??= { runs: 0, km: 0, main: 0, ramps: 0, addedRamps: 0, addedKm: 0 });
  const rp = plan.runs.get(id)!;
  t.runs++;
  t.km += rp.length / 1000;
  if (rp.cls === "expressway") t.main++;
  if (rp.cls === "ramp") t.ramps++;
  if (added.includes(id)) {
    t.addedRamps++;
    t.addedKm += rp.length / 1000;
  }
}
for (const t of Object.values(byDistrict)) {
  t.km = Math.round(t.km * 1000) / 1000;
  t.addedKm = Math.round(t.addedKm * 1000) / 1000;
}
const extent = scopeExtent(plan, shipped, inWards);

const result = {
  below,
  runBorders,
  runs: { main: shippedMain.size, ramps: shippedRamps.size, streets: ship.streets.size, all: shipped.size },
  extent,
  cuts: {
    count: cuts.length,
    cutShippedKm: Math.round(cuts.reduce((s, c) => s + c.cutShippedKm, 0) * 1000) / 1000,
    operatorRefCuts: operatorRefCuts.length,
    shortLeft: cuts.filter((c) => c.operatedLeftM !== null && c.operatedLeftM < 100),
    list: cuts,
  },
  sandwiched: {
    count: sandwiched.length,
    km: km(sandwiched.reduce((s, r) => s + r.m, 0)),
    shippedKm: km(sandwiched.filter((r) => r.shipped).reduce((s, r) => s + r.m, 0)),
    list: sandwiched,
  },
  ramps: {
    v1: { runs: v1Ramps.size, km: km([...v1Ramps].reduce((n, id) => n + planV1.runs.get(id)!.length, 0)) },
    v2: { runs: shippedRamps.size, km: km(lengthOf(shippedRamps)) },
    added: { runs: added.length, km: km(lengthOf(added)), list: added },
    lost: { runs: lost.length, list: lost },
    dropped: {
      runs: dropped.length,
      km: km(dropped.reduce((n, d) => n + d.km * 1000, 0)),
      withFoot: dropped.filter((d) => d.foot).map((d) => d.run),
      list: dropped,
    },
    rampsOutside: { runs: ship.rampsOutside.size, km: km(lengthOf(ship.rampsOutside)) },
    danglingV1: danglingIn(planV1, planV1.wanted),
    danglingV2: danglingIn(plan, shipped),
  },
  refs: {
    byRunRef: Object.fromEntries(
      [...refRuns].sort().map(([r, t]) => [r, { runs: t.runs, km: Math.round(t.km * 1000) / 1000 }]),
    ),
    byWayRefKm: Object.fromEntries([...wayRefs].sort().map(([r, m]) => [r, km(m)])),
    missing: missingRefs,
    mixed,
    e4,
  },
  districts: byDistrict,
  boxBorderRuns: boxBorderRuns(districtRuns),
  chains: chainsOut,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(result, null, 1) + "\n");
log("expressway_scope_probed", {
  out,
  below,
  runBorders,
  mainRuns: shippedMain.size,
  rampRuns: shippedRamps.size,
  cuts: cuts.length,
  cutShippedKm: result.cuts.cutShippedKm,
  operatorRefCuts: operatorRefCuts.length,
  sandwichedKm: result.sandwiched.km,
  addedRamps: added.length,
  addedRampKm: result.ramps.added.km,
  lostRamps: lost.length,
  droppedRamps: dropped.length,
  droppedWithFoot: dropped.filter((d) => d.foot).length,
  danglingV2: result.ramps.danglingV2.length,
  mixedRuns: mixed.length,
  missingRefs,
  boxBorderRuns: result.boxBorderRuns,
});
