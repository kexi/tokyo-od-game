// The drops with no wall at their edge of a data folder (A1, test 22; scripts/expresswaySeams.ts bare),
// written one per line to a JSONL file and, against another such file (another build's or main's),
// split into the points both have, the new ones and the gone ones. Exit 1 when a point is new.
//   pnpm exec tsx --import ./scripts/assetUrlHooks.mjs scripts/expresswayBareDrops.ts <dir> [--out <file>] [--against <file>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { log } from "../src/log.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";
import { type BareDrop, framesOf, probeGenerated } from "./expresswaySeams.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const files = readExpresswayFiles(dir);
const out = flag("out") ?? `.qa/expressway/bare-drops-${files.dir.split("/").filter(Boolean).pop()}.jsonl`;
const against = flag("against");

await RAPIER.init();
const probed = probeGenerated(files.chunks, files.runs, framesOf(files.tiles, files.meta.zoom));
for (const w of probed.worlds) w.free();
const points = probed.bare.toSorted((a, b) => (a.chunk === b.chunk ? a.s - b.s : a.chunk < b.chunk ? -1 : 1));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, points.map((p) => JSON.stringify(p)).join("\n") + (points.length > 0 ? "\n" : ""));

/** Under half the probe step (pairPoints, 0.5 m): the same point of the same tiles, never its neighbour. */
const SAME_POINT_M = 0.25;
/**
 * The same point in another list: the same chunk and partner, under half a probe step apart.
 * Why not a whole step (0.5 m, as before): the neighbouring point matched too, so a stretch with no
 * wall that grew by a point at an end counted no new point.
 */
const isIn = (p: BareDrop, list: readonly BareDrop[]) =>
  list.some((q) => q.chunk === p.chunk && q.with === p.with && Math.abs(q.s - p.s) < SAME_POINT_M);
const base: BareDrop[] = against
  ? readFileSync(against, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as BareDrop)
  : [];
const added = against ? points.filter((p) => !isIn(p, base)) : [];
const gone = against ? base.filter((p) => !isIn(p, points)) : [];
log("expressway_bare_drops_counted", {
  dir: files.dir,
  out,
  against: against ?? null,
  points: points.length,
  pairs: new Set(points.map((p) => `${p.chunk}|${p.with}`)).size,
  added: added.length,
  gone: gone.length,
  addedAt: added.slice(0, 20).map((p) => `${p.chunk}|${p.with} s ${p.s.toFixed(1)}`),
});
process.exitCode = added.length > 0 ? 1 : 0;
