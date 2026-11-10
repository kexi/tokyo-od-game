import type { Movement } from "./plan";

/** A horizontal direction (x east, z south: the game's ground plane). */
type Flat = { x: number; z: number };

/** sin 35°: past this much sideways a move is a turn (the law checks' turnBit uses the same 0.57). */
const TURN_SIDE = 0.57;
/** Beyond 150° from the way in, a move is a 転回 (navigation.ts classifyTurn's threshold). */
const UTURN_DEG = 150;

/**
 * Which movement leaving along `tOut` is, for a vehicle that came in along `tIn` (both unit vectors
 * on the ground). Left / through / right split as turnBit does for 指定方向外進行禁止, so the signal
 * and the turn bans read a junction the same way; turns sharper than 150° are 転回.
 * Why not classifyTurn: its 22° "slight" turns are guidance classes, not the law checks' three.
 */
export function movementOf(tIn: Flat, tOut: Flat): Movement {
  // leftOf(tIn) is (tIn.z, −tIn.x): + means tOut points to the left of the way in.
  const side = tIn.z * tOut.x - tIn.x * tOut.z;
  const ahead = tIn.x * tOut.x + tIn.z * tOut.z;
  const angleDeg = (Math.abs(Math.atan2(side, ahead)) * 180) / Math.PI;
  if (angleDeg > UTURN_DEG) return "uturn";
  // Bent back (90°–150°) but with little sideways part (past 145° sin drops under 0.57): still a
  // turn to that side, never through.
  const isBentBack = ahead < 0;
  if (isBentBack) return side > 0 ? "left" : "right";
  if (side > TURN_SIDE) return "left";
  if (side < -TURN_SIDE) return "right";
  return "through";
}
