// The scorecard's violations of a build (scripts/expressway.ts), judged by the decisions' tables the
// build applied (`--decisions`, R1-3).

import { violationsOf } from "../src/expressway/violations.ts";
import { STRUCTURE_DECISIONS } from "../src/expressway/structureDecisions.ts";
import { type Decisions, decisionTablesOf } from "./expresswayGuards.ts";

/**
 * violationsOf with T13 judged by the structure decisions the build applied: the module's table for
 * `all`, else the one decisionTablesOf gave planNetwork. The value is required, so the build cannot
 * leave the table out. Why a function here and not the argument at the call in scripts/expressway.ts
 * (PR #136 review 2): that line left out passes undefined, violationsOf then takes the module's table,
 * and nothing measured shows it (a decided stretch allows both structures, so T13 only goes lenient);
 * a test can hold this function, not the script's top level.
 */
type ViolationsArgs = Parameters<typeof violationsOf>;

export function scorecardViolationsOf(
  mode: Decisions,
  meta: ViolationsArgs[0],
  chunks: ViolationsArgs[1],
  rampFloor: ViolationsArgs[2],
  isHeight: boolean,
): ReturnType<typeof violationsOf> {
  const applied = decisionTablesOf(mode)?.structureDecisions ?? STRUCTURE_DECISIONS;
  return violationsOf(meta, chunks, rampFloor, isHeight, applied);
}
