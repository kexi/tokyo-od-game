# ruff: noqa: E501 — the patches carry TypeScript lines that must match regulations.ts as written.
# Builds src/world/regulations.exp.ts (temporary, never committed) from the branch's regulations.ts:
# review0 追記 5's rows (G': (i) the same line / same width straight on / same width leaving a shared
# node the same way; (ii) the way outside the owner's carriageway, streetRoom(width, 0).room / 2, or
# its width / 2 for the "value" row). Earlier: 追記 4's rows. L: the divided test without the mutual-nearest gate; L + G: the gate lifted
# only where guard G (G3) lets the way through, judged per sample ("upper": the owner's 幅員 class's
# upper bound, "value": its width). The strict test is not touched; the narrow rule holds for every
# return. No propagation, no undo. Run from the worktree root; delete the output after measuring.
s = open("src/world/regulations.ts").read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


rep(
    'import { OSM_ONEWAY_REACH } from "./streetAssumptions";',
    'import { NARROWEST_LANE, OSM_ONEWAY_REACH } from "./streetAssumptions";\n',
)
rep(
    """const MATCH_DIST = 6;""",
    """const MATCH_DIST = 6;
export const EXP = { L: false, G: "off" as "off" | "room" | "value", narrow: true };
export const EXP_OUT = { byLoose: [] as number[], narrowKept: [] as number[] };
function tangentAt(graph: RoadGraph, seg: Segment, n: number, arriving: boolean): Vector3 {
  const atTo = seg.to === n;
  const s = atTo ? Math.max(0, seg.length - 2) : Math.min(2, seg.length);
  const d = graph.sample(seg, s).dir.clone();
  return arriving === atTo ? d : d.multiplyScalar(-1);
}
export function straightNode(graph: RoadGraph, a: Segment, b: Segment): number | null {
  for (const n of [a.from, a.to]) {
    const isShared = b.from === n || b.to === n;
    if (!isShared || a === b) continue;
    const tIn = tangentAt(graph, a, n, true);
    const tOut = tangentAt(graph, b, n, false);
    const angle = (Math.atan2(leftOf(tIn, 1).dot(tOut), tIn.dot(tOut)) * 180) / Math.PI;
    if (Math.abs(angle) <= 22) return n;
  }
  return null;
}
export function isDoubled(graph: RoadGraph, a: Segment, b: Segment): boolean {
  if (a === b || Math.abs(a.length - b.length) > 2) return false;
  const pa = graph.sample(a, a.length / 2).pos;
  const pb = graph.sample(b, b.length / 2).pos;
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) <= 1.5;
}
/** Whether `b` leaves a node it shares with `a` the way `a` leaves it (2 m out, within PARALLEL). */
export function leavesAlike(graph: RoadGraph, a: Segment, b: Segment): boolean {
  for (const n of [a.from, a.to]) {
    const isShared = b.from === n || b.to === n;
    if (!isShared || a === b) continue;
    if (tangentAt(graph, a, n, false).dot(tangentAt(graph, b, n, false)) > PARALLEL) return true;
  }
  return false;
}
/** H2 (i): the same street — the same GSI line, the same width straight on, the same width leaving a shared node alike. */
export function isSameStreet(graph: RoadGraph, a: Segment, b: Segment): boolean {
  if (a.line === b.line) return true;
  const isSameWidth = b.line.width === a.line.width;
  if (!isSameWidth) return false;
  return straightNode(graph, a, b) !== null || leavesAlike(graph, a, b);
}""",
)
rep(
    """  samples: readonly LaneSample[],
  travel?: -1 | 0 | 1,
) => {""",
    """  samples: readonly LaneSample[],
  travel?: -1 | 0 | 1,
  gate?: "strict" | "L" | "G",
) => {""",
)
rep(
    """  return (seg, samples, travel = seg.onewayRule?.dir ?? seg.line.oneway) => {""",
    """  return (seg, samples, travel = seg.onewayRule?.dir ?? seg.line.oneway, gate = "strict") => {""",
)
rep(
    """        let isMutual = mutual.get(hit.owner);
        if (isMutual === undefined) {
          const isParallel = (dx: number, dz: number) => Math.abs(dx * hit.dx + dz * hit.dz) > PARALLEL;
          isMutual = streets.nearest(wx, wz, reach, isParallel)?.owner === seg;
          mutual.set(hit.owner, isMutual);
        }
        if (!isMutual) continue;""",
    """        let isMutual = gate === "L" ? true : mutual.get(hit.owner);
        if (gate === "G") {
          // Per sample (G3): the owner nearest this sample's way point, then (i) or (ii).
          const isParallel = (dx: number, dz: number) => Math.abs(dx * hit.dx + dz * hit.dz) > PARALLEL;
          const other = streets.nearest(wx, wz, reach, isParallel);
          const owner = other?.owner;
          const bound = owner ? (EXP.G === "room" ? streetRoom(owner.line.width, 0).room : owner.line.width) : 0;
          isMutual =
            owner === undefined ||
            owner === seg ||
            isSameStreet(graph, seg, owner) ||
            (other !== null && other.dist > bound / 2);
        } else if (isMutual === undefined) {
          const isParallel = (dx: number, dz: number) => Math.abs(dx * hit.dx + dz * hit.dz) > PARALLEL;
          isMutual = streets.nearest(wx, wz, reach, isParallel)?.owner === seg;
          mutual.set(hit.owner, isMutual);
        }
        if (!isMutual) continue;""",
)
rep(
    """    const isVotedOneWay = Math.abs(votes) >= majority;
    if (rule && isVotedOneWay && !isOsmDividedTwoWay(seg, rule, samples)) {
      seg.onewayRule = { dir: votes > 0 ? 1 : -1, time: rule };
    }""",
    """    const isVotedOneWay = Math.abs(votes) >= majority;
    const jarticLanes = laneVotes >= majority ? laneCount : null;
    let gateUsed: "strict" | "L" | "G" = "strict";
    if (rule && isVotedOneWay) {
      const isStrict = isOsmDividedTwoWay(seg, rule, samples);
      const loose: "L" | "G" = EXP.G === "off" ? "L" : "G";
      const isGsiTwoWayAllDay = seg.line.oneway === 0 && isAllDay(rule);
      const isLoose = !isStrict && EXP.L && isGsiTwoWayAllDay && osmLanes(seg, samples, 0, loose).isDivided;
      if (isLoose) gateUsed = loose;
      const isReturn = isStrict || isLoose;
      const isNarrow = isReturn && EXP.narrow && isTooNarrow(seg, samples, jarticLanes, gateUsed);
      if (isNarrow) EXP_OUT.narrowKept.push(seg.id);
      if (isReturn && !isNarrow && isLoose) EXP_OUT.byLoose.push(seg.id);
      if (!isReturn || isNarrow) {
        seg.onewayRule = { dir: votes > 0 ? 1 : -1, time: rule };
        gateUsed = "strict";
      }
    }""",
)
rep(
    """      const evidence: LaneEvidence = {
        ...osmLanes(seg, samples).evidence,
        jartic: laneVotes >= majority ? laneCount : null,
      };""",
    """      const evidence: LaneEvidence = {
        ...osmLanes(seg, samples, undefined, gateUsed).evidence,
        jartic: jarticLanes,
      };""",
)
rep(
    """  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    // Only what JARTIC decides is reset""",
    """  const isTooNarrow = (seg: Segment, samples: readonly LaneSample[], jartic: number | null, gate: "strict" | "L" | "G") => {
    const evidence: LaneEvidence = { ...osmLanes(seg, samples, 0, gate).evidence, jartic };
    return resolveSection(seg.line.width, 0, evidence).laneWidth < NARROWEST_LANE.value;
  };
  EXP_OUT.byLoose = [];
  EXP_OUT.narrowKept = [];
  const pos = new Vector3();
  const dir = new Vector3();
  for (const seg of graph.segments) {
    // Only what JARTIC decides is reset""",
)
open("src/world/regulations.exp.ts", "w").write(s)
print("ok")
