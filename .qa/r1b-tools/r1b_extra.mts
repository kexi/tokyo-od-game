// The collider triangles this PR adds over main's (5d0b7a2, src/world/expresswayDeckMain.tmp.ts) on
// the chunks round a node: per chunk, how many vertices are new and how far from the chunk's end
// ring (along its end direction; inside below zero) the farthest-in of them lies, and its run s.
//   pnpm exec tsx .qa/r1b_extra.mts <dir> <chunk> [<chunk> …]
import { Vector3 } from "three";
import { LocalFrame } from "../../src/geo/frame.ts";
import * as now from "../../src/world/expresswayDeck.ts";
import * as main from "../../src/world/expresswayDeckMain.tmp.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

const [dir, ...ids] = process.argv.slice(2);
const files = readExpresswayFiles(dir);
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const first = files.chunks.find((c) => c.id === ids[0])!;
const frame = new LocalFrame(first.st[2], first.st[1], 40);
const place = { frame, ellipsoidal: (_a: number, _b: number, h: number) => h + 36.9 };
const build = (mod: typeof now, c: (typeof files.chunks)[number]) => {
  const steps = mod.deckArraySteps(c, place, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
};
const key = (p: Float32Array, i: number) => `${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`;
for (const id of ids) {
  const c = files.chunks.find((x) => x.id === id)!;
  const a = build(main as unknown as typeof now, c);
  const b = build(now, c);
  const old = new Set<string>();
  for (let i = 0; i < a.collider.position.length; i += 3) old.add(key(a.collider.position, i));
  const ring = b.rings[b.rings.length - 1];
  const first0 = b.rings[0];
  let added = 0;
  let minAlongEnd = Infinity;
  let minAlongStart = Infinity;
  const v = new Vector3();
  for (let i = 0; i < b.collider.position.length; i += 3) {
    if (old.has(key(b.collider.position, i))) continue;
    added++;
    const p = b.collider.position;
    v.set(p[i], p[i + 1], p[i + 2]);
    // Distance inside from the end face (end ring, along -t) and from the start face (start ring, along +t).
    minAlongEnd = Math.min(minAlongEnd, -v.clone().sub(ring.c).dot(ring.t));
    minAlongStart = Math.min(minAlongStart, v.clone().sub(first0.c).dot(first0.t));
  }
  const s1 = c.st[c.st.length - 7];
  console.log(
    JSON.stringify({
      id,
      s: [c.st[0], s1],
      oldVerts: a.collider.position.length / 3,
      newVerts: b.collider.position.length / 3,
      added,
      // The added vertex nearest the end face from inside is at most this far in (m); and from the start.
      maxInFromEndM: added ? Math.round(-minAlongEnd * -1 * 100) / 100 : null,
      fartherstFromEndM: added ? Math.round(Math.max(0, ...[]) * 100) / 100 : null,
      endWalls: b.endWalls,
    }),
  );
  // The farthest-in added vertex from the end face: the largest inward distance.
  let far = -Infinity;
  for (let i = 0; i < b.collider.position.length; i += 3) {
    if (old.has(key(b.collider.position, i))) continue;
    const p = b.collider.position;
    v.set(p[i], p[i + 1], p[i + 2]);
    far = Math.max(far, -v.sub(ring.c).dot(ring.t));
  }
  console.log(`  ${id}: added vertices lie at most ${far.toFixed(2)} m inside the end face (run s ${(s1 - far).toFixed(1)})`);
}
