/**
 * What the law writes about the 都市高速's signs (G6), each with where (the Statute form of
 * src/law/roadStandards.ts). The game's own choices inside these are expresswaySignAssumptions.ts.
 */
import type { Statute } from "../law/roadStandards";

/**
 * 別表第一「設置場所」 for the 都市高速道路等, metres before the exit / JCT: [min, max].
 * 112-B and 108の2-C〜E give only a maximum (min 0).
 */
export const BOARD_RANGES: Statute<
  Record<"110-B" | "111-B" | "112-B" | "108の2-C", readonly [number, number]>
> = {
  value: { "110-B": [100, 600], "111-B": [100, 500], "112-B": [0, 300], "108の2-C": [0, 300] },
  source:
    "道路標識、区画線及び道路標示に関する命令 別表第一 110-B「都市高速道路等の出口の手前百メートルから六百メートルまで」・111-B「…出口又は分岐点の手前百メートルから五百メートルまで…当該車線の上方」・112-B「…出口の手前三百メートル以内の地点における車道の上方」・108の2-C〜E「高速道路等の入口、出口又は分岐点の手前三百メートル以内」",
};

/** Where no maximum speed is posted, a motor vehicle on a road other than a 高速自動車国道: 60 km/h. */
export const STATUTORY_SPEED: Statute<{ ordinary: number }> = {
  value: { ordinary: 60 },
  source:
    "道路交通法施行令 第11条第1号（自動車の最高速度 60 km/h。都市高速は自動車専用道路で高速自動車国道ではないので、第27条の 100 km/h は当たらない）",
};
