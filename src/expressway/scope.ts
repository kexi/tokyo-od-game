import { endPlan, type Plan, type RunPlan } from "./compile";
import { haversine } from "./geo";

/**
 * The shipped scope (P2.7-1, `--range ship`): which runs of the plan the game is to carry. Pure:
 * the build script makes `inWards` from public/data/areas.json (src/geo/areas.ts) and passes it.
 *
 * - A main line is a run of the expressway class with at least one way of the urban expressway
 *   (XwWay.operated) and a node over the 23 wards.
 * - A ramp is a ramp run over the 23 wards that reaches such an operated main line through the
 *   junctions and seams of endPlan, passing through ramps only (a ramp onto a ramp onto the main
 *   line is in; a ramp that gets there only across another main line is not).
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
  /** Ramps reaching an operated main line through ramps but nowhere over the wards: left out. */
  rampsOutside: Set<string>;
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

function isOperatedMain(plan: Plan, rp: RunPlan): boolean {
  const isMainClass = rp.cls === "expressway";
  if (!isMainClass) return false;
  return rp.run.ways.some((w) => plan.net.ways.get(w)?.operated === true);
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

export function shipRuns(plan: Plan, inWards: InWards): ShipRuns {
  const operated = [...plan.runs.values()].filter((rp) => isOperatedMain(plan, rp));
  const graph = joints(plan);
  const reached = new Set<string>();
  const queue = operated.map((rp) => rp.run.id);
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
  const isOver = (id: string) => touchesWards(plan, plan.runs.get(id)!, inWards);
  const main = sorted(operated.map((rp) => rp.run.id).filter(isOver));
  const ramps = sorted([...reached].filter(isOver));
  const rampsOutside = sorted([...reached].filter((id) => !ramps.has(id)));
  const streets = sorted(
    [...plan.runs.values()]
      .filter((rp) => rp.cls === "street")
      .map((rp) => rp.run.id)
      .filter(isOver),
  );
  return { main, ramps, streets, all: sorted([...main, ...ramps, ...streets]), rampsOutside };
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
