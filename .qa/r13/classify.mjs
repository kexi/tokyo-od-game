// 使い方: node .qa/r13/classify.mjs <基準のラベル> <ラベル>
// 2 つの生成の探りの事例（p-<ラベル>-lanes.json・-holes.json）を、場所（run と s の範囲の重なり）で
// 突き合わせ、(甲)（基準の all に在る）・(乙)（表の行に帰せる）・(丙)（それ以外）に分ける（指示書 2 節）。
// スコアカードの要約も出す。
import { readFileSync } from "node:fs";

const [base, label] = process.argv.slice(2);
const dir = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02/.qa";
const read = (p) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8"));
const lanesOf = (l) => read(`r13/p-${l}-lanes.json`);
const holesOf = (l) => read(`r13/p-${l}-holes.json`);

// 表の行（footDeferrals.ts・structureDecisions.ts）の run と区間。
const ROWS = [
  { run: "203832842", s0: -Infinity, s1: Infinity, row: "足の行 203832842" },
  { run: "895902565", s0: 57.6, s1: 89.16, row: "構造の行 895902565" },
  { run: "45021976", s0: 3410.6, s1: 3414, row: "構造の行 45021976" },
];
const overlaps = (a, b) => a.s0 <= b.s1 && b.s0 <= a.s1;
const rowOf = (c) => ROWS.find((r) => r.run === c.run && overlaps(c, r));
const key = (c) => `${c.chunk} s${c.s0}-${c.s1} L${c.lengthM} w${c.streetM} n${c.nearestM} lanes${c.lanes}`;

const a = lanesOf(base);
const b = lanesOf(label);
const out = {
  base,
  label,
  lanes: { base: a.length, count: b.length, ko: [], otsu: [], hei: [], changed: [], gone: [] },
};
for (const c of b) {
  const same = a.filter((x) => x.run === c.run && overlaps(x, c));
  const isKo = same.length > 0;
  if (isKo) {
    const isExact = same.some((x) => key(x) === key(c));
    out.lanes.ko.push(key(c));
    if (!isExact) out.lanes.changed.push({ now: key(c), base: same.map(key), row: rowOf(c)?.row ?? null });
    continue;
  }
  const row = rowOf(c);
  if (row) {
    out.lanes.otsu.push({ case: key(c), row: row.row });
    continue;
  }
  out.lanes.hei.push(key(c));
}
for (const x of a) if (!b.some((c) => c.run === x.run && overlaps(x, c))) out.lanes.gone.push(key(x));

const ha = holesOf(base);
const hb = holesOf(label);
const sum = (h) => ({ runs: h.length, lanes: h.reduce((n, r) => n + r.lanes.length, 0) });
out.holes = { base: sum(ha), now: sum(hb), ko: [], otsu: [], hei: [], changed: [], gone: [] };
const laneKey = (l) => `${l.widthM}/${l.dir}/${l.lane}/${l.lengthM}/${l.nearestM}`;
for (const r of hb) {
  const was = ha.find((x) => x.run === r.run);
  if (was) {
    out.holes.ko.push(r.run);
    const isSame = JSON.stringify(was.lanes.map(laneKey)) === JSON.stringify(r.lanes.map(laneKey));
    if (!isSame)
      out.holes.changed.push({
        run: r.run,
        lanes: `${was.lanes.length} → ${r.lanes.length}`,
        half: `${was.holeHalfM} → ${r.holeHalfM}`,
      });
    continue;
  }
  const isRow = r.run === "203832842";
  if (isRow) out.holes.otsu.push({ run: r.run, lanes: r.lanes.length, half: r.holeHalfM });
  else out.holes.hei.push({ run: r.run, lanes: r.lanes.length });
}
for (const x of ha) if (!hb.some((r) => r.run === x.run)) out.holes.gone.push(x.run);

const card = (l) => {
  const r = read(`expressway/${l}.report.json`);
  const v = Object.fromEntries(Object.entries(r.violations).map(([k, x]) => [k, x.count]));
  return {
    unconverged: r.solver.unconverged,
    violations: Object.values(v).reduce((n, x) => n + x, 0),
    byProperty: v,
    dangling: r.scope.dangling.length,
    deckMismatch: r.scope.deckMismatch.length,
    closed: r.closures.list.map((c) => c.run).sort(),
    deferred: r.ground?.deferred ?? null,
    decided: r.structures?.decided ?? null,
  };
};
out.card = { base: card(base), now: card(label) };
out.card.closedSame = JSON.stringify(out.card.base.closed) === JSON.stringify(out.card.now.closed);
console.log(JSON.stringify(out, null, 1));
