import type { DeckRoute } from "./deckRoutes.ts";
import { routeGameSeconds } from "./districtRoutes.ts";

/**
 * A generated table's drives cut into bundles that each fit one lock of the measuring machine (25 min,
 * knowledge「P2.7 R1-5 PR A」手順 0), and the round's estimate in real time (the user's line: about 8 h,
 * 2026-11-24). Pure. drive-deck.ts `--budget-min` cuts with the same numbers as it drives.
 */

/** A route driven on a page already open: the game's 移動 there, settle, place twice, blocker (s; 手順 0: 9.1–31.9, mean 21.6). */
export const MOVE_S = 21.6;
/** A new page (launch → ready → settled), as each route of the hand table opens one (s; R1-1b's drives, 58). */
export const OPEN_S = 58;
/** A page is opened again after this many routes (手順 0: the heap stayed 201–704 MB over 8; the coordinator's N). */
export const REOPEN_EVERY = 10;
/** Real seconds per game second while driving (手順 0: 0.92–1.03 over three routes; the higher). */
export const WALL_PER_GAME = 1.03;

/** A route's real time on a page already open (s). */
export const routeWallSeconds = (r: DeckRoute) => routeGameSeconds(r) * WALL_PER_GAME + MOVE_S;

/**
 * The routes cut in order into bundles of at most `budgetS` real seconds, each with one page opened
 * at its start and again every REOPEN_EVERY routes. A route longer than the budget is a bundle of its
 * own (flagged `over`).
 */
export function bundlesOf(
  routes: readonly DeckRoute[],
  budgetS: number,
): Array<{ ids: string[]; seconds: number; over: boolean }> {
  const out: Array<{ ids: string[]; seconds: number; over: boolean }> = [];
  let ids: string[] = [];
  let seconds = 0;
  for (const r of routes) {
    const reopen = ids.length % REOPEN_EVERY === 0 ? OPEN_S : 0;
    const add = routeWallSeconds(r) + reopen;
    const isFull = ids.length > 0 && seconds + add > budgetS;
    if (isFull) {
      out.push({ ids, seconds, over: false });
      ids = [];
      seconds = 0;
    }
    const first = ids.length === 0 ? OPEN_S : reopen;
    ids.push(r.id);
    seconds += routeWallSeconds(r) + first;
  }
  if (ids.length > 0) out.push({ ids, seconds, over: false });
  return out.map((b) => ({ ...b, seconds: Math.round(b.seconds), over: b.seconds > budgetS }));
}

/** The round's estimate: game and real hours, and the bundles of 25 min. */
export function estimateRound(routes: readonly DeckRoute[]) {
  const game = routes.reduce((a, r) => a + routeGameSeconds(r), 0);
  const bundles = bundlesOf(routes, 25 * 60);
  const wall = bundles.reduce((a, b) => a + b.seconds, 0);
  return {
    routes: routes.length,
    gameH: Math.round((game / 3600) * 100) / 100,
    wallH: Math.round((wall / 3600) * 100) / 100,
    bundles: bundles.length,
    overBudget: bundles.filter((b) => b.over).map((b) => b.ids[0]),
  };
}
