// P2.7 R1-2b PR 1 (追記 3 F3 1, 追記 4 K4 5): the islands of the game's street network round the
// sites, and the ones the same-road rule (M1, α) makes. Read only. One window per tile holding an
// at-grade chunk's middle (as scripts/measureSameRoad.ts): the 3 × 3 z16 road tiles round it and the
// chunks within GRAPH_RADIUS_M of its centre, joined by joinExpressway and built into a RoadGraph.
// An island is a component of the graph other than the largest; "edge" when a point of it lies
// within EXTENT_MARGIN_M of the graph's extent (the window cuts it), else "inside" (closed in the
// window; inside in any window counts as inside). Islands are matched across windows by their
// segments' end points. Made by the rule: an island that joins the largest component once what the
// rule took out (sameRoadGaps on the lines as streetsAtSites hands them over) is put back. One JSON
// log line (street_same_road_islands_counted) and --out <file> with every island.
// Run: pnpm exec tsx scripts/expresswaySameRoadIslands.ts <dir|label> [--out <file>]
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ST, STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { tileXToLon, tileYToLat } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import {
  expresswayRoadInput,
  joinExpressway,
  sameRoadGaps,
  streetsAtSites,
} from "../src/world/expresswayRoads.ts";
import { isEnterable, isExpressway, sourceOf } from "../src/world/roadClass.ts";
import { RoadGraph, type RoadLine, type Segment } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, widthBoundsOf, WIDTH_CLASSES } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { gsiTileReader, roadTileOf } from "./gameStreets.ts";

/** src/world/expresswayDeck.ts GRAPH_RADIUS_M; and expresswayRoads.ts EXTENT_MARGIN_M (not exported). */
const GRAPH_RADIUS_M = 1300;
const EDGE_M = 60;

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args[0] ?? "public/data/expressway";
const files = readExpresswayFiles(
  target.includes("/") ? join(ROOT, target) : join(ROOT, ".cache", "expressway-area", target),
);
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];
const read = gsiTileReader(join(ROOT, ".cache", "gsi-vector"));
const isAtGrade = (c: XwChunk) => c.structure === "embankment" || c.structure === "cut";
const centres = new Set<string>();
for (const c of files.chunks.filter(isAtGrade)) {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  centres.add(roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-"));
}
/** The class of a GSI width (its index in WIDTH_CLASSES), or the exact width. */
const classOf = (line: RoadLine) => {
  if (isExpressway(line)) return `${sourceOf(line)} expressway`;
  const k = WIDTH_CLASSES.findIndex(
    (c) => c.lower === widthBoundsOf(line.width).lower && c.given === line.width,
  );
  return k >= 0 ? `class ${k}` : `w${line.width}`;
};

type Island = {
  key: string;
  kind: "edge" | "inside";
  madeByRule: boolean;
  at: string;
  segments: number;
  lengthM: number;
  widths: Record<string, number>;
  enterable: boolean;
  windows: string[];
};
const islands = new Map<string, Island>();
/**
 * Road tiles a window wanted that the cache does not have (counted, and the run fails on any). Why
 * not read them as empty, as before: a window with an empty tile is a network with a hole in it, and
 * nothing said so (#128's review M1: 326 of central's 897 tiles were missing).
 */
const missingTiles = new Set<string>();
let windows = 0;
/** Components of a graph's segments (undirected): each component's segments, the largest first. */
function components(graph: RoadGraph): Segment[][] {
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let r = n;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  for (const seg of graph.segments) {
    if (!parent.has(seg.from)) parent.set(seg.from, seg.from);
    if (!parent.has(seg.to)) parent.set(seg.to, seg.to);
    parent.set(find(seg.from), find(seg.to));
  }
  const by = new Map<number, Segment[]>();
  for (const seg of graph.segments) by.set(find(seg.from), [...(by.get(find(seg.from)) ?? []), seg]);
  return [...by.values()].toSorted((a, b) => b.length - a.length);
}
const keyOfSegments = (segs: Segment[]) =>
  [
    ...new Set(
      segs
        .flatMap((seg) => [seg.line.coords.slice(0, 2), seg.line.coords.slice(-2)])
        .map(([a, b]) => `${b.toFixed(5)},${a.toFixed(5)}`),
    ),
  ]
    .toSorted()
    .join(";");

for (const centre of centres) {
  const [cx, cy] = centre.split("-").map(Number);
  const tiles: RoadLine[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = await read(cx + dx, cy + dy);
      if (t === null) missingTiles.add(`${cx + dx}-${cy + dy}`);
      else tiles.push(...t);
    }
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= GRAPH_RADIUS_M) return true;
    return false;
  });
  const xw = expresswayRoadInput(near, runs, (_a, _b, h) => h);
  const hasNoChunks = xw.lines.length === 0;
  if (hasNoChunks) continue;
  windows++;
  const frame = new LocalFrame(lat, lon, 0);
  const graph = new RoadGraph(
    joinExpressway(tiles, xw, () => {}),
    frame,
    () => {},
  );
  // What the rule took out, as lines: put back, does an island join the largest component?
  const { cut, xy } = streetsAtSites(tiles, xw, () => {});
  const takenBack: RoadLine[] = [];
  for (const t of sameRoadGaps(cut, xw.sites ?? [], xy)) {
    const line = cut[t.judgement.street];
    const along = [0];
    for (let i = 2; i + 1 < line.coords.length; i += 2) {
      const [ax, ay] = xy(line.coords[i - 2], line.coords[i - 1]);
      const [bx, by] = xy(line.coords[i], line.coords[i + 1]);
      along.push(along.at(-1)! + Math.hypot(bx - ax, by - ay));
    }
    const total = along.at(-1)!;
    for (const [g0, g1] of t.gaps) {
      const [a, b] = [Math.max(0, g0), Math.min(total, g1)];
      const at = (l: number) => {
        let i = 0;
        while (i + 2 < along.length && along[i + 1] < l) i++;
        const u = (l - along[i]) / (along[i + 1] - along[i] || 1);
        const k = i * 2;
        return [
          line.coords[k] + (line.coords[k + 2] - line.coords[k]) * u,
          line.coords[k + 1] + (line.coords[k + 3] - line.coords[k + 1]) * u,
        ];
      };
      const coords = [...at(a)];
      for (let i = 0; i < along.length; i++)
        if (along[i] > a && along[i] < b) coords.push(line.coords[i * 2], line.coords[i * 2 + 1]);
      coords.push(...at(b));
      takenBack.push({ ...line, coords });
    }
  }
  const before = components(
    new RoadGraph([...joinExpressway(tiles, xw, () => {}), ...takenBack], frame, () => {}),
  );
  const largestBefore = new Set(
    before[0]?.flatMap((seg) => [
      seg.line.coords.slice(0, 2).join(","),
      seg.line.coords.slice(-2).join(","),
    ]) ?? [],
  );
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const seg of graph.segments)
    for (const p of seg.pts)
      [minX, maxX, minZ, maxZ] = [
        Math.min(minX, p.x),
        Math.max(maxX, p.x),
        Math.min(minZ, p.z),
        Math.max(maxZ, p.z),
      ];
  const [, ...rest] = components(graph);
  for (const segs of rest) {
    const isEdge = segs.some((seg) =>
      seg.pts.some(
        (p) => p.x < minX + EDGE_M || p.x > maxX - EDGE_M || p.z < minZ + EDGE_M || p.z > maxZ - EDGE_M,
      ),
    );
    const kind = isEdge ? "edge" : "inside";
    const key = keyOfSegments(segs);
    const madeByRule = segs.some(
      (seg) =>
        largestBefore.has(seg.line.coords.slice(0, 2).join(",")) ||
        largestBefore.has(seg.line.coords.slice(-2).join(",")),
    );
    const prev = islands.get(key);
    if (prev) {
      prev.windows.push(`${centre}:${kind}`);
      prev.madeByRule ||= madeByRule;
      continue;
    }
    const widths: Record<string, number> = {};
    for (const seg of segs) widths[classOf(seg.line)] = (widths[classOf(seg.line)] ?? 0) + 1;
    islands.set(key, {
      key,
      kind,
      madeByRule,
      at: key.split(";")[0],
      segments: segs.length,
      lengthM: Math.round(segs.reduce((n, s) => n + s.length, 0)),
      widths,
      enterable: segs.some((s) => isEnterable(s.line)),
      windows: [`${centre}:${kind}`],
    });
  }
}
const list = [...islands.values()];
for (const i of list) i.kind = i.windows.some((w) => w.endsWith(":inside")) ? "inside" : "edge";
const tally = (f: (i: Island) => boolean) => {
  const s = list.filter(f);
  return { count: s.length, lengthM: s.reduce((n, i) => n + i.lengthM, 0) };
};
const summary = {
  dir: target,
  missingTiles: missingTiles.size,
  windows,
  edge: tally((i) => i.kind === "edge"),
  inside: tally((i) => i.kind === "inside"),
  insideClass0Only: tally((i) => i.kind === "inside" && Object.keys(i.widths).join() === "class 0"),
  madeByRule: tally((i) => i.madeByRule),
  madeByRuleAt: list.filter((i) => i.madeByRule).map((i) => i.at),
};
log("street_same_road_islands_counted", summary);
const out = flag("out");
if (out !== undefined) await writeFile(out, JSON.stringify({ summary, islands: list }, null, 1) + "\n");
// Fails after the output is written, as the probes do.
const hasMissingTiles = missingTiles.size > 0;
if (hasMissingTiles) process.exitCode = 1;
