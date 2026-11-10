import type { Assumption } from "../expressway/assumptions";

/**
 * Values the street cross-section (laneChange.ts, regulations.ts osmLaneMatcher) and the street
 * markings (roadMarkings.ts) need that no statute fixes, kept apart from src/law/roadStandards.ts
 * in the form of src/expressway/assumptions.ts: every entry says `verified: false` and why it is
 * what it is (tests/roadSection.test.ts checks). When a real figure is found, change the value,
 * cite it, and move it to roadStandards.ts.
 */

/** GSI 幅員 from which, with no OSM width, the 幅員 is taken to hold a 歩道 on each side. */
export const PAVED_FROM: Assumption<number> = {
  value: 13,
  verified: false,
  reason:
    "未確認。地理院の rnkWidth 3（13〜19.5 m）以上。幅員は道路縁から道路縁で、第四種の道路は各側に歩道を設ける（構造令 第11条）という読みと、丸の内で PLATEAU の歩道が地理院の幅員の内側に入る区間があること（knowledge/sidewalks-and-footbridges.md）から置いた。区間ごとには確かめていない",
};

/** Narrowest lane a count from JARTIC or OSM is squeezed to before a lane is dropped. */
export const NARROWEST_LANE: Assumption<number> = {
  value: 2.75,
  verified: false,
  reason:
    "未確認。構造令 第5条第4項の小型道路の車線幅 2.75 m を、普通道路の車線を詰める下限に流用した。地理院の幅員の粗さ（区分の代表値）を吸収するための値で、法令の下限ではない",
};

/** A JARTIC count needing more than this a lane for one direction is read as both directions' total. */
export const JARTIC_TOTAL_TEST: Assumption<number> = {
  value: 3,
  verified: false,
  reason:
    "未確認。JARTIC の「車両通行帯数」が片側か両側の合計かは仕様に無い。片側に 3 m／車線で収まらなければ合計とみなす、という P2 以前からの判定",
};

/** Most lanes a direction is given for a JARTIC section listed with its count blank. */
export const JARTIC_BLANK_MOST: Assumption<number> = {
  value: 4,
  verified: false,
  reason: "未確認。台数が空欄の車両通行帯は 2 以上で、幅員から 2〜4 と置く（P2 以前からの判定）",
};

/** Widest 中央帯 taken from the gap between a divided road's two OSM ways. */
export const MEDIAN_MOST: Assumption<number> = {
  value: 8,
  verified: false,
  reason:
    "未確認。並木や副道のある大通りの島は車道の中央帯より広い。8 m を超える間隔は中央帯ではなく島や歩道とみなして打ち切る",
};

/** How much farther than half the GSI 幅員 a one-way OSM way (one carriageway) may lie. */
export const OSM_ONEWAY_REACH: Assumption<number> = {
  value: 3,
  verified: false,
  reason:
    "未確認。中央分離帯のある道の上下線は OSM で別々の線になり、地理院の中心線から幅員の 1/4 前後離れる。半幅＋3 m までを同じ道とみなした（両方向の way は JARTIC と同じ 6 m）",
};

/** ◇ (210)'s outline width. */
export const DIAMOND_LINE: Assumption<number> = {
  value: 0.2,
  verified: false,
  reason:
    "未確認。標識令 別表第六の 210 の図（175 画素）で線の寸法が 0.20 と読めるが不鮮明。図の同心の輪郭は外形を示す線とみて一重で描く",
};

/** ◇ (210)'s length along the road. */
export const DIAMOND_LENGTH: Assumption<number> = {
  value: 3,
  verified: false,
  reason: "未確認。別表第六の図の数字が潰れて読めない（図の比は幅 1.5 m の約 2 倍）。P2 以前の値のまま",
};

/** 横断歩道 (201)'s depth along the road. */
export const CROSSWALK_DEPTH: Assumption<number> = {
  value: 4,
  verified: false,
  reason: "未確認。別表第六の図に寸法が無い（幅は公安委員会が決める）。都市部で見かける 4 m を置いた",
};

/** All entries, for the test that each says it is unverified and why. */
export const STREET_ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  PAVED_FROM,
  NARROWEST_LANE,
  JARTIC_TOTAL_TEST,
  JARTIC_BLANK_MOST,
  MEDIAN_MOST,
  OSM_ONEWAY_REACH,
  DIAMOND_LINE,
  DIAMOND_LENGTH,
  CROSSWALK_DEPTH,
};
