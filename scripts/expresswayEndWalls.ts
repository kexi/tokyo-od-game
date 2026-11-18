// The walls at the ends with nothing going on (R1-1b 3.2–3.5), built in Node as the game builds the
// decks (deckArraySteps over a DeckIndex of the whole folder) and probed with rays (Rapier):
// - per end wall, level rays from 0.25 m inside the end face outward, across the road every 0.25 m
//   and from 0.1 m over the road to 0.05 m under the wall's top every 0.25 m: each meets a collider,
//   or (`onRoad`) another deck's road lies just past the face (a child ending across its parent's
//   end); any other is a miss, a gap. A hidden end (no wall, under or on its parent) is rayed alike.
// - per end where the road goes on as another run (3.1 (c)), the widest stretch of its end face with
//   neither a box nor that run's road (≤ PARAPET_WIDTH to pass), listed apart where the deck boxes the
//   face (`onwardsBoxed`) and where it does not, a cut's or a tunnel's section (`onwardsSeen`, not judged).
// - per mouth of the folder's scorecard (an unwritten run hung on a written one), the parent's 壁高欄
//   on that side within ±30 m, and no branch line or ゼブラ there, where no written run shares the
//   parent's surface. One JSON file and one log line; exit 1 on a miss, an open face or a broken mouth.
//   just check-expressway-end-walls <dir> "--report <scorecard>"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PARAPET_WIDTH } from "../src/expressway/assumptions.ts";
import { ST, STATION_STRIDE, type XwChunk } from "../src/expressway/format.ts";
import { ReportSchema } from "../src/expressway/report.ts";
import { LocalFrame } from "../src/geo/frame.ts";
import { log } from "../src/log.ts";
import { createDeckBody, deckArraySteps, type GeoToLocal, SLAB } from "../src/world/expresswayDeck.ts";
import { endAhead, rangeOfChunks } from "../src/world/expresswayEnds.ts";
import { DeckIndex } from "../src/world/expresswayMarkings.ts";
import { liftAt, ringPoint } from "../src/world/expresswayMerge.ts";
import { readExpresswayFiles } from "./expresswayFiles.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dir = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const files = readExpresswayFiles(dir);
const name = files.dir.split("/").filter(Boolean).pop();
const out = flag("out") ?? `.qa/expressway/end-walls-${name}.json`;
const reportPath = flag("report");

await RAPIER.init();
/** The geoid's offset used by the probes (scripts/expresswaySeams.ts): a constant, enough for local geometry. */
const N = 36.9;
const runs = new Map(files.runs.map((r) => [r.id, { id: r.id, cls: r.cls, start: r.start, end: r.end }]));
const index = new DeckIndex(runs);
for (const c of files.chunks) index.add(c);
const context = { index };
const rangeOf = (run: string) => rangeOfChunks(index.chunksOf(run), STATION_STRIDE);
/** How near a chunk's middle must be to a probe's frame to be built into its world (m). */
const REACH_M = 400;

const midOf = (c: XwChunk) => {
  const m = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
  return { lon: c.st[m + ST.lon], lat: c.st[m + ST.lat] };
};
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
  Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_574);
type Built = ReturnType<typeof build>;
function build(c: XwChunk, place: GeoToLocal) {
  const steps = deckArraySteps(c, place, false, context);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** A world in a frame at a point with every chunk within REACH_M built, and the builds by id. */
function worldAt(at: { lon: number; lat: number }) {
  const frame = new LocalFrame(at.lat, at.lon, 40);
  const place: GeoToLocal = { frame, ellipsoidal: (_a, _b, h) => h + N };
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const builds = new Map<string, Built>();
  for (const c of files.chunks) {
    const isNear = metres(midOf(c), at) < REACH_M;
    if (!isNear) continue;
    const b = build(c, place);
    builds.set(c.id, b);
    createDeckBody(world, b.collider, b.piers, null);
  }
  world.step();
  return { world, builds };
}
const cast = (world: RAPIER.World, from: Vector3, toward: Vector3, max: number) =>
  world.castRay(new RAPIER.Ray(from, toward), max, true);

const endChunks = files.chunks.filter((c) => c.prev === null || c.next === null);
type WallRow = {
  chunk: string;
  end: "start" | "end";
  widthM: number;
  heightM: number;
  structure: string;
  rays: number;
  misses: number;
  onRoad: number;
};
const walls: WallRow[] = [];
const skips: Array<{
  chunk: string;
  end: string;
  reason: string;
  parent: string | null;
  misses: number;
  rays: number;
  onRoad: number;
}> = [];
const onwards: Array<{
  chunk: string;
  end: string;
  kind: string;
  via: string;
  uncoveredM: number;
  pattern: string;
}> = [];
const STEP = 0.25;

/** Level rays at a run's end ring towards its end face over `lo..hi`, from 0.1 m over the road to `top − 0.05`. */
function rayFace(world: RAPIER.World, b: Built, end: "start" | "end", lo: number, hi: number, top: number) {
  const k = end === "start" ? 0 : b.rings.length - 1;
  const ring = b.rings[k];
  const outward = end === "start" ? -1 : 1;
  const toward = ring.t.clone().multiplyScalar(outward);
  let rays = 0;
  let misses = 0;
  let onRoad = 0;
  for (let u = lo + STEP / 2; u < hi; u += STEP) {
    const road = ringPoint(ring, u, liftAt(ring, u, false));
    // Where another deck's road lies just past the face at this one's height (a child ending across
    // its parent's end, 224864773:end), the car rolls on onto it: no wall is due there.
    const past = road
      .clone()
      .addScaledVector(ring.t, outward * 0.3)
      .setY(road.y + 0.6);
    const below = cast(world, past, new Vector3(0, -1, 0), 1.2);
    const isRoadPast = below !== null && Math.abs(past.y - below.timeOfImpact - road.y) < 0.3;
    for (let y = road.y + 0.1; y <= top - 0.05 + 1e-9; y += STEP) {
      const from = ringPoint(ring, u, y - ring.c.y).addScaledVector(ring.t, -outward * 0.25);
      rays++;
      const isHit = cast(world, from, toward, 0.6) !== null;
      if (isHit) continue;
      if (isRoadPast) onRoad++;
      else misses++;
    }
  }
  return { rays, misses, onRoad };
}

for (const c of endChunks) {
  const at =
    c.prev === null
      ? { lon: c.st[1], lat: c.st[2] }
      : { lon: c.st[c.st.length - 6], lat: c.st[c.st.length - 5] };
  const sidesToCheck = (["start", "end"] as const).filter((e) =>
    e === "start" ? c.prev === null : c.next === null,
  );
  const answers = sidesToCheck.map((e) => ({ end: e, a: endAhead(runs, rangeOf, c.run, e) }));
  const isInteresting = answers.some(({ a }) => !a.ahead || a.why === "onward");
  if (!isInteresting) continue;
  const { world, builds } = worldAt(at);
  const b = builds.get(c.id)!;
  for (const w of b.endWalls) {
    const k = w.end === "start" ? 0 : b.rings.length - 1;
    const sd = b.sides[k];
    const lo = -(sd.right.wall ? sd.right.wall.inner : sd.right.reach);
    const hi = sd.left.wall ? sd.left.wall.inner : sd.left.reach;
    const ring = b.rings[k];
    // The wall's top over the slab's bottom at the centre (the road there less SLAB).
    const top = ringPoint(ring, 0, liftAt(ring, 0, false) - SLAB).y + w.heightM;
    const r = rayFace(world, b, w.end, lo, hi, top);
    walls.push({
      chunk: c.id,
      end: w.end,
      widthM: w.widthM,
      heightM: w.heightM,
      structure: c.structure,
      ...r,
    });
  }
  for (const s of b.endSkips) {
    const a = endAhead(runs, rangeOf, c.run, s.end);
    // A hidden end: rays over the child's own road at its end ring meet the parent's wall or deck.
    const k = s.end === "start" ? 0 : b.rings.length - 1;
    const sd = b.sides[k];
    const lo = -(sd.right.wall ? sd.right.wall.inner : sd.right.reach);
    const hi = sd.left.wall ? sd.left.wall.inner : sd.left.reach;
    const r = rayFace(
      world,
      b,
      s.end,
      lo,
      hi,
      ringPoint(b.rings[k], 0, liftAt(b.rings[k], 0, false)).y + 1.1,
    );
    skips.push({ chunk: c.id, end: s.end, reason: s.reason, parent: a.via ?? null, ...r });
  }
  for (const { end, a } of answers) {
    if (!(a.ahead && a.why === "onward")) continue;
    // The end face across its whole width: covered by a box (a level ray meets it) or by the onward
    // run's road (a ray down 0.3 m past the face meets a road within 0.3 m of this one's).
    const k = end === "start" ? 0 : b.rings.length - 1;
    const ring = b.rings[k];
    const outDir = end === "start" ? -1 : 1;
    const half = (c.lanes * c.laneWidth + c.shoulderL + c.shoulderR) / 2;
    let run = 0;
    let worst = 0;
    // Right to left, one letter a 0.25 m: B a box (or wall), R the onward run's road, . neither.
    let pattern = "";
    for (let u = -half + STEP / 2; u < half; u += STEP) {
      const road = ringPoint(ring, u, liftAt(ring, u, false));
      const level = road
        .clone()
        .setY(road.y + 0.5)
        .addScaledVector(ring.t, -outDir * 1.0);
      const isBox = cast(world, level, ring.t.clone().multiplyScalar(outDir), 1.6) !== null;
      const above = road
        .clone()
        .addScaledVector(ring.t, outDir * 0.3)
        .setY(road.y + 0.6);
      const hit = cast(world, above, new Vector3(0, -1, 0), 1.2);
      const isRoad = hit !== null && Math.abs(above.y - hit.timeOfImpact - road.y) < 0.3;
      const isCovered = isBox || isRoad;
      pattern += isBox ? "B" : isRoad ? "R" : ".";
      run = isCovered ? 0 : run + STEP;
      worst = Math.max(worst, run);
    }
    onwards.push({
      chunk: c.id,
      end,
      kind: runs.get(c.run)![end].kind,
      via: a.via!,
      uncoveredM: worst,
      pattern,
    });
  }
  world.free();
}

// The mouths of the folder's scorecard: the parent's wall on the child's side within ±30 m, no branch
// line nor ゼブラ painted there.
const mouths: Array<{
  run: string;
  s: number;
  child: string;
  side: string;
  wallMissingRings: number;
  sharedRings: number;
  branchLines: number;
  zebras: number;
}> = [];
if (reportPath) {
  const report = ReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  for (const m of report.ends?.mouths ?? []) {
    const chunks = index.chunksOf(m.run).filter((c) => {
      const s0 = c.st[0];
      const s1 = c.st[c.st.length - STATION_STRIDE];
      return s1 >= m.s - 30 && s0 <= m.s + 30;
    });
    if (chunks.length === 0 || !m.side) continue;
    const { world, builds } = worldAt(midOf(chunks[0]));
    let wallMissingRings = 0;
    let sharedRings = 0;
    let branchLines = 0;
    let zebras = 0;
    const sideKey = m.side;
    for (const c of chunks) {
      const b = builds.get(c.id);
      if (!b) continue;
      // A written run sharing the parent's surface there (a 分合流 of its own, 32404414 beside
      // 45661183 at 11842 m) drops the wall and paints its ゼブラ: not the mouth's doing. Asked as
      // the merge asks (DeckIndex.partnersAt, with its padding).
      const isSharedAt = (s: number) =>
        index.partnersAt(c, s).some((other) => other !== m.child && runs.has(other));
      b.rings.forEach((r, i) => {
        const isNear = Math.abs(r.frame.s - m.s) <= 30;
        if (!isNear || b.sides[i][sideKey].wall !== null) return;
        if (isSharedAt(r.frame.s)) sharedRings++;
        else wallMissingRings++;
      });
      branchLines += b.marks.lines.filter(
        (l) =>
          l.kind === "branch" &&
          l.to >= m.s - 30 &&
          l.from <= m.s + 30 &&
          !isSharedAt(l.from) &&
          !isSharedAt(l.to),
      ).length;
      zebras += b.marks.zebras.filter(
        (z) => z.s.some((s) => Math.abs(s - m.s) <= 30) && !z.s.some((s) => isSharedAt(s)),
      ).length;
    }
    world.free();
    mouths.push({
      run: m.run,
      s: m.s,
      child: m.child,
      side: sideKey,
      wallMissingRings,
      sharedRings,
      branchLines,
      zebras,
    });
  }
}

// The ends where the deck boxes the face (expresswayDeck.ts widthSteps: not in a cut's or a tunnel's
// section, whose bore it leaves out) and those only looked at here (5170834:end, a seam in a cut: its
// width step is the run's own, as on main).
const isBored = (chunk: string) => {
  const c = files.chunks.find((x) => x.id === chunk);
  return c?.structure === "cut" || c?.structure === "tunnel";
};
const onwardsBoxed = onwards.filter((o) => !isBored(o.chunk));
const onwardsSeen = onwards.filter((o) => isBored(o.chunk));
const result = {
  dir: files.dir,
  walls,
  skips,
  onwardsBoxed,
  onwardsSeen,
  mouths,
  summary: {
    walls: walls.length,
    wallMisses: walls.reduce((n, w) => n + w.misses, 0),
    hidden: skips.filter((s) => s.reason === "hidden").length,
    tunnel: skips.filter((s) => s.reason === "tunnel").length,
    hiddenMisses: skips.reduce((n, s) => n + s.misses, 0),
    onwardsBoxed: onwardsBoxed.length,
    onwardsSeen: onwardsSeen.length,
    onwardOverWidth: onwardsBoxed.filter((o) => o.uncoveredM > PARAPET_WIDTH.value + 1e-9).length,
    mouths: mouths.length,
    mouthsBroken: mouths.filter((m) => m.wallMissingRings > 0 || m.branchLines > 0 || m.zebras > 0).length,
  },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
log("expressway_end_walls_probed", { dir: files.dir, out, ...result.summary });
const isFailed =
  result.summary.wallMisses > 0 ||
  result.summary.hiddenMisses > 0 ||
  result.summary.onwardOverWidth > 0 ||
  result.summary.mouthsBroken > 0 ||
  result.summary.tunnel > 0;
process.exitCode = isFailed ? 1 : 0;
