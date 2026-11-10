import { z } from "zod";
import { warn } from "../log";

/**
 * The floors of a bridge whose structure is a landmark model drawn without its roads (レインボーブリッジ):
 * the road network builds the decks and pins them to these levels. Written by
 * scripts/blender/rainbow_bridge_spec.py into landmarks.json (`deckLevels`); no three.js here, so
 * build scripts and tests parse it as well as the game.
 *
 * Conventions, defined only here:
 * - **s** (m): distance along the bridge axis from `axis.origin`, positive toward `axis.bearing`
 *   (芝浦 → 台場 for the Rainbow Bridge).
 * - **offset** (m): horizontal distance across the axis, positive to the **left** of +s. With
 *   left-hand traffic the `forward` carriageway (travelling +s) lies at positive offsets.
 * - Heights are T.P. (m), before the geoid is added; lon/lat are WGS84.
 * - Profile: underside(s) = `undersideAtMid − k·s²`; a floor's surface = underside(s) +
 *   `aboveUnderside[level]`. Evaluate this formula rather than interpolating the stations (between
 *   ~23 m stations a linear interpolation kinks the grade by up to 0.1 %); the stations carry the
 *   same values rounded to 1 mm, with the grade dh/ds at each.
 * - Matching rule: a road segment matches a strip when its centre line lies within
 *   `tolerance.horizontal` (3 m) of the line "axis + the strip's centre offset", measured
 *   horizontally, and its height within `tolerance.vertical` of the formula. The same rule compares
 *   each strip with its OpenStreetMap ways (`osmWays`). The OSM ways sit on average
 *   `osmBias.meanOffset` (−0.68 m) to the right of the towers' axis; the axis is kept on the towers
 *   (the structure is built on it) and the bias is recorded and counted within the 3 m.
 */
export const DECK_LEVELS_VERSION = 1;

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const range = z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, "range must increase");

/** Neutral uses: route and operator names stay out of the data. */
const Use = z.enum(["expressway", "localRoad", "transit"]);
const StripKind = z.enum(["carriageway", "shoulder", "median", "barrier", "verge", "guideway", "walkway"]);

const StripSchema = z
  .object({
    kind: StripKind,
    /** Offsets of the strip's two edges (m), `from` < `to`. */
    from: z.number(),
    to: z.number(),
    use: Use.optional(),
    /** Carriageways: which way they carry traffic along s. */
    direction: z.enum(["forward", "backward"]).optional(),
    lanes: z.number().int().positive().optional(),
    laneWidth: z.number().positive().optional(),
    /** Carriageways: cross slope (fraction) falling toward `crossfallDown`. */
    crossfall: z.number().min(0).max(0.08).optional(),
    crossfallDown: z.enum(["outer", "inner"]).optional(),
    /** Walkways: which side of the bridge. */
    name: z.enum(["north", "south"]).optional(),
    /** OpenStreetMap ways that should match this strip (ids, ODbL data). */
    osmWays: z.array(z.number().int().positive()).optional(),
  })
  .refine((s) => s.from < s.to, "strip edges must increase")
  .refine((s) => s.kind !== "carriageway" || (s.use && s.direction && s.lanes && s.laneWidth && s.osmWays), {
    message: "a carriageway needs use, direction, lanes, laneWidth and osmWays",
  });

const StationSchema = z.object({
  s: z.number(),
  lon: z.number(),
  lat: z.number(),
  /** T.P. (m) of the floor's surface, 3 decimals. */
  h: z.number(),
  /** dh/ds (fraction) along +s. */
  grade: z.number(),
  segment: z.enum(["girder", "anchorage"]),
});

const LevelSchema = z.object({
  /** Between the inner faces of the two outer barriers (m): the strips fill exactly this width. */
  betweenOuterBarriers: z.number().positive(),
  strips: z.array(StripSchema).min(1),
  stations: z.array(StationSchema).min(2),
});

export const DeckLevelsSchema = z.object({
  version: z.literal(DECK_LEVELS_VERSION),
  datum: z.object({ horizontal: z.literal("WGS84"), vertical: z.literal("TP") }),
  axis: z.object({
    origin: lonLat,
    /** Degrees clockwise from north of +s. */
    bearing: z.number().min(0).max(360),
    /** s covered by the stations: the girder and the anchorages under the decks. */
    sRange: range,
    /** s of the suspended girder's ends (its bearings on the anchorages). */
    girderRange: range,
    /** s where the road side must not put piers of its own (the spans and the anchorages carry the decks). */
    pierFreeRange: range,
  }),
  profile: z.object({
    kind: z.literal("parabola"),
    undersideAtMid: z.number(),
    k: z.number().positive(),
    aboveUnderside: z.object({ upper: z.number(), lower: z.number() }),
    /** dh/ds at the ends of sRange (start = smallest s), for the approaches to continue smoothly. */
    endGrades: z.object({ start: z.number(), end: z.number() }),
    girderEndGrades: z.object({ start: z.number(), end: z.number() }),
  }),
  tolerance: z.object({ horizontal: z.number().positive(), vertical: z.number().positive() }),
  osmBias: z.object({ meanOffset: z.number(), decision: z.enum(["recorded", "axisShifted"]) }),
  /** Where the decks run over an anchorage: the clear width between its cable housings and the bearing's top. */
  anchorages: z.array(
    z.object({
      sFrom: z.number(),
      sTo: z.number(),
      clearHalfWidth: z.number().positive(),
      bearingTop: z.number(),
      housingTop: z.number(),
    }),
  ),
  levels: z.object({ upper: LevelSchema, lower: LevelSchema }),
});

export type DeckLevels = z.infer<typeof DeckLevelsSchema>;
export type DeckLevel = DeckLevels["levels"]["upper"];
export type DeckStrip = DeckLevel["strips"][number];

/** Surface height (T.P. m) of a floor at s, from the profile formula. */
export function deckHeight(d: DeckLevels, level: "upper" | "lower", s: number): number {
  const p = d.profile;
  return p.undersideAtMid - p.k * s * s + p.aboveUnderside[level];
}

/** Grade dh/ds of either floor at s. */
export function deckGrade(d: DeckLevels, s: number): number {
  return -2 * d.profile.k * s;
}

/** Centre offset of a strip (m, + = left of +s). */
export const stripCentre = (strip: Pick<DeckStrip, "from" | "to">): number => (strip.from + strip.to) / 2;

/**
 * A landmark entry's deck levels, parsed with DeckLevelsSchema: null when the entry has none or they
 * do not parse (then warned with the landmark's id), so a road is never pinned to numbers that do not
 * match this schema. The landmark entry's own schema (landmarkEntry.ts) passes the field through.
 */
export function deckLevelsOf(entry: { id: string; deckLevels?: unknown }): DeckLevels | null {
  if (entry.deckLevels === undefined) return null;
  const parsed = DeckLevelsSchema.safeParse(entry.deckLevels);
  if (parsed.success) return parsed.data;
  warn("landmark_deck_levels_invalid", { landmarkId: entry.id, error: parsed.error.message });
  return null;
}
