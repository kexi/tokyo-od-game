import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalFrame } from "../src/geo/frame";
import { applyRegulations, SIGN, type LaneDirection, type RegulationData } from "../src/world/regulations";
import { RoadGraph, type RoadLine } from "../src/world/roads";
import { readTime } from "../src/world/ruleTime";
import { design } from "../src/world/signs";

/**
 * Which signs the game puts up, where, and with which artwork, pinned as a snapshot taken before
 * the game's sign table moved to the sign definitions (G1c, knowledge/sign-system.md). Moving the
 * table must not add, drop, move or re-skin a single sign.
 *
 * The inputs are frozen copies of three regs / turnlanes tiles (tests/fixtures/sign-placement, with
 * their sources), so `just fetch-regs` does not rewrite the snapshot.
 *
 * Roads come from GSI vector tiles at run time, which are not in the repository; the road graph
 * here is built from the regulation tile's own lines (JARTIC draws them on the roads). Why not
 * commit GSI tiles as fixtures: they are served for real-time use. The positions are thus not the
 * game's, and these roads leave parts of placeSigns unreached:
 * - every road is a two-way "local" street 9 m wide, so the highway branches and a street's own
 *   one-way (line.oneway ≠ 0) never run, and lanesPerDirection always gives 2;
 * - closed, noVehicleCrossing, horn, busPriority, hydrant and school are not placed at the three
 *   places, and crosswalk and stop are placed by TrafficSigns, not placeSigns.
 * The second test covers those types: it pins design() for every type, value and lane pattern.
 */

const FIXTURES = join(import.meta.dirname, "fixtures", "sign-placement");
const KIND = new Map(Object.entries(SIGN).map(([k, v]) => [v as number, k]));

/** z14 tiles (regs and turnlanes, frozen in FIXTURES) around three places with many kinds of sign. */
const PLACES = [
  { name: "丸の内", tile: "14552-6451" },
  { name: "渋谷", tile: "14549-6452" },
  { name: "芝公園", tile: "14552-6453" },
] as const;

function tileData(tile: string): RegulationData {
  const regs = JSON.parse(readFileSync(join(FIXTURES, `regs-${tile}.json`), "utf8"));
  const lanesFile = join(FIXTURES, `turnlanes-${tile}.json`);
  const turnlanes = existsSync(lanesFile) ? JSON.parse(readFileSync(lanesFile, "utf8")) : [];
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
  };
}

/** Road centrelines from the regulation lines (each line once), as plain two-way local streets. */
function roadsOf(data: RegulationData): RoadLine[] {
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
    lines.push({ coords, width: 9, oneway: 0, kind: "local" });
  }
  return lines;
}

const laneKey = (lanes?: LaneDirection[][]) => (lanes ? lanes.map((l) => l.join("+")).join("|") : "");
/** The artwork of a design, as the game builds it (file, plate, back face, mounting). */
function artOf(d: ReturnType<typeof design>): string {
  if (!d) return "-";
  const extras = [
    d.back ? `back=${d.back}` : "",
    d.parallel ? "parallel" : "",
    d.bothFaces ? "bothFaces" : "",
  ];
  return [`${d.file}@${d.shape}`, ...extras.filter((e) => e !== "")].join(" ");
}

const fixed = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);

/** One line per placed sign: type, value, lanes, artwork, position and facing. */
function placements(tile: string): string[] {
  const data = tileData(tile);
  const [x, y] = tile.split("-").map(Number);
  const lon = ((x + 0.5) / 2 ** 14) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** 14))) * 180) / Math.PI;
  const frame = new LocalFrame(lat, lon, 40);
  const applied = applyRegulations(new RoadGraph(roadsOf(data), frame), data, frame, () => {});
  return applied.signs.map((s) => {
    const art = artOf(design(s.type, s.value, s.lanes));
    const heading = ((Math.atan2(s.travel.x, -s.travel.z) * 180) / Math.PI + 360) % 360;
    const where = `${fixed(s.pos.x)},${fixed(s.pos.z)} ${heading.toFixed(1)}°`;
    return `${KIND.get(s.type)} ${s.value} ${laneKey(s.lanes)} | ${art} | ${where}${s.note ? ` | ${s.note.replace(/\n/g, "/")}` : ""}`;
  });
}

describe("the signs the game places (placeSigns and design())", () => {
  for (const place of PLACES) {
    it(`are unchanged at ${place.name} (regs ${place.tile})`, () => {
      const rows = placements(place.tile);
      expect(rows.length).toBeGreaterThan(100);
      expect(rows).toMatchSnapshot();
    });
  }

  it("draw the same artwork for every type and value the game places", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const lanes: LaneDirection[][][] = [
      [["left", "through"], ["through"], ["right"]],
      [["through"]],
      [["left"]],
      [["left", "through"]],
      [["slight_left"], ["through", "slight_right"]],
      [["reverse", "left"], ["through"], ["through"], ["right"]],
    ];
    const rows = Object.entries(SIGN).flatMap(([kind, type]) => [
      ...values.map((v) => `${kind} ${v} ${artOf(design(type, v))}`),
      ...lanes.map((l) => `${kind} lanes ${laneKey(l)} ${artOf(design(type, 0, l))}`),
    ]);
    expect(rows).toMatchSnapshot();
  });
});
