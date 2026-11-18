import type { Vector3 } from "three";
import { leftOf } from "./roads";

/**
 * How a road's lanes and turns are read by both the drive planner (game/drivePath.ts, game/navigation
 * .ts) and the streets' bands (world/streetBands.ts, P2.7 R1-2a). Kept in world so that the bands,
 * which the worker computes, read the planner's own values and not copies: a band must end its lane
 * shift where the planner would, and a "straight on" must be the guidance's straight on.
 */

/** Lateral metres per metre of travel while changing lanes (a 3 m lane over 30 m). */
export const LANE_SLOPE = 0.1;
/** A lane change before a 進路変更禁止 stretch is over this far before its first point (m). */
export const BAN_LEAD = 10;

export type Turn = "straight" | "slightLeft" | "left" | "slightRight" | "right" | "uturn";

/** Finer class for guidance: the angle between the incoming and outgoing directions. */
export function classifyTurn(tIn: Vector3, tOut: Vector3): Turn {
  const angle = (Math.atan2(leftOf(tIn, 1).dot(tOut), tIn.dot(tOut)) * 180) / Math.PI; // + = left
  if (Math.abs(angle) > 150) return "uturn";
  if (angle > 50) return "left";
  if (angle > 22) return "slightLeft";
  if (angle < -50) return "right";
  if (angle < -22) return "slightRight";
  return "straight";
}
