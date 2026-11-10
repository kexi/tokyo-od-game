/**
 * What a published specification gives for retroreflective sign sheeting, with where it is written.
 * Kept apart from retroAssumptions.ts so a guess never passes for a measured value (the split of
 * mountStandards.ts / mountAssumptions.ts).
 */

/**
 * A value from a specification (not a law: the 共通仕様書 is a contract specification, and the
 * test method it names is a JIS). Same shape as src/law/roadStandards.ts Statute.
 */
export type Specification<T> = { readonly value: T; readonly source: string };

export type SheetingRow = {
  obsDeg: number;
  entDeg: number;
  white: number;
  yellow: number;
  red: number;
  blue: number;
  green: number;
};

/**
 * 再帰反射係数 of カプセルレンズ型反射シート (minimum, by observation and entrance angle), white /
 * yellow / red / blue / green. The page gives no unit; JIS Z 9117's is cd/(lx·m²).
 * Read from the MLIT page on 2026-11-11 (knowledge/sign-system.md). Not checked against JIS Z 9117
 * itself (sold, not read).
 */
export const SHEETING_RA: Specification<ReadonlyArray<SheetingRow>> = {
  value: [
    { obsDeg: 0.2, entDeg: 5, white: 250, yellow: 170, red: 45, blue: 20, green: 45 },
    { obsDeg: 0.2, entDeg: 30, white: 150, yellow: 100, red: 25, blue: 11, green: 25 },
    { obsDeg: 0.2, entDeg: 40, white: 110, yellow: 70, red: 16, blue: 8, green: 16 },
    { obsDeg: 0.33, entDeg: 5, white: 180, yellow: 122, red: 25, blue: 14, green: 21 },
    { obsDeg: 0.33, entDeg: 30, white: 100, yellow: 67, red: 14, blue: 7, green: 11 },
    { obsDeg: 0.33, entDeg: 40, white: 95, yellow: 64, red: 13, blue: 7, green: 11 },
    { obsDeg: 2.0, entDeg: 5, white: 5, yellow: 3, red: 0.8, blue: 0.2, green: 0.6 },
    { obsDeg: 2.0, entDeg: 30, white: 2.5, yellow: 1.5, red: 0.4, blue: 0.1, green: 0.3 },
    { obsDeg: 2.0, entDeg: 40, white: 1.5, yellow: 1.0, red: 0.3, blue: 0.06, green: 0.2 },
  ],
  source:
    "国土交通省 土木工事共通仕様書（令和8年度）第2編 2-2-12-1 (4) 表2-2-29 カプセルレンズ型反射シートの反射性能（試験・測定は JIS Z 9117）",
};
