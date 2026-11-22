// What a car in 45068170's lane 1 meets ahead from s 160: level rays at 0.5 m and 1.4 m over the road
// along the lane's centre, and the run whose collider each hits (by which build added the triangle).
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { LocalFrame } from "../../src/geo/frame.ts";
import { createDeckBody, deckArraySteps } from "../../src/world/expresswayDeck.ts";
import { DeckIndex } from "../../src/world/expresswayMarkings.ts";
import { liftAt, ringPoint } from "../../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

await RAPIER.init();
const files = readExpresswayFiles();
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const c0 = files.chunks.find((c) => c.id === "45068170:0")!;
const o = c0.st.length - 7;
const frame = new LocalFrame(c0.st[o + 2], c0.st[o + 1], 40);
const place = { frame, ellipsoidal: (_a: number, _b: number, h: number) => h + 36.9 };
const near = files.chunks.filter((c) => {
  const m = Math.floor(c.st.length / 14) * 7;
  return Math.hypot((c.st[m + 1] - c0.st[o + 1]) * 90600, (c.st[m + 2] - c0.st[o + 2]) * 110574) < 400;
});
const built = new Map<string, ReturnType<typeof build>>();
function build(c: (typeof files.chunks)[number]) {
  const steps = deckArraySteps(c, place, false, { index });
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
// One world per chunk, to tell which chunk a hit is on.
const worlds = near.map((c) => {
  const b = build(c);
  built.set(c.id, b);
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  createDeckBody(w, b.collider, b.piers, null);
  w.step();
  return { id: c.id, w };
});
const b = built.get("45068170:0")!;
// Lane 1 (the right lane): its centre 1.625 m right of the carriageway centre for 2 lanes of 3.25 m
// with shoulders 1.25 / 0.75 (laneCentreOffset).
const u = -(3.25 / 2) + (1.25 - 0.75) / 2;
for (const ring of b.rings) {
  if (ring.frame.s < 150) continue;
  for (const h of [0.5, 1.4]) {
    const from = ringPoint(ring, u, liftAt(ring, u, false) + h);
    let best: { id: string; t: number } | null = null;
    for (const { id, w } of worlds) {
      const hit = w.castRay(new RAPIER.Ray(from, ring.t), 6, true);
      if (hit && (!best || hit.timeOfImpact < best.t)) best = { id, t: hit.timeOfImpact };
    }
    if (best) console.log(`s ${ring.frame.s.toFixed(1)} h ${h}: ${best.id} at +${best.t.toFixed(2)} m`);
  }
}
const _ = new Vector3();
