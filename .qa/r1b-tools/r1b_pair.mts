// R1-1b 追記 3 C4: for an end wall and a run it shares one surface with, whether that run's road goes
// on past the end face, or ends there too. Per u across, at 0.05 m and PARAPET_WIDTH past the face
// (outward) and at 0.02 / 0.25 / 0.48 m back (inside the box): is the point on the partner's built
// road reach (its rings and sides, as the probe's onReach), its road's height over this road there,
// and the partner's own end walls / ends near.
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_pair.mts <dir> <chunk> <end> <partnerRun> [u ...]
import { STATION_STRIDE, ST } from "../../src/expressway/format.ts";
import { LocalFrame } from "../../src/geo/frame.ts";
import { deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { endAhead, rangeOfChunks } from "../../src/world/expresswayEnds.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { liftAt, ringPoint } from "../../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

const [dir, id, end, partner, ...us] = process.argv.slice(2) as [
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
type Built = ReturnType<typeof build>;
function build(c: (typeof files.chunks)[number]) {
  const steps = deckArraySteps(c, place, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
const own = build(c0);
const ring = end === "start" ? own.rings[0] : own.rings[own.rings.length - 1];
const back = end === "start" ? 1 : -1;
const wall = own.endWalls.find((w) => w.end === end)!;
console.log(
  "wall",
  JSON.stringify({ ...wall, boxes: wall.boxes.map((b) => [b.lo, b.hi, b.top - ring.c.y]) }),
);
console.log("partnersAt", index.partnersAt(c0, c0.st[o + ST.s]));
const rangeOf = (run: string) => rangeOfChunks(index.chunksOf(run), STATION_STRIDE);
console.log("own endAhead", JSON.stringify(endAhead(runs, rangeOf, c0.run, end)));

function onReach(b: Built, x: number, z: number): number | null {
  const face = (d: Built["sides"][number]["left"]) => (d.wall ? Math.min(d.wall.inner, d.reach) : d.reach);
  const ends = b.sides.map((sd) => ({ lo: -face(sd.right), hi: face(sd.left) }));
  for (let i = 0; i + 1 < b.rings.length; i++) {
    const a = b.rings[i];
    const n = b.rings[i + 1];
    const lx = n.c.x - a.c.x;
    const lz = n.c.z - a.c.z;
    const len2 = lx * lx + lz * lz;
    if (len2 < 1e-8) continue;
    const tau = ((x - a.c.x) * lx + (z - a.c.z) * lz) / len2;
    if (tau < 0 || tau > 1) continue;
    const tx = a.t.x + (n.t.x - a.t.x) * tau;
    const tz = a.t.z + (n.t.z - a.t.z) * tau;
    const tl = Math.hypot(tx, tz) || 1;
    const u = ((x - (a.c.x + lx * tau)) * tz - (z - (a.c.z + lz * tau)) * tx) / tl;
    const lo = ends[i].lo + (ends[i + 1].lo - ends[i].lo) * tau;
    const hi = ends[i].hi + (ends[i + 1].hi - ends[i].hi) * tau;
    if (u < lo || u > hi) continue;
    const ya = ringPoint(a, u, liftAt(a, u, false)).y;
    const yb = ringPoint(n, u, liftAt(n, u, false)).y;
    return ya + (yb - ya) * tau;
  }
  return null;
}

const partnerChunks = index.chunksOf(partner);
const near = partnerChunks.filter((c) => {
  for (let i = 0; i < c.st.length; i += STATION_STRIDE) {
    const p = frame.toLocal(c.st[i + ST.lat], c.st[i + ST.lon], 0);
    if (Math.hypot(p.x, p.z) < 200) return true;
  }
  return false;
});
const built = near.map((c) => ({ c, b: build(c) }));
for (const { c, b } of built) {
  const first = b.rings[0];
  const last = b.rings[b.rings.length - 1];
  const dist = (r: typeof first) => Math.hypot(r.c.x - ring.c.x, r.c.z - ring.c.z).toFixed(2);
  console.log(
    "partner chunk",
    c.id,
    c.structure,
    `prev ${c.prev} next ${c.next}`,
    `start ring ${dist(first)} m away, end ring ${dist(last)} m away`,
    "endWalls",
    JSON.stringify(b.endWalls.map((w) => ({ end: w.end, widthM: w.widthM, boxes: w.boxes.length }))),
    "endSkips",
    JSON.stringify(b.endSkips),
  );
}
for (const e of ["start", "end"] as const)
  console.log(`partner ${e} endAhead`, JSON.stringify(endAhead(runs, rangeOf, partner, e)));
const across =
  us.length > 0 ? us.map(Number) : [wall.boxes[0].lo + 0.05, wall.boxes[wall.boxes.length - 1].hi - 0.05];
for (const u of across) {
  const road = ringPoint(ring, u, liftAt(ring, u, false));
  const row: string[] = [];
  for (const d of [-PW(), -0.05, 0.02, 0.25, 0.48]) {
    const p = road.clone().addScaledVector(ring.t, back * d);
    const ys = built.map(({ b }) => onReach(b, p.x, p.z)).filter((y): y is number => y !== null);
    const label = d < 0 ? `past ${(-d).toFixed(2)}` : `back ${d.toFixed(2)}`;
    row.push(
      `${label}: ${ys.length ? ys.map((y) => `on reach, its road ${(y - road.y).toFixed(3)} over this`).join(" / ") : "off reach"}`,
    );
  }
  console.log(`u ${u.toFixed(2)} | ${row.join(" | ")}`);
}
function PW() {
  return 0.5;
}
