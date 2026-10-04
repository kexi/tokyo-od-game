/**
 * 行政処分 for the 累積点数 of caught violations (道路交通法施行令 別表第三; 警視庁「行政処分の基準」):
 * the day ends, the post comes, and with enough points the licence is suspended or revoked.
 * 前歴 (earlier 処分 within 3 years) lowers the thresholds. Fatal and drink-driving tiers are not
 * modelled because the game has neither.
 */
export type Sanction =
  | { kind: "none" }
  | { kind: "suspension"; days: number; shortened: number }
  | { kind: "revocation"; years: number };

// [points from, days] per 前歴 (0, 1, 2, 3+); revocation at the last threshold.
const SUSPENSION: Array<{ steps: Array<[number, number]>; revoke: number }> = [
  {
    steps: [
      [6, 30],
      [9, 60],
      [12, 90],
    ],
    revoke: 15,
  },
  {
    steps: [
      [4, 60],
      [6, 90],
      [8, 120],
    ],
    revoke: 10,
  },
  {
    steps: [
      [2, 90],
      [3, 120],
      [4, 150],
    ],
    revoke: 5,
  },
  {
    steps: [
      [2, 120],
      [3, 150],
      [4, 180],
    ],
    revoke: 4,
  },
];

/** Days a 停止処分者講習 takes off a suspension (優良な成績で: 30→29, 60→30 …; game: the best case). */
const SHORTENED: Record<number, number> = { 30: 29, 60: 30, 90: 45, 120: 60, 150: 70, 180: 80 };

export function decideSanction(points: number, prior: number): Sanction {
  const table = SUSPENSION[Math.min(prior, 3)];
  if (points >= table.revoke) return { kind: "revocation", years: 1 + Math.min(prior, 2) };
  let days = 0;
  for (const [from, d] of table.steps) if (points >= from) days = d;
  return days > 0 ? { kind: "suspension", days, shortened: SHORTENED[days] ?? 0 } : { kind: "none" };
}
