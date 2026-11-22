// P2.7 R1-2b PR 1 (M1, α): one row a GSI street line that the same-road rule
// (src/world/expresswayRoads.ts sameRoadStretches) would take out, to judge what the rule removes
// before it is fixed (r1-2b-pr1-review0.md 3 節). Read only. For every group of site chunks whose
// middles share a z16 tile, the streets of the 3 × 3 tiles round it as read, and per line with a
// stretch: its fragments and the gaps between them; how long it runs along the same connected site
// (the run's adjacent embankment and cut chunks as one), two ways (its 幅員 reaching the site's
// band, its centre line inside the band); the centre line's distance from the site's and the angle;
// how its stretch along the site starts and ends (the line's end, the site's end, the street turning
// off to the left or right of the site); where the line goes on at its ends; whether taking out the
// whole stretch along the site leaves its two sides joined by other streets (through traffic); and,
// from the other build's lists (--before <dir>: the lanes and hole probes' --cases, the feet probe's
// --joins, a sections dump, each from a checkout without the rule), the probe cases, the feet and
// the lanes as they were. One JSON log line (street_same_road_measured) and --out <file>.
// Run: pnpm exec tsx scripts/measureSameRoad.ts <dir|label> --before <prefix> --after <prefix> [--out <file>]
// (<prefix>-pl.json / -ph.json / -joins.json / -sec.json: written by the probes and the dump).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Vector3 } from "three";
import { ST, STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { tileXToLon, tileYToLat } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import {
  expresswayRoadInput,
  sameRoadJudgements,
  streetsAtSites,
  type XwSite,
} from "../src/world/expresswayRoads.ts";
import { RoadGraph, type RoadLine, vertexKey } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM, WIDTH_CLASSES, widthBoundsOf } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { gsiTileReader, roadTileOf } from "./gameStreets.ts";

const ROOT = join(import.meta.dirname, "..");
/** The decks the game joins round a point (expresswayDeck.ts GRAPH_RADIUS_M; not exported there). */
const GRAPH_RADIUS_M = 1300;
/** expresswayRoads.ts's SITE_CROSSING_MIN_DEG and SITE_CLEARANCE_M (not exported there). */
const ALONG_DEG = 30;
const CLEARANCE_M = 1;
/** A side of a cut line this near the edge of the streets read has its detour out of reach (m). */
const EDGE_M = 60;
/**
 * The through-traffic test reads this many z16 tiles round the group's (5 × 5: one tile more each
 * way than the game's 3 × 3), so a detour just outside the game's window is found (追記 1 B4).
 */
const THROUGH_REACH_TILES = 2;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--out", "--before", "--after", "--cache"]);
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1])));
if (target === undefined)
  throw new Error("usage: measureSameRoad.ts <dir|label> --before <prefix> --after <prefix>");
const dataDir = target.includes("/") ? target : join(ROOT, ".cache", "expressway-area", target);
const files = readExpresswayFiles(dataDir);
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];
const streetsOf = gsiTileReader(flag("cache") ?? join(ROOT, ".cache", "gsi-vector"));
const readJson = async <T>(path: string | undefined): Promise<T | null> =>
  path === undefined
    ? null
    : ((await readFile(path, "utf8")
        .then((text) => JSON.parse(text) as T)
        .catch(() => null)) as T | null);
type PlaceCase = { run: string; chunk: string; s0: number; s1: number; lengthM: number; streetM: number };
type HoleCase = { run: string; lanes: Array<{ widthM: number; lengthM: number }> };
type Join = { run: string; end: string; rule: string; street: string | null };
type SectionRow = {
  seg: string;
  line: string;
  widthM: number;
  lengthM: number;
  lanes: number;
  travel: number;
  basis: string;
};
const lists = async (prefix: string | undefined) => ({
  places: (await readJson<PlaceCase[]>(prefix && `${prefix}-pl.json`)) ?? [],
  holes: (await readJson<HoleCase[]>(prefix && `${prefix}-ph.json`)) ?? [],
  joins: (await readJson<Join[]>(prefix && `${prefix}-joins.json`)) ?? [],
  sections: (await readJson<SectionRow[]>(prefix && `${prefix}-sec.json`)) ?? [],
});
const before = await lists(flag("before"));
const after = await lists(flag("after"));

// The connected sites: a run's adjacent embankment and cut chunks as one.
const isAtGrade = (c: XwChunk) => c.structure === "embankment" || c.structure === "cut";
const byId = new Map(files.chunks.map((c) => [c.id, c]));
const siteOf = new Map<string, string>();
for (const c of files.chunks.filter(isAtGrade)) {
  if (siteOf.has(c.id)) continue;
  let first = c;
  while (first.prev && byId.get(first.prev) && isAtGrade(byId.get(first.prev)!))
    first = byId.get(first.prev)!;
  const ids: string[] = [];
  for (let k: XwChunk | undefined = first; k && isAtGrade(k); k = k.next ? byId.get(k.next) : undefined)
    ids.push(k.id);
  for (const id of ids) siteOf.set(id, `${first.run}:${first.id}..${ids.at(-1)}`);
}

const r6 = (v: number) => Number(v.toFixed(6));
const round = (v: number, k = 100) => Math.round(v * k) / k;
const median = (vs: number[]) => {
  if (vs.length === 0) return null;
  const s = vs.toSorted((a, b) => a - b);
  return round(s[Math.floor(s.length / 2)]);
};
const lineKey = (l: RoadLine) => {
  const c = l.coords;
  return `${c[1].toFixed(6)},${c[0].toFixed(6)}|${c[c.length - 1].toFixed(6)},${c[c.length - 2].toFixed(6)}`;
};
const classOf = (width: number) => {
  const { lower } = widthBoundsOf(width);
  const k = WIDTH_CLASSES.findIndex((c) => c.lower === lower && c.given === width);
  return k >= 0 ? k : null;
};

type Sample = {
  l: number;
  u: number | null;
  across: number;
  half: number;
  angle: number;
  chunk: string | null;
};
type Row = {
  line: string;
  twins: number;
  at: [number, number];
  site: string;
  chunks: string[];
  widthM: number;
  widthClass: number | null;
  /** The class's least width over two (the rule's half width), and the site's band (2 × across). */
  ruleHalfM: number;
  bandWidthM: number | null;
  fragments: number[];
  gaps: number[];
  /** Along the same connected site: the 幅員 reaching the band, and the centre line inside it (m). */
  alongWidthM: number;
  alongCentreM: number;
  ratioToWidth: number | null;
  ratioToCentre: number | null;
  offsetM: { median: number | null; most: number | null; outsideMedian: number | null };
  /** Class 0 only: the centre line's distance past the slab's edge (− inside the slab). */
  edgeM: number | null;
  angleDeg: { median: number | null; most: number | null };
  ends: [string, string];
  next: [string, string];
  /**
   * kept / cut / cut-near-edge: the two places the taken-out stretch joined (the line's pieces either
   * side, or where the stretch reaches the line's end, the other lines meeting there) are still joined
   * by streets, are not, or are not but one side reaches the edge of the streets read (a detour may lie
   * beyond). dead-end: one side has nothing beyond it (no through traffic to cut).
   */
  through: "kept" | "cut" | "cut-near-edge" | "dead-end";
  probes: { before: string[]; after: string[] };
  feet: string[];
  lanes: string[];
  /** Whether the rule's own stretches match the fragments sampled here (the check the table rests on). */
  fragmentsMatch: boolean;
  /** The rule's own counts of the line's samples: along the site, inside, at the foot (15 m). */
  rule: { along: number; inside: number; atFoot: number };
  /** A side of the taken-out stretch left on streets no longer joined to the rest (an island). */
  island: boolean;
  /** Which side is cut off: start (towards the line's first point), end, or none. */
  islandSide: "start" | "end" | null;
};
const rows = new Map<string, Row>();
/** The lines the old rule took (any samples inside) that this one keeps: its verdict and counts. */
const kept = new Map<
  string,
  {
    line: string;
    at: [number, number];
    widthM: number;
    verdict: string;
    along: number;
    inside: number;
    atFoot: number;
  }
>();

const siteChunks = files.chunks.filter(isAtGrade);
const groups = new Map<string, XwChunk[]>();
for (const c of siteChunks) {
  const o = Math.floor(c.st.length / STATION_STRIDE / 2) * STATION_STRIDE;
  const key = roadTileOf(c.st[o + ST.lon], c.st[o + ST.lat]).join("-");
  groups.set(key, [...(groups.get(key) ?? []), c]);
}

for (const [key] of groups) {
  const [cx, cy] = key.split("-").map(Number);
  const tiles: RoadLine[] = [];
  let isMissing = false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = await streetsOf(cx + dx, cy + dy);
      if (t === null) isMissing = true;
      else tiles.push(...t);
    }
  if (isMissing) continue;
  const lat = tileYToLat(cy + 0.5, ROAD_TILE_ZOOM);
  const lon = tileXToLon(cx + 0.5, ROAD_TILE_ZOOM);
  const near = files.chunks.filter((c) => {
    for (let i = 0; i < c.st.length; i += STATION_STRIDE)
      if (haversine(lon, lat, c.st[i + ST.lon], c.st[i + ST.lat]) <= GRAPH_RADIUS_M) return true;
    return false;
  });
  const xw = expresswayRoadInput(near, runs, (_a, _b, h) => h);
  const first = xw.lines[0];
  if (!first) continue;
  // The lines as joinExpressway hands them to the rule (GSI 高速道路 replaced, crossings cut), not the
  // raw tiles: the strands test reads the network the game has (a GSI ramp line it drops is not a street).
  const { cut: streets, xy } = streetsAtSites(tiles, xw, () => {});
  const sites: XwSite[] = xw.sites ?? [];
  const judgements = sameRoadJudgements(streets, sites, xy);
  // The lines the old rule (any samples inside) would have taken out and this one keeps, and why.
  for (const j of judgements) {
    // Every line the rule looked at and kept, so a line going on past an alpha one shows.
    const isKeptNow = j.verdict !== "alpha";
    if (!isKeptNow) continue;
    const st = j.stretches[0];
    const k0 = `${lineKey(streets[j.street])}|${j.chunks.join(",")}`;
    if (!kept.has(k0))
      kept.set(k0, {
        line: lineKey(streets[j.street]),
        at: st.at,
        widthM: streets[j.street].width,
        verdict: j.verdict,
        along: j.along,
        inside: j.inside,
        atFoot: j.atFoot,
      });
  }
  const judgementOf = new Map(judgements.filter((j) => j.verdict === "alpha").map((j) => [j.street, j]));
  const stretches = judgements.filter((j) => j.verdict === "alpha").flatMap((j) => j.stretches);
  if (stretches.length === 0) continue;
  const siteXY = sites.map((s) => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < s.coords.length; i += 2) pts.push(xy(s.coords[i], s.coords[i + 1]));
    return pts;
  });
  const cosMin = Math.cos((ALONG_DEG * Math.PI) / 180);
  /** A street line sampled each metre against the sites of one connected site (null: any). */
  const sampleLine = (street: RoadLine, site: string | null): Sample[] => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < street.coords.length; i += 2)
      pts.push(xy(street.coords[i], street.coords[i + 1]));
    const along = [0];
    for (let q = 1; q < pts.length; q++)
      along.push(along[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
    const out: Sample[] = [];
    let piece = 0;
    for (let l = 0; l <= along.at(-1)!; l += 1) {
      while (piece + 2 < pts.length && along[piece + 1] < l) piece++;
      const [ax, ay] = pts[piece];
      const [bx, by] = pts[piece + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const t = (l - along[piece]) / len;
      const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
      const [tx, ty] = [(bx - ax) / len, (by - ay) / len];
      const [nx, ny] = [-ty, tx];
      let best: Sample = { l, u: null, across: 0, half: 0, angle: 90, chunk: null };
      for (let k = 0; k < sites.length; k++) {
        const isTheSite = site === null || siteOf.get(sites[k].chunk) === site;
        if (!isTheSite) continue;
        for (let j = 0; j + 1 < siteXY[k].length; j++) {
          const [sax, say] = siteXY[k][j];
          const [sbx, sby] = siteXY[k][j + 1];
          const [ex, ey] = [sbx - sax, sby - say];
          const elen = Math.hypot(ex, ey);
          if (elen < 1e-9) continue;
          const cos = Math.abs(tx * ex + ty * ey) / elen;
          const det = -nx * ey + ny * ex;
          if (Math.abs(det) < 1e-9) continue;
          const [rx, ry] = [sax - px, say - py];
          const u = (rx * -ey + ry * ex) / det;
          const v = (nx * ry - ny * rx) / det;
          const isOn = v >= 0 && v <= 1 && Math.abs(u) < 60;
          if (!isOn) continue;
          const angle = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
          const isBetter = best.u === null || Math.abs(u) < Math.abs(best.u);
          if (!isBetter) continue;
          best = {
            l,
            u,
            across: sites[k].halfWidth / Math.max(cos, 1e-3) + CLEARANCE_M,
            half: sites[k].halfWidth,
            angle,
            chunk: sites[k].chunk,
          };
          void cosMin;
        }
      }
      out.push(best);
    }
    return out;
  };
  // The streets as a network without every candidate line's stretch along its site (through traffic).
  const byStreet = new Map<number, typeof stretches>();
  for (const st of stretches) byStreet.set(st.street, [...(byStreet.get(st.street) ?? []), st]);
  const cutRanges = new Map<number, [number, number]>();
  const sampled = new Map<number, Sample[]>();
  for (const [index, list] of byStreet) {
    const site = siteOf.get(list[0].chunk) ?? null;
    const samples = sampleLine(streets[index], site);
    sampled.set(index, samples);
    const isAlong = (s: Sample) =>
      s.u !== null &&
      s.angle < ALONG_DEG &&
      s.u - s.across < streets[index].width / 2 &&
      s.u + s.across > -streets[index].width / 2;
    // The stretch along the site round the rule's stretches: the run of samples along it holding them.
    const l0 = Math.min(...list.map((st) => st.l0));
    const l1 = Math.max(...list.map((st) => st.l1));
    let a = Math.round(l0);
    let b = Math.round(l1);
    while (a - 1 >= 0 && isAlong(samples[a - 1])) a--;
    while (b + 1 < samples.length && isAlong(samples[b + 1])) b++;
    cutRanges.set(index, [a, b]);
  }
  const frame = new LocalFrame(lat, lon, 0);
  const cutLines: RoadLine[] = [];
  const sideNodes = new Map<number, [Vector3 | null, Vector3 | null]>();
  // The streets of the wider window, each alpha line (and its doubles) cut where the rule cuts it.
  const wideTiles: RoadLine[] = [];
  for (let dy = -THROUGH_REACH_TILES; dy <= THROUGH_REACH_TILES; dy++)
    for (let dx = -THROUGH_REACH_TILES; dx <= THROUGH_REACH_TILES; dx++)
      wideTiles.push(...((await streetsOf(cx + dx, cy + dy)) ?? []));
  // As the game has them (the same step as the 3 x 3 lines, so an alpha piece's key matches).
  const wide = streetsAtSites(wideTiles, xw, () => {}).cut;
  const alphaIndexOf = new Map([...cutRanges.keys()].map((i) => [lineKey(streets[i]), i]));
  for (const street of wide) {
    const index = alphaIndexOf.get(lineKey(street));
    const range = index === undefined ? undefined : cutRanges.get(index);
    if (!range) {
      cutLines.push(street);
      continue;
    }
    // Pieces before and after the range, along the line's own points.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < street.coords.length; i += 2) pts.push([street.coords[i], street.coords[i + 1]]);
    const along = [0];
    for (let q = 1; q < pts.length; q++) {
      const [ax, ay] = xy(...pts[q - 1]);
      const [bx, by] = xy(...pts[q]);
      along.push(along[q - 1] + Math.hypot(bx - ax, by - ay));
    }
    const pointAt = (l: number): [number, number] => {
      let i = 0;
      while (i + 2 < pts.length && along[i + 1] < l) i++;
      const t = (l - along[i]) / (along[i + 1] - along[i] || 1);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    };
    const [a, b] = range;
    const total = along.at(-1)!;
    const pieces: Array<[number, number]> = [];
    if (a - CLEARANCE_M > 1) pieces.push([0, a - CLEARANCE_M]);
    if (b + CLEARANCE_M < total - 1) pieces.push([b + CLEARANCE_M, total]);
    const ends: [Vector3 | null, Vector3 | null] = [null, null];
    for (const [p0, p1] of pieces) {
      const coords = [...pointAt(p0)];
      for (let i = 0; i < along.length; i++) if (along[i] > p0 && along[i] < p1) coords.push(...pts[i]);
      coords.push(...pointAt(p1));
      cutLines.push({ ...street, coords });
      const isBefore = p0 === 0;
      const [lo, la] = isBefore ? pointAt(p1) : pointAt(p0);
      ends[isBefore ? 0 : 1] = frame.toLocal(la, lo, 0).setY(0);
    }
    if (index !== undefined && !sideNodes.has(index)) sideNodes.set(index, ends);
  }
  const graph = new RoadGraph(cutLines, frame, () => {});
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const seg of graph.segments)
    for (const p of seg.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  const nodeAt = (p: Vector3) => {
    let best: { node: number; d: number } | null = null;
    for (const seg of graph.segments)
      for (const [node, q] of [
        [seg.from, seg.pts[0]],
        [seg.to, seg.pts[seg.pts.length - 1]],
      ] as const) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (best === null || d < best.d) best = { node, d };
      }
    return best !== null && best.d < 2 ? best.node : null;
  };
  const component = (start: number) => {
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const n = queue.pop()!;
      for (const id of graph.nodes.get(n) ?? []) {
        const seg = graph.segments[id];
        for (const m of [seg.from, seg.to])
          if (!seen.has(m)) {
            seen.add(m);
            queue.push(m);
          }
      }
    }
    return seen;
  };
  const nearEdge = (nodes: Set<number>) =>
    graph.segments.some((seg) => {
      const isIn = nodes.has(seg.from) || nodes.has(seg.to);
      if (!isIn) return false;
      return seg.pts.some(
        (p) => p.x < minX + EDGE_M || p.x > maxX - EDGE_M || p.z < minZ + EDGE_M || p.z > maxZ - EDGE_M,
      );
    });

  // Islands: a side left on a piece of network no longer joined to the rest (the largest component).
  const largest = (() => {
    let best = new Set<number>();
    const seen = new Set<number>();
    for (const node of graph.nodes.keys()) {
      if (seen.has(node)) continue;
      const comp = component(node);
      for (const n of comp) seen.add(n);
      if (comp.size > best.size) best = comp;
    }
    return best;
  })();
  for (const [index, list] of byStreet) {
    const street = streets[index];
    const k = lineKey(street);
    const twins = streets.filter((s) => lineKey(s) === k).length - 1;
    const mid = list[Math.floor(list.length / 2)];
    const site = siteOf.get(mid.chunk) ?? mid.chunk;
    const rowKey = `${k}|${site}`;
    if (rows.has(rowKey)) continue;
    const samples = sampled.get(index)!;
    const W = street.width;
    const half = widthBoundsOf(W).lower / 2;
    const [a, b] = cutRanges.get(index)!;
    const alongSamples = samples.slice(a, b + 1).filter((s) => s.u !== null);
    const alongWidth = alongSamples.filter((s) => s.u! - s.across < W / 2 && s.u! + s.across > -W / 2).length;
    const alongCentre = alongSamples.filter((s) => Math.abs(s.u!) <= s.across).length;
    const fragments = list.map((st) => round(st.l1 - st.l0, 10)).toSorted((x, y) => x - y);
    const ordered = list.toSorted((x, y) => x.l0 - y.l0);
    const gaps = ordered.slice(1).map((st, i) => round(st.l0 - ordered[i].l1, 10));
    const total = fragments.reduce((n, f) => n + f, 0);
    const isAlpha = (s: Sample) => ordered.some((st) => s.l >= st.l0 && s.l <= st.l1);
    // The table rests on the rule: its stretches must lie inside the samples along the site.
    const fragmentsMatch = ordered.every((st) => st.l0 >= a - 1 && st.l1 <= b + 1);
    const endOf = (i: number, step: -1 | 1) => {
      const isLineEnd = step === -1 ? i <= 1 : i >= samples.length - 2;
      if (isLineEnd) return "line-end";
      const s = samples[i + step];
      const isNoSite = s.u === null || s.angle >= ALONG_DEG;
      if (isNoSite) return "site-end";
      return s.u! > 0 ? "turns-right-of-site" : "turns-left-of-site";
    };
    const pts = [
      street.coords[0],
      street.coords[1],
      street.coords[street.coords.length - 2],
      street.coords[street.coords.length - 1],
    ];
    const nextOf = (lo: number, la: number, isInAlong: boolean) => {
      if (!isInAlong) return "-";
      const vk = vertexKey(lo, la);
      const others = streets.filter((s, j) => {
        if (j === index || lineKey(s) === k) return false;
        for (let i = 0; i + 1 < s.coords.length; i += 2)
          if (vertexKey(s.coords[i], s.coords[i + 1]) === vk) return true;
        return false;
      });
      if (others.length === 0) return "dead-end";
      const alongOthers = others.filter((s) => {
        const ss = sampleLine(s, siteOf.get(mid.chunk) ?? null);
        return (
          ss.filter((x) => x.u !== null && x.angle < ALONG_DEG && Math.abs(x.u) <= x.across + s.width / 2)
            .length >= 3
        );
      });
      return alongOthers.length > 0
        ? `on along the site: ${alongOthers.map(lineKey).join(" ; ")}`
        : `network (${others.length} lines)`;
    };
    const next: [string, string] = [
      nextOf(pts[0], pts[1], a <= 1),
      nextOf(pts[2], pts[3], b >= samples.length - 2),
    ];
    const [sa, sb] = sideNodes.get(index)!;
    // Each side of the stretch: the line's piece left there, else (the stretch reaching the line's end)
    // the other lines meeting at that end, else nothing (a dead end).
    const sideOf = (piece: Vector3 | null, lo: number, la: number) => {
      if (piece) return nodeAt(piece);
      return nodeAt(frame.toLocal(la, lo, 0).setY(0));
    };
    const na = sideOf(sa, pts[0], pts[1]);
    const nb = sideOf(sb, pts[2], pts[3]);
    // A side is cut off when its own streets do not reach the edge of the streets read (the
    // side that is cut off alone decides; the network's side always reaches the edge).
    const isCutOff = (n: number | null) => n !== null && !largest.has(n) && !nearEdge(component(n));
    const isIsland = isCutOff(na) || isCutOff(nb);
    const islandSide = isCutOff(na) ? "start" : isCutOff(nb) ? "end" : null;
    let through: Row["through"] = "dead-end";
    if (na !== null && nb !== null) {
      const isKept = component(na).has(nb);
      through = isKept ? "kept" : isIsland ? "cut" : "cut-near-edge";
    }
    const chunks = [...new Set(list.map((st) => st.chunk))];
    const chunkSet = new Set([...siteOf].filter(([, g]) => g === site).map(([c]) => c));
    const caseLabel = (c: PlaceCase) => `w${c.streetM} s${c.s0}–${c.s1} ${c.lengthM} m`;
    const probes = {
      before: [
        ...before.places.filter((c) => chunkSet.has(c.chunk) && c.streetM === W).map(caseLabel),
        ...before.holes
          .filter(
            (h) => chunkSet.has([...chunkSet][0]) && [...chunkSet].some((c) => c.startsWith(`${h.run}:`)),
          )
          .flatMap((h) =>
            h.lanes.filter((l) => l.widthM === W).map((l) => `cut w${l.widthM} ${l.lengthM} m`),
          ),
      ],
      after: [
        ...after.places.filter((c) => chunkSet.has(c.chunk) && c.streetM === W).map(caseLabel),
        ...after.holes
          .filter((h) => [...chunkSet].some((c) => c.startsWith(`${h.run}:`)))
          .flatMap((h) =>
            h.lanes.filter((l) => l.widthM === W).map((l) => `cut w${l.widthM} ${l.lengthM} m`),
          ),
      ],
    };
    const runIds = new Set([...chunkSet].map((c) => c.split(":")[0]));
    const joinOf = (list: Join[], run: string, end: string) =>
      list.find((j) => j.run === run && j.end === end);
    const feet = before.joins
      .filter((j) => runIds.has(j.run) || j.street === k)
      .map((j) => {
        const after1 = joinOf(after.joins, j.run, j.end);
        const isSame = after1 !== undefined && after1.rule === j.rule && after1.street === j.street;
        return `${j.run}:${j.end} ${j.rule}${j.street === k ? " (this line)" : ""} -> ${isSame ? "same" : `${after1?.rule ?? "?"} ${after1?.street ?? ""}`}`;
      });
    // The other build's segments lying on this line (both ends within 0.6 m of it): a foot's join or
    // a junction splits the line there, so its own end points do not match.
    const linePts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < street.coords.length; i += 2)
      linePts.push(xy(street.coords[i], street.coords[i + 1]));
    const toLine = (la: number, lo: number) => {
      const [px, py] = xy(lo, la);
      let best = Infinity;
      for (let i = 0; i + 1 < linePts.length; i++) {
        const [ax, ay] = linePts[i];
        const [bx, by] = linePts[i + 1];
        const [ex, ey] = [bx - ax, by - ay];
        const l2 = ex * ex + ey * ey;
        const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2));
        best = Math.min(best, Math.hypot(ax + ex * t - px, ay + ey * t - py));
      }
      return best;
    };
    const lanes = before.sections
      .filter((s) => {
        const [p, q] = s.seg.split("|").map((v) => v.split(",").map(Number));
        return toLine(p[0], p[1]) < 0.6 && toLine(q[0], q[1]) < 0.6 && s.widthM === W;
      })
      .map((s) => `${s.lengthM} m: ${s.lanes} lane(s), travel ${s.travel}, ${s.basis}`);
    const offsets = alongSamples.map((s) => Math.abs(s.u!));
    const outside = alongSamples.filter((s) => !isAlpha(s)).map((s) => Math.abs(s.u!));
    const angles = alongSamples.map((s) => s.angle);
    const isClass0 = classOf(W) === 0;
    const g = mid.at;
    rows.set(rowKey, {
      line: k,
      twins,
      at: [r6(g[0]), r6(g[1])],
      site,
      chunks,
      widthM: W,
      widthClass: classOf(W),
      ruleHalfM: half,
      bandWidthM: median(alongSamples.map((s) => 2 * s.across)),
      fragments,
      gaps,
      alongWidthM: alongWidth,
      alongCentreM: alongCentre,
      ratioToWidth: alongWidth === 0 ? null : round(total / alongWidth),
      ratioToCentre: alongCentre === 0 ? null : round(total / alongCentre),
      offsetM: {
        median: median(offsets),
        most: offsets.length ? round(Math.max(...offsets)) : null,
        outsideMedian: median(outside),
      },
      edgeM: isClass0 ? median(alongSamples.map((s) => Math.abs(s.u!) - s.half)) : null,
      angleDeg: { median: median(angles), most: angles.length ? round(Math.max(...angles)) : null },
      ends: [endOf(a, -1), endOf(b, 1)],
      next,
      through,
      probes,
      feet,
      lanes,
      fragmentsMatch,
      rule: (() => {
        const j = judgementOf.get(index);
        return { along: j?.along ?? 0, inside: j?.inside ?? 0, atFoot: j?.atFoot ?? 0 };
      })(),
      island: isIsland,
      islandSide,
    });
  }
}

const list = [...rows.values()];
const tally = (pick: (r: Row) => string) => {
  const out: Record<string, number> = {};
  for (const r of list) out[pick(r)] = (out[pick(r)] ?? 0) + 1;
  return out;
};
const summary = {
  dir: target,
  lines: list.length,
  alphaM: Math.round(list.reduce((n, r) => n + r.fragments.reduce((m, f) => m + f, 0), 0)),
  byClass: tally((r) => String(r.widthClass)),
  byThrough: tally((r) => r.through),
  byEnds: tally((r) => r.ends.join("/")),
  wholeAlong: list.filter((r) => (r.ratioToWidth ?? 0) >= 0.9).length,
  partAlong: list.filter((r) => (r.ratioToWidth ?? 0) < 0.9).length,
  fragmentsMismatch: list.filter((r) => !r.fragmentsMatch).length,
  islands: list.filter((r) => r.island).length,
  keptByVerdict: (() => {
    const out: Record<string, number> = {};
    for (const k of kept.values()) out[k.verdict] = (out[k.verdict] ?? 0) + 1;
    return out;
  })(),
};
log("street_same_road_measured", summary);
const out = flag("out");
if (out !== undefined)
  await writeFile(out, JSON.stringify({ summary, rows: list, kept: [...kept.values()] }, null, 1) + "\n");
