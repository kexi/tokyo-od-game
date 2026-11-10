/**
 * Values of 道路構造令 (政令 345CO0000000320, revision 2020-11-25 / 502CO0000000329) and of
 * 道路標識、区画線及び道路標示に関する命令 (標識令, 335M50004002003, revision 2026-09-01) that the
 * expressway compiler and its tests read. Only what the statute text says: assumptions the statute
 * does not fix (girder depth, pier spacing, side friction…) live in src/expressway/assumptions.ts
 * so the two can never be mixed up. Every entry carries the article it was read from
 * (tests/expresswayAlignment.test.ts fails on a missing one); the text was read from the e-Gov API v2
 * JSON, whose TableStruct keeps the rowspans the plain text flattens.
 *
 * Grades and superelevations are fractions (0.05 = 5 %), lengths metres, speeds km/h.
 */

export type Statute<T> = { readonly value: T; readonly source: string };

/** Design speeds the tables below cover (第13条; 30 and 20 only for 連結路, which 28条4項 frees). */
export const DESIGN_SPEEDS = [80, 60, 50, 40, 30, 20] as const;
export type DesignSpeed = (typeof DESIGN_SPEEDS)[number];

type ByRow<T> = Readonly<Record<DesignSpeed, T>>;
/** The table's ordinary value (上欄) and the one allowed where unavoidable (下欄, 特例). */
type Graded = { readonly standard: number; readonly special: number };

/**
 * 第13条: 第二種第二級 (都市高速 in a 大都市の都心部, 第3条第2項第二号) is 60 km/h, or 50 / 40 where
 * unavoidable.
 */
export const DESIGN_SPEED_TYPE2_CLASS2: Statute<{ standard: DesignSpeed; special: readonly DesignSpeed[] }> =
  {
    value: { standard: 60, special: [50, 40] },
    source: "構造令 第13条第1項",
  };

/** 第15条: minimum radius of the centre line of a curve. 30 and 20 have no 特例 value. */
export const CURVE_RADIUS: Statute<ByRow<Graded>> = {
  value: {
    80: { standard: 280, special: 230 },
    60: { standard: 150, special: 120 },
    50: { standard: 100, special: 80 },
    40: { standard: 60, special: 50 },
    30: { standard: 30, special: 30 },
    20: { standard: 15, special: 15 },
  },
  source: "構造令 第15条",
};

/** 第16条: maximum superelevation, 第一種〜第三種 outside snowy regions; 第四種 6 %. */
export const MAX_SUPERELEVATION: Statute<{ type1to3: number; type4: number }> = {
  value: { type1to3: 0.1, type4: 0.06 },
  source: "構造令 第16条",
};

/** 第18条第3項: minimum length of a transition (緩和区間), where superelevation is run in (第2項). */
export const TRANSITION_LENGTH: Statute<ByRow<number>> = {
  value: { 80: 70, 60: 50, 50: 40, 40: 35, 30: 25, 20: 20 },
  source: "構造令 第18条第3項",
};

/** 第20条: maximum longitudinal grade, 第一種・第二種・第三種 普通道路. */
export const MAX_GRADE: Statute<ByRow<Graded>> = {
  value: {
    80: { standard: 0.04, special: 0.07 },
    60: { standard: 0.05, special: 0.08 },
    50: { standard: 0.06, special: 0.09 },
    40: { standard: 0.07, special: 0.1 },
    30: { standard: 0.08, special: 0.11 },
    20: { standard: 0.09, special: 0.12 },
  },
  source: "構造令 第20条",
};

/** 第22条第2項: minimum vertical curve radius, crest (凸形) and sag (凹形). */
export const VERTICAL_CURVE_RADIUS: Statute<ByRow<{ crest: number; sag: number }>> = {
  value: {
    80: { crest: 3000, sag: 2000 },
    60: { crest: 1400, sag: 1000 },
    50: { crest: 800, sag: 700 },
    40: { crest: 450, sag: 450 },
    30: { crest: 250, sag: 250 },
    20: { crest: 100, sag: 100 },
  },
  source: "構造令 第22条第2項",
};

/** 第22条第3項: minimum vertical curve length. */
export const VERTICAL_CURVE_LENGTH: Statute<ByRow<number>> = {
  value: { 80: 70, 60: 50, 50: 40, 40: 35, 30: 25, 20: 20 },
  source: "構造令 第22条第3項",
};

/**
 * 第25条: maximum composite grade (longitudinal grade combined with superelevation). Read from the
 * TableStruct: 10 spans 120–100 (rowspan 2), 10.5 spans 80–60 (rowspan 2), 11.5 spans 50–20
 * (rowspan 4). The flattened text reads as if 60 were 11.5; it is 10.5. 30 and 20 may go to 12.5 %
 * where unavoidable (ただし書), not used here.
 */
export const COMPOSITE_GRADE: Statute<ByRow<number>> = {
  value: { 80: 0.105, 60: 0.105, 50: 0.115, 40: 0.115, 30: 0.115, 20: 0.115 },
  source: "構造令 第25条第1項",
};

/** 第5条第4項: lane width (普通道路). 第二種第一級 may be 0.25 m narrower where unavoidable. */
export const LANE_WIDTH: Statute<{
  type2class1: number;
  type2class1Special: number;
  type2class2: number;
  type4class1: number;
  type4class2and3: number;
}> = {
  value: {
    type2class1: 3.5,
    type2class1Special: 3.25,
    type2class2: 3.25,
    type4class1: 3.25,
    type4class2and3: 3,
  },
  source: "構造令 第5条第4項",
};

/** 第6条第4項・第6項: median and its 側帯 for 第二種第二級; the smaller values on viaducts ≥ 50 m. */
export const MEDIAN_TYPE2_CLASS2: Statute<{
  width: number;
  viaduct: number;
  strip: number;
  stripViaduct: number;
}> = {
  value: { width: 1.75, viaduct: 1.25, strip: 0.5, stripViaduct: 0.25 },
  source: "構造令 第6条第4項・第6項",
};

/** 第8条第2項・第4項: shoulders (普通道路). 第二種 has no reduced left value in the table. */
export const SHOULDER: Statute<{
  type2Left: number;
  type2Right: number;
  type4Left: number;
  type4Right: number;
}> = {
  value: { type2Left: 1.25, type2Right: 0.75, type4Left: 0.5, type4Right: 0.5 },
  source: "構造令 第8条第2項・第4項",
};

/** 第12条: clearance height H for 普通道路 (4.8 m on a 重要物流道路, not applied: not in the data). */
export const CLEARANCE_HEIGHT: Statute<number> = { value: 4.5, source: "構造令 第12条" };

/**
 * 第28条第4項: 連結路 (ramps) are exempt from 第5〜8・12・13・15・16・18〜20・22・25条. The compiler
 * still applies the V40 values to ramps as a design target (assumptions.ts says so), but a ramp
 * that misses them is not a statute violation.
 */
export const RAMP_EXEMPTION: Statute<readonly number[]> = {
  value: [5, 6, 7, 8, 12, 13, 15, 16, 18, 19, 20, 22, 25],
  source: "構造令 第28条第4項",
};

/** A dashed line: width range, dash length range, and gap as a multiple of the dash. */
type Dashed = { width: [number, number]; dash: [number, number]; gapRatio: [number, number] };

/**
 * 標識令 別表第四 (区画線の様式), read from the figures (e-Gov attachments): 車線境界線 (102)
 * dashed, 車道外側線 (103) solid, and the wide dashed line along 高速道路等の左側端 (the edge beside a
 * speed-change lane).
 */
export const MARKING_DIMENSIONS: Statute<{
  laneLine: Dashed;
  edgeLine: { width: [number, number] };
  speedChangeEdge: Dashed;
}> = {
  value: {
    laneLine: { width: [0.1, 0.15], dash: [3, 10], gapRatio: [1, 2] },
    edgeLine: { width: [0.15, 0.2] },
    speedChangeEdge: { width: [0.3, 0.75], dash: [2, 5], gapRatio: [1, 1.5] },
  },
  source: "標識令 別表第四（区画線 102・103 の図）",
};

/** All entries, for the test that every value names its article. */
export const ROAD_STANDARDS: Readonly<Record<string, Statute<unknown>>> = {
  DESIGN_SPEED_TYPE2_CLASS2,
  CURVE_RADIUS,
  MAX_SUPERELEVATION,
  TRANSITION_LENGTH,
  MAX_GRADE,
  VERTICAL_CURVE_RADIUS,
  VERTICAL_CURVE_LENGTH,
  COMPOSITE_GRADE,
  LANE_WIDTH,
  MEDIAN_TYPE2_CLASS2,
  SHOULDER,
  CLEARANCE_HEIGHT,
  RAMP_EXEMPTION,
  MARKING_DIMENSIONS,
};

/** The highest tabled design speed not above `kmh` (a maxspeed of 70 designs as 60). */
export function designSpeedAtMost(kmh: number): DesignSpeed {
  for (const v of DESIGN_SPEEDS) if (v <= kmh) return v;
  return 20;
}

/** The next lower design speed, or null below 20. */
export function lowerDesignSpeed(v: DesignSpeed): DesignSpeed | null {
  const i = DESIGN_SPEEDS.indexOf(v);
  return DESIGN_SPEEDS[i + 1] ?? null;
}
