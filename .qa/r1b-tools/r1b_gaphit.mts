// R1-1b 追記 5 E4: what a level ray across an end wall's gap meets (the stretch given way), chunk by
// chunk in a world of its own: its distance out from the face, the height over this road, and where
// in the other chunk's section it lies (u' across its ring, against its road's reach and 壁高欄).
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b-tools/r1b_gaphit.mts <dir> <chunk> <end> [u ...]
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { ST, STATION_STRIDE } from "../../src/expressway/format.ts";
import { LocalFrame } from "../../src/geo/frame.ts";
import { createDeckBody, deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { liftAt, ringPoint } from "../../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

await RAPIER.init();
const [dir, id, end, ...us] = process.argv.slice(2) as [string, string, "start" | "end", ...string[]];
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
const out = end === "start" ? -1 : 1;
const toward = ring.t.clone().multiplyScalar(out);
const wall = own.endWalls.find((w) => w.end === end)!;
process.stdout.write(
  `endWalls of the others are listed per chunk below\nwall ${JSON.stringify({ ...wall, boxes: wall.boxes.map((b) => [b.lo, b.hi]) })}\n`,
);
for (const c of files.chunks) {
  const m = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
  const at = frame.toLocal(c.st[m + ST.lat], c.st[m + ST.lon], 0);
  if (Math.hypot(at.x, at.z) > 400) continue;
  const b = c.id === id ? own : build(c);
  if (b.endWalls.length > 0 && c.id !== id)
    process.stdout.write(
      `${c.id} endWalls ${JSON.stringify(b.endWalls.map((w) => ({ end: w.end, boxes: w.boxes.map((x) => [x.lo, x.hi]) })))}\n`,
    );
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  createDeckBody(world, b.collider, b.piers, null);
  world.step();
  for (const u of us.map(Number))
    for (const v of [0.1, 0.5, 1.0]) {
      const road = ringPoint(ring, u, liftAt(ring, u, false));
      const from = road
        .clone()
        .setY(road.y + v)
        .addScaledVector(ring.t, -out * 0.25);
      const hit = world.castRayAndGetNormal(new RAPIER.Ray(from, toward), 0.6, true);
      if (!hit) continue;
      const p = from.clone().addScaledVector(toward, hit.timeOfImpact);
      // Where across the other's nearest ring the point lies.
      let best = b.rings[0];
      let bi = 0;
      b.rings.forEach((r, i) => {
        if (Math.hypot(r.c.x - p.x, r.c.z - p.z) < Math.hypot(best.c.x - p.x, best.c.z - p.z))
          [best, bi] = [r, i];
      });
      const uu = (p.x - best.c.x) * best.t.z - (p.z - best.c.z) * best.t.x;
      const sd = b.sides[bi];
      process.stdout.write(
        `u ${u} v ${v}: ${c.id} (${c.structure}) at ${(hit.timeOfImpact - 0.25).toFixed(2)} m out, normal ${[hit.normal.x, hit.normal.y, hit.normal.z].map((x) => x.toFixed(2)).join(",")}, u' ${uu.toFixed(2)} along its ring ${((p.x - best.c.x) * best.t.x + (p.z - best.c.z) * best.t.z).toFixed(2)} (ring ${bi} of ${b.rings.length}, its t ${best.t.x.toFixed(2)},${best.t.z.toFixed(2)}; ray ${toward.x.toFixed(2)},${toward.z.toFixed(2)}) (its left reach ${sd.left.reach.toFixed(2)} wall ${JSON.stringify(sd.left.wall)}, right reach ${sd.right.reach.toFixed(2)} wall ${JSON.stringify(sd.right.wall)})\n`,
      );
    }
  world.free();
}
void Vector3;
