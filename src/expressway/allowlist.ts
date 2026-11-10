import type { XwDiagnostic } from "./format";

/**
 * What the compiler reports and the project accepts, each with why. Only this list decides a
 * diagnostic's `allowed` (compile.ts sets it from here; the compiler itself never does), and
 * tests/expresswayData.test.ts fails on anything it does not cover (設計書 4.4 T10), while the
 * counts per kind are a reviewed snapshot. `run: "*"` covers the kind everywhere.
 */
export const ALLOWLIST: ReadonlyArray<{ run: string; kind: string; reason: string }> = [
  {
    run: "*",
    kind: "vertical_fallback",
    reason:
      "特例値の勾配・下げた設計速度はどちらも第20条・第13条の範囲内（設計書 4.3 の 3 の順に試した結果）",
  },
  {
    run: "*",
    kind: "crossing_over_or_at_grade",
    reason:
      "OSM に高さの無い「地上」の道路が地表端の近くにあり、標準勾配では越えられない。掘割の上を渡る道か地下道とみなした（P3 で地表近くの床版が道路を塞ぐ箇所としてタイルに記録する）",
  },
  {
    run: "*",
    kind: "deck_overlap",
    reason:
      "P1 は検出と記録だけ（描画のみでコライダーが無い）。並走・分合流部の床版の分離は P3 の前に直す。件数はスナップショットで固定",
  },
];

export function isAllowed(d: Pick<XwDiagnostic, "run" | "kind">): boolean {
  return ALLOWLIST.some((a) => (a.run === "*" || a.run === d.run) && a.kind === d.kind);
}
