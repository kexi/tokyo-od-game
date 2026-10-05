import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  centreOf,
  FEATURED,
  isStation,
  joinRings,
  KINDS,
  kindsOf,
  nameOf,
  type Feature,
} from "../scripts/destinations";
import { DestinationFileSchema, expandDestinations } from "../src/game/destinations";
import { AreaIndex, type AreaFile } from "../src/geo/areas";

const DATA = join(import.meta.dirname, "..", "public", "data");
const FILE = join(DATA, "destinations.json");
const file = DestinationFileSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
const items = expandDestinations(file);
const areas = new AreaIndex(JSON.parse(readFileSync(join(DATA, "areas.json"), "utf8")) as AreaFile);
const landmarks = JSON.parse(readFileSync(join(DATA, "landmarks.json"), "utf8")) as Array<{
  name: string;
  lat: number;
  lon: number;
}>;

/** Ground distance in metres (equirectangular: plenty at a few kilometres). */
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110_950);
const named = (name: string) => items.filter((d) => d.name === name);

describe("destinations.json: the places the 目的地 chooser searches", () => {
  it("is a well-formed file whose every kind has a label", () => {
    expect(Object.keys(file.kinds)).toEqual(Object.keys(KINDS));
    for (const d of items) expect(file.kinds[d.kind], d.name).toBeDefined();
    expect(file.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(file.source).toContain("OpenStreetMap");
  });

  it("stays small enough to load with the game (< 400 KB)", () => {
    expect(statSync(FILE).size).toBeLessThan(400_000);
  });

  it("has every station and a few thousand places", () => {
    const stations = items.filter((d) => d.kind === "station");
    expect(stations.length).toBeGreaterThan(400);
    expect(items.length).toBeGreaterThan(2000);
    for (const s of stations) expect(s.name).toMatch(/駅$/);
  });

  it("lists every featured landmark once, under its common name", () => {
    const featured = items.filter((d) => d.featured);
    expect(featured.map((d) => d.name).toSorted()).toEqual(FEATURED.map((f) => f.label).toSorted());
  });

  it("puts every place inside the 23 wards, in the ward it names", () => {
    for (const d of items) {
      const hit = areas.lookup(d.lat, d.lon);
      expect(hit?.ward, `${d.name} ${d.lat},${d.lon}`).toBe(d.ward);
    }
  });

  it("has one entry per place: no name twice within 400 m, no row twice", () => {
    const rows = new Set(file.items.map((r) => JSON.stringify(r)));
    expect(rows.size).toBe(file.items.length);
    const byName = new Map<string, typeof items>();
    for (const d of items) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);
    for (const [name, list] of byName) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          expect(metres(list[i], list[j]), `${name} twice`).toBeGreaterThan(400);
        }
      }
    }
  });

  it("is sorted by kind, then name (re-running the script writes the same bytes)", () => {
    const order = Object.keys(file.kinds);
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1];
      const b = items[i];
      const byKind = order.indexOf(a.kind) - order.indexOf(b.kind);
      expect(byKind <= 0 && (byKind < 0 || a.name <= b.name), `${a.name} before ${b.name}`).toBe(true);
    }
  });

  it("places the well-known landmarks where they are (tolerances, not sources)", () => {
    const [tokyo] = named("東京駅");
    expect(metres(tokyo, { lat: 35.6812, lon: 139.7671 })).toBeLessThan(300);
    expect(tokyo.note).toContain("JR東日本");
    const [diet] = named("国会議事堂");
    expect(metres(diet, { lat: 35.6759, lon: 139.7448 })).toBeLessThan(200);
    const [haneda] = named("羽田空港");
    expect(haneda.kind).toBe("airport");
    expect(haneda.ward).toBe("大田区");
    // The hero models' positions (scripts/blender/landmarks.py) agree with OSM's towers.
    for (const name of ["東京タワー", "東京スカイツリー"]) {
      const model = landmarks.find((l) => l.name === name);
      const [tower] = named(name);
      expect(model, name).toBeDefined();
      expect(metres(tower, model as { lat: number; lon: number }), name).toBeLessThan(150);
    }
  });
});

const way = (osm: string, tags: Record<string, string>, pts: Array<[number, number]>): Feature => ({
  osm,
  tags,
  parts: [{ pts, inner: false }],
});

describe("what counts as a destination", () => {
  it("takes passenger stations, not gates, training or freight stations, or slope cars", () => {
    expect(isStation({ railway: "station", name: "東京" })).toBe(true);
    expect(isStation({ railway: "station", name: "大田", usage: "training" })).toBe(false);
    expect(isStation({ railway: "station", name: "東京貨物ターミナル" })).toBe(false);
    expect(isStation({ railway: "halt", name: "山頂駅", station: "funicular" })).toBe(false);
    expect(isStation({ railway: "station", name: "日暮里駅 南改札口" })).toBe(false);
  });

  it("names a place in Japanese even when `name` carries another script", () => {
    expect(nameOf({ name: "Храм Сенсодзи 金龍山 浅草寺", "name:ja": "浅草寺" })).toBe("浅草寺");
    expect(nameOf({ name: "東京ビッグサイト", "name:ja": "東京国際展示場" })).toBe("東京ビッグサイト");
  });

  it("counts a bridge only by its own wikidata, not the road's on its deck", () => {
    expect(kindsOf({ man_made: "bridge", name: "日本橋", wikidata: "Q1" })).toContain("bridge");
    const road = {
      highway: "primary",
      bridge: "yes",
      name: "中山道",
      "bridge:name": "戸田橋",
      wikidata: "Q2",
    };
    expect(kindsOf(road)).not.toContain("bridge");
    expect(kindsOf({ ...road, "bridge:wikidata": "Q3" })).toContain("bridge");
  });

  it("needs wikidata for temples and parks, not for museums; leaves out adult venues", () => {
    expect(kindsOf({ amenity: "place_of_worship", religion: "buddhist", name: "某寺" })).toEqual([]);
    expect(
      kindsOf({ amenity: "place_of_worship", religion: "buddhist", name: "某寺", wikidata: "Q1" }),
    ).toEqual(["temple"]);
    expect(kindsOf({ tourism: "museum", name: "凧の博物館" })).toEqual(["museum"]);
    expect(
      kindsOf({ tourism: "attraction", name: "吉原", "name:en": "Red Light District", wikidata: "Q1" }),
    ).toEqual([]);
  });
});

describe("where a place is", () => {
  it("joins a multipolygon's cut outline into a ring and takes its area centroid", () => {
    const rings = joinRings([
      [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      [
        [0, 0],
        [0, 2],
        [2, 2],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    const at = centreOf({ osm: "r1", tags: {}, parts: rings.map((pts) => ({ pts, inner: false })) });
    expect(at?.[0]).toBeCloseTo(1, 9);
    expect(at?.[1]).toBeCloseTo(1, 9);
  });

  it("takes an open line's middle by length (a bridge's carriageway)", () => {
    const at = centreOf(
      way("w1", {}, [
        [0, 0],
        [0.001, 0],
        [0.003, 0],
      ]),
    );
    expect(at?.[0]).toBeCloseTo(0.0015, 9);
  });
});
