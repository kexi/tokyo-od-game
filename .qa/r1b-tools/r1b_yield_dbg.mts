// R1-1b 追記 4 D3: why an end wall gives way or not to a run's road. As expresswayDeck.ts onwardRoadsAt /
// yieldOf, read again from the exported pieces: per u across, the run's base sides (DeckMerge.sides)
// at the ring interval holding the point, its road height there, at d 0 / PARAPET_WIDTH / past the face.
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_yield_dbg.mts <dir> <chunk> <end> <run> [u ...]
import { Vector3 } from "three";
import { ST, STATION_STRIDE } from "../../src/expressway/format.ts";
import { LocalFrame } from "../../src/geo/frame.ts";
import { deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { chunkRings, DeckMerge, liftAt, ringPoint } from "../../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

const [dir, id, end, run, ...us] = process.argv.slice(2) as [
  string,
  string,
  "start" | "end",
  string,
  ...string[],
];
const files = readExpresswayFiles(dir);
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const c0 = files.chunks.find((c) => c.id === id)!;
const o = end === "start" ? 0 : c0.st.length - STATION_STRIDE;
const frame = new LocalFrame(c0.st[o + ST.lat], c0.st[o + ST.lon], 40);
const place = { frame, ellipsoidal: (_a: number, _b: number, h: number) => h + 36.9 };
const steps = deckArraySteps(c0, place, false, { index });
let r = steps.next();
while (!r.done) r = steps.next();
const own = r.value;
const ring = end === "start" ? own.rings[0] : own.rings[own.rings.length - 1];
const back = end === "start" ? 1 : -1;
console.log("wall", JSON.stringify(own.endWalls.find((w) => w.end === end)));
const merge = new DeckMerge(index, place, false);
for (const c of index.chunksOf(run)) {
  const deck = chunkRings(c, place, false);
  const at = (u: number, d: number) => {
    const p = ringPoint(ring, u, 0).addScaledVector(ring.t, back * d);
    const road = ringPoint(ring, u, liftAt(ring, u, false)).y;
    const rs = deck.rings;
    for (let i = 0; i + 1 < rs.length; i++) {
      const a = rs[i];
      const b = rs[i + 1];
      const lx = b.c.x - a.c.x;
      const lz = b.c.z - a.c.z;
      const len2 = lx * lx + lz * lz;
      if (len2 < 1e-8) continue;
      const tau = ((p.x - a.c.x) * lx + (p.z - a.c.z) * lz) / len2;
      if (tau < 0 || tau > 1) continue;
      const tx = a.t.x + (b.t.x - a.t.x) * tau;
      const tz = a.t.z + (b.t.z - a.t.z) * tau;
      const tl = Math.hypot(tx, tz) || 1;
      const uu = ((p.x - (a.c.x + lx * tau)) * tz - (p.z - (a.c.z + lz * tau)) * tx) / tl;
      const sa = merge.sides(deck, a);
      const sb = merge.sides(deck, b);
      const f = (d: { wall: { inner: number } | null; reach: number }) =>
        d.wall ? Math.min(d.wall.inner, d.reach) : d.reach;
      const lo = -f(sa.right) + (-f(sb.right) + f(sa.right)) * tau;
      const hi = f(sa.left) + (f(sb.left) - f(sa.left)) * tau;
      const y = ringPoint(a, uu, liftAt(a, uu, false)).y;
      return `${c.id}#${i} u' ${uu.toFixed(2)} reach ${lo.toFixed(2)}..${hi.toFixed(2)} ${uu >= lo && uu <= hi ? "ON" : "off"} dz ${(y - road).toFixed(3)}`;
    }
    return null;
  };
  for (const u of us.map(Number))
    for (const d of [0, 0.5, -0.05, -0.5]) {
      const s = at(u, d);
      if (s) console.log(`u ${u} d ${d}: ${s}`);
    }
}
void Vector3;
