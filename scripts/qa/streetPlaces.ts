import { ST, STATION_STRIDE, type XwChunk } from "../../src/expressway/format.ts";

/**
 * The street drive's places (scripts/qa/street-drive.ts, P2.7 R1-5 PR A): where the car is put on the
 * street nearest a point and driven on the autopilot 40 m before → 40 m past it. Written by hand: S6
 * PR 7c's street drive's 18 (the copy in .qa/street-drive.mts of 7c, knowledge/expressway-generation.md
 * 「P2.7-6 PR 7c1」), and the places S7-6 adds. A generated list (PR B: a place per foot, the street
 * bands' largest jumps) is another file of the same shape.
 *
 * A place is a run and a run distance, `left` metres to its left (a wall's side), so a rebuild that
 * renumbers the chunks keeps it; or a latitude and longitude, for a street far from any deck (the
 * controls), which no run would name.
 */

export type StreetPlaceAt = { run: string; s: number; left?: number } | { lat: number; lon: number };

export type StreetPlace = { id: string; what: string; at: StreetPlaceAt };

/** 7c's street drive's 18 places, as the copy had them (ids, words and numbers unchanged). */
export const STREET_PLACES: readonly StreetPlace[] = [
  {
    id: "azabudai-north-portal-over",
    what: "麻布台の北の坑門の上の道（737538573）",
    at: { run: "737538573", s: 118 },
  },
  {
    id: "azabudai-north-portal-over-2",
    what: "麻布台の北の坑門の上の道（先、737538573）",
    at: { run: "737538573", s: 135 },
  },
  {
    id: "wall-24039751-left",
    what: "24039751:0 の盛土の壁際（左）",
    at: { run: "24039751", s: 50, left: 12 },
  },
  {
    id: "wall-24039751-right",
    what: "24039751:0 の盛土の壁際（右）",
    at: { run: "24039751", s: 50, left: -12 },
  },
  {
    id: "wall-45068169-left",
    what: "45068169 の盛土の壁際（左）",
    at: { run: "45068169", s: 100, left: 12 },
  },
  {
    id: "wall-45068169-right",
    what: "45068169 の盛土の壁際（右）",
    at: { run: "45068169", s: 100, left: -12 },
  },
  {
    id: "wall-24402611-start",
    what: "24402611 の始まりの盛土の壁際",
    at: { run: "24402611", s: 30, left: 12 },
  },
  {
    id: "kasumi-24402611-75",
    what: "霞が関の低い径間の下（24402611 s 75）",
    at: { run: "24402611", s: 74.7 },
  },
  {
    id: "kasumi-24402611-84",
    what: "霞が関の低い径間の下（24402611 s 84）",
    at: { run: "24402611", s: 83.9 },
  },
  {
    id: "kasumi-24402611-90",
    what: "霞が関の低い径間の下（24402611 s 90）",
    at: { run: "24402611", s: 90.2 },
  },
  {
    id: "kasumi-895902565-850",
    what: "895902565 の低い径間の下（s 850）",
    at: { run: "895902565", s: 849.6 },
  },
  {
    id: "kasumi-895902565-856",
    what: "895902565 の低い径間の下（s 856）",
    at: { run: "895902565", s: 856.5 },
  },
  {
    id: "kasumi-895902565-865",
    what: "895902565 の低い径間の下（s 865）",
    at: { run: "895902565", s: 865.1 },
  },
  {
    id: "decided-895902565-80",
    what: "決定で高架に戻した 895902565 s 80 の下の街路（区間 815）",
    at: { run: "895902565", s: 80 },
  },
  {
    id: "decided-45021976-3412",
    what: "決定で高架に戻した 45021976 s 3412 の下の街路（区間 650）",
    at: { run: "45021976", s: 3412 },
  },
  {
    id: "control-two-way",
    what: "対照: 双方向の街路（幅 9 m、床版から 200 m 以上）",
    at: { lat: 35.666023, lon: 139.750794 },
  },
  {
    id: "control-one-way",
    what: "対照: 一方通行の街路（幅 9 m、床版から 200 m 以上）",
    at: { lat: 35.664318, lon: 139.755902 },
  },
  {
    id: "control-narrow",
    what: "対照: 幅 4.3 m の街路（一方通行、床版から 200 m 以上）",
    at: { lat: 35.664136, lon: 139.756425 },
  },
];

/** Metres per degree of latitude, and of longitude at the equator (the copy's flat-earth step). */
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320;

/**
 * The (lat, lon) of a place: a run's stations put end to end in chunk order, interpolated at `s`, and
 * moved `left` m to the left of the station's direction; null when the data has no such run.
 * The copy's own arithmetic (7c), so the same data gives the same points as it did: the run distance
 * clamped to the run's first and last station pair, a local flat step for the offset.
 * Why not deckRoutes.ts chunkAt: it returns the station before `s`, not a point at `s`, and no offset.
 */
export function placeLatLon(
  byRun: ReadonlyMap<string, readonly XwChunk[]>,
  at: StreetPlaceAt,
): { lat: number; lon: number } | null {
  const isPoint = "lat" in at;
  if (isPoint) return { lat: at.lat, lon: at.lon };
  const list = (byRun.get(at.run) ?? []).toSorted((a, b) => a.k - b.k);
  if (list.length === 0) return null;
  const st = list.flatMap((c) => {
    const rows: number[][] = [];
    for (let i = 0; i < c.st.length; i += STATION_STRIDE) rows.push(c.st.slice(i, i + STATION_STRIDE));
    return rows;
  });
  const isTooShort = st.length < 2;
  if (isTooShort) return null;
  let i = 0;
  while (i + 2 < st.length && st[i + 1][ST.s] < at.s) i++;
  const [a, b] = [st[i], st[i + 1]];
  const t = Math.max(0, Math.min(1, (at.s - a[ST.s]) / (b[ST.s] - a[ST.s] || 1)));
  const lat = a[ST.lat] + (b[ST.lat] - a[ST.lat]) * t;
  const lon = a[ST.lon] + (b[ST.lon] - a[ST.lon]) * t;
  const kx = M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
  const ex = (b[ST.lon] - a[ST.lon]) * kx;
  const ny = (b[ST.lat] - a[ST.lat]) * M_PER_DEG_LAT;
  const n = Math.hypot(ex, ny) || 1;
  const left = at.left ?? 0;
  return { lat: lat + ((ex / n) * left) / M_PER_DEG_LAT, lon: lon - ((ny / n) * left) / kx };
}

/** The places named in `ids` (all without), or throws on an id the table does not have. */
export function placesOf(places: readonly StreetPlace[], ids: readonly string[] | null): StreetPlace[] {
  if (ids === null) return [...places];
  const unknown = ids.filter((id) => !places.some((p) => p.id === id));
  const hasUnknown = unknown.length > 0;
  if (hasUnknown) throw new Error(`unknown street places: ${unknown.join(", ")}`);
  return places.filter((p) => ids.includes(p.id));
}
