import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { STATION_STRIDE, type XwChunk, type XwTileRun } from "../src/expressway/format.ts";
import { frameAt } from "../src/expressway/profile.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { createDeckBody, deckArraySteps } from "../src/world/expresswayDeck.ts";
import { DeckIndex, MERGE_PAD_M, roleOf } from "../src/world/expresswayMarkings.ts";
import { MERGE_MAX_DZ, seamWeight } from "../src/world/expresswayMerge.ts";
import { type PairPoint, pairPoints, type Project } from "./expresswayPairs.ts";

/**
 * The merged decks of a data folder probed by rays where the chunks alone say the seams and the
 * let-go points are (expresswayPairs.ts): for the data tests (tests/expresswayDrive.test.ts,
 * tests/expresswayLedger.test.ts) and the ledger tool (scripts/expresswayLedger.ts), which count the
 * seam cases from them. Needs RAPIER.init().
 */

const N = 36.9;

/**
 * Frames the probes run in, each over the chunks nearest to it: the colliders are float32, and
 * 4 km from a frame's origin a vertex rounds by ~0.25 mm, enough to read a millimetre step where
 * the data has none. Every chunk is probed in its nearest frame; each frame's world holds every
 * chunk within WORLD_REACH_M (so a pair's master is always there). The frames are the centres of
 * the tiles that hold chunks (P2.7-4: before, three points written by hand for the test section).
 */
const WORLD_REACH_M = 3000;

export type ProbeFrame = { lat: number; lon: number };

/** The centre of a z<zoom> tile <x>-<y>. */
export function tileCentre(key: string, zoom: number): ProbeFrame {
  const [x, y] = key.split("-").map(Number);
  const n = 2 ** zoom;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** The probe frames of a folder: the centres of its tiles that hold chunks, in key order. */
export function framesOf(
  tiles: ReadonlyMap<string, { chunks: readonly XwChunk[] }>,
  zoom: number,
): ProbeFrame[] {
  return [...tiles]
    .filter(([, t]) => t.chunks.length > 0)
    .map(([key]) => key)
    .sort()
    .map((key) => tileCentre(key, zoom));
}

export type SeamProbe = {
  chunk: string;
  with: string;
  s: number;
  dz: number;
  step: number | null;
  expected: number;
  inside: number | null;
};
export type LetGo = { chunk: string; with: string; s: number; alongStep: number | null };

/**
 * Every chunk merged (the DeckIndex always over all of them), and the probes of every seam and
 * let-go point, each in its nearest frame.
 */
export function probeGenerated(
  chunks: readonly XwChunk[],
  tileRuns: readonly XwTileRun[],
  frames: readonly ProbeFrame[],
): { seams: SeamProbe[]; cuts: LetGo[]; worlds: RAPIER.World[] } {
  const runs = new Map(tileRuns.map((r) => [r.id, r]));
  const index = new DeckIndex(runs);
  for (const c of chunks) index.add(c);
  const distanceTo = (c: XwChunk, a: ProbeFrame) => {
    const m = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
    const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot((c.st[m + 1] - a.lon) * kx, (c.st[m + 2] - a.lat) * 110_574);
  };
  const nearest = (c: XwChunk) =>
    frames.reduce((best, a, i) => (distanceTo(c, a) < distanceTo(c, frames[best]) ? i : best), 0);
  const seams: SeamProbe[] = [];
  const cuts: LetGo[] = [];
  const worlds: RAPIER.World[] = [];
  frames.forEach((area, k) => {
    const own = new Set(chunks.filter((c) => nearest(c) === k).map((c) => c.id));
    const hasOwn = own.size > 0;
    if (!hasOwn) return;
    const frame = new LocalFrame(area.lat, area.lon, 40);
    const near = chunks.filter((c) => distanceTo(c, area) < WORLD_REACH_M);
    const res = probeIn(frame, near, own, runs, index);
    seams.push(...res.seams);
    cuts.push(...res.cuts);
    worlds.push(res.world);
  });
  return { seams, cuts, worlds };
}

/**
 * Where a same-surface stretch misses by more than the game makes one slab (MERGE_MAX_DZ): per chunk
 * and partner, the stretch and the largest |Δz| (unpadded "same" stretches every 0.5 m, against the
 * other run's surface at the nearest point of its centre line). The deck builder leaves these apart
 * and logs expressway_merge_skipped.
 */
export function mergeMisses(
  chunks: readonly XwChunk[],
): Array<{ chunk: string; with: string; s0: number; s1: number; maxDzM: number }> {
  const known = new Set(chunks.map((c) => c.run));
  const found = new Map<string, { chunk: string; with: string; s0: number; s1: number; maxDzM: number }>();
  for (const p of pairPoints(chunks)) {
    const isApart = known.has(p.with) && Math.abs(p.dz) > MERGE_MAX_DZ;
    if (!isApart) continue;
    const key = `${p.chunk.id}|${p.with}`;
    const g = found.get(key) ?? { chunk: p.chunk.id, with: p.with, s0: p.s, s1: p.s, maxDzM: 0 };
    g.s0 = Math.min(g.s0, p.s);
    g.s1 = Math.max(g.s1, p.s);
    g.maxDzM = Math.max(g.maxDzM, Math.abs(p.dz));
    found.set(key, g);
  }
  return [...found.values()];
}

function probeIn(
  FRAME: LocalFrame,
  chunks: XwChunk[],
  own: ReadonlySet<string>,
  runs: Map<string, XwTileRun>,
  index: DeckIndex,
): { seams: SeamProbe[]; cuts: LetGo[]; world: RAPIER.World } {
  const place = { frame: FRAME, ellipsoidal: (_a: number, _b: number, h: number) => h + N };
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  for (const c of chunks) {
    const steps = deckArraySteps(c, place, false, { index });
    let r = steps.next();
    while (!r.done) r = steps.next();
    createDeckBody(world, r.value.collider, r.value.piers, null);
  }
  world.step();
  // Plan metres in the game's own frame (east, north = −z), each point at its own height (the
  // decks' vertices are; at height 0 a point 1.5 km from the origin would sit 1.4 cm off them).
  const project: Project = (lon, lat, z) => {
    const p = FRAME.toLocal(lat, lon, z + N);
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
  const all = pairPoints(chunks, 0.5, project).filter(
    (p) => own.has(p.chunk.id) && known.has(p.with) && isCut(p),
  );
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
      with: p.with,
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
  ).filter(
    (p) => own.has(p.chunk.id) && known.has(p.with) && isCut(p) && Math.abs(p.offset) - p.edge < p.otherEdge,
  );
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
