// Two expressway data folders' chunks compared byte for byte (P2.7-4): every chunk id of either,
// its JSON (JSON.stringify of the chunk as read, the fields in the file's order) against the other's.
// Reads format 5 and 6 alike: it takes the chunks of every <x>-<y>.json tile in the folder and nothing
// else, so a change of the tiles' container (v6 adds runs and entrances) is not a difference.
// One JSON log line (expressway_chunks_compared); exit code 1 when any chunk differs or is missing.
// Run: pnpm exec tsx scripts/compareExpresswayChunks.ts <dirA> <dirB> (just compare-expressway-chunks a b;
// a label without a slash means .cache/expressway-area/<label>).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { XwChunk } from "../src/expressway/format.ts";
import { log } from "../src/log.ts";

const ROOT = join(import.meta.dirname, "..");
const isLabel = (arg: string) => !arg.includes("/");
const dirOf = (arg: string) => (isLabel(arg) ? join(ROOT, ".cache", "expressway-area", arg) : arg);

/** Each chunk's JSON by id, from every tile file of a folder. */
async function chunksOf(dir: string): Promise<Map<string, string>> {
  const files = (await readdir(dir)).filter((f) => /^\d+-\d+\.json$/.test(f)).sort();
  const out = new Map<string, string>();
  for (const f of files) {
    const tile = JSON.parse(await readFile(join(dir, f), "utf8")) as { chunks: XwChunk[] };
    for (const c of tile.chunks) out.set(c.id, JSON.stringify(c));
  }
  return out;
}

const [a, b] = process.argv.slice(2);
const isMissingArgs = a === undefined || b === undefined;
if (isMissingArgs) throw new Error("usage: compareExpresswayChunks.ts <dirA> <dirB>");
const ca = await chunksOf(dirOf(a));
const cb = await chunksOf(dirOf(b));
const sorted = (ids: Iterable<string>) => [...ids].sort();
const differIds = sorted([...ca.keys()].filter((id) => cb.has(id) && cb.get(id) !== ca.get(id)));
const onlyAIds = sorted([...ca.keys()].filter((id) => !cb.has(id)));
const onlyBIds = sorted([...cb.keys()].filter((id) => !ca.has(id)));
const same = [...ca.keys()].filter((id) => cb.get(id) === ca.get(id)).length;
const LIST = 50;
log("expressway_chunks_compared", {
  a,
  b,
  chunksA: ca.size,
  chunksB: cb.size,
  same,
  differ: differIds.length,
  onlyA: onlyAIds.length,
  onlyB: onlyBIds.length,
  differIds: differIds.slice(0, LIST),
  onlyAIds: onlyAIds.slice(0, LIST),
  onlyBIds: onlyBIds.slice(0, LIST),
});
const isSame = differIds.length === 0 && onlyAIds.length === 0 && onlyBIds.length === 0;
if (!isSame) process.exitCode = 1;
