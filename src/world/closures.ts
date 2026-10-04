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

/** What the closure is called on the review screen and in the logs. */
export const CLOSURE_WORDS: Record<ClosureKind, string> = {
  [CLOSURE.pedestrianRoad]: "歩行者用道路",
  [CLOSURE.all]: "通行止め",
  [CLOSURE.vehicles]: "車両通行止め",
  [CLOSURE.motor]: "自動車通行止め",
};
