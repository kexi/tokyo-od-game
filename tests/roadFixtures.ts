import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalFrame } from "../src/geo/frame";
import type { RegulationData } from "../src/world/regulations";
import type { RoadLine } from "../src/world/roads";
import { readTime } from "../src/world/ruleTime";

/**
 * The frozen tiles of tests/fixtures/sign-placement as road-model inputs, shared by
 * tests/roadModelInvariance.test.ts and tests/roadSection.test.ts: the regulation data of a place
 * (JARTIC regs, OSM turn:lanes and, from P8, street lanes) and road centrelines made from the
 * regulation tile's own lines (GSI tiles are not committed: they are served for real-time use).
 */

export const FIXTURES = join(import.meta.dirname, "fixtures", "sign-placement");
export const PLACES = [
  { name: "丸の内", tile: "14552-6451" },
  { name: "渋谷", tile: "14549-6452" },
  { name: "芝公園", tile: "14552-6453" },
] as const;

export function tileData(tile: string): RegulationData {
  const regs = JSON.parse(readFileSync(join(FIXTURES, `regs-${tile}.json`), "utf8"));
  const lanesFile = join(FIXTURES, `turnlanes-${tile}.json`);
  const turnlanes = existsSync(lanesFile) ? JSON.parse(readFileSync(lanesFile, "utf8")) : [];
  const roadFile = join(FIXTURES, `roadlanes-${tile}.json`);
  const roadlanes = existsSync(roadFile) ? JSON.parse(readFileSync(roadFile, "utf8")) : [];
  return {
    speed: [],
    speedZone: [],
    oneway: [],
    crosswalk: [],
    stopLine: [],
    stopSign: [],
    sections: [],
    turns: [],
    closures: [],
    noOvertake: [],
    lanes: [],
    noLaneChange: [],
    laneArrows: [],
    signals: [],
    junctions: [],
    footbridges: [],
    ...regs,
    turnlanes,
    roadlanes,
  };
}

const WIDTHS = [2.5, 4.3, 5.5, 9, 13, 16, 22, 9, 6];
const KINDS: RoadLine["kind"][] = ["local", "national", "prefectural", "local", "narrow"];

/** Metres east / north per degree near Tokyo (enough to tell coincident lines apart). */
const M_PER_LAT = 110_950;
const M_PER_LON = 111_320 * Math.cos((35.67 * Math.PI) / 180);
/** Closer than this to a kept line, a piece of a new line runs along it. */
const COINCIDENT_M = 1.5;

/** Distance (m) from point (x, y) to the segment a–b, all in metres. */
function pointToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

/** Lon / lat to local metres (east, north), up to an offset. */
const toM = (lon: number, lat: number): [number, number] => [lon * M_PER_LON, lat * M_PER_LAT];

/** Whether any edge midpoint of `coords` lies on one of the kept lines. */
function overlapsAny(coords: number[], kept: readonly RoadLine[]): boolean {
  for (let i = 0; i + 3 < coords.length; i += 2) {
    const [x, y] = toM((coords[i] + coords[i + 2]) / 2, (coords[i + 1] + coords[i + 3]) / 2);
    for (const line of kept) {
      const c = line.coords;
      for (let j = 0; j + 3 < c.length; j += 2) {
        const [ax, ay] = toM(c[j], c[j + 1]);
        const [bx, by] = toM(c[j + 2], c[j + 3]);
        const isOnIt = pointToSegment(x, y, ax, ay, bx, by) < COINCIDENT_M;
        if (isOnIt) return true;
      }
    }
  }
  return false;
}

/** The regulation tile's lines (each once, none along another) as road centrelines, varied by index. */
export function roadsOf(data: RegulationData): RoadLine[] {
  const coordLists = [
    ...data.speed.map((r) => r.slice(1)),
    ...data.oneway.map((r) => r.slice(readTime(r, 0).next)),
    ...data.sections.map((r) => r.slice(readTime(r, 2).next)),
    ...data.closures.filter((r) => r[0] === 2).map((r) => r.slice(readTime(r, 2).next)),
    ...data.noOvertake,
    ...data.noLaneChange,
    ...data.lanes.map((r) => r.slice(1)),
    ...data.laneArrows.map((r) => r.slice(1)),
  ];
  const seen = new Set<string>();
  const lines: RoadLine[] = [];
  for (const coords of coordLists) {
    const key = coords.join(",");
    const isLine = coords.length >= 4 && !seen.has(key);
    if (!isLine) continue;
    seen.add(key);
    // JARTIC lists one road in several records (each direction, overlapping sections). Kept, they
    // make coincident segments, and which of two equally near ones wins is then decided by the
    // last bit of a double: different on another machine. Real GSI roads do not coincide.
    if (overlapsAny(coords, lines)) continue;
    const i = lines.length;
    const isExpressway = i % 17 === 5;
    lines.push({
      coords,
      width: WIDTHS[i % WIDTHS.length],
      oneway: i % 11 === 3 ? 1 : i % 13 === 7 ? -1 : 0,
      kind: isExpressway ? ("highway" as RoadLine["kind"]) : KINDS[i % KINDS.length],
      ...(i % 19 === 2 ? { bridge: true } : {}),
    });
  }
  return lines;
}

/** The local frame centred on a z14 tile. */
export function placeFrame(tile: string): LocalFrame {
  const [x, y] = tile.split("-").map(Number);
  const lon = ((x + 0.5) / 2 ** 14) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** 14))) * 180) / Math.PI;
  return new LocalFrame(lat, lon, 40);
}
