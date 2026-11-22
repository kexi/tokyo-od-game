# ruff: noqa: E501 — the patches carry TypeScript lines that must match regulations.ts as written.
# Builds src/world/regulations.exp.ts (temporary, never committed) from the branch's regulations.ts:
# the PR W options (a) propagate, (b) loose mutual (judge / evidence), (c) doubled pairs, (d) undo,
# switched by the exported EXP. Run from the worktree root; delete the output after measuring.
src = open("src/world/regulations.ts").read()
s = src


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


# --- switches and helpers -------------------------------------------------------------------
rep(
    """const MATCH_DIST = 6;""",
    """const MATCH_DIST = 6;
export const EXP = { a: false, b: "off" as "off" | "judge" | "evidence", c: false, d: false, margin: 60 };
export const EXP_OUT = { undone: [] as number[], propagated: [] as number[], paired: [] as number[] };
/** Unit travel direction along `seg` 2 m from node `n`, arriving (into n) or leaving (out of n). */
function tangentAt(graph: RoadGraph, seg: Segment, n: number, arriving: boolean): Vector3 {
  const atTo = seg.to === n;
  const s = atTo ? Math.max(0, seg.length - 2) : Math.min(2, seg.length);
  const d = graph.sample(seg, s).dir.clone();
  // Arriving at `to` runs along the coords; leaving `from` too; the other two against them.
  const isAlong = arriving === atTo;
  return isAlong ? d : d.multiplyScalar(-1);
}
/** navigation.ts classifyTurn's straight (within 22°), copied to keep src/game out of the world. */
function isStraight(tIn: Vector3, tOut: Vector3): boolean {
  const angle = (Math.atan2(leftOf(tIn, 1).dot(tOut), tIn.dot(tOut)) * 180) / Math.PI;
  return Math.abs(angle) <= 22;
}
/** The node of `a` that `b` continues straight on from (same street going on), or null. */
export function straightNode(graph: RoadGraph, a: Segment, b: Segment): number | null {
  for (const n of [a.from, a.to]) {
    const isShared = b.from === n || b.to === n;
    if (!isShared || a === b) continue;
    if (isStraight(tangentAt(graph, a, n, true), tangentAt(graph, b, n, false))) return n;
  }
  return null;
}
/** Whether two segments are the same line drawn twice (GSI's doubled lines): middles within 1.5 m, lengths within 2 m. */
export function isDoubled(graph: RoadGraph, a: Segment, b: Segment): boolean {
  if (a === b || Math.abs(a.length - b.length) > 2) return false;
  const pa = graph.sample(a, a.length / 2).pos;
  const pb = graph.sample(b, b.length / 2).pos;
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) <= 1.5;
}""",
)

# --- (b): loose mutual in the matcher -------------------------------------------------------
rep(
    """    const mutual = new Map<OsmWayLanes, boolean>();""",
    """    const mutual = new Map<OsmWayLanes, boolean>();
    const mutualLoose = new Map<OsmWayLanes, boolean>();
    const carriagewaysLooseAll: number[] = [];""",
)
rep(
    """      const carriageways: Array<{ x: number; z: number }> = [];
      for (const sense of [1, -1] as const) {""",
    """      const carriageways: Array<{ x: number; z: number }> = [];
      const carriagewaysLoose: Array<{ x: number; z: number }> = [];
      for (const sense of [1, -1] as const) {""",
)
rep(
    """        let isMutual = mutual.get(hit.owner);
        if (isMutual === undefined) {
          const isParallel = (dx: number, dz: number) => Math.abs(dx * hit.dx + dz * hit.dz) > PARALLEL;
          isMutual = streets.nearest(wx, wz, reach, isParallel)?.owner === seg;
          mutual.set(hit.owner, isMutual);
        }
        if (!isMutual) continue;""",
    """        let isMutual = mutual.get(hit.owner);
        let isLoose = mutualLoose.get(hit.owner);
        if (isMutual === undefined || isLoose === undefined) {
          const isParallel = (dx: number, dz: number) => Math.abs(dx * hit.dx + dz * hit.dz) > PARALLEL;
          const owner = streets.nearest(wx, wz, reach, isParallel)?.owner;
          isMutual = owner === seg;
          const isSameStreet =
            owner !== undefined &&
            owner.line.width === seg.line.width &&
            (straightNode(graph, seg, owner) !== null || isDoubled(graph, seg, owner));
          isLoose = isMutual || isSameStreet;
          mutual.set(hit.owner, isMutual);
          mutualLoose.set(hit.owner, isLoose);
        }
        const useLoose = EXP.b === "evidence";
        const isTaken = useLoose ? isLoose : isMutual;
        // The judge-only form: the divided test sees the loose pairs, the evidence the strict ones.
        const fitsLoose = (way: OsmWayLanes) =>
          (way.oneway ? way.forward : Math.max(way.forward, way.backward)) <= fitting;
        const isLooseLevel = hit.owner.layer === 0 || (hit.owner.layer > 0 && isBridge);
        if (isLoose && hit.owner.oneway && fitsLoose(hit.owner) && isLooseLevel) carriagewaysLoose.push({ x: wx, z: wz });
        if (!isTaken) continue;""",
)
rep(
    """      // Across the segment (its normal), how far apart the two carriageways run.
      const isDivided = carriageways.length === 2 && !isOneWay;""",
    """      if (carriagewaysLoose.length === 2 && !isOneWay) carriagewaysLooseAll.push(1);
      // Across the segment (its normal), how far apart the two carriageways run.
      const isDivided = carriageways.length === 2 && !isOneWay;""",
)
rep(
    """    // A pair of ways tagged with a width only still draws the road as divided.
    if (!isMatched) return { ...none, isDivided: isSeparated };""",
    """    const isDividedOut = EXP.b === "judge" ? carriagewaysLooseAll.length >= majority : isSeparated;
    // A pair of ways tagged with a width only still draws the road as divided.
    if (!isMatched) return { ...none, isDivided: isDividedOut };""",
)
rep(
    """      isDivided: isSeparated,
    };""",
    """      isDivided: isDividedOut,
    };""",
)

# --- defer the sections; (a)/(c)/(d) between the votes and the sections -----------------------
rep(
    """    const isVotedOneWay = Math.abs(votes) >= majority;
    if (rule && isVotedOneWay && !isOsmDividedTwoWay(seg, rule, samples)) {
      seg.onewayRule = { dir: votes > 0 ? 1 : -1, time: rule };
    }""",
    """    const isVotedOneWay = Math.abs(votes) >= majority;
    if (rule && isVotedOneWay) voted.set(seg, { dir: votes > 0 ? 1 : -1, time: rule });
    if (rule && isVotedOneWay && !isOsmDividedTwoWay(seg, rule, samples)) {
      seg.onewayRule = { dir: votes > 0 ? 1 : -1, time: rule };
    }
    deferred.set(seg, { samples, jartic: laneVotes >= majority ? laneCount : null });""",
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
    """  warnIfDistrictClosed(graph, report);
""",
    """  postProcess(graph, voted, approxDivided, frame);
  for (const [seg, d] of deferred) {
    const hasSection = seg.line.section !== undefined;
    if (hasSection) continue;
    const evidence: LaneEvidence = { ...osmLanes(seg, d.samples).evidence, jartic: d.jartic };
    const section = streetSectionOf(seg, evidence);
    seg.section = section;
    seg.lanes = section.lanes;
  }
  warnIfDistrictClosed(graph, report);
""",
)
rep(
    """  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    // Only what JARTIC decides is reset""",
    """  const voted = new Map<Segment, { dir: 1 | -1; time: RuleTime }>();
  const deferred = new Map<Segment, { samples: LaneSample[]; jartic: number | null }>();
  // The tool's approximation (measureStreetBands onewaySourceOf): one-way OSM ways both ways
  // within half the 幅員 + 15 m at any sample.
  const wideWays = new LineGrid<boolean>(50);
  for (const r of data.roadlanes) wideWays.add(r[ROAD_LANES_COLUMN.oneway] === 1, toLocal(frame, r, ROAD_LANES_COLUMN.coords));
  const approxDivided = (seg: Segment) => {
    const dirs = new Set<number>();
    for (const f of [0.2, 0.5, 0.8]) {
      const { pos: p, dir: d } = graph.sample(seg, seg.length * f);
      for (const sense of [1, -1]) {
        const hit = wideWays.nearest(p.x, p.z, Math.min(50, seg.line.width / 2 + 15), (dx, dz) => sense * (dx * d.x + dz * d.z) > PARALLEL && true);
        if (hit?.owner) dirs.add(sense);
      }
    }
    return dirs.size === 2;
  };
  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    // Only what JARTIC decides is reset""",
)

post = """
/** The PR W options after the votes (EXP): (a) propagate, (c) doubled pairs, (d) undo. */
function postProcess(
  graph: RoadGraph,
  voted: Map<Segment, { dir: 1 | -1; time: RuleTime }>,
  approxDivided: (seg: Segment) => boolean,
  frame: LocalFrame,
): void {
  void frame;
  EXP_OUT.undone = [];
  EXP_OUT.propagated = [];
  EXP_OUT.paired = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of graph.segments)
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
  /** Travel direction of `s` leaving node n in the flow that arrives at n along `a` in direction `ad`. */
  const flowDir = (s: Segment, n: number): 1 | -1 => (s.from === n ? 1 : -1);
  const arriveDir = (s: Segment, n: number): 1 | -1 => (s.to === n ? 1 : -1);
  if (EXP.a) {
    const queue = graph.segments.filter(isReturned);
    while (queue.length) {
      const a = queue.pop()!;
      const ra = voted.get(a)!;
      for (const n of [a.from, a.to]) {
        for (const id of graph.nodes.get(n) ?? []) {
          const b = graph.segments[id];
          if (!isCandidate(b) || isNearEdge(b)) continue;
          if (straightNode(graph, a, b) !== n) continue;
          // Same flow: a's rule arriving at n and b's rule leaving n (or both the other way).
          const aArrives = ra.dir === arriveDir(a, n);
          const bLeaves = voted.get(b)!.dir === flowDir(b, n);
          if (aArrives !== bLeaves) continue;
          if (!approxDivided(b)) continue;
          b.onewayRule = null;
          EXP_OUT.propagated.push(b.id);
          queue.push(b);
        }
      }
    }
  }
  if (EXP.c) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of graph.segments) {
        if (!isReturned(a)) continue;
        for (const n of [a.from, a.to])
          for (const id of graph.nodes.get(n) ?? []) void id;
        for (const b of graph.segments) {
          if (!isCandidate(b) || isNearEdge(b) || !isDoubled(graph, a, b)) continue;
          b.onewayRule = null;
          EXP_OUT.paired.push(b.id);
          changed = true;
        }
      }
    }
  }
  if (EXP.d) {
    const eff = (s: Segment): number => {
      const r = s.onewayRule;
      return r && isAllDay(r.time) ? r.dir : s.line.oneway;
    };
    const offends = (a: Segment): boolean => {
      const ra = voted.get(a)!;
      const nd = -ra.dir as 1 | -1;
      const n = nd === 1 ? a.to : a.from;
      const others = (graph.nodes.get(n) ?? []).map((id) => graph.segments[id]).filter((s) => s !== a && isEnterable(s.line));
      if (others.length === 0) return false;
      const canLeave = others.some((s) => eff(s) === 0 || eff(s) === flowDir(s, n));
      if (!canLeave) return true;
      return others.some((s) => straightNode(graph, a, s) === n && eff(s) !== 0 && eff(s) !== flowDir(s, n));
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
"""
s = s.replace("/** Arriving direction at the `dir` end", post + "\n/** Arriving direction at the `dir` end", 1)
if post not in s:
    s = s + post
open("src/world/regulations.exp.ts", "w").write(s)
print("ok")
