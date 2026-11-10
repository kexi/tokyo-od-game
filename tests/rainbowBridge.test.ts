import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "../src/geo/ellipsoid";
import {
  DeckLevelsSchema,
  deckGrade,
  deckLevelsOf,
  deckHeight,
  stripCentre,
  type DeckLevel,
} from "../src/world/deckLevels";
import {
  hiddenFootprints,
  LandmarkEntrySchema,
  landmarkPlaces,
  walledFootprints,
  type LandmarkEntry,
} from "../src/world/landmarkEntry";

const ROOT = join(import.meta.dirname, "..");
const entries: LandmarkEntry[] = JSON.parse(
  readFileSync(join(ROOT, "public", "data", "landmarks.json"), "utf8"),
).map((e: unknown) => LandmarkEntrySchema.parse(e));
const found = entries.find((e) => e.id === "rainbow_bridge");
if (!found) throw new Error("landmarks.json has no rainbow_bridge entry");
const bridge: LandmarkEntry = found;
// Parsed, not cast: a malformed or missing deckLevels fails the whole file here.
const levels = DeckLevelsSchema.parse(bridge.deckLevels);

/** OSM ways on the bridge and the tower outlines (© OpenStreetMap contributors, ODbL), fetched 2026-11-10. */
const osm = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "rainbowBridgeOsm.json"), "utf8")) as {
  ways: Record<string, Array<[number, number]>>;
  towerOutlines: Record<"shibaura" | "odaiba", Array<[number, number]>>;
};
const centroid = (ring: Array<[number, number]>) => ({
  lon: ring.reduce((a, p) => a + p[0], 0) / ring.length,
  lat: ring.reduce((a, p) => a + p[1], 0) / ring.length,
});
const SHIBAURA = centroid(osm.towerOutlines.shibaura);
const ODAIBA = centroid(osm.towerOutlines.odaiba);

/** A local east/north plane (m) around the axis origin: enough over a kilometre for metre tolerances. */
const [LON0, LAT0] = levels.axis.origin;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
const toPlane = (lon: number, lat: number) => ({ x: (lon - LON0) * KX, y: (lat - LAT0) * KY });
const bearing = (levels.axis.bearing * Math.PI) / 180;
const ALONG = { x: Math.sin(bearing), y: Math.cos(bearing) };
const LEFT = { x: -ALONG.y, y: ALONG.x };
/** (s, offset) of a point on the bridge, by this file's own projection. */
const onAxis = (lon: number, lat: number) => {
  const p = toPlane(lon, lat);
  return { s: p.x * ALONG.x + p.y * ALONG.y, offset: p.x * LEFT.x + p.y * LEFT.y };
};

const isJapanese = /[぀-ヿ一-鿿]/;

describe("レインボーブリッジ in landmarks.json: a structure-only model", () => {
  it("puts the model on the bay's datum and never walls off the roads it carries", () => {
    // y in the model is the T.P. height itself: the deck levels and the model share one datum.
    expect(bridge.baseHeight).toBe(0);
    // PLATEAU draws each anchorage as a building too: both are cut out, the 926 m bounding box is not,
    // and nothing is walled (walls would cut the decks and the roads running over the anchorages).
    const hidden = hiddenFootprints([bridge]);
    expect(hidden).toHaveLength(2);
    expect(hidden).not.toContainEqual(bridge.footprint);
    expect(walledFootprints([bridge])).toEqual([]);
    for (const ring of hidden) {
      const s = ring.map(([lon, lat]) => onAxis(lon, lat).s);
      // Each ring covers one anchorage body (394–463 m from mid-span), 1 m beyond its walls.
      expect(Math.min(...s.map(Math.abs))).toBeCloseTo(393, 0);
      expect(Math.max(...s.map(Math.abs))).toBeCloseTo(464, 0);
    }
    expect(bridge.lightModes.map((m) => m.id)).toEqual(["summer", "winter", "lightsOut"]);
  });

  it("keeps its far silhouette's length (an 800 m bridge widened with distance would grow fat)", () => {
    expect(bridge.widenFar).toBe(false);
  });

  it("names a street on Shibaura to warp and route to, not mid-span over the water", () => {
    const [place] = landmarkPlaces([bridge], "landmark");
    const { lon, lat } = place;
    const { s, offset } = onAxis(lon, lat);
    // Beyond the Shibaura anchorage's back (s < −463 m), beside the approach viaduct (±14 m), away from mid-span.
    expect(s).toBeLessThan(levels.axis.sRange[0]);
    expect(Math.abs(offset)).toBeGreaterThan(20);
    expect(haversineMeters(lat, lon, bridge.lat, bridge.lon)).toBeGreaterThan(600);
    // なぎさ通り (OSM way 1030669190, a ground-level tertiary road): the point lies on it.
    expect(haversineMeters(lat, lon, 35.6391198, 139.7560316)).toBeLessThan(1);
  });
});

describe("deckLevels: the constraint the road side pins both decks to", () => {
  it("is exactly what the generator script prints (no Blender needed)", () => {
    const printed = execFileSync(
      "python3",
      ["-I", join(ROOT, "scripts", "blender", "rainbow_bridge_spec.py")],
      {
        encoding: "utf8",
      },
    );
    expect(JSON.parse(printed)).toEqual(bridge.deckLevels);
  });

  it("gives no levels when they do not parse, so no road is pinned to them", () => {
    expect(deckLevelsOf(bridge)).toEqual(levels);
    expect(deckLevelsOf({ id: "rainbow_bridge", deckLevels: { ...levels, version: 2 } })).toBeNull();
    expect(deckLevelsOf({ id: "tokyo_tower" })).toBeNull();
  });

  it("names uses and directions with neutral values only (no route or operator names)", () => {
    expect(JSON.stringify(levels)).not.toMatch(isJapanese);
  });

  it("runs along the OSM towers' axis", () => {
    const mid = { lon: (SHIBAURA.lon + ODAIBA.lon) / 2, lat: (SHIBAURA.lat + ODAIBA.lat) / 2 };
    expect(haversineMeters(mid.lat, mid.lon, LAT0, LON0)).toBeLessThan(0.5);
    const a = toPlane(SHIBAURA.lon, SHIBAURA.lat);
    const b = toPlane(ODAIBA.lon, ODAIBA.lat);
    const towersBearing = ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(towersBearing - levels.axis.bearing)).toBeLessThan(0.05);
    // s grows from Shibaura toward Odaiba.
    expect(onAxis(SHIBAURA.lon, SHIBAURA.lat).s).toBeLessThan(0);
  });

  it.each(["upper", "lower"] as const)(
    "puts the %s floor's stations on the axis, on the profile formula",
    (level) => {
      const st = levels.levels[level].stations;
      expect(st[0].s).toBe(levels.axis.sRange[0]);
      expect(st[st.length - 1].s).toBe(levels.axis.sRange[1]);
      for (const [i, p] of st.entries()) {
        const at = onAxis(p.lon, p.lat);
        expect(Math.abs(at.s - p.s)).toBeLessThan(0.1);
        expect(Math.abs(at.offset)).toBeLessThan(0.1);
        expect(p.h).toBeCloseTo(deckHeight(levels, level, p.s), 3);
        expect(p.grade).toBeCloseTo(deckGrade(levels, p.s), 5);
        expect(p.segment).toBe(Math.abs(p.s) <= levels.axis.girderRange[1] ? "girder" : "anchorage");
        if (i > 0) expect(p.s - st[i - 1].s).toBeLessThan(25);
      }
      // A station on the crest, where the published 桁下 T.P.+51.266 m is.
      const crest = st.find((p) => p.s === 0);
      expect(crest?.h).toBeCloseTo(51.266 + levels.profile.aboveUnderside[level], 3);
    },
  );

  it("follows a gentle crest curve whose end grades let the approaches continue smoothly", () => {
    const [s0, s1] = levels.axis.sRange;
    expect(levels.profile.endGrades.start).toBeCloseTo(deckGrade(levels, s0), 5);
    expect(levels.profile.endGrades.end).toBeCloseTo(deckGrade(levels, s1), 5);
    expect(levels.profile.girderEndGrades.start).toBeCloseTo(
      deckGrade(levels, levels.axis.girderRange[0]),
      5,
    );
    // Rising toward the middle from both ends, under 3 % anywhere.
    expect(levels.profile.endGrades.start).toBeGreaterThan(0);
    expect(Math.abs(levels.profile.endGrades.end)).toBeLessThan(0.03);
    // 桁下 at the towers stays near the photo measurement (48–51 m): the curve is not a guess's artefact.
    const atTowers = deckHeight(levels, "lower", 285) - levels.profile.aboveUnderside.lower;
    expect(atTowers).toBeGreaterThan(48);
    expect(atTowers).toBeLessThan(51);
    // The upper floor over the lower: a lower deck with room for traffic under the upper deck's floor.
    expect(levels.profile.aboveUnderside.upper - levels.profile.aboveUnderside.lower).toBeGreaterThan(7.5);
  });

  it("covers the anchorages, where no piers of the road side may stand", () => {
    expect(levels.axis.pierFreeRange[0]).toBeLessThanOrEqual(levels.anchorages[0].sFrom);
    expect(levels.axis.pierFreeRange[1]).toBeGreaterThanOrEqual(levels.anchorages[1].sTo);
    for (const a of levels.anchorages) {
      // The decks pass between the cable housings, over the girder's bearing.
      const widest = Math.max(
        ...[levels.levels.upper, levels.levels.lower].map((l) => l.betweenOuterBarriers),
      );
      expect(widest / 2).toBeLessThan(a.clearHalfWidth);
      const sMid = (a.sFrom + a.sTo) / 2;
      expect(deckHeight(levels, "lower", sMid)).toBeGreaterThan(a.bearingTop);
    }
  });
});

describe("deckLevels cross-sections", () => {
  const floors = Object.entries(levels.levels) as Array<[string, DeckLevel]>;

  it.each(floors)(
    "fills the %s floor between its barriers with strips that neither overlap nor leave gaps",
    (_n, f) => {
      const half = f.betweenOuterBarriers / 2;
      expect(f.strips[0].from).toBeCloseTo(-half, 6);
      expect(f.strips[f.strips.length - 1].to).toBeCloseTo(half, 6);
      for (let i = 1; i < f.strips.length; i++) expect(f.strips[i].from).toBeCloseTo(f.strips[i - 1].to, 6);
      const total = f.strips.reduce((a, s) => a + (s.to - s.from), 0);
      expect(total).toBeCloseTo(f.betweenOuterBarriers, 6);
      // Inside the main truss: its planes are 29.0 m apart (幅員), chords 1 m wide.
      expect(half).toBeLessThanOrEqual(14.0);
      for (const s of f.strips.filter((x) => x.kind === "carriageway")) {
        expect((s.lanes ?? 0) * (s.laneWidth ?? 0)).toBeCloseTo(s.to - s.from, 6);
      }
    },
  );

  it.each(floors)(
    "keeps left-hand traffic on the %s floor: forward (+s) on the left, its OSM ways running +s",
    (_n, f) => {
      const roads = f.strips.filter((s) => s.kind === "carriageway");
      expect(roads.map((r) => r.direction).toSorted()).toEqual(["backward", "forward"]);
      for (const road of roads) {
        const isForward = road.direction === "forward";
        expect(stripCentre(road) > 0).toBe(isForward);
        for (const id of road.osmWays ?? []) {
          const pts = osm.ways[String(id)];
          const first = onAxis(...pts[0]);
          const last = onAxis(...pts[pts.length - 1]);
          expect(last.s > first.s, `way ${id}`).toBe(isForward);
        }
      }
    },
  );

  it.each(floors)("matches every %s strip to its OSM ways by the published rule (≤ 3 m across)", (_n, f) => {
    const tol = levels.tolerance.horizontal;
    const [g0, g1] = levels.axis.girderRange;
    for (const strip of f.strips.filter((s) => s.osmWays)) {
      for (const id of strip.osmWays ?? []) {
        const onBridge = osm.ways[String(id)].map((p) => onAxis(...p)).filter((p) => p.s > g0 && p.s < g1);
        expect(onBridge.length, `way ${id} on the bridge`).toBeGreaterThan(0);
        for (const p of onBridge) {
          // Roads: the line "axis + centre offset"; a guideway or walkway: anywhere within its strip.
          const miss =
            strip.kind === "carriageway"
              ? Math.abs(p.offset - stripCentre(strip))
              : Math.max(0, strip.from - p.offset, p.offset - strip.to);
          expect(miss, `way ${id} at s=${p.s.toFixed(0)}`).toBeLessThanOrEqual(tol);
        }
      }
    }
  });

  it("records the OSM ways' common lean off the towers' axis", () => {
    const pairs = [
      [316305908, 316305907],
      [4848879, 316305913],
      [275936305, 749205417],
      [508040812, 508040811],
    ];
    const meanOffset = (id: number) => {
      const on = osm.ways[String(id)]
        .map((p) => onAxis(...p))
        .filter((p) => Math.abs(p.s) < levels.axis.girderRange[1]);
      return on.reduce((a, p) => a + p.offset, 0) / on.length;
    };
    const centres = pairs.map(([a, b]) => (meanOffset(a) + meanOffset(b)) / 2);
    const lean = centres.reduce((a, c) => a + c, 0) / centres.length;
    expect(lean).toBeLessThan(0);
    expect(Math.abs(lean - levels.osmBias.meanOffset)).toBeLessThan(0.15);
    expect(Math.abs(lean)).toBeLessThan(levels.tolerance.horizontal);
  });
});
