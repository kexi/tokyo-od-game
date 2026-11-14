/**
 * Stretches of a run built as a viaduct by a decision where their height alone makes an embankment
 * (S6 PR 7c): a street's lanes the game builds run under the deck there, and an embankment's walls
 * would close them (main's tags build had a viaduct there, the lanes passing under it). Only an
 * embankment's stations turn: a cut stays a cut (a road under the ground cannot be a viaduct).
 *
 * Add a row only on the user's decision (a stretch seen with its numbers in `reason`): this is the
 * decisions' input, as footDeferrals.ts is, not a rule. The rule (a street's lanes under the deck
 * keep it a viaduct) needs the game's lanes, built from GSI's streets the compiler does not read, and
 * a street's median in its section: R1's. Why not the OSM ground roads (the compiler's): tried in 7c,
 * their windows covered 1 of the 13 stretches and spread over kilometres of others (knowledge「P2.7-6 PR
 * 7c」). More than four rows is the sign that R1's rule is due.
 *
 * Checked at every build (compile.ts structureDecisionWindows): a row whose stretch is not an
 * embankment by height in that build stops it (no stale row is left); a row whose run the build does
 * not plan is skipped (any range). T13 (heightStructures.ts) reads the same rows.
 */
export type StructureDecision = {
  run: string;
  /** Run distances of the stretch (m). */
  s0: number;
  s1: number;
  structure: "viaduct";
  /** What was seen and measured, why it is a viaduct. */
  reason: string;
  decidedBy: "user";
  /** ISO date of the decision. */
  decidedAt: string;
  /** When the row goes. */
  release: string;
};

const RELEASE = "R1 の並走する街路の中央帯の規則が入り、街路の車線が床版の下を通る所を規則で高架にするとき";

export const STRUCTURE_DECISIONS: readonly StructureDecision[] = [
  {
    run: "895902565",
    s0: 57.6,
    s1: 89.16,
    structure: "viaduct",
    reason:
      "霞が関の外回り 895902565 の始まりの盛土のうち、ゲームが組む街路の車線が床版の下に掛かる所（幅 40 m の区間 815 が s 57.6〜85.7、幅 16 m の区間 771・幅 40 m の区間 813 が s 85.2〜89.2、車線の中心は軸から最短 0.15〜0.71 m）。路面 − 地表は 4.27〜6.18 m で、main（tags）は高架で桁下 2.09〜4.00 m だった（7c の盛土で車線が壁に塞がれた）。s 89.16 から先は今も高架",
    decidedBy: "user",
    decidedAt: "2026-11-14",
    release: RELEASE,
  },
  {
    run: "45021976",
    s0: 3410.6,
    s1: 3414,
    structure: "viaduct",
    reason:
      "外回り 45021976 の汐留の盛土の始まりで、幅 40 m の区間 650 の車線が床版の下に掛かる所（s 3410.6〜3411.8、車線の中心は軸から最短 0.65 m、+1.5 m の余白まで s 3414）。路面 − 地表は 6.21〜6.27 m で、main（tags）は高架で桁下 3.87〜3.93 m だった。s 3410.6 の手前は今も高架",
    decidedBy: "user",
    decidedAt: "2026-11-14",
    release: RELEASE,
  },
];

/** The decided viaduct stretches of a run (run distances). */
export function decidedViaducts(table: readonly StructureDecision[], run: string): Array<[number, number]> {
  return table.filter((d) => d.run === run && d.structure === "viaduct").map((d) => [d.s0, d.s1]);
}
