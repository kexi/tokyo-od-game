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

/** The kind (行政区分) an OSM expressway line carries: GSI's 高速道路 class, which it replaces. */
export const OSM_EXPRESSWAY_KIND: RoadKind = EXPRESSWAY_KIND;

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
 * 60 km/h where nothing is posted (the 都市高速 is not a 高速自動車国道, 施行令 第27条).
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
 * limits come from OSM, and a viaduct over a street must not take that street's rules. On the
 * ground only: a street on a viaduct (P7's 臨港道路 on the Rainbow Bridge, compiled from OSM with its
 * own maxspeed) passes over streets whose rules it would otherwise pick up by position.
 */
export const takesJarticRules = (line: RoadLine): boolean => isStreet(line) && isOnGround(line);

/**
 * Drawn as a street on the terrain (asphalt, lines, bridges over water) and stood on by cars at
 * ground level. False for the expressway: its deck is drawn by expresswayDeck.ts.
 */
export const usesGroundSurface = (line: RoadLine): boolean => isStreet(line) && isOnGround(line);

/**
 * Who asks whether a road may be driven: each can be opened to the expressway on its own. "guide"
 * is the guide boards' route numbers (guidePlan.ts): which street a 国道・都道 number belongs to, not
 * where a car may go, so opening the navi to the expressway does not move a number onto a ramp.
 */
export type RouteUse = "navigation" | "autopilot" | "traffic" | "spawn" | "map" | "guide";

/**
 * Which uses may take the OSM expressway. P3 opened the map and spawn (the decks have colliders
 * and the chunks are in the graph); P6 the navi, the autopilot and the traffic AI, with the lane
 * links of the merges and diverges (laneLinks.ts) and the yielding at a merge (merging.ts). The
 * guide boards' route numbers stay off it: a 国道・都道 number does not belong on a ramp. Opening
 * one is a change here, not at its call sites. Why not one flag: the navi could route over a ramp
 * long before the traffic AI could merge.
 */
const EXPRESSWAY_OPEN: Readonly<Record<RouteUse, boolean>> = {
  navigation: true,
  autopilot: true,
  traffic: true,
  spawn: true,
  map: true,
  guide: false,
};

/**
 * Which uses may take a street on a deck (P7's 臨港道路 on the Rainbow Bridge's lower floor). Like
 * the expressway until P6: the car may drive it (the player, the steady-speed hook) and be put back
 * on it, and the map draws it; the navi, the autopilot and the traffic AI do not route over it yet.
 * Why not open with the streets: it joins the expressway's ramps (台場出口) on a deck, where those
 * would follow it into decks they are not opened to, and its merges wait for LaneLink as theirs do.
 */
const DECK_STREET_OPEN: Readonly<Record<RouteUse, boolean>> = {
  navigation: false,
  autopilot: false,
  traffic: false,
  spawn: true,
  map: true,
  guide: false,
};

/**
 * Carried so a car can drive it now: the ground, a viaduct, and the expressway's tunnels and cuts
 * (P9: expresswayBore.ts gives them a floor, walls and a roof with colliders). GSI's own tunnel
 * lines have none of that.
 */
const isOpenStructure = (line: RoadLine): boolean => {
  const structure = structureOf(line);
  const isCarried = structure === "ground" || structure === "viaduct";
  const isBuiltBelow = (structure === "tunnel" || structure === "cut") && sourceOf(line) === "osm";
  return isCarried || isBuiltBelow;
};

/**
 * Whether `use` may route a car over the road (width and closures are the caller's). GSI's own
 * 高速道路 lines stay closed for every use: they are a single centreline for both directions with
 * no ramps, and where the OSM chunks are loaded they are dropped (expresswayRoads.ts).
 */
export function isDrivable(line: RoadLine, use: RouteUse): boolean {
  if (!isOpenStructure(line)) return false;
  if (isStreet(line)) return isOnGround(line) || DECK_STREET_OPEN[use];
  const isGsiExpressway = sourceOf(line) === "gsi";
  if (isGsiExpressway) return false;
  return EXPRESSWAY_OPEN[use];
}

/**
 * A road a car can turn into or arrive from at a junction: the streets, and the OSM expressway
 * where it meets them (an on-ramp leaving a street junction is one of its exits, an off-ramp one of
 * its approaches). Not the same as hasRoadside: an off-ramp's end gets a stop line and may face a
 * signal, but no lamps or 歩道 stand on it. GSI's 高速道路 lines stay out, as before P3.
 */
export function isEnterable(line: RoadLine): boolean {
  if (!isOpenStructure(line)) return false;
  if (isStreet(line)) return isOnGround(line);
  return sourceOf(line) === "osm";
}

/**
 * A car may pull over and stand at its side (patrols, checkpoints). False on the expressway for
 * now: 駐停車 there is banned (道路交通法 第75条の8) except in emergencies.
 */
export const allowsRoadsideStop = (line: RoadLine): boolean => isStreet(line);

/**
 * A street the local patrol (所轄のパトカー・白バイ) appears on and cruises to: a street on the
 * ground it may drive. Not the expressway, which the game gives no patrol of its own (高速隊); a
 * chase may still follow the player onto it (the autopilot's routes). Why not allowsRoadsideStop
 * (as before P6): that says where a car may pull over, not where a patrol drives.
 */
export const isPatrolStreet = (line: RoadLine): boolean =>
  isStreet(line) && isOnGround(line) && isDrivable(line, "autopilot");

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
