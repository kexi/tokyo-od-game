// Per chunk with an end of a run, a hash of its built collider and drawn vertices, and its end walls
// (R1-1b 追記 3 C5: which walls changed shape against ea62e55). Each chunk is built in a frame at its
// own first station, the whole folder in the index, as the probe builds it. Run from a worktree root:
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_hash.mts <dir> <out.json>
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ST } from "../../src/expressway/format.ts";
import { LocalFrame } from "../../src/geo/frame.ts";
import { deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

const [dir, out] = process.argv.slice(2) as [string, string];
const files = readExpresswayFiles(dir);
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const result: Record<string, unknown> = {};
for (const c of files.chunks) {
  const isEnd = c.prev === null || c.next === null;
  if (!isEnd) continue;
  const frame = new LocalFrame(c.st[ST.lat], c.st[ST.lon], 40);
  const place = { frame, ellipsoidal: (_a: number, _b: number, h: number) => h + 36.9 };
  const steps = deckArraySteps(c, place, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  const b = r.value;
  const h = (a: Float32Array) =>
    createHash("sha256")
      .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
      .digest("hex")
      .slice(0, 16);
  result[c.id] = {
    collider: h(b.collider.position),
    drawn: h(b.arrays.position),
    triangles: b.collider.position.length / 9,
    endWalls: b.endWalls.map((w: { end: string; widthM: number; heightM: number }) => ({
      end: w.end,
      widthM: w.widthM,
      heightM: w.heightM,
    })),
  };
}
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
