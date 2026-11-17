import { endPlan, type Plan, type RunPlan } from "./compile";
import { type DistrictRun, type DroppedRamp, type ScopeRun, scopeRamps } from "./districts";
import { haversine } from "./geo";

/**
 * The shipped scope (P2.7-1, `--range ship`): which runs of the plan the game is to carry. Pure:
 * the build script makes `inWards` from public/data/areas.json (src/geo/areas.ts) and passes it.
 *
 * - A main line is a run of the expressway class with at least one way of the urban expressway
 *   (XwWay.operated) and a node over the 23 wards.
 * - A ramp (scope v2, R1-1a: U2 ships what lies past the wards) is a ramp run that reaches a shipped
 *   main line through the junctions and seams of endPlan, passing through ramps only (a ramp onto a
 *   ramp onto the main line is in; a ramp that gets there only across another main line is not),
 *   wherever it lies, unless it hangs from a run that is not shipped (pruneHangingRamps). Why not
 *   "over the 23 wards" as in v1: the main lines run on whole past the wards (to Yokohama, Kawaguchi,
 *   Urayasu), and v1 left their entrances, exits and junctions out there. A ramp reaching only main
 *   lines that are not shipped (the K lines' in Yokohama) stays out.
 * - A structure's street (P7: the 臨港道路 on the Rainbow Bridge's lower floor) over the 23 wards is
 *   in, so the bridge keeps both floors and the ramps ending on it (台場出口) keep their parent.
 *
 * "Over the 23 wards" is a node within WARD_REACH_M of a town polygon (nearWards): the e-Stat towns
 * leave slivers between them (rivers, the expressway's own strip), and 汐留入口 runs on one end to
 * end. The plan holds every run of the universe whatever the range (planNetwork plans them all), so
 * the set is the same whichever range the plan was made for.
 *
 * What the scope reaches past the wards is kept, not cut: a run is shipped whole, so the main
 * lines run on to Yokohama, Kawaguchi and Urayasu (scopeExtent measures it). The operator test
 * picks runs, not ways: a run that has one operated way takes along the other operators' ways it
 * runs on through (a chain does not stop at the operator's border, e.g. into 中央道), while another
 * operator's run inside the wards (C3, E1, E17 …) is left out with the ramps that hang only from it.
 */
export type InWards = (lon: number, lat: number) => boolean;

/** How near a town polygon a node may be and still count as over the wards (m). */
export const WARD_REACH_M = 30;

export type ShipRuns = {
  main: Set<string>;
  ramps: Set<string>;
  streets: Set<string>;
  all: Set<string>;
  /**
   * Ramps reaching an operated main line through ramps, but only main lines that are not shipped (not
   * over the wards): left out. (v1: the ramps reaching an operated main line nowhere over the wards.)
   */
  rampsOutside: Set<string>;
  /**
   * Ramps reaching a shipped main line but left out by rule A (districts.ts scopeRamps): hanging from
   * a run that is not shipped (a junction's link onto 外環 or onto a K line in Yokohama, `parent`), or
   * no longer reached once those are out (the feet on the streets of such links, `unreached`), with the
   * round that dropped each.
   */
  rampsDropped: Map<string, DroppedRamp>;
};

const DIRECTIONS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);

/**
 * Whether a point is over the wards or within `reachM` of them, tried at the point and at 8
 * points around it. Why not the distance to the nearest polygon: the town index answers point
 * lookups only, and a sliver between towns is narrower than the reach on at least one side.
 */
export function nearWards(inWards: InWards, lon: number, lat: number, reachM = WARD_REACH_M): boolean {
  if (inWards(lon, lat)) return true;
  const dLat = reachM / 110574;
  const dLon = reachM / (111320 * Math.cos((lat * Math.PI) / 180));
  return DIRECTIONS.some((a) => inWards(lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)));
}

function touchesWards(plan: Plan, rp: RunPlan, inWards: InWards): boolean {
  for (let i = rp.run.from; i <= rp.run.to; i++) {
    const node = plan.net.nodes.get(rp.chain.nodes[i]);
    const isOver = node !== undefined && nearWards(inWards, node.lon, node.lat);
    if (isOver) return true;
  }
  return false;
}

/**
 * A run and the runs it is joined to across the borders of the ref's district (`--run-borders cut`,
 * network.ts refBorders: 1 | K1, 5 | S5), as one line. Why: the scope takes a main line over the wards
 * to its end (U11), and cutting it where its ref changes must not leave out the part past the border
 * (S5 lies wholly outside the wards, and would drop with its ramps).
 */
function refLineOf(plan: Plan, rp: RunPlan): RunPlan[] {
  const line = [rp];
  const seen = new Set([rp.run.id]);
  for (let k = 0; k < line.length; k++) {
    const r = line[k];
    for (const atStart of [true, false]) {
      const border = r.run.borders?.[atStart ? 0 : 1];
      const isRefBorder = border === "seam" || border === "open";
      if (!isRefBorder) continue;
      const idx = atStart ? r.run.from : r.run.to;
      const beside = (plan.chainRuns.get(r.chain.id) ?? []).find(
        (o) => !seen.has(o.run.id) && o.run.from <= idx && idx <= o.run.to,
      );
      if (!beside) continue;
      seen.add(beside.run.id);
      line.push(beside);
    }
  }
  return line;
}

function isOperatedMain(plan: Plan, rp: RunPlan): boolean {
  const isMainClass = rp.cls === "expressway";
  if (!isMainClass) return false;
  return rp.run.ways.some((w) => plan.net.ways.get(w)?.operated === true);
}

/**
 * The parents of a run's ends: endPlan's junction or seam partner where it is a run of the plan (a
 * ground end, or a link at grade that is not compiled, is an end and no parent).
 */
function parentsOf(plan: Plan, id: string): string[] {
  const rp = plan.runs.get(id)!;
  const out: string[] = [];
  for (const atStart of [true, false]) {
    const e = endPlan(plan, rp, atStart);
    const isJoined = e.kind === "junction" || e.kind === "seam";
    if (isJoined && plan.runs.has(e.parent)) out.push(e.parent);
  }
  return out;
}

/** Every run of the plan as scopeRamps reads it: its class and the runs its ends hang from. */
export function scopeRunsOf(plan: Plan): Map<string, ScopeRun> {
  const out = new Map<string, ScopeRun>();
  for (const [id, rp] of plan.runs) out.set(id, { id, cls: rp.cls, parents: parentsOf(plan, id) });
  return out;
}

/** Runs joined at a junction or seam, both ways (a ramp's parent and the ramps hanging from a run). */
function joints(plan: Plan): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    out.set(a, (out.get(a) ?? new Set()).add(b));
    out.set(b, (out.get(b) ?? new Set()).add(a));
  };
  for (const [id, rp] of plan.runs) {
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isJoined = e.kind === "junction" || e.kind === "seam";
      if (isJoined && plan.runs.has(e.parent)) link(id, e.parent);
    }
  }
  return out;
}

const sorted = (ids: Iterable<string>) => new Set([...ids].sort());

/**
 * The ramps reached from the runs `from` through the junctions and seams of endPlan, passing through
 * ramps only (both ways: a ramp's parent and the ramps hanging from it).
 */
export function rampsReachedFrom(plan: Plan, from: Iterable<string>): Set<string> {
  const graph = joints(plan);
  const reached = new Set<string>();
  const queue = [...from];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const next of graph.get(id) ?? []) {
      const isRamp = plan.runs.get(next)!.cls === "ramp";
      const isNew = !seen.has(next);
      if (!isRamp || !isNew) continue;
      seen.add(next);
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

export function shipRuns(plan: Plan, inWards: InWards): ShipRuns {
  const operated = [...plan.runs.values()].filter((rp) => isOperatedMain(plan, rp)).map((rp) => rp.run.id);
  const isOver = (id: string) => touchesWards(plan, plan.runs.get(id)!, inWards);
  const isLineOver = (id: string) => refLineOf(plan, plan.runs.get(id)!).some((rp) => isOver(rp.run.id));
  const main = sorted(operated.filter(isLineOver));
  const streets = sorted(
    [...plan.runs.values()]
      .filter((rp) => rp.cls === "street")
      .map((rp) => rp.run.id)
      .filter(isOver),
  );
  const pruned = scopeRamps(scopeRunsOf(plan), main, new Set([...main, ...streets]));
  const ramps = sorted(pruned.ramps);
  const reached = new Set([...pruned.ramps, ...pruned.dropped.keys()]);
  const rampsOutside = sorted([...rampsReachedFrom(plan, operated)].filter((id) => !reached.has(id)));
  const all = sorted([...main, ...ramps, ...streets]);
  return { main, ramps, streets, all, rampsOutside, rampsDropped: pruned.dropped };
}

export type ExtentTally = { inKm: number; outKm: number; operatedKm: number; otherKm: number };
export type ScopeExtent = Record<"main" | "ramp" | "street", ExtentTally>;

const roundKm = (m: number) => Math.round(m) / 1000;

/**
 * How far the runs reach outside the wards and onto other operators' ways: each OSM segment of a
 * run booked by its midpoint (nearWards) and by its way's `operated`. On the OSM line, so the sums
 * are a few metres off the compiled lengths.
 */
export function scopeExtent(plan: Plan, ids: Iterable<string>, inWards: InWards): ScopeExtent {
  const blank = () => ({ inKm: 0, outKm: 0, operatedKm: 0, otherKm: 0 });
  const out: ScopeExtent = { main: blank(), ramp: blank(), street: blank() };
  for (const id of ids) {
    const rp = plan.runs.get(id)!;
    const t = out[rp.cls === "expressway" ? "main" : rp.cls];
    for (const wayId of rp.run.ways) {
      const way = plan.net.ways.get(wayId)!;
      const start = rp.chain.wayStarts[rp.chain.ways.indexOf(wayId)];
      for (let i = start; i < start + way.nodes.length - 1; i++) {
        const a = plan.net.nodes.get(rp.chain.nodes[i])!;
        const b = plan.net.nodes.get(rp.chain.nodes[i + 1])!;
        const m = haversine(a.lon, a.lat, b.lon, b.lat);
        const isIn = nearWards(inWards, (a.lon + b.lon) / 2, (a.lat + b.lat) / 2);
        if (isIn) t.inKm += m;
        else t.outKm += m;
        if (way.operated) t.operatedKm += m;
        else t.otherKm += m;
      }
    }
  }
  for (const t of Object.values(out)) {
    t.inKm = roundKm(t.inKm);
    t.outKm = roundKm(t.outKm);
    t.operatedKm = roundKm(t.operatedKm);
    t.otherKm = roundKm(t.otherKm);
  }
  return out;
}

/** Plan samples between two points of a district run (about 50 m: the samples are 1 m apart). */
const DISTRICT_POINT_STEP = 50;

/**
 * The runs `ids` of the plan as the districts need them (districts.ts DistrictRun), from the plan
 * alone (R1-1a): the ref of the run's first way (what its chunks carry, compile.ts runPlan), the runs
 * its ends hang from (endPlan's junction or seam parent, start first, as the run summaries write
 * them), points about every 50 m and the point at half its length. Why from the plan and not from
 * the chunks (districtRunsOf): a run that is not written (deferred, pruned or closed) has no chunks,
 * and the districts must be known before the solve to write some districts alone (--districts).
 */
export function planDistrictRuns(plan: Plan, ids: Iterable<string>): DistrictRun[] {
  return [...ids].sort().map((id) => {
    const rp = plan.runs.get(id)!;
    const parents: string[] = [];
    for (const atStart of [true, false]) {
      const e = endPlan(plan, rp, atStart);
      const isJoined = e.kind === "junction" || e.kind === "seam";
      if (isJoined) parents.push(e.parent);
    }
    const at = (i: number) => rp.plane.toLonLat(rp.align.xy[2 * i], rp.align.xy[2 * i + 1]);
    const points: Array<[number, number]> = [];
    for (let i = rp.i0; i <= rp.i1; i += DISTRICT_POINT_STEP) points.push(at(i));
    // Review 1 W1: the last point too, so a run across YAMATE_BOX in its last 50 m is seen across.
    const isLastIn = (rp.i1 - rp.i0) % DISTRICT_POINT_STEP === 0;
    if (!isLastIn) points.push(at(rp.i1));
    const half = rp.align.s[rp.i0] + rp.length / 2;
    let mid = rp.i0;
    for (let i = rp.i0; i <= rp.i1; i++) {
      const isNearer = Math.abs(rp.align.s[i] - half) < Math.abs(rp.align.s[mid] - half);
      if (isNearer) mid = i;
    }
    const wayRefs = rp.run.ways.map((w) => plan.net.ways.get(w)!.ref);
    return { id, cls: rp.cls, ref: rp.ref, parents, points, middle: at(mid), wayRefs };
  });
}
