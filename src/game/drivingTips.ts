import { t, type MessageKey } from "../i18n";
import type { ViolationRecord } from "./traffic";

/**
 * What to do differently, per violation, as a driving instructor would put it. Used for the
 * end-of-day advice when the on-device AI is off (and as its facts when it is on), in the language
 * in force (the Japanese wording is in ja.ts as tips.*).
 */
const TIPS: Record<string, MessageKey> = {
  speed: "tips.speed",
  signal: "tips.signal",
  stopSign: "tips.stopSign",
  noEntry: "tips.noEntry",
  keepLeft: "tips.keepLeft",
  closedRoad: "tips.closedRoad",
  turnBan: "tips.turnBan",
  uturn: "tips.uturn",
  slow: "tips.slow",
  laneChange: "tips.laneChange",
  laneUse: "tips.laneUse",
  laneDirection: "tips.laneDirection",
  phone: "tips.phone",
  phoneDanger: "tips.phoneDanger",
  safeDriving: "tips.safeDriving",
  injury: "tips.injury",
  parking: "tips.parking",
};

export function tipFor(kind: string): string {
  return t(TIPS[kind] ?? TIPS[kind.replace(/\d+$/, "")] ?? "tips.default");
}

/** One tip per kind of violation the driver committed today, most frequent first. */
export function adviceFor(records: readonly ViolationRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1]).map(([kind]) => tipFor(kind));
}
