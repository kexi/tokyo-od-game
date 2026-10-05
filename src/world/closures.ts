import { M_LAT, M_LON } from "./anchors";

/**
 * Kinds of 通行禁止 in the JARTIC data (共通規制種別コード 1 and 4), shared by the data build and
 * the game. Each closes the street to the player's car while in force and has its own sign
 * (道路標識、区画線及び道路標示に関する命令 別表第一).
 */
export const CLOSURE = {
  /** 歩行者用道路 (code 1; sign 歩行者専用), mostly school-run hours with 許可車両を除く. */
  pedestrianRoad: 1,
  /** 通行止め for all traffic (code 4, no 対象車両; sign 301). */
  all: 2,
  /** 車両通行止め (code 4, 対象 車両; sign 302). */
  vehicles: 3,
  /** 自動車 (incl. 二輪) 通行止め (code 4, 対象 自動車). */
  motor: 4,
} as const;
export type ClosureKind = (typeof CLOSURE)[keyof typeof CLOSURE];

/**
 * The largest 通行禁止 area believed, in km². The largest real ones in the 23 wards are school-run
 * 歩行者用道路 zones of about 0.9 km² (JARTIC 2026-08). A larger ring is a misread record — the
 * 環七 大型貨物自動車等 ban (317 km²) once closed 2,732 of 2,746 sections around 太子堂 — so the data
 * build drops it with a log, and the game does too for tiles built before that check.
 */
export const MAX_CLOSURE_AREA_KM2 = 5;

/**
 * Area of a lon/lat ring `[…, lon, lat, lon, lat, …]` read from index `from`, in km²: the shoelace
 * formula on a plane through Tokyo (anchors.ts metres per degree), relative to the first vertex so
 * the products stay small. Good to well under 1 % over the 23 wards, plenty for a plausibility check.
 */
export function ringAreaKm2(coords: number[], from = 0): number {
  const n = Math.floor((coords.length - from) / 2);
  if (n < 3) return 0;
  const x = (k: number) => (coords[from + 2 * (k % n)] - coords[from]) * M_LON;
  const y = (k: number) => (coords[from + 2 * (k % n) + 1] - coords[from + 1]) * M_LAT;
  let twice = 0;
  for (let k = 0; k < n; k++) twice += x(k) * y(k + 1) - x(k + 1) * y(k);
  return Math.abs(twice) / 2 / 1e6;
}

/**
 * What the closure is called on the review screen and in the logs, in Japanese (records keep it).
 * The screen shows it in the language in force through the `closure.*` keys (translateWord).
 */
export const CLOSURE_WORDS: Record<ClosureKind, string> = {
  [CLOSURE.pedestrianRoad]: "歩行者用道路",
  [CLOSURE.all]: "通行止め",
  [CLOSURE.vehicles]: "車両通行止め",
  [CLOSURE.motor]: "自動車通行止め",
};
