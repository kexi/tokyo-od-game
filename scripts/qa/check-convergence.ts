// The review loop's verdict for one view table: reads .qa/reviews/<table>/round-NN.jsonl and each
// round's shoot record (.qa/views/<table>/round-NN/run.json), writes what is new, gone and carried
// in each round (diff-NN.json) and the verdict (verdict.json), and logs it.
//
//   just check-convergence <table>
//   pnpm exec tsx scripts/qa/check-convergence.ts <table> [--reviews DIR] [--views DIR]
//
// A round whose shoot is missing, failed or partial (--only) is not quiet: convergence needs two
// complete, fully reviewed rounds. Exit 0 whatever the verdict (it is a status; read verdict.json or
// the log line); 1 when a file does not parse or the table does not.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../src/log";
import { diffRecord, judge, parseRound, type ReviewContext } from "./reviewLoop.ts";
import { parseViewTable, shotKeys } from "./viewTable.ts";
import { roundRead } from "./runRecord.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const [table, ...rest] = process.argv.slice(2);
if (!table) throw new Error("usage: check-convergence.ts <table> [--reviews DIR] [--views DIR]");
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const reviewsDir = join(flag("reviews") ?? join(ROOT, ".qa", "reviews"), table);
const viewsDir = join(flag("views") ?? join(ROOT, ".qa", "views"), table);
if (!existsSync(reviewsDir)) throw new Error(`no reviews yet: ${reviewsDir} (write round-01.jsonl first)`);

const spec = parseViewTable(
  JSON.parse(readFileSync(join(ROOT, "scripts", "qa", "views", `${table}.json`), "utf8")),
);
const ctx: ReviewContext = { shots: shotKeys(spec), metrics: spec.metrics };

const rounds = readdirSync(reviewsDir)
  .map((f) => /^round-(\d+)\.jsonl$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => {
    const n = Number(m[1]);
    const runFile = join(viewsDir, `round-${m[1]}`, "run.json");
    const run: unknown = existsSync(runFile) ? JSON.parse(readFileSync(runFile, "utf8")) : null;
    // Each round against the shots it took, complete only if it took every shot of the table now.
    const { shots, isShootComplete } = roundRead(run, ctx.shots);
    const round = parseRound(n, readFileSync(join(reviewsDir, m[0]), "utf8"), { ...ctx, shots });
    return { ...round, shots, isShootComplete };
  });
const verdict = judge(rounds, ctx);
for (const d of verdict.diffs) {
  const file = join(reviewsDir, `diff-${String(d.round).padStart(2, "0")}.json`);
  writeFileSync(file, `${JSON.stringify(diffRecord(d), null, 2)}\n`);
}
const last = verdict.diffs[verdict.diffs.length - 1];
writeFileSync(
  join(reviewsDir, "verdict.json"),
  `${JSON.stringify({ table, verdict: verdict.verdict, round: verdict.round, quietRounds: verdict.quietRounds, reason: verdict.reason }, null, 2)}\n`,
);
log("review_round_checked", {
  viewTable: table,
  round: verdict.round,
  newBlocking: last.newBlocking,
  gone: last.gone.length,
  openCritical: last.openCritical,
  verdict: verdict.verdict,
  reason: verdict.reason,
});
