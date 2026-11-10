import type { XwDiagnostic } from "./format";

/**
 * What the compiler reports and the project accepts, each with why. Only this list decides a
 * diagnostic's `allowed` (compile.ts sets it from here; the compiler itself never does), and
 * tests/expresswayData.test.ts fails on anything it does not cover (knowledge/road-redesign-plan.md 4.4 T10), while the
 * counts per kind are a reviewed snapshot. `run: "*"` covers the kind everywhere; `with` narrows a
 * deck_overlap entry to one pair (the diagnostic's detail starts "with <run>:").
 */
export type AllowEntry = {
  run: string;
  kind: string;
  with?: string;
  /** For a deck_overlap: the most stations and the largest |Δz| (m) accepted; more fails T10. */
  maxStations?: number;
  maxDzM?: number;
  reason: string;
};

const RAMP_RADIUS_REASON =
  "OSM の線形のままの半径。平面は OSM から 1.5 m 以内に留める（MAX_LATERAL_SHIFT）ので広げられない。下限 15 m は設計書の仮定（RAMP_MIN_RADIUS）で、連結路は第28条第4項で第15条の適用外。走れるかは P3 の走行で確かめる";

const C1_CHANGEOVER_REASON =
  "都心環状線の内回り・外回りが二層（OSM layer 3 / 2）から並列（同じ layer）に移る区間。OSM の中心線の間隔（6–8.6 m）が車線域の幅の和（8.5 m）より狭く、移り変わりの高さの差（0–6.7 m）がどこに置いても重なりの中に入る";

const HAMAZAKIBASHI_REASON =
  "浜崎橋 JCT で 1 号羽田線への分岐（4848762）のノーズが内回りと同一面、外回りの 1 段上（OSM layer）を同時に求められ、内回りと外回りの移り変わりと重なる。三者の OSM の線が 1.3–8 m に集まり、全部は満たせない";

export const ALLOWLIST: ReadonlyArray<AllowEntry> = [
  {
    run: "*",
    kind: "vertical_fallback",
    reason:
      "特例値の勾配・下げた設計速度はどちらも第20条・第13条の範囲内（knowledge/road-redesign-plan.md 4.3 の 3 の順に試した結果）。地表の床を外す「交差のみ」は別の kind（vertical_crossings_only）で、ここには含まない",
  },
  {
    run: "*",
    kind: "crossing_over_or_at_grade",
    reason:
      "OSM に高さの無い「地上」の道路が地表端の近くにあり、標準勾配では越えられない。掘割の上を渡る道か地下道とみなし、タイルの blocked に記録した（P3 で通行止め・迂回を決める）",
  },
  { run: "203059412", kind: "ramp_radius", reason: `R 11.7 m。${RAMP_RADIUS_REASON}` },
  { run: "203059413", kind: "ramp_radius", reason: `R 10.7 m。${RAMP_RADIUS_REASON}` },
  {
    run: "203873831",
    kind: "ramp_radius",
    reason: `R 13.4 m（試験区間の C1 と同じ成分で解く連結路）。${RAMP_RADIUS_REASON}`,
  },
  { run: "24039815", kind: "ramp_radius", reason: `R 14.5 m。${RAMP_RADIUS_REASON}` },
  { run: "5213291", kind: "ramp_radius", reason: `R 13.5 m。${RAMP_RADIUS_REASON}` },
  { run: "761796514", kind: "ramp_radius", reason: `R 11.6 m。${RAMP_RADIUS_REASON}` },
  {
    run: "24402611",
    kind: "deck_overlap",
    with: "45021976",
    maxStations: 29,
    maxDzM: 6.57,
    reason: C1_CHANGEOVER_REASON,
  },
  {
    run: "24402611",
    kind: "deck_overlap",
    with: "4848762",
    maxStations: 6,
    maxDzM: 0.14,
    reason: HAMAZAKIBASHI_REASON,
  },
  {
    run: "45021976",
    kind: "deck_overlap",
    with: "4848762",
    maxStations: 4,
    maxDzM: 6.42,
    reason: HAMAZAKIBASHI_REASON,
  },
  {
    run: "24402611",
    kind: "deck_overlap",
    with: "813455519",
    maxStations: 2,
    maxDzM: 1.9,
    reason: `羽田線から外回りへ入る連結路（813455519）が外回りへ合流する終点で内回りの車線域に 2 測点かかる。${C1_CHANGEOVER_REASON}`,
  },
];

/** Stations and largest |Δz| from a deck_overlap detail ("with b: N stations, |Δz| lo–hi m, …"). */
export function overlapSize(detail: string): { stations: number; maxDzM: number } | null {
  const m = /: (\d+) stations, \|Δz\| [\d.]+–([\d.]+) m/.exec(detail);
  return m ? { stations: Number(m[1]), maxDzM: Number(m[2]) } : null;
}

export function isAllowed(d: Pick<XwDiagnostic, "run" | "kind"> & { detail?: string }): boolean {
  return ALLOWLIST.some((a) => {
    const isRun = a.run === "*" || a.run === d.run;
    const isPair = a.with === undefined || (d.detail ?? "").startsWith(`with ${a.with}:`);
    if (!isRun || a.kind !== d.kind || !isPair) return false;
    const hasLimit = a.maxStations !== undefined || a.maxDzM !== undefined;
    if (!hasLimit) return true;
    const size = overlapSize(d.detail ?? "");
    if (!size) return false;
    return size.stations <= (a.maxStations ?? Infinity) && size.maxDzM <= (a.maxDzM ?? Infinity);
  });
}
