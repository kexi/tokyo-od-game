// OSM signal nodes with the facts the game keeps (src/signals/osmTags.ts): whether each is a
// pedestrian crossing's signal, how far it is from a car-road junction, and its button, sound and
// direction tags. Used by scripts/regulations.ts (the tiles) and scripts/signal-tags.ts (the census).
import { readNodeCoords, readTaggedNodes, readWays, type OsmNode, type OsmWay } from "./osm-pbf.ts";
import { buttonOf, soundOf, type SignalNodeFacts } from "../src/signals/osmTags.ts";
import { SIGNAL_JUNCTION_M } from "../src/signals/siting.ts";

/**
 * Car roads for the junction test. Why not service: driveways and car-park aisles meet roads every
 * few metres, and a crossing by a petrol station's entrance is still a 単路 one.
 */
const CAR_ROAD =
  /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/;
/** Metres per degree of latitude (and of longitude × cos lat): plenty for a 25 m test. */
const M_PER_DEG = 111_320;

/** Metres between two lon/lat points (flat-earth: the distances here are tens of metres). */
const metres = (a: [number, number], b: [number, number]) =>
  Math.hypot((b[0] - a[0]) * M_PER_DEG * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * M_PER_DEG);

/** A node on a signal: highway=traffic_signals, or a crossing tagged with signals. */
export const isSignalNode = (t: Record<string, string>): boolean =>
  t.highway === "traffic_signals" || isCrossingSignal(t);
/** crossing=traffic_signals (also inside a list, "traffic_signals;marked") or crossing:signals=yes. */
export const isCrossingSignal = (t: Record<string, string>): boolean =>
  (t.crossing ?? "").split(";").includes("traffic_signals") || t["crossing:signals"] === "yes";

export type SignalNode = { node: OsmNode; facts: SignalNodeFacts; onCarRoad: boolean; junctionM: number };

/** Every signal node in the box of an OSM extract, with its facts (classifySignalNodes). */
export function readSignalNodes(
  file: Uint8Array,
  inBbox: (lon: number, lat: number) => boolean,
): SignalNode[] {
  const nodes = readTaggedNodes(file, isSignalNode).filter((n) => inBbox(n.lon, n.lat));
  const ways = readWays(file, (t) => CAR_ROAD.test(t.highway ?? ""));
  return classifySignalNodes(nodes, ways, (ids) => readNodeCoords(file, ids), inBbox);
}

/**
 * The facts of each signal node, from the car-road ways and a lookup of node coordinates (the
 * extract, or a fixture in the tests). `junctionM` is the distance to the nearest other car-road
 * junction node (0 when the node is one): a node shared by three or more way ends or passes,
 * counting a way's inner nodes twice. Ways that are not car roads are ignored.
 */
export function classifySignalNodes(
  nodes: readonly OsmNode[],
  allWays: readonly OsmWay[],
  coordsOf: (ids: Set<number>) => Map<number, [number, number]>,
  inBbox: (lon: number, lat: number) => boolean,
): SignalNode[] {
  const ways = allWays.filter((w) => CAR_ROAD.test(w.tags.highway ?? ""));
  const degree = new Map<number, number>();
  for (const w of ways)
    w.refs.forEach((r, i) =>
      degree.set(r, (degree.get(r) ?? 0) + (i === 0 || i === w.refs.length - 1 ? 1 : 2)),
    );
  const signalIds = new Set(nodes.map((n) => n.id));
  // The car way through each signal node and its neighbours there, for the direction tag.
  const through = new Map<number, { prev: number; next: number }>();
  for (const w of ways)
    w.refs.forEach((r, i) => {
      if (!signalIds.has(r) || through.has(r)) return;
      through.set(r, { prev: w.refs[Math.max(0, i - 1)], next: w.refs[Math.min(w.refs.length - 1, i + 1)] });
    });
  const junctionIds = new Set([...degree].filter(([, d]) => d >= 3).map(([id]) => id));
  const neighbourIds = new Set([...through.values()].flatMap((t) => [t.prev, t.next]));
  const coords = coordsOf(new Set([...junctionIds, ...neighbourIds]));
  // Junctions in ~55 m cells, so each signal looks at its 3 × 3 cells only.
  const CELL = 0.0005;
  const cellKey = (lon: number, lat: number) => `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
  const grid = new Map<string, Array<[number, number]>>();
  for (const id of junctionIds) {
    const c = coords.get(id);
    if (!c || !inBbox(c[0], c[1])) continue;
    const key = cellKey(c[0], c[1]);
    grid.set(key, [...(grid.get(key) ?? []), c]);
  }
  const nearestJunction = (n: OsmNode) => {
    if (junctionIds.has(n.id)) return 0;
    const cx = Math.floor(n.lon / CELL);
    const cy = Math.floor(n.lat / CELL);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const c of grid.get(`${cx + dx},${cy + dy}`) ?? [])
          best = Math.min(best, metres([n.lon, n.lat], c));
    return best;
  };
  const bearingOf = (n: OsmNode): number | null => {
    const dir = n.tags["traffic_signals:direction"];
    const way = through.get(n.id);
    const isAlongWay = dir === "forward" || dir === "backward";
    if (!isAlongWay || !way) return null;
    const a = coords.get(way.prev) ?? [n.lon, n.lat];
    const b = coords.get(way.next) ?? [n.lon, n.lat];
    const dx = (b[0] - a[0]) * Math.cos((n.lat * Math.PI) / 180);
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return null;
    const forward = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    return Math.round(dir === "forward" ? forward : (forward + 180) % 360);
  };
  return nodes.map((node) => {
    const junctionM = nearestJunction(node);
    const onCarRoad = through.has(node.id);
    return {
      node,
      onCarRoad,
      junctionM,
      facts: {
        // Exactly, as the tiles always took it: "traffic_signals;crossing" (2 nodes in the 23 wards)
        // stays a crossing, so the junction records are the same set as before T3.
        isHighwaySignal: node.tags.highway === "traffic_signals",
        isCrossing: isCrossingSignal(node.tags),
        awayFromJunction: onCarRoad && junctionM > SIGNAL_JUNCTION_M,
        button: buttonOf(node.tags),
        sound: soundOf(node.tags),
        bearing: bearingOf(node),
      },
    };
  });
}

/**
 * Whether the tiles keep a node: every highway=traffic_signals node (as before T3), and of the
 * crossing nodes tagged only as crossings those on a car road that are 単路 (mid-block) or carry a
 * sound tag (which says how the crosswalk's 音響式 runs). Why not every crossing node: the ~17,000
 * crossings next to junctions would only repeat what the junction's own node says.
 */
export function isKept(s: SignalNode): boolean {
  if (s.facts.isHighwaySignal) return true;
  if (!s.onCarRoad) return false;
  return s.facts.awayFromJunction || s.facts.sound !== null;
}
