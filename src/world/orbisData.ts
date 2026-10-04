/**
 * 速度違反自動取締装置 (オービス) as extracted from OpenStreetMap by scripts/orbis.ts into
 * public/data/police.json (`orbis`), shared by the data build and the game. Bearings are degrees
 * clockwise from north, in the direction of travel the device enforces.
 */

/**
 * A 予告看板 point up the road: [lon, lat, travel bearing there, metres before the device, travel
 * bearing at the device it warns of] (the last tells the two directions apart when both are).
 */
export type OrbisSign = [number, number, number, number, number];

/** How the enforced direction was found (strongest first). */
export type OrbisBearingSource =
  | "relation" // type=enforcement relation, from → to
  | "direction" // direction=forward/backward on the way, or the bearing the camera faces
  | "oneway" // on (or beside) a oneway carriageway
  | "side" // beside a two-way road: left-hand traffic passes the kerb it stands at
  | "none"; // unknown: the game treats it as covering both directions

export type OrbisEntry = {
  /** OSM node id. */
  id: number;
  lon: number;
  lat: number;
  /** Enforced travel bearing, or null when unknown (both directions). */
  bearing: number | null;
  source: OrbisBearingSource;
  /** Lanes in the enforced direction from OSM (0 = unknown). */
  lanes: number;
  /** OSM maxspeed at the device (km/h, 0 = unknown). For reference: the game uses its own limit. */
  maxspeed: number;
  /** OSM highway class of the road it is on ("" = no road found). */
  road: string;
  /** On a viaduct (bridge / layer ≥ 1): the game has no surface there. */
  elevated: boolean;
  name: string;
  /** Warning-sign points, for each enforced direction (both when the bearing is unknown). */
  signs: OrbisSign[];
};

/** 首都高 and other expressways in OSM's classes. */
export const isExpresswayClass = (road: string): boolean => road === "motorway" || road === "motorway_link";

/** Entries of police.json's `orbis`, dropping anything malformed (older builds wrote tuples). */
export function parseOrbis(raw: unknown): OrbisEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is OrbisEntry => {
    const isObject = typeof e === "object" && e !== null && !Array.isArray(e);
    if (!isObject) return false;
    const o = e as Partial<OrbisEntry>;
    return typeof o.lon === "number" && typeof o.lat === "number" && Array.isArray(o.signs);
  });
}
