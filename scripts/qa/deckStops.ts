/**
 * The car's stands on the decks in a deck drive (scripts/qa/drive-deck.ts), each with the reason
 * the game logged for it, if any: expressway_car_stalled (the car stood STALL_MS on a deck) paired
 * with the autopilot's autopilot_stop_trace (what it was waiting for, src/main.ts).
 *
 * Why tell them apart: the check's stall is there to catch a car caught on the decks' shape (a
 * 壁高欄 across the lane, a step, 207111988:2), and it failed an autopilot waiting at a red light at
 * the foot of an exit ramp just as well (D1, 24402125:2). Why not guess the reason on the QA side
 * (a light near the stall): what the driver waited for is the game's own record; a guess would pass
 * a car stuck beside a light.
 */

/** expressway_car_stalled, as the page logged it. */
export type DeckStall = {
  ts: string;
  lat: number;
  lon: number;
  xid: string | null;
  frozen: boolean;
  carFrozen: boolean;
  touching: { buildings: number; other: number };
};

/** autopilot_stop_trace, as the page logged it (the parts read here). */
export type StopTrace = {
  ts: string;
  phase: "still" | "movedOff" | "accident";
  stillS: number;
  lat: number;
  lon: number;
  why: {
    blockBy: "stop" | "obstacle" | null;
    stop: { kind: string; action: string; cycleS: number | null } | null;
    front: { gap: number } | null;
    verdict: string;
  } | null;
};

/** A stand with a reason: how long it lasted and the longest it may (a signal's cycle). */
export type DeckWait = {
  xid: string | null;
  reason: "signal" | "stopLine" | "queue";
  seconds: number | null;
  limitS: number;
  isOver: boolean;
};

/**
 * The longest a car may wait with a reason but no signal's cycle to go by (s): a queue behind a car,
 * a 一時停止. Why 180: four cycles of the two-phase plan (45 s, src/world/trafficControl.ts CYCLE),
 * room for a queue to clear through a light or two; one that has not moved for longer is a
 * blockage, not a wait.
 */
export const WAIT_LIMIT_S = 180;
/** How far a trace may be from the stall it explains, in time (ms) and on the ground (m). */
const PAIR_MS = 2000;
const PAIR_M = 5;

const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

/** The reason the driver logged for standing, or null when it logged none. */
function reasonOf(trace: StopTrace): DeckWait["reason"] | null {
  const why = trace.why;
  if (!why) return null;
  const isAtStop = why.blockBy === "stop" && why.stop !== null && why.stop.action !== "go";
  if (isAtStop) return why.stop?.kind === "signal" ? "signal" : "stopLine";
  const isQueued = why.verdict === "queue" && why.front !== null && why.front.gap < 10;
  if (isQueued) return "queue";
  return null;
}

/**
 * Splits the stalls into the unexplained (failures, as before) and the waits with a reason. A stall
 * where the car was held (frozen) or touched something is never a wait, whatever the driver says.
 */
export function judgeStalls(
  stalls: readonly DeckStall[],
  traces: readonly StopTrace[],
): { unexplained: DeckStall[]; waits: DeckWait[] } {
  const unexplained: DeckStall[] = [];
  const waits: DeckWait[] = [];
  for (const stall of stalls) {
    const t = Date.parse(stall.ts);
    const isHeld = stall.frozen || stall.carFrozen || stall.touching.buildings + stall.touching.other > 0;
    const still = traces.find(
      (tr) => tr.phase === "still" && Math.abs(Date.parse(tr.ts) - t) < PAIR_MS && metres(tr, stall) < PAIR_M,
    );
    const reason = still ? reasonOf(still) : null;
    if (isHeld || !still || reason === null) {
      unexplained.push(stall);
      continue;
    }
    const after = Date.parse(still.ts);
    const movedOff = traces.find((tr) => tr.phase === "movedOff" && Date.parse(tr.ts) > after);
    const seconds = movedOff ? movedOff.stillS : null;
    const limitS = (reason === "signal" ? still.why?.stop?.cycleS : null) ?? WAIT_LIMIT_S;
    // A wait the drive ended in is no pass: it has no end to measure.
    const isOver = seconds === null || seconds > limitS;
    waits.push({ xid: stall.xid, reason, seconds, limitS, isOver });
  }
  return { unexplained, waits };
}

/** The JSON of a logged line ("[warning] {…}" as browser.mjs keeps it). */
export function parseLogged<T>(line: string): T {
  return JSON.parse(line.slice(line.indexOf("{"))) as T;
}
