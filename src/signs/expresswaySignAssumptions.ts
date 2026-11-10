/**
 * The 都市高速's signs (G6): the game's choices where the 命令 gives a range or nothing, each
 * `verified: false` with why (the Assumption form of src/expressway/assumptions.ts). The ranges the
 * choices must stay in are the 命令's (別表第一) and are checked by tests/expresswaySigns.test.ts
 * against the text, not against these values. knowledge/sign-system.md「都市高速の板と設置（G6）」.
 */
import type { Assumption } from "../expressway/assumptions";

/** 日本字 height on the 都市高速's boards, cm. */
export const EXPRESSWAY_LETTER: Assumption<number> = {
  value: 30,
  verified: false,
  reason:
    "未確認。設計書の仮置き（20 cm の 1.5 倍 = 30 cm）。文字の大きさは別表第二 備考一(五)1、案内標識の拡大は同 備考一(二)3 による（G5 の表の 備考一(五)2 ただし書としていたのは誤り、G6 レビュー S4）。実物の都市高速の板の文字高は測っていない",
};

/**
 * Metres before the exit (or the JCT) each guide board is tried at, in this order: the first that
 * lies on the run, clear of the other signs and of a deck overhead, is taken. Every value stays in
 * the 命令's range (110-B 100〜600, 111-B 100〜500, 112-B ≤ 300, 108の2-C〜E ≤ 300).
 */
export const BOARD_BEFORE: Assumption<Record<"110-B" | "111-B" | "112-B" | "108の2-C", readonly number[]>> = {
  value: {
    "110-B": [500, 450, 550, 400, 600, 350, 300],
    "111-B": [300, 250, 350, 200, 400, 150, 450],
    "112-B": [120, 80, 160, 200, 60, 240, 280],
    "108の2-C": [200, 160, 240, 120, 280, 80],
  },
  verified: false,
  reason:
    "未確認。命令の範囲の中で、予告（110-B）→車線（111-B）→出口（112-B）が 150 m 以上離れて順に並ぶ値から試す。実物の設置距離の分布は調べていない",
};

/** Two signs on one run stand at least this far apart (the second is tried at the next distance). */
export const SIGN_SPACING: Assumption<number> = {
  value: 60,
  verified: false,
  reason: "未確認。門型が続けて重なって見えないための目安（60 km/h で約 3.6 s）",
};

/**
 * 116の4・116の6 (small boards on the 壁高欄, at the phone or bay itself) keep this from any other
 * sign instead of SIGN_SPACING: they mark a place, and a gantry 20 m away does not hide them.
 */
export const PHONE_SPACING: Assumption<number> = {
  value: 20,
  verified: false,
  reason: "未確認。電話の位置から動かさないため、門型の脚と板が重ならない程度の間隔だけを取る",
};

/**
 * 113-A・B: metres past where the ramp's deck leaves the main line's (the end of their shared
 * surface): the nose, on the ramp's 壁高欄 facing the main line.
 */
export const NOSE_AFTER: Assumption<number> = {
  value: 8,
  verified: false,
  reason: "未確認。別表第一は「出口附近」。ノーズ（床版が分かれる所）の少し先、本線から見える位置",
};

/**
 * 104 入口の予告: metres before the entrance ramp's ground end it is tried at (別表第一 gives no
 * distance), and 103 at the ramp's mouth.
 */
export const ENTRANCE_BEFORE: Assumption<{ advance: readonly number[]; direction: readonly number[] }> = {
  value: { advance: [150, 120, 180, 100, 200, 80, 70, 60, 50], direction: [15, 22, 10, 30, 40, 50, 60, 5] },
  verified: false,
  reason:
    "未確認。別表第一は 103・104 の距離を定めない（「入口の方向を示す必要がある地点」「入口を予告する必要がある地点」）。一般道の 108 の予告（300 m 以内）より近い目安。芝公園の入口は手前の道が 79 m で途切れる（GSI の道路中心線のつながり）ので 80・60 m も試す",
};

/**
 * Route symbols on the arms of 108の2-C〜E: the frame's height as a share of the 日本字
 * (備考一(五)6 caps a 経由路線's symbol at 1.6 times).
 */
export const ROUTE_SYMBOL_ON_ARM: Assumption<number> = {
  value: 1.2,
  verified: false,
  reason: "未確認。備考一(五)6 の上限 1.6 倍の内で、腕の上で地名と重ならない大きさ",
};

/**
 * Route symbol in the white band of 103・104: the frame's height as a share of the 日本字. The cap
 * of 備考一(五)6 is written for 「方面及び方向」; that 103・104 fall under its 方面 cap (0.9) is
 * itself the assumption.
 */
export const ENTRANCE_ROUTE_SYMBOL: Assumption<number> = {
  value: 0.9,
  verified: false,
  reason:
    "未確認。103・104 の路線記号の大きさは命令に無い。108の2 の方面の上限 0.9 倍（備考一(五)6）を当てはめた",
};

/**
 * 116の4・116の6 drawn larger than 図示 by this (案内 on 高速道路等 up to 3 times, 備考一(二)3):
 * 90 × 60 cm is a few pixels at 100 m in the game's field of view.
 */
export const PICTOGRAM_SCALE: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason:
    "未確認。案内標識の拡大の上限 3 倍（備考一(二)3）の内。ゲームの視野で 60 m 先から読める大きさの目安",
};

/**
 * The guide boards on the decks drawn this many times their layout (案内 on 高速道路等 up to 3 times,
 * 備考一(二)3, enlargementFor): with EXPRESSWAY_LETTER the 日本字 read as 45 cm.
 */
export const BOARD_SCALE: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason:
    "未確認。1 周目の多視点レビューで、30 cm の字の板（112-B は 3.2 m 幅）が運転席 60 m で 4 px しかなく読めなかった（W1）。命令の拡大の範囲 3 倍の内で、60 m で字が 6 px を超える大きさ",
};

/** 323 / 325 plates on the deck: drawn this many times 図示 (規制 on any road 1/2〜2, 備考一(二)9). */
export const DECK_PLATE_SCALE: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason: "未確認。一般道の 1.25 倍より大きく、命令の範囲 2 倍の内。都市高速の速度で読める大きさの目安",
};

/**
 * 323 relative to where the posted speed changes (a chunk's start): AFTER_CHANGE past it, and the
 * shifts tried in order when that place is taken (a plate a little before the change shows the new
 * value a little early; never more than 30 m). A branch's first plate stands AFTER_SEPARATION past
 * where its deck leaves the parent's (before that the two share one surface).
 */
export const SPEED_SIGN_SHIFT: Assumption<{
  afterChange: number;
  afterSeparation: number;
  tries: readonly number[];
  /** A run's first plate (a ramp past its nose sign or 325): later places too. */
  startTries: readonly number[];
}> = {
  value: {
    afterChange: 5,
    afterSeparation: 20,
    tries: [0, 10, 20, 30, -10, -20, -30],
    startTries: [0, 10, 20, 30, 45, 60, 75, 90],
  },
  verified: false,
  reason:
    "未確認。規制は標識の位置から始まるので、掲示速度の変わり目（チャンクの始まり）のすぐ先に立て、他の標識と重なれば ±30 m の内でずらす目安。run の最初の板（ランプでは 113 のノーズの板・325 と近い）は 90 m 先まで試す（その間は前の道の速度が掲示されたまま、と読む）",
};

/**
 * A way without maxspeed carries the posted speed of the way before it on the run; only a run that
 * starts without one takes the statutory 60 km/h (施行令 第11条第1号).
 */
export const POSTED_SPEED_CARRY: Assumption<boolean> = {
  value: true,
  verified: false,
  reason:
    "未確認。OSM の都市高速の way は maxspeed が付いたり欠けたりする（試験区間の C1 で 50 と欠測が交互）。欠測を法定 60 と読むと、同じ区間で 50→60→50 と板が並ぶ。欠測は「前と同じ」と読む方が実物の規制に近いという判断（実物の規制速度の一覧とは照合していない）。run の始まりで欠測なら、分岐はその親の値を引き継ぎ、一般道から入って本線に合流するランプは法定 60 と合流先の値の低い方、それ以外は法定 60（施行令 第11条第1号）。ランプが合流先より速いと、共有する床版の上で取締りの速度が板より高く読まれるため（tests/expresswayDrive.test.ts の lower limit の検査）",
};

/**
 * A girder-mount whose deck above is not in the data (its run outside the range): the girder's
 * underside and depth above the road assumed (the standard underclearance less a girder).
 */
export const GIRDER_FALLBACK: Assumption<{ bottomM: number; depthM: number }> = {
  value: { bottomM: 5.5, depthM: 2 },
  verified: false,
  reason:
    "未確認。上の床版の測点が無いときだけ使う。建築限界 4.5 m に余裕を足した桁下と、assumptions.ts の桁高に近い値",
};

export const EXPRESSWAY_SIGN_ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  EXPRESSWAY_LETTER,
  BOARD_BEFORE,
  SIGN_SPACING,
  PHONE_SPACING,
  NOSE_AFTER,
  ENTRANCE_BEFORE,
  ROUTE_SYMBOL_ON_ARM,
  ENTRANCE_ROUTE_SYMBOL,
  PICTOGRAM_SCALE,
  BOARD_SCALE,
  DECK_PLATE_SCALE,
  SPEED_SIGN_SHIFT,
  POSTED_SPEED_CARRY,
  GIRDER_FALLBACK,
};
