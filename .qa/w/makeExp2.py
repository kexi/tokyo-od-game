# ruff: noqa: E501 — the patches carry TypeScript lines that must match regulations.ts as written.
# Builds src/world/regulations.exp.ts (temporary, never committed) from the branch's regulations.ts:
# review0 追記 1's rows: (a) as before (approximate target test), a2 (the game's matcher without the
# mutual-nearest gate, its evidence for the propagated segments), + d (undo), + copy (section from the
# segment it was propagated from), and the narrow rule (no return below NARROWEST_LANE). Run from the
# worktree root; delete the output after measuring.
s = open("src/world/regulations.ts").read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


rep(
    'import { OSM_ONEWAY_REACH } from "./streetAssumptions";',
    'import { NARROWEST_LANE, OSM_ONEWAY_REACH } from "./streetAssumptions";',
)
rep(
    """const MATCH_DIST = 6;""",
    """const MATCH_DIST = 6;
export const EXP = { a: false, a2: false, d: false, copy: false, narrow: true, margin: 60, L: false };
export const EXP_OUT = {
  undone: [] as number[],
  propagated: [] as Array<{ id: number; from: number }>,
  narrowKept: [] as number[],
  reachBoth: (_s: Segment) => false,
};
function tangentAt(graph: RoadGraph, seg: Segment, n: number, arriving: boolean): Vector3 {
  const atTo = seg.to === n;
  const s = atTo ? Math.max(0, seg.length - 2) : Math.min(2, seg.length);
  const d = graph.sample(seg, s).dir.clone();
  const isAlong = arriving === atTo;
  return isAlong ? d : d.multiplyScalar(-1);
}
function isStraight(tIn: Vector3, tOut: Vector3): boolean {
  const angle = (Math.atan2(leftOf(tIn, 1).dot(tOut), tIn.dot(tOut)) * 180) / Math.PI;
  return Math.abs(angle) <= 22;
}
export function straightNode(graph: RoadGraph, a: Segment, b: Segment): number | null {
  for (const n of [a.from, a.to]) {
    const isShared = b.from === n || b.to === n;
    if (!isShared || a === b) continue;
    if (isStraight(tangentAt(graph, a, n, true), tangentAt(graph, b, n, false))) return n;
  }
  return null;
}
export function isDoubled(graph: RoadGraph, a: Segment, b: Segment): boolean {
  if (a === b || Math.abs(a.length - b.length) > 2) return false;
  const pa = graph.sample(a, a.length / 2).pos;
  const pb = graph.sample(b, b.length / 2).pos;
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) <= 1.5;
}""",
)
# matcher: optional skip of the mutual-nearest gate
rep(
    """  samples: readonly LaneSample[],
  travel?: -1 | 0 | 1,
) => {""",
    """  samples: readonly LaneSample[],
  travel?: -1 | 0 | 1,
  skipMutual?: boolean,
) => {""",
)
rep(
    """  return (seg, samples, travel = seg.onewayRule?.dir ?? seg.line.oneway) => {""",
    """  return (seg, samples, travel = seg.onewayRule?.dir ?? seg.line.oneway, skipMutual = false) => {""",
)
rep(
    """        let isMutual = mutual.get(hit.owner);
        if (isMutual === undefined) {""",
    """        let isMutual = skipMutual ? true : mutual.get(hit.owner);
        if (isMutual === undefined) {""",
)
# vote + narrow rule + deferral
rep(
    """    const isVotedOneWay = Math.abs(votes) >= majority;
    if (rule && isVotedOneWay && !isOsmDividedTwoWay(seg, rule, samples)) {
      seg.onewayRule = { dir: votes > 0 ? 1 : -1, time: rule };
    }""",
    """    const isVotedOneWay = Math.abs(votes) >= majority;
    const jarticLanes = laneVotes >= majority ? laneCount : null;
    if (rule && isVotedOneWay) {
      const ow = { dir: (votes > 0 ? 1 : -1) as 1 | -1, time: rule };
      voted.set(seg, ow);
      const isGsiTwoWayAllDay = seg.line.oneway === 0 && isAllDay(rule);
      const isReturnL = EXP.L && isGsiTwoWayAllDay && osmLanes(seg, samples, 0, true).isDivided;
      const isReturn = isReturnL || isOsmDividedTwoWay(seg, rule, samples);
      const isNarrow = isReturn && EXP.narrow && isTooNarrow(seg, samples, jarticLanes, isReturnL);
      if (isNarrow) EXP_OUT.narrowKept.push(seg.id);
      if (!isReturn || isNarrow) seg.onewayRule = ow;
    }
    deferred.set(seg, { samples, jartic: jarticLanes, loose: EXP.L });""",
)
rep(
    """    const hasSection = seg.line.section !== undefined;
    if (!hasSection) {
      const evidence: LaneEvidence = {
        ...osmLanes(seg, samples).evidence,
        jartic: laneVotes >= majority ? laneCount : null,
      };
      const section = streetSectionOf(seg, evidence);
      seg.section = section;
      seg.lanes = section.lanes;
    }
    for (const [code, v]""",
    """    for (const [code, v]""",
)
rep(
    """  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    // Only what JARTIC decides is reset""",
    """  const voted = new Map<Segment, { dir: 1 | -1; time: RuleTime }>();
  const deferred = new Map<Segment, { samples: LaneSample[]; jartic: number | null; loose: boolean }>();
  const isTooNarrow = (seg: Segment, samples: readonly LaneSample[], jartic: number | null, loose: boolean) => {
    const evidence: LaneEvidence = { ...osmLanes(seg, samples, 0, loose).evidence, jartic };
    return resolveSection(seg.line.width, 0, evidence).laneWidth < NARROWEST_LANE.value;
  };
  // The tool's approximation (measureStreetBands onewaySourceOf), for the old (a).
  const wideWays = new LineGrid<boolean>(50);
  for (const r of data.roadlanes) wideWays.add(true, toLocal(frame, r, ROAD_LANES_COLUMN.coords));
  const approxDivided = (seg: Segment) => {
    const dirs = new Set<number>();
    for (const f of [0.2, 0.5, 0.8]) {
      const { pos: p, dir: d } = graph.sample(seg, seg.length * f);
      for (const sense of [1, -1]) {
        const hit = wideWays.nearest(p.x, p.z, Math.min(50, seg.line.width / 2 + 15), (dx, dz) => sense * (dx * d.x + dz * d.z) > PARALLEL);
        if (hit) dirs.add(sense);
      }
    }
    return dirs.size === 2;
  };
  // 追記 1 A3's independent line: a one-way OSM way each way within the game's reach at most samples.
  const onewayWays = new LineGrid<boolean>();
  for (const r of data.roadlanes)
    if (r[ROAD_LANES_COLUMN.oneway] === 1) onewayWays.add(true, toLocal(frame, r, ROAD_LANES_COLUMN.coords));
  EXP_OUT.reachBoth = (seg: Segment) => {
    const reach = Math.min(25, seg.line.width / 2 + OSM_ONEWAY_REACH.value);
    const fr = seg.length < 20 ? [0.5] : [0.2, 0.5, 0.8];
    let n = 0;
    for (const f of fr) {
      const { pos: p, dir: d } = graph.sample(seg, seg.length * f);
      const both = [1, -1].every((sense) => onewayWays.nearest(p.x, p.z, reach, (dx, dz) => sense * (dx * d.x + dz * d.z) > PARALLEL) !== null);
      if (both) n++;
    }
    return n >= Math.ceil(fr.length / 2);
  };
  EXP_OUT.undone = [];
  EXP_OUT.propagated = [];
  EXP_OUT.narrowKept = [];
  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    // Only what JARTIC decides is reset""",
)
rep(
    """  warnIfDistrictClosed(graph, report);
""",
    """  {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    // The streets' extent (expresswayRoads.ts isInsideStreets: ground lines only), not the decks'.
    for (const s of graph.segments)
      if (takesJarticRules(s.line))
        for (const p of s.pts) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
    const m = EXP.margin;
    const isNearEdge = (s: Segment) => s.pts.some((p) => p.x < minX + m || p.x > maxX - m || p.z < minZ + m || p.z > maxZ - m);
    const isReturned = (s: Segment) => voted.has(s) && s.onewayRule === null;
    const isCandidate = (s: Segment) => {
      const v = voted.get(s);
      return v !== undefined && s.onewayRule !== null && s.line.oneway === 0 && isAllDay(v.time) && takesJarticRules(s.line);
    };
    const leaves = (s: Segment, n: number): 1 | -1 => (s.from === n ? 1 : -1);
    const arrives = (s: Segment, n: number): 1 | -1 => (s.to === n ? 1 : -1);
    if (EXP.a || EXP.a2) {
      const queue = graph.segments.filter(isReturned);
      while (queue.length) {
        const a = queue.shift()!;
        const ra = voted.get(a)!;
        for (const n of [a.from, a.to])
          for (const id of graph.nodes.get(n) ?? []) {
            const b = graph.segments[id];
            if (!isCandidate(b) || isNearEdge(b)) continue;
            if (straightNode(graph, a, b) !== n) continue;
            const isSameFlow = (ra.dir === arrives(a, n)) === (voted.get(b)!.dir === leaves(b, n));
            if (!isSameFlow) continue;
            const d = deferred.get(b)!;
            const isTarget = EXP.a2 ? osmLanes(b, d.samples, 0, true).isDivided : approxDivided(b);
            if (!isTarget) continue;
            if (EXP.a2 && EXP.narrow && isTooNarrow(b, d.samples, d.jartic, true)) {
              EXP_OUT.narrowKept.push(b.id);
              continue;
            }
            b.onewayRule = null;
            d.loose = EXP.a2;
            EXP_OUT.propagated.push({ id: b.id, from: a.id });
            queue.push(b);
          }
      }
    }
    if (EXP.d) {
      const eff = (s: Segment): number => (s.onewayRule && isAllDay(s.onewayRule.time) ? s.onewayRule.dir : s.line.oneway);
      const offends = (a: Segment): boolean => {
        const nd = -voted.get(a)!.dir as 1 | -1;
        const arrive = nd === 1 ? a.to : a.from;
        const enter = nd === 1 ? a.from : a.to;
        const around = (n: number) => (graph.nodes.get(n) ?? []).map((id) => graph.segments[id]).filter((s) => s !== a && isEnterable(s.line));
        const out = around(arrive);
        if (out.length > 0) {
          if (!out.some((s) => eff(s) === 0 || eff(s) === leaves(s, arrive))) return true;
          if (out.some((s) => straightNode(graph, a, s) === arrive && eff(s) !== 0 && eff(s) !== leaves(s, arrive))) return true;
        }
        const inn = around(enter);
        if (inn.length > 0) {
          if (!inn.some((s) => eff(s) === 0 || eff(s) === arrives(s, enter))) return true;
          if (inn.some((s) => straightNode(graph, a, s) === enter && eff(s) !== 0 && eff(s) !== arrives(s, enter))) return true;
        }
        return false;
      };
      let changed = true;
      while (changed) {
        changed = false;
        for (const a of graph.segments) {
          if (!isReturned(a) || isNearEdge(a) || !offends(a)) continue;
          a.onewayRule = voted.get(a)!;
          EXP_OUT.undone.push(a.id);
          changed = true;
        }
      }
    }
  }
  for (const [seg, d] of deferred) {
    const hasSection = seg.line.section !== undefined;
    if (hasSection) continue;
    const isLoose = d.loose && seg.onewayRule === null && voted.has(seg);
    const evidence: LaneEvidence = { ...osmLanes(seg, d.samples, undefined, isLoose).evidence, jartic: d.jartic };
    const section = streetSectionOf(seg, evidence);
    seg.section = section;
    seg.lanes = section.lanes;
  }
  if (EXP.copy)
    for (const { id, from } of EXP_OUT.propagated) {
      const t = graph.segments[id];
      const f = graph.segments[from];
      if (t.onewayRule !== null || !f.section) continue;
      t.section = { ...f.section };
      t.lanes = f.lanes;
    }
  warnIfDistrictClosed(graph, report);
""",
)
open("src/world/regulations.exp.ts", "w").write(s)
print("ok")
