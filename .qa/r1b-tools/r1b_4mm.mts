// R1-1b 追記 4 D5 の 5: where 45068170:end's box tops stand into 24402125's slab, and why. Per box (a
// cut of OPEN_SAMPLE_M), the top built, and the physical road of the deck over it (a ray up in a world
// of that chunk alone) at the rule's sample (the cut's middle, at the face d 0 and PARAPET_WIDTH in)
// and at the box's four corners and the probe's points (d 0.02 / 0.25 / 0.48): top − (road − SLAB).
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_4mm.mts <dir> <chunk> <end> <overChunk>
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { ST, STATION_STRIDE } from "../../src/expressway/format.ts";
import { LocalFrame } from "../../src/geo/frame.ts";
import { createDeckBody, deckArraySteps, SLAB } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { liftAt, ringPoint } from "../../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

await RAPIER.init();
const [dir, id, end, overId] = process.argv.slice(2) as [string, string, "start" | "end", string];
const files = readExpresswayFiles(dir);
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const c0 = files.chunks.find((c) => c.id === id)!;
const o = end === "start" ? 0 : c0.st.length - STATION_STRIDE;
const frame = new LocalFrame(c0.st[o + ST.lat], c0.st[o + ST.lon], 40);
const place = { frame, ellipsoidal: (_a: number, _b: number, h: number) => h + 36.9 };
const build = (c: (typeof files.chunks)[number]) => {
  const steps = deckArraySteps(c, place, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
};
const own = build(c0);
const ring = end === "start" ? own.rings[0] : own.rings[own.rings.length - 1];
const back = end === "start" ? 1 : -1;
const wall = own.endWalls.find((w) => w.end === end)!;
const over = build(files.chunks.find((c) => c.id === overId)!);
const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
createDeckBody(world, over.collider, over.piers, null);
world.step();
/** The deck over's road at (u, d), met by a ray up from 5 cm over this road; null where none. */
const roadOver = (u: number, d: number) => {
  const p = ringPoint(ring, u, liftAt(ring, u, false) + 0.05).addScaledVector(ring.t, back * d);
  const hit = world.castRay(new RAPIER.Ray(p, new Vector3(0, 1, 0)), 3, true);
  return hit ? p.y + hit.timeOfImpact : null;
};
const mm = (v: number | null) => (v === null ? "  -  " : (v * 1000).toFixed(1).padStart(6));
let worst = { at: "", over: -Infinity };
let worstCorner = -Infinity;
const rows: string[] = [];
for (const b of wall.boxes) {
  const mid = (b.lo + b.hi) / 2;
  const over = (u: number, d: number) => {
    const y = roadOver(u, d);
    return y === null ? null : b.top - (y - SLAB);
  };
  const rule = [over(mid, 0), over(mid, 0.5)];
  const corners = [over(b.lo, 0), over(b.hi, 0), over(b.lo, 0.5), over(b.hi, 0.5)];
  const probe = [0.02, 0.25, 0.48].map((d) => over(mid, d));
  const near = [over(b.lo, 0.02), over(b.hi, 0.02)];
  for (const v of [...corners, ...near]) if (v !== null) worstCorner = Math.max(worstCorner, v);
  for (const [i, v] of [...probe, ...near].entries())
    if (v !== null && v > worst.over) worst = { at: `u ${mid.toFixed(3)} probe#${i}`, over: v };
  rows.push(
    `u ${b.lo.toFixed(3)}..${b.hi.toFixed(3)} top−(road−SLAB) mm | rule mid d0 ${mm(rule[0])} d0.5 ${mm(rule[1])} | corners lo/hi d0 ${mm(corners[0])} ${mm(corners[1])} d0.5 ${mm(corners[2])} ${mm(corners[3])} | mid d0.02/0.25/0.48 ${probe.map(mm).join(" ")} | lo/hi d0.02 ${near.map(mm).join(" ")}`,
  );
}
for (const r of rows) process.stdout.write(r + "\n");
// The over deck's road along the face (d 0 → 0.02) and across (one cut), at the middle of the wall.
const um = (wall.boxes[0].lo + wall.boxes[wall.boxes.length - 1].hi) / 2;
const y0 = roadOver(um, 0);
const y2 = roadOver(um, 0.02);
const yx = roadOver(um + 0.05, 0);
process.stdout.write(
  `slope at u ${um.toFixed(2)}: along d 0→0.02 ${mm(y0 !== null && y2 !== null ? y2 - y0 : null)} mm, across one cut ${mm(y0 !== null && yx !== null ? yx - y0 : null)} mm\n`,
);
process.stdout.write(
  `worst probe point ${worst.at} ${mm(worst.over)} mm; worst corner (d 0 / 0.02 / 0.5) ${mm(worstCorner)} mm\n`,
);

// The rule reads the deck over as the plane between its two slab edges (expresswayDeck.ts decksOver:
// a quad edge to edge per ring interval). That plane against its own road (liftAt at each u), at its
// ring nearest this end: how far the plane stands over the road across.
import { chunkRings } from "../../src/world/expresswayMerge.ts";
const oc = chunkRings(
  files.chunks.find((c) => c.id === overId)!,
  place,
  false,
);
let nearest = oc.rings[0];
for (const r of oc.rings)
  if (
    Math.hypot(r.c.x - ring.c.x, r.c.z - ring.c.z) <
    Math.hypot(nearest.c.x - ring.c.x, nearest.c.z - ring.c.z)
  )
    nearest = r;
const yl = liftAt(nearest, oc.edge, false);
const yr = liftAt(nearest, -oc.edge, false);
const cols: string[] = [];
for (let u = -oc.edge; u <= oc.edge + 1e-9; u += oc.edge / 4) {
  const plane = yr + ((u + oc.edge) / (2 * oc.edge)) * (yl - yr);
  cols.push(`u ${u.toFixed(2)}: plane − road ${mm(plane - liftAt(nearest, u, false))}`);
}
process.stdout.write(`over deck edge ${oc.edge}, ${cols.join(", ")}\n`);

// The rule's own read at a sample (decksOver's strip, surfaceOver's two triangles a quad) against the
// built collider's road there, and which rings the strip and the build hold near the point.
{
  const strip = oc.rings.map((r) => [
    ringPoint(r, oc.edge, liftAt(r, oc.edge, false)),
    ringPoint(r, -oc.edge, liftAt(r, -oc.edge, false)),
  ]);
  const tri = (a: Vector3, b: Vector3, c: Vector3, p: Vector3) => {
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    const l1 = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / d;
    const l2 = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / d;
    const l3 = 1 - l1 - l2;
    return l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9 ? l1 * a.y + l2 * b.y + l3 * c.y : null;
  };
  for (const u of [-1, 0, 1.075, 2, 3]) {
    const p = ringPoint(ring, u, 0);
    let ruleY: number | null = null;
    let at = -1;
    for (let i = 0; i + 1 < strip.length && ruleY === null; i++) {
      const q = [strip[i][0], strip[i + 1][0], strip[i + 1][1], strip[i][1]];
      ruleY = tri(q[0], q[1], q[2], p) ?? tri(q[0], q[2], q[3], p);
      at = i;
    }
    const phys = roadOver(u, 0);
    const ss = at >= 0 ? `${oc.rings[at].frame.s.toFixed(2)}..${oc.rings[at + 1].frame.s.toFixed(2)}` : "-";
    const built = over.rings
      .filter((r) => r.frame.s >= oc.rings[at].frame.s - 1e-6 && r.frame.s <= oc.rings[at + 1].frame.s + 1e-6)
      .map((r) => r.frame.s.toFixed(2));
    process.stdout.write(
      `u ${u}: rule ${mm(ruleY === null || phys === null ? null : ruleY - phys)} mm over the built road; strip rings s ${ss}, built rings there [${built.join(", ")}]\n`,
    );
  }
}
