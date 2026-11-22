// PR W, J3 の 4: merges countWide.mts's shards — returns once per key, the G′-only list (with the
// ≥ 13 m other-owner column), exit-less / entry-less nodes, and keys whose answers differ across networks.
// Run: pnpm exec tsx .qa/w/mergeWide.mts <out.json> <shard.json>...
import { readFile, writeFile } from "node:fs/promises";
const [outPath, ...parts] = process.argv.slice(2);
const returned = new Map<string, any>();
const loose = new Map<string, any>();
const exitless = new Map<string, any>();
const entryless = new Map<string, any>();
const answers = new Map<string, Record<string, string>>();
const totals = { centres: 0, netsBuilt: 0, netsMissing: 0, netsNoRegs: 0, seconds: 0 };
for (const p of parts) {
  const d = JSON.parse(await readFile(p, "utf8"));
  for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += d[k];
  for (const [k, v] of Object.entries(d.returned)) if (!returned.has(k)) returned.set(k, v);
  for (const l of d.looseList) if (!loose.has(l.seg)) loose.set(l.seg, l);
  for (const e of d.exitless) exitless.set(`${e.node}|${e.seg}`, e);
  for (const e of d.entryless) entryless.set(`${e.node}|${e.seg}`, e);
  for (const [k, per] of Object.entries(d.answers as Record<string, Record<string, string>>))
    answers.set(k, { ...(answers.get(k) ?? {}), ...per });
}
const ret = [...returned.values()];
// A key is unstable when two networks (each with it 60 m inside) give different answer sets.
const unstable = [...answers]
  .filter(([, per]) => new Set(Object.values(per)).size > 1)
  .map(([k, per]) => ({ seg: k, per }));
const looseL = [...loose.values()];
const summary = {
  ...totals,
  returned: {
    n: ret.length,
    m: Math.round(ret.reduce((n, r) => n + r.len, 0)),
    strict: ret.filter((r) => !r.loose).length,
    loose: ret.filter((r) => r.loose).length,
    looseM: Math.round(ret.filter((r) => r.loose).reduce((n, r) => n + r.len, 0)),
  },
  looseWithBigOther: looseL.filter((l) => l.hasBigOther).length,
  exitless: exitless.size,
  entryless: entryless.size,
  unstable: unstable.length,
};
console.log(JSON.stringify(summary));
await writeFile(
  outPath,
  JSON.stringify(
    {
      summary,
      loose: looseL,
      exitless: [...exitless.values()],
      entryless: [...entryless.values()],
      unstable,
    },
    null,
    1,
  ) + "\n",
);
