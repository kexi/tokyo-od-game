// PR W, review0 追記 6 J3 の 4: the GSI z16 vector tiles under every regulation tile (public/data/regs,
// z14 → 4 × 4 z16) and the ring round them, fetched one at a time (0.2 s apart) into the cache. A 404
// is kept as an empty file (as scripts/expresswayFeetProbe.ts does); failures are retried once at the end.
// Run (from the worktree): pnpm exec tsx .qa/w/fetchTiles.mts <cacheDir> <failures.json>
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [cacheDir, failPath] = process.argv.slice(2);
/** The data build's agent string (scripts/demTiles.ts): the project, no person. */
const USER_AGENT = "tokyo-od-game-databuild/0.1 (+https://github.com/kexi/tokyo-od-game)";
const regs = (JSON.parse(await readFile("public/data/regs/meta.json", "utf8")) as { tiles: string[] }).tiles;
const need = new Set<string>();
for (const t of regs) {
  const [x, y] = t.split("-").map(Number);
  for (let dx = 0; dx < 4; dx++)
    for (let dy = 0; dy < 4; dy++)
      for (let rx = -1; rx <= 1; rx++)
        for (let ry = -1; ry <= 1; ry++) need.add(`${x * 4 + dx + rx}-${y * 4 + dy + ry}`);
}
await mkdir(cacheDir, { recursive: true });
const cached = new Set(
  (await readdir(cacheDir)).filter((f) => f.startsWith("16-")).map((f) => f.slice(3, -4)),
);
const todo = [...need].filter((k) => !cached.has(k)).toSorted();
console.log(
  JSON.stringify({
    event: "tiles_to_fetch",
    need: need.size,
    cached: need.size - todo.length,
    todo: todo.length,
  }),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fetchOne(key: string): Promise<"ok" | "404" | "fail"> {
  const [x, y] = key.split("-");
  try {
    const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/16/${x}/${y}.pbf`, {
      headers: { "User-Agent": USER_AGENT },
    });
    const isMissing = res.status === 404;
    if (!res.ok && !isMissing) return "fail";
    const bytes = isMissing ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
    await writeFile(join(cacheDir, `16-${key}.pbf`), bytes);
    return isMissing ? "404" : "ok";
  } catch {
    return "fail";
  }
}
const counts = { ok: 0, "404": 0, fail: 0 };
let failed: string[] = [];
for (const [i, key] of todo.entries()) {
  const r = await fetchOne(key);
  counts[r]++;
  if (r === "fail") failed.push(key);
  if (i % 500 === 499) console.log(JSON.stringify({ event: "tiles_progress", done: i + 1, ...counts }));
  await sleep(200);
}
// One retry of the failures, at the end.
const retried = failed;
failed = [];
for (const key of retried) {
  const r = await fetchOne(key);
  if (r === "fail") failed.push(key);
  await sleep(200);
}
await writeFile(failPath, JSON.stringify({ failed, retried: retried.length }, null, 1) + "\n");
console.log(
  JSON.stringify({ event: "tiles_fetched", ...counts, retried: retried.length, stillFailed: failed.length }),
);
