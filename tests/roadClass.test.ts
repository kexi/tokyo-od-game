import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowsPedestrians,
  allowsRoadsideStop,
  classOf,
  hasRoadside,
  isDrivable,
  isEnterable,
  isExpressway,
  isLevelInconsistent,
  isOnGround,
  kindFromGsi,
  mapRank,
  takesJarticRules,
  usesGroundSurface,
  type RouteUse,
} from "../src/world/roadClass";
import type { RoadLine } from "../src/world/roads";
import { sourceFiles, stripComments } from "./sourceCode";

/** src/*.ts without comments (the word in a doc comment is not a branch). */
const FILES = sourceFiles("src");

/**
 * Where the word may stand, and why. Anything else that names it (a quoted kind, an object key,
 * a property) is a branch on GSI's expressway kind and belongs in roadClass.ts.
 */
const HIGHWAY_ALLOWED: Record<string, string> = {
  [join("src", "world", "roadClass.ts")]: "the kind itself",
  [join("src", "game", "credits.ts")]: "the OSM tag highway=traffic_signals in the credits text",
};
/** OSM's own `highway` tag, read by the expressway compiler. */
const isOsmCompiler = (path: string) => path.startsWith(join("src", "expressway") + "/");
/** Who may read `cls`, `structure` and `level` off a line: the accessors, and the compiler that sets them. */
const isLineFieldReader = (path: string) =>
  path === join("src", "world", "roadClass.ts") || isOsmCompiler(path);

const line = (kind: RoadLine["kind"], extra: Partial<RoadLine> = {}): RoadLine => ({
  coords: [139.76, 35.68, 139.761, 35.68],
  width: 9,
  oneway: 0,
  kind,
  ...extra,
});
const KINDS: RoadLine["kind"][] = ["national", "prefectural", "local", "narrow"];
const USES: RouteUse[] = ["navigation", "autopilot", "traffic", "spawn", "map"];
const PREDICATES = {
  allowsPedestrians,
  hasRoadside,
  takesJarticRules,
  usesGroundSurface,
  allowsRoadsideStop,
};

describe("road class (src/world/roadClass.ts)", () => {
  it('is the only file in src that names the GSI kind "highway" (quoted, as a key or a property)', () => {
    const offenders = FILES.filter(
      (f) => !(f.path in HIGHWAY_ALLOWED) && !isOsmCompiler(f.path) && /\bhighway\b/.test(f.code),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("is the only reader of a line's cls, structure and level outside the expressway compiler", () => {
    const offenders = FILES.filter(
      (f) => !isLineFieldReader(f.path) && /\bline\??\.(cls|structure|level)\b/.test(f.code),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("strips comments without swallowing code between a glob in a string and a later comment", () => {
    const code =
      'const glob = "assets/**/*.png";\nconst kind = "highway"; /* note */\n// tail\nconst t = `a${"b"}c`; // x';
    const stripped = stripComments(code);
    expect(stripped).toContain('const kind = "highway";');
    expect(stripped).toContain('"assets/**/*.png"');
    expect(stripped).toContain('`a${"b"}c`');
    expect(stripped).not.toContain("note");
    expect(stripped).not.toContain("tail");
  });

  it("reads GSI's 道路種別 and 高速道路フラグ into the kind as roadTiles always did", () => {
    expect(kindFromGsi(3, 0)).toBe("highway");
    expect(kindFromGsi(0, 1)).toBe("highway");
    expect(kindFromGsi(0, 0)).toBe("national");
    expect(kindFromGsi(1, 0)).toBe("prefectural");
    expect(kindFromGsi(2, 0)).toBe("local");
    expect(kindFromGsi(5, 0)).toBe("local");
  });

  it("gives every predicate the old answer for GSI lines: false on 高速道路, true on the rest", () => {
    const highway = line("highway");
    expect(classOf(highway)).toBe("expressway");
    expect(isExpressway(highway)).toBe(true);
    for (const [name, p] of Object.entries(PREDICATES)) expect([name, p(highway)]).toEqual([name, false]);
    for (const use of USES) expect([use, isDrivable(highway, use)]).toEqual([use, false]);
    for (const kind of KINDS) {
      const street = line(kind);
      expect(classOf(street)).toBe("street");
      expect(isExpressway(street)).toBe(false);
      for (const [name, p] of Object.entries(PREDICATES))
        expect([kind, name, p(street)]).toEqual([kind, name, true]);
      for (const use of USES) expect([kind, use, isDrivable(street, use)]).toEqual([kind, use, true]);
    }
  });

  it("keeps pedestrians and street furniture off OSM expressway and ramp lines, whatever their kind", () => {
    for (const cls of ["expressway", "ramp"] as const) {
      const deck = line("national", { source: "osm", cls, structure: "viaduct", level: 1 });
      expect(allowsPedestrians(deck)).toBe(false);
      expect(hasRoadside(deck)).toBe(false);
      expect(takesJarticRules(deck)).toBe(false);
      expect(allowsRoadsideStop(deck)).toBe(false);
      expect(usesGroundSurface(deck)).toBe(false);
    }
  });

  it("opens the OSM expressway to the map and the spawn only (P3), never GSI's own 高速道路 lines", () => {
    const opened: RouteUse[] = ["spawn", "map"];
    for (const cls of ["expressway", "ramp"] as const) {
      const deck = line("national", { source: "osm", cls, structure: "viaduct", level: 1 });
      for (const use of USES)
        expect([cls, use, isDrivable(deck, use)]).toEqual([cls, use, opened.includes(use)]);
      expect(isDrivable(deck, "guide")).toBe(false);
      expect(isEnterable(deck)).toBe(true);
    }
    const gsi = line("highway");
    for (const use of [...USES, "guide" as const]) expect(isDrivable(gsi, use)).toBe(false);
    expect(isEnterable(gsi)).toBe(false);
  });

  it("closes tunnels and cuttings to every use until P9 gives them a floor", () => {
    for (const structure of ["tunnel", "cut"] as const) {
      const street = line("local", { structure, level: -1 });
      const xw = line("national", { source: "osm", cls: "expressway", structure, level: -1 });
      for (const use of USES) {
        expect(isDrivable(street, use)).toBe(false);
        expect(isDrivable(xw, use)).toBe(false);
      }
      expect(isEnterable(street)).toBe(false);
    }
  });

  it("lets every ground street be a junction's approach or exit, as hasRoadside did", () => {
    for (const kind of KINDS) expect(isEnterable(line(kind))).toBe(hasRoadside(line(kind)));
  });

  it("calls a line on the ground only at level 0 and carried by the ground, and flags contradictions", () => {
    expect(isOnGround(line("local"))).toBe(true);
    expect(isOnGround(line("local", { level: 0, structure: "viaduct" }))).toBe(false);
    expect(isOnGround(line("local", { level: 1 }))).toBe(false);
    expect(isOnGround(line("local", { structure: "tunnel" }))).toBe(false);
    expect(isLevelInconsistent(line("local", { level: 1 }))).toBe(true);
    expect(isLevelInconsistent(line("local", { level: 0, structure: "viaduct" }))).toBe(true);
    expect(isLevelInconsistent(line("local", { level: 1, structure: "viaduct" }))).toBe(false);
    expect(isLevelInconsistent(line("local"))).toBe(false);
  });

  it("draws the in-car map narrow streets first and the expressway last, as before", () => {
    const ranks = (["narrow", "local", "prefectural", "national", "highway"] as const).map((k) =>
      mapRank(line(k)),
    );
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
    expect(mapRank(line("local", { cls: "ramp" }))).toBe(4);
  });

  it("drives but does not paint, walk or furnish a street off the ground (P7's 臨港道路 on a viaduct)", () => {
    const upper = line("local", { source: "osm", cls: "street", structure: "viaduct", level: 1 });
    expect(usesGroundSurface(upper)).toBe(false);
    expect(allowsPedestrians(upper)).toBe(false);
    expect(hasRoadside(upper)).toBe(false);
    // Its limit is its own (OSM maxspeed), not the rules of the streets it passes over.
    expect(takesJarticRules(upper)).toBe(false);
    // Closed to the navi, the autopilot and the traffic AI until P6 opens the decks; drawn on the
    // map and a car may be put back on it (spawn).
    for (const use of ["navigation", "autopilot", "traffic", "guide"] as const)
      expect(isDrivable(upper, use), use).toBe(false);
    for (const use of ["spawn", "map"] as const) expect(isDrivable(upper, use), use).toBe(true);
    // The same street on the ground stays open to every route.
    const ground = line("local", { source: "osm", cls: "street", structure: "ground", level: 0 });
    expect(isDrivable(ground, "navigation")).toBe(true);
    expect(usesGroundSurface(line("local", { structure: "tunnel" }))).toBe(false);
  });
});
