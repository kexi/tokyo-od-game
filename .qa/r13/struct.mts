// 使い方: pnpm exec tsx .qa/r13/struct.mjs <all のラベル> <ラベル>
// 2 つの生成の、run ごとの構造の区間（チャンクの structure を run 距離で並べた物）の違いと、
// 高さの比べで 0.05 m を超えて動いた run を出す。
import { readFileSync } from "node:fs";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";
import { STATION_STRIDE } from "../../src/expressway/format.ts";

const [base, label] = process.argv.slice(2);
const root = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02";
const STRIDE = STATION_STRIDE;
const stretchesOf = async (l) => {
  const f = readExpresswayFiles(`${root}/.cache/expressway-area/${l}`);
  const byRun = new Map();
  for (const c of f.chunks) {
    const s0 = c.st[0];
    const s1 = c.st[c.st.length - STRIDE];
    byRun.set(c.run, [...(byRun.get(c.run) ?? []), { s0, s1, structure: c.structure }]);
  }
  const out = new Map();
  for (const [run, list] of byRun) {
    list.sort((a, b) => a.s0 - b.s0);
    const merged = [];
    for (const x of list) {
      const last = merged[merged.length - 1];
      const isSame = last && last.structure === x.structure;
      if (isSame) last.s1 = x.s1;
      else merged.push({ ...x });
    }
    out.set(
      run,
      merged.map((m) => `${m.structure} ${m.s0.toFixed(1)}–${m.s1.toFixed(1)}`),
    );
  }
  return out;
};
const a = await stretchesOf(base);
const b = await stretchesOf(label);
const changed = [];
for (const run of new Set([...a.keys(), ...b.keys()])) {
  const x = JSON.stringify(a.get(run) ?? null);
  const y = JSON.stringify(b.get(run) ?? null);
  if (x !== y) changed.push({ run, before: a.get(run) ?? null, after: b.get(run) ?? null });
}
const log = readFileSync(`${root}/.qa/r13/cmp-${label}-heights.log`, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("{"));
const h = JSON.parse(log[log.length - 1]);
const moved = h.top.filter((t) => t.maxDzM > 0.05);
console.log(JSON.stringify({ base, label, structureChanged: changed, movedOver5cm: moved }, null, 1));
