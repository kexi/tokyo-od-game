/**
 * The heights and distances the standards give for holding a sign up, each with where it is
 * written. Kept apart from mountAssumptions.ts so a guess never passes for a standard (the same
 * split as src/law/roadStandards.ts and src/expressway/assumptions.ts). src/signs/mount.ts reads
 * nothing else; knowledge/sign-system.md「支柱と取付（G4）」 has the readings behind each value.
 *
 * Who sets a sign decides which standard applies: 規制・指示 are the 公安委員会's (警察庁「交通規制基準」),
 * 案内・警戒 the road administrator's (国土交通省「道路標識設置基準」).
 */
import { CLEARANCE_HEIGHT, type Statute } from "../law/roadStandards";

export { CLEARANCE_HEIGHT };

/** Who sets the sign, and so which standard's heights apply. */
export type Authority = "police" | "road";
/** Where a roadside face hangs: over a pavement people walk or cycle on, or anywhere else. */
export type Site = "pavement" | "roadside";
/** A lower-edge rule: the standard and the lowest the standard still allows, m. */
export type Bottom = { readonly standardM: number; readonly minM: number };

/** Lower edge of the lowest face of a roadside mount, above the surface it stands on. */
export const ROADSIDE_BOTTOM: Statute<Record<Authority, Record<Site, Bottom>>> = {
  value: {
    // 歩道上 2.5 m（状況により 1.8 m まで）; elsewhere 1.8 m (1.5–2.5 m).
    police: { pavement: { standardM: 2.5, minM: 1.8 }, roadside: { standardM: 1.8, minM: 1.5 } },
    // 1.80 m; 2.5 m or more on a pavement without a furniture strip and too narrow (the game's).
    road: { pavement: { standardM: 2.5, minM: 2.5 }, roadside: { standardM: 1.8, minM: 1.8 } },
  },
  source:
    "交通規制基準（令和8年3月16日）第2章 3 高さの基準 表 1・道路標識設置基準（令和元年10月）3-1-2 (2) 1) I)",
};

/** 片持式・門型式: 5.0 m standard, 4.7 m or more (交通規制基準 allows 4.5 m; the stricter is kept). */
export const OVERHEAD_BOTTOM: Statute<Bottom> = {
  value: { standardM: 5.0, minM: 4.7 },
  source: "道路標識設置基準 3-1-2 (2) 2) I)・交通規制基準 第2章 3 表 2・3",
};

/** 建築限界 H on a 重要物流道路 (the 4.5 m of other 普通道路 is CLEARANCE_HEIGHT). */
export const LOGISTICS_CLEARANCE_HEIGHT: Statute<number> = { value: 4.8, source: "構造令 第12条" };

/** Posts and plates 25 cm or more from the kerb line (歩車道境界), and from a median's edge. */
export const KERB_CLEAR: Statute<number> = { value: 0.25, source: "道路標識設置基準 3-1-2 (2) 1) II)" };

/**
 * Gantry legs stand like roadside posts: 50 cm from the edge on 第1種第1・2級 (25 cm elsewhere).
 * The larger is used: G6 stands gantries on the 都市高速.
 */
export const LEG_CLEAR: Statute<number> = { value: 0.5, source: "道路標識設置基準 3-1-2 (2) 1) II)・2) II)" };

/** On one face: two 本板 above each other at most, and four plates in all (補助板 included). */
export const FACE_LIMITS: Statute<{ plates: number; faces: number }> = {
  value: { plates: 2, faces: 4 },
  source: "交通規制基準 第2章 9 (2) ア (ア)・(イ)",
};

/**
 * Between an upper 本板 (or its 補助板) and the 本板 under it: with 10–15 cm the lower plate may carry
 * a 補助板 the upper one lacks, without the upper one repeating it.
 */
export const PLATE_GAP_RANGE: Statute<{ min: number; max: number }> = {
  value: { min: 0.1, max: 0.15 },
  source: "交通規制基準 第2章 9 (2) ウ (ウ)",
};

/** On a signal, a pole or another structure: up to 6 m when hung like an overhead sign. */
export const SHARE_MAX_TOP: Statute<number> = { value: 6.0, source: "交通規制基準 第2章 3 表 4" };

/** Large overhead boards lean forward about 3°. */
export const TILT_DEG: Statute<number> = { value: 3, source: "国土交通省 道路標識 Q&A 5（通常約 3°）" };

/** Every standard here, for the tests (each must cite where it is written). */
export const MOUNT_STANDARDS: Readonly<Record<string, Statute<unknown>>> = {
  ROADSIDE_BOTTOM,
  OVERHEAD_BOTTOM,
  CLEARANCE_HEIGHT,
  LOGISTICS_CLEARANCE_HEIGHT,
  KERB_CLEAR,
  LEG_CLEAR,
  FACE_LIMITS,
  PLATE_GAP_RANGE,
  SHARE_MAX_TOP,
  TILT_DEG,
};
