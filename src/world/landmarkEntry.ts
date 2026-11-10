import { z } from "zod";

/**
 * The shape of public/data/landmarks.json (written by scripts/blender/landmarks.py and the modules it
 * registers), and what the game derives from an entry without three.js: the footprints whose PLATEAU
 * copies are left out and those walled off, and where warps and destinations land. Kept apart from
 * landmarks.ts (models, LOD, lighting) so the tests and the credits can read entries in Node.
 */

/** [lon, lat]. */
const LonLat = z.tuple([z.number(), z.number()]);
/** A closed lon/lat ring (the first point is not repeated): three points at least. */
const Ring = z.array(LonLat).min(3);

const RuleSchema = z.object({
  mode: z.string(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  weekdays: z.array(z.number().int()).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * Loose objects: fields the game does not read here (sources' notes, colorByMonth, a landmark's own
 * data such as a bridge's deck levels) pass through untouched. Why not strict: a later landmark adding
 * a field of its own would otherwise drop every landmark from the game until this schema knew it.
 * A landmark's own field is parsed where it is used, with its own schema (safeParse, e.g. a bridge's
 * deckLevels in its own module), not added here; tests/landmarks.test.ts keeps a register of them.
 */
export const LandmarkEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The near file, relative to the site's base (models/<id>.glb). */
  model: z.string().min(1),
  /** The far silhouette file (models/<id>_far.glb). */
  farModel: z.string().min(1),
  lon: z.number(),
  lat: z.number(),
  /** Degrees clockwise from north that the model's +Z faces. */
  heading: z.number(),
  /** T.P. height (m) of the model's origin. */
  baseHeight: z.number(),
  /** m: nearer than this the near file is shown. */
  farDistance: z.number().positive(),
  footprint: Ring,
  /** m above the base: the model's height (for reading; the game takes heights from the model). */
  height: z.number().optional(),
  /** More rings whose PLATEAU buildings are left out (several buildings under one model); walled with `solid`. */
  extraFootprints: z.array(Ring).optional(),
  plateau: z.array(z.looseObject({ gmlId: z.string(), hide: z.boolean() })).optional(),
  /**
   * Collision walls on footprint and extra rings: true even when no PLATEAU building is hidden, false
   * none even when one is (a bridge over the roads it stands on). Not given: walls where one is hidden.
   */
  solid: z.boolean().optional(),
  /** false: the far silhouette keeps its width with distance (a long, low bridge would grow fat). */
  widenFar: z.boolean().optional(),
  /** Where a warp or a destination lands ([lon, lat]), when not at lon/lat (a bridge over the sea). */
  warpAt: LonLat.optional(),
  /** Not offered as a warp or a destination (a building only seen on the way). */
  excludeFromWarp: z.boolean().optional(),
  /**
   * Node names in the model files: only nodes.near of the near file is shown (the file may also carry
   * the far node). Required, not derived from the id: modules name their nodes their own way.
   */
  nodes: z.object({ near: z.string().min(1), far: z.string().min(1) }),
  /** A free note for the reader of the file. */
  note: z.string().optional(),
  /** Attribution the landmark's data needs, listed under the landmarks in the credits. */
  sources: z.array(z.string()).optional(),
  lightSchedule: z.looseObject({
    on: z.string(),
    off: z.string(),
    rules: z.array(RuleSchema).optional(),
    cycle: z.object({ modes: z.array(z.string()).min(1), epoch: z.string() }).optional(),
    after: z.string(),
  }),
  lightModes: z.array(z.looseObject({ id: z.string() })),
});
export const LandmarkFileSchema = z.array(LandmarkEntrySchema);
export type LandmarkEntry = z.infer<typeof LandmarkEntrySchema>;

const hidesPlateau = (e: Pick<LandmarkEntry, "plateau">) => e.plateau?.some((p) => p.hide) ?? false;

/**
 * Rings (lon/lat) whose PLATEAU buildings are left out: the footprint of a landmark that hides a
 * PLATEAU building, and every landmark's extra rings. Why not the footprint of every landmark: a
 * bridge's footprint is its bounding box (926 m), far more than it replaces.
 */
export function hiddenFootprints(
  entries: readonly Pick<LandmarkEntry, "footprint" | "extraFootprints" | "plateau">[],
): Array<Array<[number, number]>> {
  return entries.flatMap((e) => [...(hidesPlateau(e) ? [e.footprint] : []), ...(e.extraFootprints ?? [])]);
}

/**
 * Rings (lon/lat) that get collision walls: footprint and extra rings of a landmark with `solid`, or,
 * when `solid` is not given, of one that hides a PLATEAU building (nothing else would stop a car).
 */
export function walledFootprints(
  entries: readonly Pick<LandmarkEntry, "footprint" | "extraFootprints" | "plateau" | "solid">[],
): Array<Array<[number, number]>> {
  return entries.flatMap((e) => {
    const hasWalls = e.solid ?? hidesPlateau(e);
    return hasWalls ? [e.footprint, ...(e.extraFootprints ?? [])] : [];
  });
}
/** The landmarks offered as warps and destinations, at their landing point (warpAt, else lon/lat). */
export function landmarkPlaces(
  entries: readonly Pick<LandmarkEntry, "name" | "lon" | "lat" | "warpAt" | "excludeFromWarp">[],
  kind: string,
): Array<{ name: string; kind: string; lat: number; lon: number }> {
  return entries
    .filter((e) => e.excludeFromWarp !== true)
    .map((e) => {
      const [lon, lat] = e.warpAt ?? [e.lon, e.lat];
      return { name: e.name, kind, lat, lon };
    });
}
