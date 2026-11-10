import RAPIER from "@dimforge/rapier3d-compat";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3 } from "three";
import type { XwChunk, XwMeta, XwTile } from "../src/expressway/format";
import { frameAt } from "../src/expressway/profile";
import { LocalFrame } from "../src/geo/frame";
import { createDeckBody, deckArraySteps } from "../src/world/expresswayDeck";
import { DeckIndex, MERGE_PAD_M, roleOf } from "../src/world/expresswayMarkings";
import { MERGE_MAX_DZ, seamWeight } from "../src/world/expresswayMerge";
import { type PairPoint, pairPoints, type Project } from "./expresswayPairs";

/**
 * The generated data's merged decks probed by rays where the chunks alone say the seams and the
 * let-go points are (expresswayPairs.ts), for tests/expresswayDrive.test.ts. Needs RAPIER.init().
 */

const N = 36.9;
const FRAME = new LocalFrame(35.6537, 139.7508, 40);

export function loadGenerated(): { meta: XwMeta; chunks: XwChunk[] } {
  const dir = join(import.meta.dirname, "..", "public", "data", "expressway");
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as XwMeta;
  const chunks = readdirSync(dir)
    .filter((f) => /^\d+-\d+\.json$/.test(f))
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as XwTile).chunks);
  return { meta, chunks };
}

export type SeamProbe = {
  chunk: string;
  s: number;
  dz: number;
  step: number | null;
  expected: number;
  inside: number | null;
};
export type LetGo = { chunk: string; with: string; s: number; alongStep: number | null };

/** All chunks merged in one world, and the probes. */
export function probeGenerated(): { seams: SeamProbe[]; cuts: LetGo[]; world: RAPIER.World } {
  const { meta, chunks } = loadGenerated();
  const runs = new Map(meta.runs.map((r) => [r.id, r]));
  const index = new DeckIndex(runs);
  for (const c of chunks) index.add(c);
  const place = { frame: FRAME, ellipsoidal: (_a: number, _b: number, h: number) => h + N };
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  for (const c of chunks) {
    const steps = deckArraySteps(c, place, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    createDeckBody(world, r.value.collider, r.value.piers, null);
  }
  world.step();
  // Plan metres in the game's own frame (east, north = −z), heights at the master's foot.
  const project: Project = (lon, lat) => {
    const p = FRAME.toLocal(lat, lon, 0);
    return [p.x, -p.z];
  };
  /** A plan point at the local height of the master's surface at its foot (rays start 0.5 m above). */
  const local = (x: number, y: number, p: PairPoint) => {
    const f = frameAt(p.other.chunk.st, p.other.s);
    return new Vector3(x, FRAME.toLocal(f.lat, f.lon, f.z + N).y, -y);
  };
  const down = (p: Vector3) => {
    const hit = world.castRay(
      new RAPIER.Ray({ x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: -1, z: 0 }),
      3,
      true,
    );
    return hit ? p.y + 0.5 - hit.timeOfImpact : null;
  };
  const known = new Set(chunks.map((c) => c.run));
  const isCut = (p: PairPoint) => p.isSameWay && roleOf(runs, p.chunk.run, p.with) === "child";
  const all = pairPoints(chunks, 0.5, project).filter((p) => known.has(p.with) && isCut(p));
  const seams: SeamProbe[] = [];
  for (const p of all) {
    const sign = p.offset >= 0 ? 1 : -1;
    const hw = p.edge - 0.5;
    // Its road (not only its parapet) lies past the master's edge here: the seam is driven over.
    const hasRoadOutside = Math.abs(p.offset) + hw > p.otherEdge + 0.02;
    const isMerged = Math.abs(p.dz) <= MERGE_MAX_DZ;
    if (!hasRoadOutside || !isMerged) continue;
    const nx = -p.other.dy * sign;
    const ny = p.other.dx * sign;
    const at = (u: number) => local(p.other.x + nx * u, p.other.y + ny * u, p);
    const inside = down(at(p.otherEdge - 0.002));
    const outside = down(at(p.otherEdge + 0.002));
    const step = inside === null || outside === null ? null : Math.abs(inside - outside);
    const master = at(0).y;
    seams.push({
      chunk: p.chunk.id,
      s: p.s,
      dz: p.dz,
      step,
      expected: (1 - seamWeight(p.dz)) * Math.abs(p.dz),
      inside: inside === null ? null : inside - master,
    });
  }
  // Where a merged pair lets go along the cut deck (|Δz| crosses MERGE_MAX_DZ, padded stretches),
  // the step along travel on its road beside the seam, over 4 cm less the grade's share.
  const padded = pairPoints(
    chunks.map((c) => ({
      ...c,
      decks: c.decks.map((d) => ({ ...d, s0: d.s0 - MERGE_PAD_M, s1: d.s1 + MERGE_PAD_M })),
    })),
    0.25,
    project,
  ).filter((p) => known.has(p.with) && isCut(p) && Math.abs(p.offset) - p.edge < p.otherEdge);
  const cuts: LetGo[] = [];
  for (let i = 1; i < padded.length; i++) {
    const a = padded[i - 1];
    const b = padded[i];
    const isSameStretch = a.chunk === b.chunk && a.with === b.with && b.s - a.s < 0.3;
    const crosses = Math.abs(a.dz) <= MERGE_MAX_DZ !== Math.abs(b.dz) <= MERGE_MAX_DZ;
    if (!isSameStretch || !crosses) continue;
    const s = (a.s + b.s) / 2;
    const sign = b.offset >= 0 ? 1 : -1;
    // 0.3 m onto the cut deck's road past the master's edge (or its centre, if that is farther out).
    const u = Math.max(b.otherEdge + 0.3, Math.abs(b.offset)) * sign;
    const nx = -b.other.dy;
    const ny = b.other.dx;
    const pointAt = (ds: number) =>
      local(b.other.x + nx * u + b.other.dx * ds, b.other.y + ny * u + b.other.dy * ds, b);
    const y0 = down(pointAt(-0.02));
    const y1 = down(pointAt(0.02));
    const grade = frameAt(b.chunk.st, s).grade * 0.04;
    cuts.push({
      chunk: b.chunk.id,
      with: b.with,
      s: Math.round(s * 10) / 10,
      // Both run one way: the cut deck's grade is the climb along the master's direction too.
      alongStep: y0 === null || y1 === null ? null : Math.abs(y1 - y0 - grade),
    });
  }
  return { seams, cuts, world };
}
