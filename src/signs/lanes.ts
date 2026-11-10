/**
 * Lane lists of 進行方向別通行区分 (327の7) and the per-lane 専用・優先 marks, read the way
 * scripts/textures/signs/lanes.py reads them (`parse` and `slug` there), so a key made here names
 * the PNG the generator draws for it.
 */

/** OSM turn:lanes words in the order the key writes them, with their letters. */
const DIRECTIONS = [
  ["reverse", "u"],
  ["left", "l"],
  ["slight_left", "hl"],
  ["through", "t"],
  ["slight_right", "hr"],
  ["right", "r"],
] as const;

export const LANE_USES = { bus: "bus", bus_priority: "busp", bicycle: "cyc" } as const;
export type LaneUseKind = keyof typeof LANE_USES;

/**
 * One lane, left lane first: OSM words joined by `+` or `;` ("left;through"), a list of words, or
 * the words with a 専用・優先 use.
 */
export type LaneSpec = string | readonly string[] | { dirs: string; use: LaneUseKind };

type ParsedLane = { dirs: string[]; use: LaneUseKind | null };

/**
 * Lanes with their directions in key order. A whole OSM value ("left;through|through|right") is
 * split at `|`; unknown words are dropped and a lane left empty goes straight on (as lanes.py and
 * src/world/regulations.ts read turn:lanes).
 */
export function parseLanes(lanes: string | readonly LaneSpec[]): ParsedLane[] {
  const list = typeof lanes === "string" ? lanes.split("|") : lanes;
  return list.map((lane) => {
    const isWithUse = typeof lane === "object" && !Array.isArray(lane);
    const use = isWithUse ? (lane as { use: LaneUseKind }).use : null;
    const words = isWithUse ? (lane as { dirs: string }).dirs : (lane as string | readonly string[]);
    const given = new Set(
      (typeof words === "string" ? words.replace(/\+/g, ";").split(";") : words).map((w) => w.trim()),
    );
    const dirs = DIRECTIONS.filter(([d]) => given.has(d)).map(([d]) => d as string);
    return { dirs: dirs.length > 0 ? dirs : ["through"], use };
  });
}

const LETTER = new Map<string, string>(DIRECTIONS);

/** The render key: lanes joined by "-", a use after "~" (left;through|through|right → lt-t-r). */
export function laneKey(lanes: string | readonly LaneSpec[]): string {
  return parseLanes(lanes)
    .map(({ dirs, use }) => dirs.map((d) => LETTER.get(d)).join("") + (use ? `~${LANE_USES[use]}` : ""))
    .join("-");
}

const ONE_LANE_SIGN: Record<string, string> = {
  through: "327の7-D",
  left: "327の7-C",
  "left,through": "327の7-B",
};

/**
 * The number a lane render is a face of: a lane with a use belongs to 327の5 (a 優先 lane) or
 * 327の4 (専用); one lane is 327の7-D (直進), -C (左折), -B (左折・直進, and any other single set,
 * as 図示 B is the one with two arrows); more lanes 327の7-A.
 */
export function laneSign(lanes: string | readonly LaneSpec[]): string {
  const parsed = parseLanes(lanes);
  const isPriority = parsed.some((l) => l.use === "bus_priority");
  if (isPriority) return "327の5";
  const hasUse = parsed.some((l) => l.use !== null);
  if (hasUse) return "327の4";
  const isOneLane = parsed.length === 1;
  if (!isOneLane) return "327の7-A";
  return ONE_LANE_SIGN[parsed[0].dirs.join(",")] ?? "327の7-B";
}
