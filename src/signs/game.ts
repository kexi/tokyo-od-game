import { auxKey, type AuxPlate } from "./auxPlates";
import { laneKey } from "./lanes";

/**
 * The game's sign types and how a placed sign finds its artwork. The codes are what
 * src/world/regulations.ts stores in PlacedSign.type; which 別表第一 number and face each type
 * shows is declared on the definitions (`game` in src/signs/defs) and reaches the game as
 * assets/signs/game.json (src/signs/gameTable.ts), so the game bundles neither the definitions
 * (their names and notes) nor the catalogue.
 *
 * Why not derive the codes from the definitions: a code travels as a number (the packed sign
 * anchors, the road-network worker's messages) and must not shift when a definition is added.
 */
export const SIGN = {
  speed: 1,
  oneway: 2,
  noEntry: 3,
  noParking: 4,
  noStopping: 5,
  noUturn: 6,
  slow: 7,
  turn: 8, // value: the directions allowed (1 left, 2 straight, 4 right)
  crosswalk: 9, // placed at runtime at crossings without signals
  stop: 10, // placed at runtime at 一時停止 approaches
  closed: 11, // at the entrances of streets under 通行禁止
  pedestrianRoad: 12, // mostly with school-run hours
  roadClosed: 13,
  motorClosed: 14, // with a 補助 text
  noPedestrianCrossing: 15,
  noOvertakeRight: 16,
  noOvertake: 17,
  noVehicleCrossing: 18,
  horn: 19,
  bikeOnPavement: 20,
  parkingAllowed: 21,
  timedParking: 22,
  busLane: 23,
  bikeLane: 24,
  busPriority: 25,
  vehicleClass: 26,
  laneArrows: 27, // the lanes in PlacedSign.lanes
  hydrant: 28, // 法定外: the red disc at hydrants
  school: 29,
  schoolRoute: 30, // 法定外 plate, under 歩行者専用 in school hours
} as const;

export type GameSignKind = keyof typeof SIGN;
export const GAME_SIGN_KINDS = Object.keys(SIGN) as [GameSignKind, ...GameSignKind[]];

/**
 * How a placed sign of a type picks its face: the definition's default face; the face whose
 * `gameValue` is the placed value (速度の値, the turn mask); the lane render of the placed lanes.
 */
export const GAME_PICKS = ["default", "value", "lanes"] as const;
export type GamePick = (typeof GAME_PICKS)[number];

/**
 * A face as the game draws it: the number, the PNG without .png, the signs.glb plate node and the
 * scale the plate is drawn at (the definition's displayScale; none on a 補助標識, which takes the
 * scale of the plate it hangs under).
 */
export type GameFace = { id: string; file: string; plate: string; scale?: number; value?: number };

export type GameKindEntry = {
  pick: GamePick;
  /** "default": the one face; "value": one per value; "lanes": none (see `lanes`). */
  faces: GameFace[];
  /** "lanes": the lane renders by key (src/signs/lanes.ts laneKey). */
  lanes?: Record<string, GameFace>;
  /** Mounted along the street with this face on the other side (一方通行 326-A). */
  back?: GameFace;
  parallel?: true;
  /** Back-to-back copies of the face, one per direction (横断歩道). */
  bothFaces?: true;
};

/** assets/signs/game.json. `aux`: the 補助標識 faces by auxPlates.ts auxKey. */
export type GameTable = {
  kinds: Partial<Record<GameSignKind, GameKindEntry>>;
  aux: Record<string, GameFace>;
};

/**
 * The artwork of a placed sign: `id` is the 別表第一 number shown (311-A, not the old turn_3),
 * `shape` the plate node, `scale` how much larger than 図示 it is drawn (within 別表第二
 * 備考一(二), src/signs/schema.ts ENLARGEMENT). `bothFaces`: back-to-back copies; `parallel`: along
 * the street with `back` as the other face (道路標識設置基準 3-1-4: 平行又は斜め 0°〜45°).
 */
export type Design = {
  id: string;
  file: string;
  shape: string;
  scale: number;
  bothFaces?: boolean;
  parallel?: boolean;
  back?: string;
};

const KIND_OF = new Map<number, GameSignKind>(
  Object.entries(SIGN).map(([kind, code]) => [code, kind as GameSignKind]),
);

function pickFace(entry: GameKindEntry, value: number, lanes?: readonly string[][]): GameFace | undefined {
  switch (entry.pick) {
    case "default":
      return entry.faces[0];
    case "value":
      return entry.faces.find((f) => f.value === value);
    case "lanes":
      // A lane with no direction (or only words laneKey does not know) is read as straight on, as
      // turn:lanes is read everywhere (lanes.ts parseLanes): [[], ["right"]] shows 327-7_t-r.
      return lanes ? entry.lanes?.[laneKey(lanes)] : undefined;
  }
}

/** The design of a placed sign (type code, value, lanes), or null when the type has no face for it. */
export function designFor(
  table: GameTable,
  type: number,
  value: number,
  lanes?: readonly string[][],
): Design | null {
  const kind = KIND_OF.get(type);
  const entry = kind === undefined ? undefined : table.kinds[kind];
  if (!entry) return null;
  const face = pickFace(entry, value, lanes);
  if (!face) return null;
  return {
    id: face.id,
    file: face.file,
    shape: face.plate,
    scale: face.scale ?? 1,
    ...(entry.back ? { back: entry.back.file } : {}),
    ...(entry.parallel ? { parallel: true } : {}),
    ...(entry.bothFaces ? { bothFaces: true } : {}),
  };
}

/**
 * The face of a 補助標識 hung under a plate drawn at `scale`, or null when it was not drawn ahead
 * of time (public/data/regs newer than registry.json; the registry test fails on that).
 */
export function auxDesignFor(table: GameTable, plate: AuxPlate, scale: number): Design | null {
  const face = table.aux[auxKey(plate)];
  if (!face) return null;
  return { id: face.id, file: face.file, shape: face.plate, scale };
}
