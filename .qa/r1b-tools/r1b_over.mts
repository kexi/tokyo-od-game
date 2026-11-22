// For one end wall: what is over its foot. Per chunk near (one world each), the first collider up from
// 5 cm over this road at the wall's middle depth every 0.5 m across, and that chunk's structure.
//   ./node_modules/.bin/tsx --import ./scripts/assetUrlHooks.mjs .qa/r1b_over.mts <dir> <chunk> <end>
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { LocalFrame } from "../../src/geo/frame.ts";
import { createDeckBody, deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { liftAt, ringPoint } from "../../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

await RAPIER.init();
const [dir, id, end] = process.argv.slice(2) as [string, string, "start" | "end"];
const files = readExpresswayFiles(dir);
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const c0 = files.chunks.find((c) => c.id === id)!;
const o = end === "start" ? 0 : c0.st.length - 7;
const frame = new LocalFrame(c0.st[o + 2], c0.st[o + 1], 40);
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
const wall = own.endWalls.find((w) => w.end === end);
console.log("wall", JSON.stringify({ ...wall, boxes: wall?.boxes.length }));
for (const c of files.chunks) {
  if (c.id === id) continue;
  const m = Math.floor(c.st.length / 14) * 7;
  const dist = Math.hypot((c.st[m + 1] - c0.st[o + 1]) * 90600, (c.st[m + 2] - c0.st[o + 2]) * 110574);
  if (dist > 400) continue;
  const b = build(c);
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  createDeckBody(w, b.collider, b.piers, null);
  w.step();
  const hits: string[] = [];
  for (let u = -4.5; u <= 4.5; u += 0.5) {
    const road = ringPoint(ring, u, liftAt(ring, u, false)).addScaledVector(ring.t, back * 0.25);
    const from = road.clone().setY(road.y + 0.05);
    const hit = w.castRay(new RAPIER.Ray(from, new Vector3(0, 1, 0)), 3, true);
    if (hit) hits.push(`u ${u}: +${(hit.timeOfImpact + 0.05).toFixed(2)}`);
  }
  if (hits.length) console.log(c.id, c.structure, `girder ${c.girder}`, hits.join(", "));
  w.free();
}
