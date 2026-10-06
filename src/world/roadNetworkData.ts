import { Vector3 } from "three";
import type { RoadNetworkPacket } from "./roadNetworkPacket";
import { LocalFrame } from "../geo/frame";
import type { Geodetic } from "../geo/ellipsoid";
import { RoadGraph, type RoadGraphSnapshot, type RoadGraphBuffers, type RoadLine } from "./roads";
import {
  applyRegulations,
  type AppliedRegulations,
  type RegulationData,
  type RegulationDiagnostic,
  type StopLine,
} from "./regulations";

type Point = [number, number, number];
type WireStop = Omit<StopLine, "seg" | "pos"> & { seg: number; pos: Point };
type WireApplied = {
  crossings: Array<{ seg: number; s: number; pos: Point }>;
  signs: Array<
    Omit<AppliedRegulations["signs"][number], "seg" | "pos" | "travel"> & {
      seg: number;
      pos: Point;
      travel: Point;
    }
  >;
  turnRules: Array<Omit<AppliedRegulations["turnRules"][number], "approach"> & { approach: number }>;
  stops: WireStop[];
  stopLineCount: number;
  stopSigns: Array<{ pos: Point; line: number }>;
  signals: Point[];
  junctionNames: Array<{ pos: Point; name: string; en: string }>;
  footbridges: Array<{ width: number; deck: Point[]; stairs: Point[][] }>;
  laneUse: Array<Omit<AppliedRegulations["laneUse"][number], "seg"> & { seg: number }>;
  hasMarkings: boolean;
};
export type RoadNetworkInput = { lines: RoadLine[]; regs: RegulationData | null; origin: Geodetic };
export type RoadNetworkData = {
  graph: RoadGraphSnapshot;
  applied: WireApplied | null;
  diagnostics: RegulationDiagnostic[];
  computeMs: number;
};
export type RoadNetworkRestorable = Omit<RoadNetworkData, "graph"> & {
  graph: RoadGraphSnapshot | RoadGraphBuffers;
};
export type RoadNetwork = { graph: RoadGraph; applied: AppliedRegulations | null };
export type RoadNetworkRequest = { id: number; input: RoadNetworkInput };
export type RoadNetworkReply =
  | { id: number; data: RoadNetworkData | RoadNetworkPacket; packMs?: number }
  | { id: number; error: string };

const point = (p: Vector3): Point => [p.x, p.y, p.z];
const vector = (p: Point): Vector3 => new Vector3(...p);

export function computeRoadNetwork(input: RoadNetworkInput): RoadNetworkData {
  const start = performance.now();
  const { lat, lon, h } = input.origin;
  const frame = new LocalFrame(lat, lon, h);
  const graph = new RoadGraph(input.lines, frame);
  const diagnostics: RegulationDiagnostic[] = [];
  const applied = input.regs ? applyRegulations(graph, input.regs, frame, (d) => diagnostics.push(d)) : null;
  const data = { graph: graph.snapshot(), applied: applied ? packApplied(applied) : null, diagnostics };
  return { ...data, computeMs: performance.now() - start };
}

function packApplied(applied: AppliedRegulations): WireApplied {
  // A sign without a mapped stop line has its own resolved line; preserve shared lines too.
  const stops = [...applied.stopLines];
  const stopIds = new Map(stops.map((line, i) => [line, i]));
  const stopSigns = applied.stopSigns.map((sign) => {
    let id = stopIds.get(sign.line);
    const isUnlisted = id === undefined;
    if (isUnlisted) {
      id = stops.length;
      stops.push(sign.line);
      stopIds.set(sign.line, id);
    }
    return { pos: point(sign.pos), line: id! };
  });
  return {
    crossings: applied.crossings.map((c) => ({ ...c, seg: c.seg.id, pos: point(c.pos) })),
    signs: applied.signs.map((s) => ({ ...s, seg: s.seg.id, pos: point(s.pos), travel: point(s.travel) })),
    turnRules: applied.turnRules.map((r) => ({ ...r, approach: r.approach.id })),
    stops: stops.map((s) => ({ ...s, seg: s.seg.id, pos: point(s.pos) })),
    stopLineCount: applied.stopLines.length,
    stopSigns,
    signals: applied.signals.map(point),
    junctionNames: applied.junctionNames.map((n) => ({ ...n, pos: point(n.pos) })),
    footbridges: applied.footbridges.map((b) => ({
      ...b,
      deck: b.deck.map(point),
      stairs: b.stairs.map((s) => s.map(point)),
    })),
    laneUse: applied.laneUse.map((l) => ({ ...l, seg: l.seg.id })),
    hasMarkings: applied.hasMarkings,
  };
}

export function restoreRoadNetwork(data: RoadNetworkRestorable, frame: LocalFrame): RoadNetwork {
  const graph = RoadGraph.restore(data.graph, frame);
  const a = data.applied;
  const hasNoRegulations = a === null;
  if (hasNoRegulations) return { graph, applied: null };
  const stops = a.stops.map((s) => ({ ...s, seg: graph.segments[s.seg], pos: vector(s.pos) }));
  return {
    graph,
    applied: {
      crossings: a.crossings.map((c) => ({ ...c, seg: graph.segments[c.seg], pos: vector(c.pos) })),
      signs: a.signs.map((s) => ({
        ...s,
        seg: graph.segments[s.seg],
        pos: vector(s.pos),
        travel: vector(s.travel),
      })),
      turnRules: a.turnRules.map((r) => ({ ...r, approach: graph.segments[r.approach] })),
      stopLines: stops.slice(0, a.stopLineCount),
      stopSigns: a.stopSigns.map((s) => ({ pos: vector(s.pos), line: stops[s.line] })),
      signals: a.signals.map(vector),
      junctionNames: a.junctionNames.map((n) => ({ ...n, pos: vector(n.pos) })),
      footbridges: a.footbridges.map((b) => ({
        ...b,
        deck: b.deck.map(vector),
        stairs: b.stairs.map((s) => s.map(vector)),
      })),
      laneUse: a.laneUse.map((l) => ({ ...l, seg: graph.segments[l.seg] })),
      hasMarkings: a.hasMarkings,
    },
  };
}
