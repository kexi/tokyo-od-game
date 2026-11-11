import { DEM_SINK_GIVE, OPEN_FLOOR_GIVE, OPEN_GROUND_FLOOR } from "./assumptions";
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
  /** For a ramp_radius: the tightest radius (m) accepted on that ramp (T6 checks the plan against it). */
  minRadiusM?: number;
  /** For a miss of an assumed floor (detail "<m> m under …"): the most accepted. */
  maxShortM?: number;
  reason: string;
};

const RAMP_RADIUS_REASON =
  "OSM の線形のままの半径。平面は OSM から 1.5 m 以内に留める（MAX_LATERAL_SHIFT）ので広げられない。下限 15 m は設計書の仮定（RAMP_MIN_RADIUS）で、連結路は第28条第4項で第15条の適用外。走れるかは P3 の走行で確かめる";

const C1_CHANGEOVER_REASON =
  "都心環状線の内回り・外回りが二層（OSM layer 3 / 2）から並列（同じ layer）に移る区間。OSM の中心線の間隔（6–8.6 m）が車線域の幅の和（8.5 m）より狭く、移り変わりの高さの差（0–6.7 m）がどこに置いても重なりの中に入る";

const HAMAZAKIBASHI_REASON =
  "浜崎橋 JCT で 1 号羽田線への分岐（4848762）のノーズが内回りと同一面、外回りの 1 段上（OSM layer）を同時に求められ、内回りと外回りの移り変わりと重なる。三者の OSM の線が 1.3–8 m に集まり、全部は満たせない";

/**
 * The largest same-surface miss the list accepts (浜崎橋 JCT, 24402611 × 4848762). The game makes
 * one slab of a pair only within this (expresswayMerge.ts MERGE_MAX_DZ is derived from it): what the
 * project accepts as one surface is what is drawn as one.
 */
export const SAME_SURFACE_ALLOWED_DZ_M = 0.14;

const SHIBAURA_REASON =
  "芝浦 JCT で 11 号台場線と 1 号羽田線の上下線が二層・立体交差から並列へ移る区間（OSM layer 2〜4 の移り変わり）。P7 の rainbow 範囲で初めてファイルに出た run で、構造物上書きなし（--no-structures）でも同じ組・ほぼ同じ大きさで出る。中心線の間隔（6.4〜8.4 m）が車線域の幅の和より狭く、移り変わりの高さの差がどこに置いても重なりの中に入る";

const NOSE_REASON =
  "分合流のノーズで、同一面（5 cm 以内）の帯をわずかに外れる 1〜2 測点（P2.5 の全域の重なりの内訳で 0.5 m 未満の 114 組と同じ類型）";

const SHIODOME_REASON =
  "本線はこの区間で地表（築地川の掘割へ向かう地表端）へ下り、連結路は高架のまま一般道へ向かうので、車線域が重なったまま高さが離れる（同一面のノーズから最大 6.6 m）。OSM の線のとおりで平面は動かせない（MAX_LATERAL_SHIFT）。本線のこの先の掘割はこの範囲のデータに無く（P9 が通したのは麻布台のトンネル）、run の地表端で終わるので、経路と交通 AI は入らない（laneLinks.ts reachesStreets）";

export const ALLOWLIST: ReadonlyArray<AllowEntry> = [
  {
    run: "*",
    kind: "vertical_fallback",
    reason:
      "特例値の勾配・下げた設計速度はどちらも第20条・第13条の範囲内（knowledge/road-redesign-plan.md 4.3 の 3 の順に試した結果）。地表の床を外す「交差のみ」は別の kind（vertical_crossings_only）で、ここには含まない",
  },
  {
    run: "*",
    kind: "below_open_ground_floor",
    maxShortM: OPEN_FLOOR_GIVE.value,
    reason: `最も低い設計速度でも解けない run だけ（最終段）。${OPEN_GROUND_FLOOR.reason}。${OPEN_FLOOR_GIVE.reason}。OSM の道路は交差として 4.5 m を満たす`,
  },
  {
    run: "*",
    kind: "deck_below_ground",
    maxShortM: DEM_SINK_GIVE.value,
    reason: `最も低い設計速度でも解けない run の、低い端の近くだけ（最終段）。${DEM_SINK_GIVE.reason}`,
  },
  {
    run: "*",
    kind: "crossing_over_or_at_grade",
    reason:
      "OSM に高さの無い「地上」の道路が地表端の近くにあり、標準勾配では越えられない。掘割の上を渡る道か地下道とみなし、タイルの blocked に記録した（P3 で通行止め・迂回を決める）",
  },
  {
    run: "737538573",
    kind: "tunnel_cover_short",
    reason:
      "都心環状線外回りの麻布台のトンネル（P9）の北の坑口は斜面に開き、坑口の手前で地表が 3 m 余り下がる。坑口から第20条の標準勾配（V50 で 6 %、坑口を上り勾配で出る最悪の場合から）では、箱の高さと最小の土被り（TUNNEL_DEPTH_M）まで下りきれない。坑口の近くは箱の頂版が地表より上に出る開削部として扱い、地形を切り欠いて坑門で見せる（expresswayBore.ts）",
  },
  { run: "203059412", kind: "ramp_radius", minRadiusM: 11.7, reason: `R 11.7 m。${RAMP_RADIUS_REASON}` },
  { run: "203059413", kind: "ramp_radius", minRadiusM: 10.7, reason: `R 10.7 m。${RAMP_RADIUS_REASON}` },
  {
    run: "203873831",
    kind: "ramp_radius",
    minRadiusM: 13.4,
    reason: `R 13.4 m（試験区間の C1 と同じ成分で解く連結路）。${RAMP_RADIUS_REASON}`,
  },
  { run: "24039815", kind: "ramp_radius", minRadiusM: 14.5, reason: `R 14.5 m。${RAMP_RADIUS_REASON}` },
  { run: "5213291", kind: "ramp_radius", minRadiusM: 13.5, reason: `R 13.5 m。${RAMP_RADIUS_REASON}` },
  { run: "761796514", kind: "ramp_radius", minRadiusM: 11.6, reason: `R 11.6 m。${RAMP_RADIUS_REASON}` },
  {
    run: "24402611",
    kind: "deck_overlap",
    with: "895902565",
    maxStations: 38,
    maxDzM: 5.56,
    reason:
      "麻布台のトンネル（P9）の北の坑口を出た外回り（895902565、OSM layer 2）が地表から上り始める区間で、内回り（199311749、layer 3）の中心線が 7.9 m 横を通る。車線域の幅の和より近く、坑口で地表に接する外回りは 1 段（4.5 m + 桁高）の差まで上がりきれない。P9 で外回りがファイルに入って初めて出た組（坑口の高さは P7 の portal と同じ地表）",
  },
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
    maxDzM: SAME_SURFACE_ALLOWED_DZ_M,
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
  {
    run: "45019020",
    kind: "deck_overlap",
    with: "45554540",
    maxStations: 13,
    maxDzM: 6.38,
    reason: SHIBAURA_REASON,
  },
  {
    run: "45019020",
    kind: "deck_overlap",
    with: "4848762",
    maxStations: 10,
    maxDzM: 4.12,
    reason: SHIBAURA_REASON,
  },
  {
    run: "45021972",
    kind: "deck_overlap",
    with: "45554540",
    // P6 cuts chunks where the OSM maxspeed changes (XW_VERSION 5): the stations at the new cuts
    // add 4 to the same stretch (16 → 20), the largest |Δz| unchanged.
    maxStations: 20,
    maxDzM: 6.64,
    reason: SHIBAURA_REASON,
  },
  {
    run: "45021972",
    kind: "deck_overlap",
    with: "4848762",
    maxStations: 16,
    maxDzM: 6.46,
    // P7 alone: 15 stations, 6.33 m. P2.6's solve (gapTol, the end bands) moves the coupled
    // component by centimetres, which puts one more station in and 13 cm more on the changeover.
    reason: `${SHIBAURA_REASON}（P2.6 との統合で 15 測点・6.33 m から 16 測点・6.46 m）`,
  },
  {
    run: "45021972",
    kind: "deck_overlap",
    with: "45021976",
    maxStations: 1,
    maxDzM: 0.11,
    reason: `浜崎橋 JCT で 1 号羽田線（45021972）が C1 外回りから分かれる所。${NOSE_REASON}`,
  },
  {
    run: "45554540",
    kind: "deck_overlap",
    with: "813455519",
    maxStations: 2,
    maxDzM: 0.24,
    reason: `浜崎橋 JCT で 1 号羽田線（45554540）が羽田線から C1 への連結路と分かれる所。${NOSE_REASON}`,
  },
  {
    run: "45019020",
    kind: "deck_overlap",
    with: "4848740",
    maxStations: 1,
    maxDzM: 0.32,
    reason: `芝浦 JCT の連結路（4848740）が 11 号台場線の上り（45019020）に合流する所。${NOSE_REASON}`,
  },
  {
    run: "45019020",
    kind: "deck_overlap",
    with: "4848755",
    maxStations: 2,
    maxDzM: 0.06,
    reason: `芝浦の入口ランプ（4848755）が 11 号台場線の上り（45019020）に合流する所（P2.6 との統合で出た）。${NOSE_REASON}`,
  },
  {
    run: "45177678",
    kind: "deck_overlap",
    with: "4848755",
    maxStations: 2,
    maxDzM: 0.06,
    reason: `芝浦の入口ランプ（4848755）の地表端が臨港道路（45177678、street）の地表端と同じ面で並ぶ所（P2.6 との統合で出た）。${NOSE_REASON}`,
  },
  {
    run: "24402125",
    kind: "deck_overlap",
    with: "24402611",
    maxStations: 21,
    maxDzM: 6.62,
    reason: `汐留出口（24402125、P6 で範囲に足した）が内回りから分かれた後の 190 m を、OSM の中心線が内回りから 1.1–1.7 m しか離れずに並走する。${SHIODOME_REASON}`,
  },
  {
    run: "45021976",
    kind: "deck_overlap",
    with: "45068172",
    maxStations: 13,
    maxDzM: 3.68,
    reason: `汐留入口（45068172、P6 で範囲に足した）が外回りへ合流する手前の 110 m を、OSM の中心線が外回りから 1.1 m ほどで並走する。${SHIODOME_REASON}`,
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
    const radius = /R=([\d.]+) m/.exec(d.detail ?? "");
    const isRadiusLimited = a.minRadiusM !== undefined;
    if (isRadiusLimited) return radius !== null && Number(radius[1]) >= a.minRadiusM!;
    const short = /^([\d.]+) m under/.exec(d.detail ?? "");
    const isShortLimited = a.maxShortM !== undefined;
    if (isShortLimited) return short !== null && Number(short[1]) <= a.maxShortM!;
    const hasLimit = a.maxStations !== undefined || a.maxDzM !== undefined;
    if (!hasLimit) return true;
    const size = overlapSize(d.detail ?? "");
    if (!size) return false;
    return size.stations <= (a.maxStations ?? Infinity) && size.maxDzM <= (a.maxDzM ?? Infinity);
  });
}
