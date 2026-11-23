// P2.7 R1-2b PR 1 (追記 3 方針 1, 追記 4 K4 6): whether the same-road rule (M1, α) gives every GSI
// street line the same answer in every window the game builds round the car. Read only. The windows:
// the car at 9 places in each tile (a hundredth, a half and 99 hundredths of the way across, each way) of
// every tile holding a point of an at-grade chunk and the tiles round them; for each, the 3 × 3 z16
// road tiles round the car's tile (RoadTiles.around) and the chunks within GRAPH_RADIUS_M of the car
// (ExpresswayDeck.roadInput), windows with the same tiles and chunks counted once. In each window the
// rule runs on the lines as joinExpressway hands them over (streetsAtSites → sameRoadGaps). A line is
// matched across windows by the GSI line it is a piece of (a crossing may cut it in one window and
// not in another). Its answer in a window: the verdict, and for an alpha line the two points where
// what the game takes out ends (to 1e-6°); "not judged" where the line is loaded near a site but the
// rule did not look at it. Each answer is booked outside or inside the edge band (a point of the line
// within EXTENT_MARGIN_M of the extent of the streets read, as joinExpressway's isInsideStreets).
// Outside the band, one answer per line is the rule's line (方針 1). One JSON log line
// (street_same_road_stability_measured) and --out <file> with every line that has more than one answer.
// Run: pnpm exec tsx scripts/expresswaySameRoadStability.ts <dir|label> [--out <file>]
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ST, STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format.ts";
import { haversine } from "../src/expressway/geo.ts";
import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../src/geo/tiles.ts";
import { log } from "../src/log.ts";
import {
  expresswayRoadInput,
  sameRoadGaps,
  sameRoadJudgements,
  streetsAtSites,
} from "../src/world/expresswayRoads.ts";
import type { RoadLine } from "../src/world/roads.ts";
import { ROAD_TILE_ZOOM } from "../src/world/roadTiles.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { gsiTileReader } from "./gameStreets.ts";

/** src/world/expresswayDeck.ts GRAPH_RADIUS_M; and expresswayRoads.ts EXTENT_MARGIN_M (not exported). */
const GRAPH_RADIUS_M = 1300;
const EDGE_M = 60;
/**
 * Where in a tile the car stands (fractions of the tile, each way). Why so near the corners: from a
 * tenth in, every point outside the edge band lies within about 1,250 m of the car, short of
 * GRAPH_RADIUS_M, so every site beside a line there is always read and the check could not fail;
 * from a hundredth in, the far corner is about 1,320 m off (re-review A3).
 */
const CAR_AT = [0.01, 0.5, 0.99];

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args[0] ?? "public/data/expressway";
const dataDir = target.includes("/") ? join(ROOT, target) : join(ROOT, ".cache", "expressway-area", target);
const files = readExpresswayFiles(dataDir);
const runs: XwTileRun[] = [
  ...new Map([...files.tiles.values()].flatMap((t) => t.runs).map((r) => [r.id, r])).values(),
];
const read = gsiTileReader(join(ROOT, ".cache", "gsi-vector"));
const isAtGrade = (c: XwChunk) => c.structure === "embankment" || c.structure === "cut";

/** ExpresswayDeck's distanceTo (expresswayDeck.ts pulls in the renderer): every 4th station and the last. */
function distanceTo(c: XwChunk, lon: number, lat: number): number {
  let best = Infinity;
  for (let i = 0; i < c.st.length; i += STATION_STRIDE * 4)
    best = Math.min(best, haversine(lon, lat, c.st[i + 1], c.st[i + 2]));
  const last = c.st.length - STATION_STRIDE;
  return Math.min(best, haversine(lon, lat, c.st[last + 1], c.st[last + 2]));
}

const siteTiles = new Set<string>();
for (const c of files.chunks.filter(isAtGrade))
  for (let i = 0; i < c.st.length; i += STATION_STRIDE)
    siteTiles.add(
      `${Math.floor(lonToTileX(c.st[i + ST.lon], ROAD_TILE_ZOOM))}-${Math.floor(latToTileY(c.st[i + ST.lat], ROAD_TILE_ZOOM))}`,
    );
const carTiles = new Set<string>();
for (const t of siteTiles) {
  const [x, y] = t.split("-").map(Number);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) carTiles.add(`${x + dx}-${y + dy}`);
}
// The raw GSI lines near any at-grade chunk (within 40 m of a station): the ones a window may judge.
const nearSite = (() => {
  const cells = new Set<string>();
  const cellOf = (lon: number, lat: number) => `${Math.floor(lon * 2000)},${Math.floor(lat * 2500)}`;
  for (const c of files.chunks.filter(isAtGrade))
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
      const [lon, lat] = [c.st[i + ST.lon], c.st[i + ST.lat]];
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1]) cells.add(cellOf(lon + dx / 2000, lat + dy / 2500));
    }
  return (l: RoadLine) => {
    for (let i = 0; i + 1 < l.coords.length; i += 2)
      if (cells.has(cellOf(l.coords[i], l.coords[i + 1]))) return true;
    return false;
  };
})();
const keyOf = (l: RoadLine) => {
  const c = l.coords;
  return `${c[1].toFixed(6)},${c[0].toFixed(6)}|${c.at(-1)!.toFixed(6)},${c.at(-2)!.toFixed(6)}`;
};

type Answer = { window: string; answer: string; inBand: boolean };
const answers = new Map<string, Answer[]>();
const seen = new Set<string>();
/**
 * Road tiles a window wanted that the cache does not have (counted, and the run fails on any). Why
 * not read them as empty, as before: a window with an empty tile is a network with a hole in it, and
 * nothing said so (#128's review M1: 326 of central's 897 tiles were missing).
 */
const missingTiles = new Set<string>();
let windows = 0;
for (const tile of carTiles) {
  const [tx, ty] = tile.split("-").map(Number);
  const tiles: RoadLine[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = await read(tx + dx, ty + dy);
      if (t === null) missingTiles.add(`${tx + dx}-${ty + dy}`);
      else tiles.push(...t);
    }
  const raw = tiles.filter(nearSite);
  for (const fx of CAR_AT)
    for (const fy of CAR_AT) {
      const lon = tileXToLon(tx + fx, ROAD_TILE_ZOOM);
      const lat = tileYToLat(ty + fy, ROAD_TILE_ZOOM);
      const near = files.chunks.filter((c) => distanceTo(c, lon, lat) <= GRAPH_RADIUS_M);
      const windowKey = `${tile}|${near
        .map((c) => c.id)
        .toSorted()
        .join(",")}`;
      const isRepeat = seen.has(windowKey);
      if (isRepeat) continue;
      seen.add(windowKey);
      const xw = expresswayRoadInput(near, runs, (_a, _b, h) => h);
      const hasNoChunks = xw.lines.length === 0;
      if (hasNoChunks) continue;
      windows++;
      const label = `${tile}@${fx},${fy}`;
      const { cut, xy } = streetsAtSites(tiles, xw, () => {});
      let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const l of cut)
        for (let i = 0; i + 1 < l.coords.length; i += 2) {
          const [x, y] = xy(l.coords[i], l.coords[i + 1]);
          [minX, maxX, minY, maxY] = [
            Math.min(minX, x),
            Math.max(maxX, x),
            Math.min(minY, y),
            Math.max(maxY, y),
          ];
        }
      const isInBand = (l: RoadLine) => {
        for (let i = 0; i + 1 < l.coords.length; i += 2) {
          const [x, y] = xy(l.coords[i], l.coords[i + 1]);
          const isNearEdge = x < minX + EDGE_M || x > maxX - EDGE_M || y < minY + EDGE_M || y > maxY - EDGE_M;
          if (isNearEdge) return true;
        }
        return false;
      };
      // Which raw line a cut piece is of: the raw line (same width) holding both its ends.
      const rawPts = raw.map((l) => {
        const pts: Array<[number, number]> = [];
        for (let i = 0; i + 1 < l.coords.length; i += 2) pts.push(xy(l.coords[i], l.coords[i + 1]));
        return pts;
      });
      const isOn = (pts: Array<[number, number]>, [x, y]: [number, number]) => {
        for (let q = 0; q + 1 < pts.length; q++) {
          const [ax, ay] = pts[q];
          const [ex, ey] = [pts[q + 1][0] - ax, pts[q + 1][1] - ay];
          const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
          const isNear = Math.hypot(ax + ex * t - x, ay + ey * t - y) < 0.05;
          if (isNear) return true;
        }
        return false;
      };
      const rawOf = (l: RoadLine) => {
        const a = xy(l.coords[0], l.coords[1]);
        const b = xy(l.coords.at(-2)!, l.coords.at(-1)!);
        const k = raw.findIndex((r, i) => r.width === l.width && isOn(rawPts[i], a) && isOn(rawPts[i], b));
        return k >= 0 ? keyOf(raw[k]) : null;
      };
      const book = (key: string, answer: string, inBand: boolean) => {
        const list = answers.get(key) ?? [];
        const hasHere = list.some((a) => a.window === label && a.answer === answer);
        if (hasHere) return;
        list.push({ window: label, answer, inBand });
        answers.set(key, list);
      };
      const judged = sameRoadJudgements(cut, xw.sites ?? [], xy);
      const taken = new Map(sameRoadGaps(cut, xw.sites ?? [], xy).map((t) => [t.judgement.street, t]));
      const judgedRaw = new Set<string>();
      for (const j of judged) {
        const line = cut[j.street];
        const key = rawOf(line);
        if (key === null) continue;
        judgedRaw.add(key);
        const t = taken.get(j.street);
        let answer = j.verdict;
        if (t) {
          const along = [0];
          for (let i = 2; i + 1 < line.coords.length; i += 2) {
            const [ax, ay] = xy(line.coords[i - 2], line.coords[i - 1]);
            const [bx, by] = xy(line.coords[i], line.coords[i + 1]);
            along.push(along.at(-1)! + Math.hypot(bx - ax, by - ay));
          }
          const at = (l: number) => {
            const c = Math.max(0, Math.min(along.at(-1)!, l));
            let i = 0;
            while (i + 2 < along.length && along[i + 1] < c) i++;
            const u = (c - along[i]) / (along[i + 1] - along[i] || 1);
            const k = i * 2;
            const lon2 = line.coords[k] + (line.coords[k + 2] - line.coords[k]) * u;
            const lat2 = line.coords[k + 1] + (line.coords[k + 3] - line.coords[k + 1]) * u;
            return `${lat2.toFixed(6)},${lon2.toFixed(6)}`;
          };
          answer += ` ${t.gaps.map(([g0, g1]) => `${at(g0)}–${at(g1)}`).join(" ")}`;
        }
        book(key, answer, isInBand(line));
      }
      for (const l of cut) {
        const key = rawOf(l);
        const isUnjudged = key !== null && !judgedRaw.has(key);
        if (isUnjudged) book(key, "not judged", isInBand(l));
      }
    }
}
// Lines the rule never judged anywhere are no line of the rule's.
const lines = [...answers].filter(([, list]) => list.some((a) => a.answer !== "not judged"));
const distinct = (list: Answer[]) => new Set(list.map((a) => a.answer));
// One answer per window: a line a crossing cuts into pieces gets each piece's answer, joined.
const perWindow = (list: Answer[]): Answer[] => {
  const byWindow = new Map<string, Answer[]>();
  for (const a of list) byWindow.set(a.window, [...(byWindow.get(a.window) ?? []), a]);
  return [...byWindow].map(([window, here]) => ({
    window,
    answer: [...new Set(here.map((a) => a.answer))].toSorted().join(" + "),
    inBand: here.some((a) => a.inBand),
  }));
};
const rows = lines.map(([line, booked]) => {
  const list = perWindow(booked);
  const outside = list.filter((a) => !a.inBand);
  const isAlpha = list.some((a) => a.answer.startsWith("alpha"));
  return {
    line,
    isAlpha,
    outsideAnswers: [...distinct(outside)],
    inBandAnswers: [...distinct(list.filter((a) => a.inBand))],
    windows: list.length,
    list,
  };
});
const summary = {
  dir: target,
  missingTiles: missingTiles.size,
  windows,
  lines: rows.length,
  alphaLines: rows.filter((r) => r.isAlpha).length,
  differOutsideBand: rows.filter((r) => r.outsideAnswers.length > 1).length,
  alphaDifferOutsideBand: rows.filter((r) => r.isAlpha && r.outsideAnswers.length > 1).length,
  differInBandOnly: rows.filter((r) => r.outsideAnswers.length <= 1 && distinct(r.list).size > 1).length,
};
log("street_same_road_stability_measured", summary);
const out = flag("out");
if (out !== undefined)
  await writeFile(
    out,
    JSON.stringify({ summary, differing: rows.filter((r) => distinct(r.list).size > 1) }, null, 1) + "\n",
  );
// Fails after the output is written, as the probes do.
const hasMissingTiles = missingTiles.size > 0;
if (hasMissingTiles) process.exitCode = 1;
