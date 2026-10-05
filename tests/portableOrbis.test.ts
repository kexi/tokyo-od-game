import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { TrafficLaw, speedViolation } from "../src/game/traffic";
import { setLocale } from "../src/i18n";
import { violationDetail } from "../src/i18n/law";
import { inJapanese } from "../src/i18n/reverse";
import { LocalFrame } from "../src/geo/frame";
import { crossing, photographs, type OrbisSite } from "../src/world/orbis";
import { PORTABLE, dayKey, onewayAllDay, planPortable, type GameDay } from "../src/world/portableOrbis";
import { CLOSURE } from "../src/world/closures";
import { RoadGraph, leftOf, type RoadLine } from "../src/world/roads";
import { ALWAYS, gameClock } from "../src/world/ruleTime";

const LAT = 35.68;
const LON = 139.76;
const M_LAT = 1 / 110_950; // degrees per metre of latitude near Tokyo
const M_LON = M_LAT / Math.cos((LAT * Math.PI) / 180);
const DAY: GameDay = { y: 2026, m: 10, d: 5 };

/**
 * A residential grid 1.6 km square around (LAT, LON): streets every 100 m both ways, 5 m wide
 * (no centre line: 30 km/h statutory), every fourth east–west street one-way eastbound, and one
 * 16 m 国道 through the middle north–south. Vertices at every crossing, so the graph splits there.
 */
function city(opts: { clipWest?: number } = {}): RoadLine[] {
  const half = 800;
  const steps = Array.from({ length: 17 }, (_, k) => -half + k * 100);
  const west = opts.clipWest ?? -half;
  const xs = steps.filter((x) => x >= west);
  const lines: RoadLine[] = [];
  steps.forEach((z, k) => {
    const coords = xs.flatMap((x) => [LON + x * M_LON, LAT + z * M_LAT]);
    lines.push({ coords, width: 5, oneway: k % 4 === 0 ? 1 : 0, kind: "local" });
  });
  for (const x of xs) {
    const isNational = x === 0;
    lines.push({
      coords: steps.flatMap((z) => [LON + x * M_LON, LAT + z * M_LAT]),
      width: isNational ? 16 : 5,
      oneway: 0,
      kind: isNational ? "national" : "local",
    });
  }
  return lines;
}

const graphOf = (lines: RoadLine[], frame: LocalFrame) => new RoadGraph(lines, frame);

const isEastWest = (pts: Vector3[]) => Math.abs(pts[1].z - pts[0].z) < 1;
/** Within the school radius of the 小学校 the preference test puts 400 m north-west of the centre. */
const byTheSchool = (site: OrbisSite) =>
  Math.hypot(site.line.x + 400, site.line.z + 400) < PORTABLE.schoolRadius;

/** Units as frame-free records: the cell they belong to and where they stand (≈ 1 cm). */
const summary = (sites: OrbisSite[]) =>
  sites
    .map((s) => ({
      key: s.entry.origin,
      lat: Math.round(s.entry.lat * 1e5),
      lon: Math.round(s.entry.lon * 1e5),
      bearing: s.entry.bearing,
    }))
    .toSorted((a, b) => (a.key ?? "").localeCompare(b.key ?? ""));

describe("portable orbis placement", () => {
  const frame = new LocalFrame(LAT, LON, 40);
  const graph = graphOf(city(), frame);
  const sites = planPortable(graph, frame, DAY);

  it("is the same on every rebuild of the day, in another frame, and differs on another day", () => {
    expect(sites.length).toBeGreaterThan(0);
    expect(summary(planPortable(graph, frame, DAY))).toEqual(summary(sites));
    // The frame re-anchored 400 m away (as after a drive): the same units in the same places.
    const moved = new LocalFrame(LAT + 300 * M_LAT, LON + 250 * M_LON, 35);
    expect(summary(planPortable(graphOf(city(), moved), moved, DAY))).toEqual(summary(sites));
    const tomorrow = planPortable(graph, frame, { ...DAY, d: 6 });
    expect(summary(tomorrow)).not.toEqual(summary(sites));
    expect(dayKey(DAY)).toBe("2026-10-05");
  });

  it("puts a cell's unit in the same place whatever window of streets is loaded around it", () => {
    // Another window: the western 500 m are not loaded (as when the player is further east).
    const eastGraph = graphOf(city({ clipWest: -300 }), frame);
    let compared = 0;
    for (let d = 1; d <= 30; d++) {
      const day = { ...DAY, d };
      const east = summary(planPortable(eastGraph, frame, day));
      const byKey = new Map(summary(planPortable(graph, frame, day)).map((s) => [s.key, s]));
      // …its cells are only those fully inside the smaller window, each with the same unit.
      for (const unit of east) expect(byKey.get(unit.key)).toEqual(unit);
      compared += east.length;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it("stands off the carriageway at the left kerb, never in a junction, on residential streets", () => {
    for (const site of sites) {
      const { seg, s } = site;
      expect(site.kind).toBe("portable");
      expect(seg.line.kind).toBe("local");
      expect(s).toBeGreaterThanOrEqual(PORTABLE.clear - 1e-6);
      expect(s).toBeLessThanOrEqual(seg.length - PORTABLE.clear + 1e-6);
      expect(graph.carriagewaysAt(site.line, 0, seg)).toEqual([]);
      const stand = site.stand as Vector3;
      // Left of travel, just beyond the carriageway edge, and inside no carriageway.
      const offset = stand.clone().sub(site.line);
      expect(offset.dot(leftOf(site.travel, 1))).toBeCloseTo(seg.line.width / 2 + PORTABLE.kerbGap, 5);
      expect(Math.abs(offset.dot(site.travel))).toBeLessThan(1e-6);
      expect(graph.carriagewaysAt(stand, 0)).toEqual([]);
    }
  });

  it("looks back at the traffic it takes: along a one-way street, its permitted direction", () => {
    for (const site of sites) {
      const along = graph.sample(site.seg, site.s).dir.multiplyScalar(site.dir);
      expect(site.travel.dot(along)).toBeCloseTo(1, 6);
      if (onewayAllDay(site.seg) !== 0) expect(site.dir).toBe(onewayAllDay(site.seg));
      // A car driving that way past the unit in the kerb lane crosses its line; the other way not.
      const a = site.line.clone().addScaledVector(site.travel, -4);
      const b = site.line.clone().addScaledVector(site.travel, 4);
      expect(crossing(site, a, b)).toBe(0);
      expect(crossing(site, b, a)).toBeNull();
    }
  });

  it("keeps off streets closed round the clock, not those closed for the school run", () => {
    const closed = new RoadGraph(city(), frame);
    const schoolRun = { on: [[450, 510, 0] as [number, number, number]], off: [] };
    for (const seg of closed.segments) {
      const isNorth = seg.pts.every((p) => p.z <= 0);
      seg.closures = [{ kind: CLOSURE.vehicles, time: isNorth ? ALWAYS : schoolRun }];
    }
    let south = 0;
    for (let d = 1; d <= 28; d++) {
      for (const site of planPortable(closed, frame, { ...DAY, d })) {
        expect(site.seg.pts.every((p) => p.z <= 0)).toBe(false);
        south++;
      }
    }
    expect(south).toBeGreaterThan(10);
  });

  it("faces the same way all day where a one-way holds only some hours", () => {
    const timed = new RoadGraph(city(), frame);
    const morning = { on: [[420, 540, 0] as [number, number, number]], off: [] };
    for (const seg of timed.segments) {
      if (seg.line.kind === "local" && isEastWest(seg.pts)) seg.onewayRule = { dir: -1, time: morning };
    }
    timed.setClock(gameClock(2026, 10, 5, 8 * 60));
    const at8 = summary(planPortable(timed, frame, DAY));
    timed.setClock(gameClock(2026, 10, 5, 15 * 60));
    expect(summary(planPortable(timed, frame, DAY))).toEqual(at8);
  });

  it("places none on 国道 or other wide or fast roads, nor on a graph of only those", () => {
    const arterial = new RoadGraph(
      [
        {
          coords: [LON, LAT - 900 * M_LAT, LON, LAT, LON, LAT + 900 * M_LAT],
          width: 16,
          oneway: 0,
          kind: "national",
        },
      ],
      frame,
    );
    expect(planPortable(arterial, frame, DAY)).toEqual([]);
    for (const site of sites) expect(site.seg.line.kind).not.toBe("national");
  });

  it("puts a few in a loaded window: about 3 a day on a 1.6 km grid, never on every street", () => {
    const counts = Array.from({ length: 365 }, (_, k) => {
      const date = new Date(Date.UTC(2026, 0, 1 + k));
      const day = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
      return planPortable(graph, frame, day).length;
    });
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    // ~20 whole cells × 0.15 (no 小学校 on this grid).
    expect(mean).toBeGreaterThan(2.4);
    expect(mean).toBeLessThan(3.6);
    expect(Math.max(...counts)).toBeLessThanOrEqual(10);
  });

  it("prefers posted 30 km/h streets inside a cell, and cells and streets by a 小学校", () => {
    // The same grid with its east–west streets posted 30 km/h (JARTIC), and a 小学校 400 m
    // north-west of the centre.
    const posted = new RoadGraph(city(), frame);
    for (const seg of posted.segments) {
      if (seg.line.kind !== "local" || !isEastWest(seg.pts)) continue;
      seg.limit = 30;
      seg.limitKind = "sign";
    }
    const school: [number, number, number, string] = [
      LON - 400 * M_LON,
      LAT + 400 * M_LAT,
      0,
      "区立テスト小学校",
    ];
    const tally = { postedEW: 0, plainEW: 0, units: 0, school: 0, noSchool: 0 };
    for (let k = 0; k < 300; k++) {
      const day = { y: 2027, m: 1 + Math.floor(k / 28), d: 1 + (k % 28) };
      for (const site of planPortable(posted, frame, day)) if (isEastWest(site.seg.pts)) tally.postedEW++;
      for (const site of planPortable(graph, frame, day)) {
        tally.units++;
        if (isEastWest(site.seg.pts)) tally.plainEW++;
        if (byTheSchool(site)) tally.noSchool++;
      }
      for (const site of planPortable(graph, frame, day, [school])) if (byTheSchool(site)) tally.school++;
    }
    // Half the streets run east–west; posting them 30 km/h wins them a clear majority.
    expect(tally.plainEW / tally.units).toBeLessThan(0.6);
    expect(tally.postedEW / tally.units).toBeGreaterThan(0.65);
    // Near the school: cells there get a unit twice as often.
    expect(tally.school).toBeGreaterThan(tally.noSchool * 1.5);
  });
});

describe("portable orbis judgement and record", () => {
  const frame = new LocalFrame(LAT, LON, 40);
  const graph = new RoadGraph(city(), frame);
  const [site] = planPortable(graph, frame, DAY);

  it("photographs 15 km/h or more over the limit (fixed cameras: 30)", () => {
    expect(site.threshold).toBe(15);
    expect(site.limit).toBe(30);
    const a = site.line.clone().addScaledVector(site.travel, -4);
    const b = site.line.clone().addScaledVector(site.travel, 4);
    expect(photographs(site, a, b, 44)).toBeNull();
    expect(photographs(site, a, b, 45)).toBe(0);
    expect(photographs(site, b, a, 80)).toBeNull();
  });

  it("books a 反則行為 below 30 over (points and 反則金 by post), a 非反則行為 from 30", () => {
    const law = new TrafficLaw();
    const blue = law.commit(speedViolation(18)!, 0)!;
    law.notice(blue, "orbisPortable");
    expect(blue).toMatchObject({ status: "notice", by: "orbisPortable" });
    expect(law.state.points).toBe(0);
    const red = law.commit({ ...speedViolation(31)!, kind: "speed" }, 30_000, 0)!;
    law.notice(red, "orbisPortable");
    expect(law.deliverNotices()).toEqual([blue, red]);
    expect(blue).toMatchObject({ points: 1, fine: 12000, status: "caught" });
    expect(red).toMatchObject({ points: 6, fine: null, status: "caught" });
    expect(law.state.points).toBe(7);
  });

  it("says 可搬式 in the record, and in English and Chinese on the screen", () => {
    const detail = inJapanese("violationDetail.orbisPortable", { kmh: 47, limit: 30 });
    expect(detail).toContain("可搬式");
    setLocale("en");
    expect(violationDetail(detail)).toBe(
      "Photographed by a portable speed camera (portable Orbis): 47 km/h (limit 30 km/h)",
    );
    setLocale("zh");
    expect(violationDetail(detail)).toContain("移动式");
    setLocale("ja");
    // The fixed cameras' detail stays theirs.
    expect(violationDetail(inJapanese("violationDetail.orbis", { kmh: 90, limit: 60 }))).not.toContain(
      "可搬式",
    );
  });
});
