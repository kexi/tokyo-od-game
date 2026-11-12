import { DEM_SINK_GIVE, OPEN_FLOOR_GIVE, OPEN_GROUND_FLOOR } from "./assumptions";
import type { XwDiagnostic } from "./format";

/**
 * The rules for what the compiler reports and the project accepts (P2.7-4): per kind, what is
 * accepted, how far and why. No run is named here: the cases themselves are in each data folder's
 * ledger (ledger.json, src/expressway/ledger.ts), which the ledger tool counts from the files and a
 * review decides case by case. Only these rules and the ledger decide a diagnostic's `allowed`
 * (compile.ts sets it from the rules; scripts/expressway.ts again with the ledger), and the data
 * tests fail on anything neither covers (knowledge/road-redesign-plan.md 4.4 T10).
 */

/**
 * Kinds every run may have, accepted by these rules alone (`maxShortM`: the most a miss of an
 * assumed floor, detail "<m> m under …", may be). The ledger only counts them (its `rules`).
 */
export type RuleEntry = { kind: string; maxShortM?: number; reason: string };

export const RULES: ReadonlyArray<RuleEntry> = [
  {
    kind: "vertical_fallback",
    reason:
      "特例値の勾配・下げた設計速度はどちらも第20条・第13条の範囲内（knowledge/road-redesign-plan.md 4.3 の 3 の順に試した結果）。地表の床を外す「交差のみ」は別の kind（vertical_crossings_only）で、ここには含まない",
  },
  {
    kind: "below_open_ground_floor",
    maxShortM: OPEN_FLOOR_GIVE.value,
    reason: `最も低い設計速度でも解けない run だけ（最終段）。${OPEN_GROUND_FLOOR.reason}。${OPEN_FLOOR_GIVE.reason}。OSM の道路は交差として 4.5 m を満たす`,
  },
  {
    kind: "deck_below_ground",
    maxShortM: DEM_SINK_GIVE.value,
    reason: `最も低い設計速度でも解けない run の、低い端の近くだけ（最終段）。${DEM_SINK_GIVE.reason}`,
  },
  {
    kind: "crossing_over_or_at_grade",
    reason:
      "OSM に高さの無い「地上」の道路が地表端の近くにあり、標準勾配では越えられない。掘割の上を渡る道か地下道とみなし、タイルの blocked に記録した（P3 で通行止め・迂回を決める）",
  },
];

/** The kinds RULES accepts (the ledger's `rules` counts, in this order). */
export const RULE_KINDS = RULES.map((r) => r.kind);

/**
 * The largest same-surface miss the project accepts at a 分合流 (the largest of the default data's
 * accepted pairs, at 浜崎橋 JCT). The game makes one slab of a pair only within this
 * (expresswayMerge.ts MERGE_MAX_DZ is derived from it): what is accepted as one surface is drawn as one.
 */
export const SAME_SURFACE_ALLOWED_DZ_M = 0.14;

/** Why a nose passes by rule (the ledger's `nose`, NOSE_MAX_DZ_M in overlapClass.ts). */
export const NOSE_REASON =
  "分合流でつながる 2 本のノーズで、同一面（5 cm 以内）の帯を最大 |Δz| 0.5 m（NOSE_MAX_DZ_M）以内で外れる所（P2.5 の全域の重なりの内訳で 0.5 m 未満の 114 組と同じ類型）。測点の数は縛らない（ship v1 で規則が通す 56 組のうち 14 組が 3〜7 測点）";

/** The longest shortfall of tunnel cover from a portal that passes by rule (`portal-open-cut`), m. */
export const PORTAL_OPEN_CUT_MAX_M = 150;

export const PORTAL_OPEN_CUT_REASON =
  "坑口が斜面に開き、坑口の手前で地表が下がる所。坑口から第20条の標準勾配では箱の高さと最小の土被り（TUNNEL_DEPTH_M）まで下りきれない。坑口から続く不足の区間（PORTAL_OPEN_CUT_MAX_M 以内）は箱の頂版が地表より上に出る開削部として扱い、地形を切り欠いて坑門で見せる（expresswayBore.ts）";

/** The largest step along travel where a merged pair lets go (`let_go`), m. */
export const LET_GO_MAX_STEP_M = 0.001;

export const LET_GO_REASON =
  "一体化した 2 枚の床版が |Δz| MERGE_MAX_DZ を越えて手放す点。進行方向の段差が 1 mm 以内なら、車が通る面に段は出ない（P3.5 レビュー W1 の後）";

/** Why a height build's cut in a viaduct-tagged run passes by rule (`cut-stretch`, P2.7-6 PR 1). */
export const CUT_STRETCH_REASON =
  "OSM では高架だが、解いた縦断が地表より下にある区間（坑口へ下りる取付けなど）。掘割（擁壁と地形の穴、P9 と同じ描き方）として描く。深さ・長さが HEIGHT_STRUCTURES の上限（3 m・150 m）以内なら規則で通す";

/** Why a height build's embankment in a viaduct-tagged run passes by rule (`embankment-stretch`). */
export const EMBANKMENT_STRETCH_REASON =
  "OSM では高架だが、解いた縦断が地表から開けた地表の床（桁下 4.5 m + 桁高）に届かない区間（地表端へ下りる取付け・低いまま走るランプ）。橋脚の無い盛土・擁壁として描き、下を通る道路は blocked。長さが HEIGHT_STRUCTURES の上限（500 m）以内なら規則で通す";

/** Why a run at grade passes by rule (`ground-stretch`, S6 PR 2). */
export const GROUND_STRETCH_REASON =
  "地平 run（OSM で高架でもトンネルでもない区間）。解いた路面が測点の地表から帯（HEIGHT_STRUCTURES.ground.bandM 1.5 m）の内にあれば、掘割・盛土はその高さから決めた描き分けで、規則で通す。超えたら listed";

/** Why a thinner girder passes by rule (`thin-girder`, P2.7-6 PR 1). */
export const THIN_GIRDER_REASON =
  "交差・床版の重なりで、離隔が建築限界 + 桁高（2.2 m）に 0.5 m 以内で足りない区間を、桁を薄くして受けた（GIRDER_MIN 1.7 m 以上）。桁高はどちらも仮定（assumptions.ts）";

/** Why a ramp may keep OSM's radius below the assumed floor (each case is in the ledger: ramp-radius). */
export const RAMP_RADIUS_REASON =
  "OSM の線形のままの半径。平面は OSM から 1.5 m 以内に留める（MAX_LATERAL_SHIFT）ので広げられない。下限 15 m は設計書の仮定（RAMP_MIN_RADIUS）で、連結路は第28条第4項で第15条の適用外。走れるかは P3 の走行で確かめる";

/**
 * How far a case's measure may move from its decided cap and keep the decision (the ledger tool,
 * a rebuild's wobble): stations +2, |Δz|, a step or a face miss +5 cm, a stretch's ends ±5 m, a
 * radius −0.5 m, a shortfall's length +5 m. Beyond, the case goes back to `new`.
 */
export const CASE_MARGIN = { stations: 2, dzM: 0.05, edgeM: 5, radiusM: 0.5 } as const;

/**
 * high-deck (P2.7-5 4.3): a viaduct, off a structure's deck and in a stretch nothing forces
 * (report.ts forcingOf), standing more than HIGH_DECK_ABOVE_M over the ground for HIGH_DECK_MIN_M
 * or more. Objective v2 crosses a valley at one grade instead of following the DEM down and up, so
 * such decks are right where a real valley, river or cutting lies (a review confirms it by a view).
 * Why not a ceiling over the ground for every deck: a deck across a valley is high and right
 * (203832852 / 1467911980 over 渋谷's valley are nearer the real road under v2).
 */
export const HIGH_DECK_ABOVE_M = 20;
export const HIGH_DECK_MIN_M = 50;
/** How far a high-deck case may grow past its cap and keep the decision: its height +0.5 m, its length +20 m. */
export const HIGH_DECK_MARGIN = { heightM: 0.5, spanM: 20 } as const;
/** The ratchet's step for the km of viaduct over 15 and 20 m (budget.heightKm): a cap rounded up to it. */
export const HEIGHT_KM_STEP = 0.5;

/** Stations and largest |Δz| from a deck_overlap detail ("with b: N stations, |Δz| lo–hi m, …"). */
export function overlapSize(detail: string): { stations: number; maxDzM: number } | null {
  const m = /: (\d+) stations, \|Δz\| [\d.]+–([\d.]+) m/.exec(detail);
  return m ? { stations: Number(m[1]), maxDzM: Number(m[2]) } : null;
}

/** Whether RULES accept a diagnostic (a kind every run may have, within its limit). */
export function isRuleAllowed(d: Pick<XwDiagnostic, "kind"> & { detail?: string }): boolean {
  const rule = RULES.find((r) => r.kind === d.kind);
  if (!rule) return false;
  const isShortLimited = rule.maxShortM !== undefined;
  if (!isShortLimited) return true;
  const short = /^([\d.]+) m under/.exec(d.detail ?? "");
  return short !== null && Number(short[1]) <= rule.maxShortM!;
}

/** What decides a diagnostic RULES do not cover: the ledger's verdict (ledger.ts ledgerVerdict). */
export type CaseVerdict = (d: XwDiagnostic) => boolean;

/**
 * Whether a diagnostic is accepted: by RULES, or by `verdict` (the data folder's ledger and the
 * rules of the case kinds). Without a verdict only RULES (compile.ts; a folder with no ledger).
 */
export function isAllowed(
  d: Pick<XwDiagnostic, "run" | "kind"> & { detail?: string },
  verdict?: CaseVerdict,
): boolean {
  if (isRuleAllowed(d)) return true;
  if (!verdict) return false;
  return verdict({ run: d.run, kind: d.kind, detail: d.detail ?? "", allowed: false });
}

/** Why a road or railway crossing a run at grade at its end node passes by rule (`ground-crossing`, S6 PR 7a). */
export const GROUND_CROSSING_REASON =
  "地平 run を平面で横切る道路・鉄道のうち、run の端の節点（端から 1 m 以内）のもの。ランプの端で一般道の網に接する所で、渡す・くぐる構造は要らないので規則で通す。途中を横切るものは listed（PR 7 で越える・くぐる形を決める）";

/**
 * The detail of a road or railway crossing a run at grade (compile.ts setupGround), and its reading
 * back (the ledger's ground-crossing, scripts/expresswayCases.ts): one place for the text both sides
 * rely on (S6 PR 7a review W8).
 */
export function atGradeCrossingDetail(kind: "road" | "rail", id: number, s: number): string {
  return `${kind} ${id} at ${s.toFixed(0)} m crosses the road at grade; taken as passing over or under`;
}

/** What atGradeCrossingDetail wrote, or null for any other detail. */
export function parseAtGradeCrossing(
  detail: string,
): { kind: "road" | "rail"; id: number; s: number } | null {
  const m = /^(road|rail) (\d+) at (\d+) m crosses the road at grade; taken as passing over or under$/.exec(
    detail,
  );
  if (m === null) return null;
  return { kind: m[1] as "road" | "rail", id: Number(m[2]), s: Number(m[3]) };
}

/**
 * A seam_step a rule takes (S6 PR 7c, PR 5's (A), the user's approval): the one or two probes (within
 * SEAM_SLIDE_SPAN_M) of a sliding band, where the pair stands MERGE_FULL_DZ to MERGE_MAX_DZ apart in
 * the data and the seam slides from the master's face to the cut deck's own height. There the step
 * is the band's by design up to MERGE_MAX_DZ; the deck's chords off the Hermite surface (1 cm each)
 * add up to twice SEAM_CHORD_M, and the inside face stays within SEAM_CHORD_M. Why not wider: a
 * longer stretch, or an inside face past 1 cm, is (A2), (B) or (C), still a review's.
 */
export const SEAM_CHORD_M = 0.01;
export const SEAM_SLIDE_SPAN_M = 0.5;
export const SEAM_SLIDE_MAX_PROBES = 2;
/** The data's |Δz| up to which a pair is one surface (overlap.ts SAME_SURFACE_M, the runtime's MERGE_FULL_DZ). */
export const SEAM_FULL_DZ_M = 0.05;
/** The data's |Δz| up to which the runtime merges a pair (expresswayMerge.ts MERGE_MAX_DZ). */
export const SEAM_SLIDE_MAX_DZ_M = SAME_SURFACE_ALLOWED_DZ_M + 0.01;

/** Why such a seam_step passes by rule. */
export const SEAM_SLIDE_REASON =
  "一体化を手放す点の滑る帯（データの |Δz| が MERGE_FULL_DZ 0.05 m 超 MERGE_MAX_DZ 0.15 m 以下）の 1〜2 測点（0.5 m 以内）で、段が MERGE_MAX_DZ + 床版の弦の許容 × 2（0.17 m）以下、内側の面が弦の許容（0.01 m）以下。帯の段は設計どおりで、弦（Hermite から最大 1 cm）の分だけ測点によって出る（PR 5 の (A)、S6 PR 7c でユーザーの承認のもと規則に）";
