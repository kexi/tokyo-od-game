/**
 * The drives over the decks (P2.7-5 4.4): every route the earlier drives took (P3's cruise, P6's
 * autopilot, P7's Rainbow Bridge, P9's 麻布台 tunnel) plus 台場出口, written by run and run distance so
 * a rebuild that renumbers the chunks (v2 moves the decks) does not break them. scripts/qa/drive-deck.ts
 * drives one (`just check-deck-drive <label> <route>`); deckDriveVerdict.ts judges it. Pure: the
 * script resolves a place to a chunk with chunkAt over the data it serves.
 *
 * Why run distances and not chunk ids (as P7 did): P7's ends 45177681:15 and 45177678:17 no longer
 * existed by P2.7-4, so those drives ran to their time limit and "reached" nothing.
 */
import { ST, STATION_STRIDE, type XwChunk } from "../../src/expressway/format.ts";

/** A place on a run: its id and the run distance (m). */
export type RunPlace = { run: string; s: number };

export type CruiseRoute = {
  id: string;
  kind: "cruise";
  /** Where the car is put (on the deck, in `lane`); the game starts at that station's lon/lat. */
  from: RunPlace;
  /** The lane the car is put in and keeps (0 the left, the default). */
  lane?: number;
  /** The runs the cruise prefers at a fork, in that order. */
  prefer: string[];
  /** Reached on the chunk holding this place; `street`: once off the decks after its run. */
  to: RunPlace | { run: string; street: true };
  kmh: number;
  /** Game seconds the drive may take at most. */
  seconds: number;
  /** What the earlier drive was (knowledge/expressway-generation.md). */
  was: string;
};

export type AutoRoute = {
  id: string;
  kind: "auto";
  /** The game's start (lat,lon): the street near the entrance. */
  start: string;
  /** The entrance ramp: the car is put on the street connector at its foot (P6's drive). */
  entrance: string;
  /** Where the autopilot is sent (debug.expressway.route). */
  to: { lat: number; lon: number };
  seconds: number;
  was: string;
};

export type DeckRoute = CruiseRoute | AutoRoute;

/** The route check-deck-drive takes when none is named (P3's, as before). */
export const DEFAULT_ROUTE = "shibakoen-shiodome";

export const DECK_ROUTES: readonly DeckRoute[] = [
  {
    id: "shibakoen-shiodome",
    kind: "cruise",
    from: { run: "207111988", s: 2 },
    prefer: ["207111988", "24402125", "24402611"],
    to: { run: "24402125", street: true },
    kmh: 50,
    seconds: 400,
    was: "P3: 芝公園の入口 207111988 → 内回り 24402611 → 汐留出口 24402125 → 一般道（just check-deck-drive）",
  },
  {
    id: "auto-shibakoen-shiodome",
    kind: "auto",
    start: "35.6534,139.7497",
    entrance: "861095931",
    to: { lat: 35.66325, lon: 139.76275 },
    seconds: 300,
    was: "P6 の 1 本目: 一般道 → 芝公園入口 → 内回り → 汐留出口 → 一般道（scratchpad の p6/route.mjs）。S6 PR 7c: 入口の足が地平 run 861095931 になった（207111988 はその seam から）",
  },
  {
    id: "auto-shiodome-shibakoen",
    kind: "auto",
    start: "35.6631,139.7628",
    entrance: "23705286",
    to: { lat: 35.6529, lon: 139.7464 },
    seconds: 480,
    was: "P6 の 2 本目: 一般道 → 汐留入口 45068172 → 外回り 45021976 → 芝公園出口 4853798 → 一般道。S6 PR 7c: 入口の足が地平 run 23705286 になった（45068172 はその seam から）",
  },
  {
    id: "rainbow-upper-east",
    kind: "cruise",
    from: { run: "4848762", s: 1790 },
    prefer: ["4848762"],
    to: { run: "4848762", s: 2720 },
    kmh: 60,
    seconds: 240,
    was: "P7 upper-forward: 4848762:9 → :26 の橋の上と取付け",
  },
  {
    id: "rainbow-upper-west",
    kind: "cruise",
    from: { run: "45019020", s: 1995 },
    prefer: ["45019020"],
    to: { run: "45019020", s: 2925 },
    kmh: 60,
    seconds: 240,
    was: "P7 upper-backward: 45019020:9 → :24",
  },
  {
    id: "rainbow-lower-east",
    kind: "cruise",
    from: { run: "45177681", s: 1160 },
    prefer: ["45177681"],
    to: { run: "45177681", s: 3400 },
    kmh: 40,
    seconds: 400,
    was: "P7 lower-forward: 45177681:4 → 下層の終わり（P7 の :15 は今のデータに無い）",
  },
  {
    id: "rainbow-lower-west",
    kind: "cruise",
    from: { run: "45177678", s: 880 },
    prefer: ["45177678"],
    to: { run: "45177678", s: 3290 },
    kmh: 40,
    seconds: 400,
    was: "P7 lower-backward: 45177678:3 → 下層の終わり（P7 の :17 は今のデータに無い）",
  },
  {
    id: "daiba-exit",
    kind: "cruise",
    from: { run: "4848762", s: 2300 },
    prefer: ["4848889", "45177681", "4848762"],
    to: { run: "45177681", s: 3390 },
    kmh: 50,
    seconds: 300,
    was: "新設（P2.7-5）: 4848762 → 台場出口 4848889 → 臨港道路 45177681（v2 で最も動く run）",
  },
  {
    id: "azabudai-tunnel",
    kind: "cruise",
    from: { run: "45021976", s: 3175 },
    prefer: ["45021976", "737538573", "895902565"],
    to: { run: "895902565", s: 60 },
    kmh: 50,
    seconds: 200,
    was: "P9: 外回り 45021976:19 → 掘割・トンネル 737538573 → 895902565",
  },
  {
    id: "haneda-up-seam",
    kind: "cruise",
    from: { run: "45554541", s: 1150 },
    prefer: ["45554541", "45554540"],
    to: { run: "45554540", s: 300 },
    kmh: 60,
    seconds: 120,
    was: "新設（S6 PR 7c）: 1 号羽田線の地平 run 45554541 → 高架 45554540 の seam を越える",
  },
  {
    id: "haneda-down-seam",
    kind: "cruise",
    from: { run: "45021972", s: 7900 },
    prefer: ["45021972", "5213324"],
    to: { run: "5213324", s: 300 },
    kmh: 60,
    seconds: 120,
    was: "新設（S6 PR 7c）: 1 号羽田線の高架 45021972 → 地平 run 5213324 の seam を越える",
  },
  {
    id: "shiodome-approach-in",
    kind: "cruise",
    from: { run: "45068169", s: 10 },
    prefer: ["45068169", "45021976"],
    to: { run: "45021976", s: 200 },
    kmh: 50,
    seconds: 120,
    was: "新設（S6 PR 7c）: 汐留の取付け 45068169（坑口の外の地平 run、盛土・掘割）→ 外回り 45021976 の seam",
  },
  {
    id: "shiodome-approach-out",
    kind: "cruise",
    from: { run: "24402611", s: 4850 },
    lane: 1,
    prefer: ["24402611", "45068170"],
    to: { run: "45068170", s: 160 },
    kmh: 50,
    seconds: 120,
    was: "新設（S6 PR 7c）: 内回り 24402611 → 汐留の取付け 45068170 を坑口の手前まで。車線 1: 車線 0 は手放しの点（run s 約 4951）から先で汐留出口 24402125:0 の壁高欄に約 0.25 m 掛かる（台帳 parallel-ramp:24402125|24402611、7c で車線 0 は 24402611:33 s 22.3 で止まり、相手は 24402125:0 のコライダー）",
  },
];

export function routeOf(id: string): DeckRoute {
  const r = DECK_ROUTES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown route ${id} (${DECK_ROUTES.map((x) => x.id).join(", ")})`);
  return r;
}

/** The runs a route names (its places and preferences): each must be in the data. */
export function runsOf(r: DeckRoute): string[] {
  const runs = r.kind === "auto" ? [r.entrance] : [r.from.run, r.to.run, ...r.prefer];
  return [...new Set(runs)];
}

/** The chunk of a run holding run distance s, the share of the chunk there and its station's lon/lat. */
export function chunkAt(
  byRun: ReadonlyMap<string, readonly XwChunk[]>,
  p: RunPlace,
): { xid: string; k: number; share: number; lon: number; lat: number } | null {
  const list = byRun.get(p.run) ?? [];
  for (const c of list) {
    const s0 = c.st[ST.s];
    const last = c.st.length - STATION_STRIDE;
    const s1 = c.st[last + ST.s];
    const isInside = p.s >= s0 && p.s <= s1;
    if (!isInside) continue;
    let i = 0;
    while (i + STATION_STRIDE < last && c.st[i + STATION_STRIDE + ST.s] <= p.s) i += STATION_STRIDE;
    return {
      xid: c.id,
      k: c.k,
      share: s1 > s0 ? (p.s - s0) / (s1 - s0) : 0,
      lon: c.st[i + ST.lon],
      lat: c.st[i + ST.lat],
    };
  }
  return null;
}
