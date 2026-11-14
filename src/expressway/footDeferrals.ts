/**
 * The ramps' feet left out of the build by a decision (S6 PR 7c): each a run at grade whose ground end
 * compile.ts cutFeet judges `along` a street (in its median for RAMP_FOOT.maxM), not built until the
 * stage named in `until`; the run beside it ends at the ground there as with `--ground skip`, and the
 * scorecard and report.json list it under `ground.deferred`.
 *
 * Add a row only on the user's decision (a case seen with a view, its numbers in `reason`): this is
 * the decisions' input, as the structures' specs (structures.ts) and the ledger are, not a rule. A rule
 * for every foot along a street's median is R1's (with the median in the street's section). Why not a
 * rule now: tried in 7c (every along run at grade left out), it took 129 runs out of the network and
 * moved the main lines by up to −1.89 m (24402611) and −1.46 m (45554540), far past the user's one
 * decision (knowledge「P2.7-6 PR 7c」). More than three rows is the sign that R1's rule is due.
 *
 * Checked at every build (compile.ts checkFootDeferrals): a row whose foot is not `along` in that build
 * stops it (no stale row is left); a row whose run the build does not plan is skipped (any range).
 */
export type FootDeferral = {
  run: string;
  end: "start" | "end";
  /** The stage that takes the foot back. */
  until: "R1" | "S7";
  /** What was seen and measured, why it is left out. */
  reason: string;
  decidedBy: "user";
  /** ISO date of the decision. */
  decidedAt: string;
  /** When the row goes (and the run comes back). */
  release: string;
};

export const FOOT_DEFERRALS: readonly FootDeferral[] = [
  {
    run: "203832842",
    end: "end",
    until: "R1",
    reason:
      "飯倉出口の足の地平 run（68.9 m、中央帯を 12° で並走、end は掘割 203832842:1 で路面 − 地表 −1 m）。ゲームが組む幅 4.3 m の街路の車線の中心が掘割の穴（擁壁の外面 2.875 m + 1 m の内）に 9 m 掛かり（最短 0.15 m）、7c の街路の走行で車が穴に落ちた（respawn）。既定範囲では start が範囲の縁でどの床版にもつながらない",
    decidedBy: "user",
    decidedAt: "2026-11-13",
    release: "R1 の並走する街路の中央帯の規則が入り、穴に掛かる車線が車線でなくなったとき",
    // In ship: 23273634 (the viaduct before it) ends at the ground there instead of a seam (as in main's
    // tags build), its steepest grade 1.17 → 3.50 % (the terrain's, within its 11.5 %); heights move
    // by 0.32 m (23273634) and 0.343 m (737538573). Accepted by the design (knowledge「P2.7-6 PR 7c」).
  },
];

/** The deferral of a run's end, if decided. */
export function footDeferralOf(
  table: readonly FootDeferral[],
  run: string,
  end: "start" | "end",
): FootDeferral | undefined {
  return table.find((d) => d.run === run && d.end === end);
}
