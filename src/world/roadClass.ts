import type { RoadLine } from "./roads";

/**
 * What a road is, and what follows from it, in one place. Before this module 48 places across src
 * asked whether a line was GSI's 高速道路 kind, and each meant something else by it: no pedestrians,
 * no JARTIC matching, no painted surface, no routing, no roadside furniture. They now ask a
 * predicate named for what they mean (knowledge/road-model.md has the table). tests/roadClass.test.ts
 * fails on the word anywhere else in src, and on a direct read of `cls`, `structure` or `level`
 * outside this module and src/expressway.
 *
 * Today every line is a GSI centreline on the ground, and the GSI 高速道路 lines (rdCtg 3 or
 * motorway 1) are "expressway": the defaults below give each predicate the answer the old kind
 * test gave. The OSM-built expressway chunks (src/expressway, P3) set `cls`, `structure` and
 * `level` themselves.
 */

/** GSI 道路種別 as RoadLine.kind keeps it (rdCtg / motorway, src/world/roadTiles.ts). */
export type RoadKind = "highway" | "national" | "prefectural" | "local" | "narrow";
/** Where the centreline came from. */
export type RoadSource = "gsi" | "osm";
/** What the road is for: the kind (行政区分) stays alongside it. */
export type RoadClass = "street" | "expressway" | "ramp";
/** How it is carried: on the ground, on a viaduct, in a tunnel or a cutting. */
export type RoadStructure = "ground" | "viaduct" | "tunnel" | "cut";

const EXPRESSWAY_KIND: RoadKind = "highway";

/** RoadLine.kind from GSI's 道路種別 (rdCtg) and 高速道路フラグ (motorway). */
export function kindFromGsi(rdCtg: number, motorway: number): RoadKind {
  const isExpressway = rdCtg === 3 || motorway === 1;
  if (isExpressway) return EXPRESSWAY_KIND;
  if (rdCtg === 0) return "national";
  if (rdCtg === 1) return "prefectural";
  return "local";
}

export const sourceOf = (line: RoadLine): RoadSource => line.source ?? "gsi";
export const structureOf = (line: RoadLine): RoadStructure => line.structure ?? "ground";
/** 0 on the ground; decks above count up, tunnels down. Part of the junction key (roads.ts). */
export const levelOf = (line: RoadLine): number => line.level ?? 0;

/**
 * On the ground: level 0 and carried by the ground (not a 橋 deck of its own, a tunnel or a
 * cutting). The one definition of "ground" every predicate and the graph's default search use.
 */
export const isOnGround = (line: RoadLine): boolean => levelOf(line) === 0 && structureOf(line) === "ground";

/**
 * Whether `level` and `structure` contradict each other: a ground line off level 0, or a viaduct
 * at or below it. The graph logs these (road_level_mismatch) instead of guessing which is right.
 */
export function isLevelInconsistent(line: RoadLine): boolean {
  const level = levelOf(line);
  const structure = structureOf(line);
  const isGroundOffLevel = structure === "ground" && level !== 0;
  const isLowViaduct = structure === "viaduct" && level <= 0;
  return isGroundOffLevel || isLowViaduct;
}

/** The line's class: as given, or from the GSI kind (高速道路 → expressway). */
export function classOf(line: RoadLine): RoadClass {
  if (line.cls) return line.cls;
  return line.kind === EXPRESSWAY_KIND ? "expressway" : "street";
}

const isStreet = (line: RoadLine): boolean => classOf(line) === "street";

/**
 * 自動車専用道路 (main line or ramp): drawn as such on the maps, matched to expressway orbis, and
 * 60 km/h where nothing is posted (首都高 is not a 高速自動車国道, 施行令 第27条).
 */
export const isExpressway = (line: RoadLine): boolean => !isStreet(line);

/**
 * Pedestrians may walk it (歩道, 横断, the walking route). Permanently false off the streets:
 * 自動車専用道路 are for motor vehicles only. Off the ground too, for now: a street on a viaduct
 * (P7's 臨港道路 under the Rainbow Bridge) has no 歩道 in the data.
 */
export const allowsPedestrians = (line: RoadLine): boolean => isStreet(line) && isOnGround(line);

/**
 * Street furniture and street-side equipment belong on it: lamps, hydrant signs, 信号, 横断歩道,
 * portable orbis, street-type guide sign poles. Permanently false off the streets: the
 * expressway's own furniture (壁高欄, its signs) comes with its deck. On the ground only, as above.
 */
export const hasRoadside = (line: RoadLine): boolean => isStreet(line) && isOnGround(line);

/**
 * JARTIC 交通規制 are matched onto it. JARTIC covers the 警視庁 street rules; on the expressway the
 * limits come from OSM, and a viaduct over a street must not take that street's rules.
 */
export const takesJarticRules = (line: RoadLine): boolean => isStreet(line);

/**
 * Drawn as a street on the terrain (asphalt, lines, bridges over water) and stood on by cars at
 * ground level. False for the expressway: its deck is drawn by expresswayDeck.ts.
 */
export const usesGroundSurface = (line: RoadLine): boolean => isStreet(line) && isOnGround(line);

/** Who asks whether a road may be driven: each can be opened to the expressway on its own. */
export type RouteUse = "navigation" | "autopilot" | "traffic" | "spawn" | "map";

/**
 * Which uses may take the expressway. All closed until it has colliders, graph links and merges
 * (P3, P6); opening one is a change here, not at its call sites. Why not one flag: the navi can
 * route over a ramp long before the traffic AI can merge.
 */
const EXPRESSWAY_OPEN: Readonly<Record<RouteUse, boolean>> = {
  navigation: false,
  autopilot: false,
  traffic: false,
  spawn: false,
  map: false,
};

/** Whether `use` may route a car over the road (width and closures are the caller's). */
export function isDrivable(line: RoadLine, use: RouteUse): boolean {
  if (isStreet(line)) return true;
  return EXPRESSWAY_OPEN[use];
}

/**
 * A car may pull over and stand at its side (patrols, checkpoints). False on the expressway for
 * now: 駐停車 there is banned (道路交通法 第75条の8) except in emergencies.
 */
export const allowsRoadsideStop = (line: RoadLine): boolean => isStreet(line);

/**
 * Rank of a road for drawing order on the in-car map: narrow streets under wide ones, the
 * expressway on top.
 */
export function mapRank(line: RoadLine): number {
  if (isExpressway(line)) return 4;
  const rank: Record<Exclude<RoadKind, typeof EXPRESSWAY_KIND>, number> = {
    narrow: 0,
    local: 1,
    prefectural: 2,
    national: 3,
  };
  return rank[line.kind as Exclude<RoadKind, typeof EXPRESSWAY_KIND>];
}
