import { DEFAULT_LANES, DEFAULT_SPEED } from "./assumptions";
import { haversine } from "./geo";

/**
 * OSM motorway / motorway_link ways normalised into the compiler's input (knowledge/road-redesign-plan.md 4.1), then joined
 * into alignment chains (ways continuing one another through a node, the same ref and the straightest
 * way first) and cut into runs of one structure class. Pure data: the build script reads the pbf and
 * the tests build networks by hand.
 */

export type Structure = "viaduct" | "ground" | "tunnel" | "cut";
export type RoadClass = "expressway" | "ramp";

export type XwNode = {
  id: number;
  lon: number;
  lat: number;
  /** motorway_junction name / ref (出入口・JCT 名), kept as in OSM. */
  junctionName: string | null;
  junctionRef: string | null;
};

export type XwWay = {
  id: number;
  nodes: number[];
  cls: RoadClass;
  ref: string | null;
  /** A name without the operator's (e.g. "宝町出口"); names carrying it are dropped. */
  name: string | null;
  destination: string | null;
  destinationRef: string | null;
  lanes: number;
  /** OSM maxspeed, or the default (assumptions.DEFAULT_SPEED). */
  speedKmh: number;
  structure: Structure;
  /** OSM layer (layerOf): orders decks where they cross or run over one another. */
  layer: number;
};

export type Network = { ways: Map<number, XwWay>; nodes: Map<number, XwNode> };

/**
 * Words that name the real operator. The game calls it by a fictional name (i18n), so none of these
 * may survive into the data (tests/expresswayData.test.ts checks the tiles).
 */
export const OPERATOR_WORDS = ["首都高", "Shuto", "Metropolitan Expressway", "首都高速"] as const;

const hasOperator = (text: string) =>
  OPERATOR_WORDS.some((w) => text.toLowerCase().includes(w.toLowerCase()));
const clean = (text: string | undefined): string | null => {
  const isUsable = text !== undefined && text.trim() !== "" && !hasOperator(text);
  return isUsable ? text : null;
};

/** Structure from OSM tags. A layer above 0 without a bridge tag is still a viaduct here. */
export function structureOf(tags: Record<string, string>): Structure {
  const layer = Number.parseInt(tags.layer ?? "0", 10) || 0;
  const isTunnel = (tags.tunnel ?? "no") !== "no" || tags.covered === "yes";
  if (isTunnel) return "tunnel";
  const isCut = tags.cutting === "yes" || layer < 0;
  if (isCut) return "cut";
  const isBridge = (tags.bridge ?? "no") !== "no" || layer > 0;
  return isBridge ? "viaduct" : "ground";
}

/**
 * OSM layer, with a bridge that has no layer tag taken as layer 1 (OSM's implied layer for
 * bridges), so it orders above a ground road and level with other untagged bridges.
 */
export function layerOf(tags: Record<string, string>): number {
  const tagged = Number.parseInt(tags.layer ?? "", 10);
  const hasLayer = Number.isFinite(tagged);
  if (hasLayer) return tagged;
  const isBridge = (tags.bridge ?? "no") !== "no";
  return isBridge ? 1 : 0;
}

export function normalizeWay(id: number, nodes: number[], tags: Record<string, string>): XwWay {
  const cls: RoadClass = tags.highway === "motorway_link" ? "ramp" : "expressway";
  const isRamp = cls === "ramp";
  const lanesTag = Number.parseInt(tags.lanes ?? "", 10);
  const speedTag = Number.parseInt(tags.maxspeed ?? "", 10);
  const defaults = DEFAULT_LANES.value;
  const speeds = DEFAULT_SPEED.value;
  return {
    id,
    nodes,
    cls,
    ref: clean(tags.ref),
    name: clean(tags.name),
    destination: clean(tags.destination),
    destinationRef: clean(tags["destination:ref"]),
    lanes: lanesTag > 0 ? lanesTag : isRamp ? defaults.ramp : defaults.main,
    speedKmh: speedTag > 0 ? speedTag : isRamp ? speeds.ramp : speeds.main,
    structure: structureOf(tags),
    layer: layerOf(tags),
  };
}

export function normalizeNode(id: number, lon: number, lat: number, tags: Record<string, string>): XwNode {
  return { id, lon, lat, junctionName: clean(tags.name), junctionRef: clean(tags.ref) };
}

export type Chain = {
  /** "c" + the first way's id (the smallest id for a closed loop): stable across ranges. */
  id: string;
  ways: number[];
  /** Node ids along the chain, joins not repeated. */
  nodes: number[];
  /** Index into `nodes` where each way starts. */
  wayStarts: number[];
  closed: boolean;
};

function bearing(net: Network, a: number, b: number): number {
  const p = net.nodes.get(a)!;
  const q = net.nodes.get(b)!;
  const dx = (q.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180);
  return Math.atan2(dx, q.lat - p.lat);
}

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

/** Turns sharper than this never continue a chain. */
const MAX_CONTINUATION = (60 * Math.PI) / 180;

/**
 * Join ways into chains. At every node, the ways ending there are paired with the ways starting
 * there by a score (turn angle, then the same class, then the same ref), greedily and one-to-one,
 * so a way is the continuation of at most one other. Iteration is by ascending way id, which makes
 * the result independent of input order.
 */
export function buildChains(net: Network): Chain[] {
  const ending = new Map<number, number[]>();
  const starting = new Map<number, number[]>();
  const ids = [...net.ways.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const w = net.ways.get(id)!;
    const first = w.nodes[0];
    const last = w.nodes[w.nodes.length - 1];
    starting.set(first, [...(starting.get(first) ?? []), id]);
    ending.set(last, [...(ending.get(last) ?? []), id]);
  }
  const next = new Map<number, number>();
  const prev = new Map<number, number>();
  const nodeIds = [...ending.keys()].sort((a, b) => a - b);
  for (const node of nodeIds) {
    const outs = starting.get(node) ?? [];
    const pairs: Array<{ a: number; b: number; score: number }> = [];
    for (const a of ending.get(node) ?? []) {
      const wa = net.ways.get(a)!;
      const inDir = bearing(net, wa.nodes[wa.nodes.length - 2], node);
      for (const b of outs) {
        if (a === b) continue;
        const wb = net.ways.get(b)!;
        const turn = angleBetween(inDir, bearing(net, node, wb.nodes[1]));
        if (turn > MAX_CONTINUATION) continue;
        const clsPenalty = wa.cls === wb.cls ? 0 : 1;
        const refPenalty = wa.ref === wb.ref ? 0 : 1;
        pairs.push({ a, b, score: turn + clsPenalty * 0.6 + refPenalty * 0.35 });
      }
    }
    pairs.sort((p, q) => p.score - q.score || p.a - q.a || p.b - q.b);
    for (const { a, b } of pairs) {
      const isTaken = next.has(a) || prev.has(b);
      if (isTaken) continue;
      next.set(a, b);
      prev.set(b, a);
    }
  }
  const chains: Chain[] = [];
  const used = new Set<number>();
  const follow = (start: number, closed: boolean) => {
    const ways: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      ways.push(cur);
      cur = next.get(cur);
    }
    const nodes: number[] = [];
    const wayStarts: number[] = [];
    for (const id of ways) {
      const w = net.ways.get(id)!;
      wayStarts.push(Math.max(0, nodes.length - 1));
      nodes.push(...(nodes.length === 0 ? w.nodes : w.nodes.slice(1)));
    }
    chains.push({ id: `c${start}`, ways, nodes, wayStarts, closed });
  };
  for (const id of ids) {
    const isHead = !prev.has(id);
    if (isHead && !used.has(id)) follow(id, false);
  }
  // What is left are loops: start each at its smallest way id.
  for (const id of ids) if (!used.has(id)) follow(id, true);
  return chains;
}

export type Run = {
  /** The first way's id: the run's stable name, and the prefix of its chunk ids. */
  id: string;
  chain: string;
  ways: number[];
  /** Node index range within the chain, inclusive. */
  from: number;
  to: number;
  elevated: boolean;
  /** Ground-looking ways (no tags) that were taken as part of the viaduct around them. */
  filledWays: number[];
};

/** Untagged pieces shorter than this between two viaduct ways are tagging gaps, not ground. */
const GAP_FILL_M = 80;

function wayLength(net: Network, w: XwWay): number {
  let len = 0;
  for (let i = 1; i < w.nodes.length; i++) {
    const a = net.nodes.get(w.nodes[i - 1])!;
    const b = net.nodes.get(w.nodes[i])!;
    len += haversine(a.lon, a.lat, b.lon, b.lat);
  }
  return len;
}

/** Cut a chain into runs where it changes between elevated (viaduct) and not. */
export function splitRuns(net: Network, chain: Chain): Run[] {
  const elevated = chain.ways.map((id) => net.ways.get(id)!.structure === "viaduct");
  const filled = new Set<number>();
  for (let i = 0; i < chain.ways.length; i++) {
    if (elevated[i]) continue;
    let j = i;
    let len = 0;
    while (j < chain.ways.length && !elevated[j] && net.ways.get(chain.ways[j])!.structure === "ground") {
      len += wayLength(net, net.ways.get(chain.ways[j])!);
      j++;
    }
    const isGap =
      j > i && i > 0 && j < chain.ways.length && elevated[i - 1] && elevated[j] && len < GAP_FILL_M;
    if (isGap) {
      for (let k = i; k < j; k++) {
        elevated[k] = true;
        filled.add(chain.ways[k]);
      }
    }
    i = Math.max(i, j - 1);
  }
  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= chain.ways.length; i++) {
    const isBoundary = i === chain.ways.length || elevated[i] !== elevated[start];
    if (!isBoundary) continue;
    const ways = chain.ways.slice(start, i);
    const lastWay = net.ways.get(ways[ways.length - 1])!;
    runs.push({
      id: String(ways[0]),
      chain: chain.id,
      ways,
      from: chain.wayStarts[start],
      to: chain.wayStarts[i - 1] + lastWay.nodes.length - 1,
      elevated: elevated[start],
      filledWays: ways.filter((w) => filled.has(w)),
    });
    start = i;
  }
  return runs;
}
