import { z } from "zod";

/**
 * A round's shoot record (.qa/views/<table>/round-NN/run.json), written by scripts/qa/views.ts at
 * the end of a shoot and read by check-convergence.ts and the next shoot's round numbering. A round
 * counts (for convergence, and as done for numbering) only when it is complete: every shot of the
 * table taken, none failed, not a partial (--only) shoot.
 */
export const RunRecordSchema = z.object({
  table: z.string(),
  round: z.number().int().positive(),
  /** --only of the shoot (null: the whole table). */
  only: z.array(z.string()).nullable(),
  /** The shot keys taken. */
  shots: z.array(z.string()),
  failed: z.array(z.object({ shot: z.string(), error: z.string() })),
  complete: z.boolean(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** Whether `run` is a complete shoot of every one of `expected` shots. */
export function isCompleteRun(run: unknown, expected: readonly string[]): boolean {
  const parsed = RunRecordSchema.safeParse(run);
  if (!parsed.success) return false;
  const r = parsed.data;
  const taken = new Set(r.shots);
  const hasAll = expected.every((k) => taken.has(k));
  return r.complete && r.only === null && r.failed.length === 0 && hasAll;
}

/**
 * The round a new shoot writes: the last round if it is not complete (shot again under the same
 * number), else the one after the last complete one. `runs` maps each round dir's number to its
 * run.json (null when it has none).
 */
export function nextRound(runs: ReadonlyMap<number, unknown>, expected: readonly string[]): number {
  const numbers = [...runs.keys()].toSorted((a, b) => a - b);
  const last = numbers.at(-1);
  if (last === undefined) return 1;
  const isLastComplete = isCompleteRun(runs.get(last), expected);
  return isLastComplete ? last + 1 : last;
}
