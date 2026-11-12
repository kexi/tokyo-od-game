import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import {
  checkChunkJoin,
  checkClearance,
  checkCover,
  climbingEnds,
  checkGrade,
  checkGroundEnd,
  checkJunction,
  checkPlan,
  checkSuperelevation,
  checkSurface,
  checkVerticalCurves,
} from "../src/expressway/checks";
import { BLOCKED_STRIDE, STATION_STRIDE } from "../src/expressway/format";
import { tileKey } from "../src/expressway/geo";
import { isAllowed } from "../src/expressway/allowlist";
import { assignDistricts, DISTRICTS, districtRunsOf } from "../src/expressway/districts";
import { caseContextOf, ledgerVerdict, rampFloorOf, withinCap } from "../src/expressway/ledger";
import { NOSE_MAX_DZ_M } from "../src/expressway/overlapClass";
import { DEFAULT_RANGES } from "../src/expressway/ranges";
import { OPERATOR_WORDS } from "../src/expressway/network";
import { TUNNEL_DEPTH_M } from "../src/expressway/below";
import { surfaceAt } from "../src/expressway/profile";

// Every generated tile under public/data/expressway (scripts/expressway.ts, just make-expressway-data),
// checked against knowledge/road-redesign-plan.md 4.4 T1〜T7 and T10, and the conditions for shipping the whole ward area
// (knowledge/expressway-generation.md). XW_DATA_DIR points it at another output (a --range all
// build written with --out) to judge that before it is shipped.
// v6 (P2.7-4): the tiles, report.json and the ledger through the one reader (scripts/expresswayFiles.ts).
const files = readExpresswayFiles();
const DIR = files.dir;
const meta = files.meta;
const record = files.record;
const tileFiles = readdirSync(DIR).filter((f) => /^\d+-\d+\.json$/.test(f));
const { tiles, chunks, byRun } = files;
const runs = files.runById;
/** The default build (just make-expressway-data): the expectations about its own runs hold only there. */
const isDefaultBuild = meta.ranges.map((r) => r.name).join(",") === DEFAULT_RANGES.join(",");
const isWholeArea = meta.ranges.length === 0;
/** The ledger's verdict on what the rules do not take (the build's `allowed` recomputed). */
const verdict = ledgerVerdict(caseContextOf(files.runs, record.untied, chunks), files.ledger);
/** The tightest radius the ledger accepts on a ramp (its ramp-radius case), for T6. */
const rampFloor = rampFloorOf(files.ledger);
/** The ledger's overlap case of a pair (any overlap kind), by "a|b" (a < b). */
const OVERLAP_KINDS = ["nose", "changeover", "parallel-ramp", "touchdown", "other"];
const overlapCase = (pair: string) =>
  files.ledger?.cases.find(
    (c) => OVERLAP_KINDS.includes(c.kind) && `${c.run}|${c.with}` === pair && c.status !== "gone",
  );
/**
 * Districts (src/expressway/districts.ts) with runs in the files; XW_DISTRICT keeps one. The
 * per-chunk checks run per district, so a failure names where it is and one district can be judged
 * apart.
 */
const districtOf = assignDistricts(districtRunsOf(files.runs, byRun));
// A misspelt XW_DISTRICT would run no district at all and pass: stop instead.
const isUnknownDistrict =
  process.env.XW_DISTRICT !== undefined &&
  !(DISTRICTS as readonly string[]).includes(process.env.XW_DISTRICT);
if (isUnknownDistrict)
  throw new Error(`XW_DISTRICT ${process.env.XW_DISTRICT}: not one of ${DISTRICTS.join(", ")}`);
const DISTRICT_LIST = DISTRICTS.filter((d) => [...districtOf.values()].includes(d)).filter(
  (d) => process.env.XW_DISTRICT === undefined || process.env.XW_DISTRICT === d,
);

// Overlaps recomputed here by brute force, without overlap.ts (the compiler's own detector):
// every station of a run against every segment of every other run, the other's height the cubic
// Hermite through its two stations, the bands the carriageways recomputed from 第5・8条 / the ramp
// assumption (lanes × lane width + shoulders), a level apart over the upper deck's own girder (its
// chunk's, 2.2 m where it has none: P2.7-6's thinner girders).
function overlapsByBruteForce() {
  const kx = 111320 * Math.cos((35.65 * Math.PI) / 180);
  const ky = 110574;
  type P = { x: number; y: number; s: number; z: number; g: number; hw: number; gd: number };
  const lines = new Map<string, P[]>();
  for (const [run, list] of byRun) {
    const pts: P[] = [];
    for (const c of list) {
      const hw = (c.lanes * c.laneWidth + c.shoulderL + c.shoulderR) / 2;
      for (let i = pts.length === 0 ? 0 : STATION_STRIDE; i < c.st.length; i += STATION_STRIDE)
        pts.push({
          x: c.st[i + 1] * kx,
          y: c.st[i + 2] * ky,
          s: c.st[i],
          z: c.st[i + 3],
          g: c.st[i + 6],
          hw,
          gd: c.girder > 0 ? Math.min(c.girder, 2.2) : 2.2,
        });
    }
    lines.set(run, pts);
  }
  const cubic = (p: P, q: P, s: number) => {
    const h = q.s - p.s;
    const t = (s - p.s) / h;
    return (
      (2 * t ** 3 - 3 * t ** 2 + 1) * p.z +
      (t ** 3 - 2 * t ** 2 + t) * h * p.g +
      (-2 * t ** 3 + 3 * t ** 2) * q.z +
      (t ** 3 - t ** 2) * h * q.g
    );
  };
  // Segments by 100 m cell (each listed in every cell its bounding box touches), so the whole
  // ward area stays quick; a station looks at its own cell's segments and the eight around it.
  const CELL = 100;
  const cells = new Map<string, Array<[string, number]>>();
  for (const [run, pts] of lines) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, x1] = [Math.min(pts[i].x, pts[i + 1].x), Math.max(pts[i].x, pts[i + 1].x)];
      const [y0, y1] = [Math.min(pts[i].y, pts[i + 1].y), Math.max(pts[i].y, pts[i + 1].y)];
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const key = `${cx},${cy}`;
          cells.set(key, [...(cells.get(key) ?? []), [run, i]]);
        }
    }
  }
  const out = new Map<string, { stations: number; maxDz: number; at: Array<[string, number]> }>();
  // Runs of one chain are one road (a viaduct and the tunnel it goes on into, P9): not decks.
  const chainOf = new Map(chunks.map((c) => [c.run, c.chain]));
  for (const [a, pa] of lines) {
    for (const p of pa) {
      const near = new Map<string, number[]>();
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const [run, i] of cells.get(`${Math.floor(p.x / CELL) + dx},${Math.floor(p.y / CELL) + dy}`) ??
            [])
            if (run !== a && chainOf.get(run) !== chainOf.get(a))
              near.set(run, [...(near.get(run) ?? []), i]);
      for (const [b, segs] of near) {
        const pb = lines.get(b)!;
        let best = { d: Infinity, z: 0, hw: 0, gd: 2.2 };
        for (const i of new Set(segs)) {
          const q0 = pb[i];
          const q1 = pb[i + 1];
          const ex = q1.x - q0.x;
          const ey = q1.y - q0.y;
          const t = Math.min(1, Math.max(0, ((p.x - q0.x) * ex + (p.y - q0.y) * ey) / (ex * ex + ey * ey)));
          const d = Math.hypot(p.x - q0.x - ex * t, p.y - q0.y - ey * t);
          if (d < best.d) best = { d, z: cubic(q0, q1, q0.s + (q1.s - q0.s) * t), hw: q0.hw, gd: q0.gd };
        }
        const isOver = best.d < p.hw + best.hw;
        if (!isOver) continue;
        const dz = Math.abs(p.z - best.z);
        const upperGirder = p.z >= best.z ? p.gd : best.gd;
        const isBad = dz > 0.05 && dz < 4.5 + upperGirder;
        if (!isBad) continue;
        const key = [a, b].sort().join("|");
        const o = out.get(key) ?? { stations: 0, maxDz: 0, at: [] };
        o.stations++;
        o.maxDz = Math.max(o.maxDz, dz);
        o.at.push([a, p.s]);
        out.set(key, o);
      }
    }
  }
  return out;
}
const brute = overlapsByBruteForce();

describe("生成済みの高速道路タイル", () => {
  it("meta.json lists exactly the tile files, each chunk sits in the z14 tile of its middle station, ids are <run>:<k>", () => {
    expect([...tiles.keys()].sort()).toEqual([...meta.tiles].sort());
    for (const [key, tile] of tiles) {
      for (const c of tile.chunks) {
        const mid = Math.floor(c.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
        expect(tileKey(c.st[mid + 1], c.st[mid + 2], meta.zoom)).toBe(key);
        expect(c.id).toBe(`${c.run}:${c.k}`);
      }
    }
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
    expect(meta.counts.chunks).toBe(chunks.length);
  });

  it.runIf(isDefaultBuild)(
    "builds the test section (都心環状線 both ways, the 芝公園 and 汐留 entrances and exits) and the Rainbow Bridge's (11号台場線, the 臨港道路 below)",
    () => {
      expect(meta.ranges.map((r) => r.name)).toEqual([
        "hamazakibashi",
        "rainbow",
        "azabudai",
        "azabudai_exit",
        "shiodome",
      ]);
      const refs = new Set(record.runs.filter((r) => r.cls === "expressway").map((r) => r.ref));
      expect(refs.has("C1")).toBe(true);
      expect(refs.has("11")).toBe(true);
      expect(record.runs.filter((r) => r.cls === "ramp").length).toBeGreaterThanOrEqual(2);
      expect(record.runs.filter((r) => r.cls === "street").length).toBe(2);
    },
  );

  it("has a posted limit on every chunk, and the raw maxspeed only where a way is tagged (XW_VERSION 5)", () => {
    for (const c of chunks) {
      expect(c.posted, c.id).toBeGreaterThan(0);
      expect(c.maxspeed === null || c.maxspeed > 0, c.id).toBe(true);
      // Where the way is tagged the plate shows the tag (G6 postedOf carries only untagged ways).
      if (c.maxspeed !== null && c.cls !== "street") expect(c.posted, c.id).toBe(c.maxspeed);
    }
  });

  it("P9: piers stand over a buried tunnel as over any ground; only an open cut or a portal's hole under a viaduct takes them away", () => {
    // 都心環状線内回り (24402611) crosses over the 麻布台 tunnel between s ≈ 870 and 1620 m. Counted as
    // a deck below, the tunnel had taken all 15 of its piers there (review of P9, C2).
    const piersOf = (run: string) =>
      byRun
        .get(run)!
        .flatMap((c) => Array.from({ length: c.piers.length / 2 }, (_, i) => c.piers[i * 2]))
        .sort((a, b) => a - b);
    const longestGap = (ps: number[], from: number, to: number) => {
      const inside = ps.filter((s) => s >= from && s <= to);
      let gap = 0;
      for (let i = 1; i < inside.length; i++) gap = Math.max(gap, inside[i] - inside[i - 1]);
      return { count: inside.length, gap };
    };
    const over = longestGap(piersOf("24402611"), 700, 1800);
    expect(over.count).toBeGreaterThanOrEqual(10);
    expect(over.gap).toBeLessThanOrEqual(90);
    // The whole run's longest stretch without a pier: s 1404–2275, where it stands over other decks (the
    // C1 changeover) and the tunnel's open stretches; before P9 it was 1505–2275 (770 m).
    expect(longestGap(piersOf("24402611"), 0, Infinity).gap).toBeLessThanOrEqual(875);
  });

  it("P9: 都心環状線外回りの麻布台の掘割とトンネル is one run seamed to the viaducts either side, with its portals", () => {
    const run = runs.get("737538573")!;
    expect(run.ref).toBe("C1");
    expect(run.start).toMatchObject({ kind: "seam", parent: "45021976" });
    expect(run.end).toMatchObject({ kind: "seam", parent: "895902565" });
    // The viaduct before it still ends at its portal on the ground, as in P7's data.
    expect(runs.get("45021976")!.end).toMatchObject({ kind: "portal", into: "cut" });
    const list = byRun.get("737538573")!;
    expect(list.map((c) => c.structure)).toEqual(["cut", "tunnel", "tunnel"]);
    const portals = list.flatMap((c) => c.portals ?? []);
    expect(portals.map((p) => `${p.from}>${p.to}`)).toEqual(["viaduct>cut", "cut>tunnel", "tunnel>viaduct"]);
    expect(portals[0].s).toBe(0);
    expect(portals[2].s).toBeCloseTo(run.lengthM, 2);
    for (const c of list) {
      expect(c.girder).toBe(0);
      expect(c.piers).toEqual([]);
      expect(c.cross).toEqual([]);
      expect(c.blocked).toEqual([]);
    }
    // No viaduct chunk carries portals (the field is left out there).
    expect(chunks.filter((c) => c.structure === "viaduct" && c.portals !== undefined)).toEqual([]);
    // Deep in the tunnel the road is more than the box and cover under the ground.
    const depths = list.flatMap((c) => {
      const out: number[] = [];
      for (let i = 0; i < c.st.length; i += STATION_STRIDE) out.push(c.st[i + 5] - c.st[i + 3]);
      return out;
    });
    expect(Math.max(...depths)).toBeGreaterThan(TUNNEL_DEPTH_M);
  });

  it("T10: nothing the rules and the ledger do not accept is left (the counts per kind are the ledger's budget)", () => {
    // allowed comes from src/expressway/allowlist.ts's rules and the folder's ledger, recomputed here too.
    expect(record.diagnostics.filter((d) => !d.allowed || !isAllowed(d, verdict))).toEqual([]);
    const unsolved = ["vertical_unsolved", "parent_unsolved", "parent_missing"];
    expect(record.diagnostics.filter((d) => unsolved.includes(d.kind))).toEqual([]);
  });

  it("deck_overlap: carriageways over one another are one surface or a level apart; the rest are the reported pairs, each a ledger case within its cap", () => {
    const reported = new Map(
      record.diagnostics
        .filter((d) => d.kind === "deck_overlap")
        .map((d) => [[d.run, /^with (\S+):/.exec(d.detail)![1]].sort().join("|"), d] as const),
    );
    expect([...brute.keys()].sort()).toEqual([...reported.keys()].sort());
    for (const [key, o] of brute) {
      const c = overlapCase(key);
      expect(c, key).toBeDefined();
      // A nose passes by its rule (≤ NOSE_MAX_DZ_M); a reviewed pair within its cap and margin.
      const isNose = c!.kind === "nose";
      if (isNose) expect(o.maxDz, key).toBeLessThanOrEqual(NOSE_MAX_DZ_M + 0.005);
      if (isNose) continue;
      expect(c!.cap, key).not.toBeNull();
      expect(withinCap({ stations: o.stations, maxDzM: Math.max(0, o.maxDz - 0.005) }, c!.cap!), key).toBe(
        true,
      );
    }
  });

  it("records where carriageways overlap (decks), covering every overlapping station found independently", () => {
    for (const c of chunks) {
      for (const d of c.decks) {
        expect(["same", "above", "below"]).toContain(d.relation);
        expect(d.s0).toBeGreaterThanOrEqual(c.st[0] - 1e-6);
        expect(d.s1).toBeLessThanOrEqual(c.st[c.st.length - STATION_STRIDE] + 1e-6);
      }
    }
    const covered = (run: string, s: number) =>
      byRun.get(run)!.some((c) => c.decks.some((d) => s >= d.s0 - 6 && s <= d.s1 + 6));
    for (const o of brute.values())
      for (const [run, s] of o.at) expect(covered(run, s), `${run}@${s}`).toBe(true);
  });

  it("says which format it is (meta.version 6) and that every joint solve converged", () => {
    expect(meta.version).toBe(6);
    // P9's tunnels and cuts are named, so a reader without them refuses the files (isSupportedMeta).
    expect(meta.features).toEqual(["below"]);
    expect(record.solver.unconverged).toBe(0);
    expect(record.solver.solves).toBeGreaterThan(0);
    expect(record.diagnostics.filter((d) => d.kind === "solver_not_converged")).toEqual([]);
  });

  it("records the roads at ground level a low deck does not clear (blocked), one per crossing_over_or_at_grade of a run in the files", () => {
    const blocked: string[] = [];
    for (const c of chunks) {
      for (let i = 0; i < c.blocked.length; i += BLOCKED_STRIDE) {
        const [s, top] = c.blocked.slice(i, i + BLOCKED_STRIDE);
        // Somewhere over the road's width the deck is below the clearance (else it would be a
        // crossing): the lowest surface within 40 m along (the widest window the compiler takes).
        const list = byRun.get(c.run)!;
        let low = Infinity;
        for (let sv = s - 40; sv <= s + 40; sv += 1) {
          const holder = list.find((k) => sv >= k.st[0] && sv <= k.st[k.st.length - STATION_STRIDE]);
          if (holder) low = Math.min(low, surfaceAt(holder.st, sv).z);
        }
        expect(low - top).toBeLessThan(4.5 + c.girder);
        blocked.push(`${c.run}@${Math.round(s)}`);
      }
    }
    const reported = record.diagnostics
      .filter((d) => d.kind === "crossing_over_or_at_grade" && runs.has(d.run))
      .map((d) => `${d.run}@${/ at (\d+) m/.exec(d.detail)![1]}`);
    expect(blocked.sort()).toEqual(reported.sort());
  });

  it("tells a portal (the road goes on into a tunnel or cut) from a touchdown at grade", () => {
    for (const r of record.runs) {
      for (const e of [r.start, r.end]) {
        const isPortal = e.kind === "portal";
        if (isPortal) expect(["tunnel", "cut"]).toContain(e.into);
        else expect(e.into).toBeUndefined();
      }
    }
  });

  it("carries no operator name (the game calls it by a fictional name)", () => {
    const text = [
      ...tileFiles.map((f) => readFileSync(join(DIR, f), "utf8")),
      readFileSync(join(DIR, "meta.json"), "utf8"),
      readFileSync(join(DIR, "report.json"), "utf8"),
      ...(existsSync(join(DIR, "ledger.json")) ? [readFileSync(join(DIR, "ledger.json"), "utf8")] : []),
    ].join("\n");
    for (const w of OPERATOR_WORDS) expect(text.toLowerCase()).not.toContain(w.toLowerCase());
  });

  it("stays small: the tiles' bytes are recorded in meta.json, and under 1 MB for the default build", () => {
    const total = tileFiles.reduce((n, f) => n + readFileSync(join(DIR, f)).length, 0);
    expect(meta.bytes).toBe(total);
    if (isDefaultBuild) expect(total).toBeLessThan(1_000_000);
  });
});

describe.each(DISTRICT_LIST)("生成済みの高速道路タイル（地区 %s）", (district) => {
  const dRuns = record.runs.filter((r) => districtOf.get(r.id) === district);
  const dChunks = chunks.filter((c) => districtOf.get(c.run) === district);

  it("every run of the range is in the files with all its chunks", () => {
    for (const r of dRuns) expect(byRun.get(r.id)?.map((c) => c.id)).toEqual(r.chunks);
  });

  it("T1・T2: grades within 第20条 and vertical curves within 第22条 on every chunk, between stations too (the Hermite surface)", () => {
    expect(dChunks.flatMap((c) => checkGrade(c, runs.get(c.run)!))).toEqual([]);
    expect(dChunks.flatMap(checkVerticalCurves)).toEqual([]);
    expect(dChunks.flatMap(checkSurface)).toEqual([]);
  });

  it("design speed is per section: a run's chunks may differ, each within the run's highest and its tag", () => {
    for (const r of dRuns) {
      const speeds = byRun.get(r.id)!.map((c) => c.V);
      expect(Math.max(...speeds)).toBe(r.V);
      expect(r.V).toBeLessThanOrEqual(r.tagV);
    }
  });

  it("T3: chunks join exactly within a run, and runs join their parent at a junction in height, grade and bank", () => {
    const problems: string[] = [];
    for (const list of dRuns.map((r) => byRun.get(r.id)!))
      for (let i = 1; i < list.length; i++) problems.push(...checkChunkJoin(list[i - 1], list[i]));
    for (const r of dRuns) {
      const list = byRun.get(r.id)!;
      for (const [atStart, end] of [
        [true, r.start],
        [false, r.end],
      ] as const) {
        const isJoined = end.kind === "junction" || end.kind === "seam";
        const parent = isJoined ? byRun.get(end.parent!) : undefined;
        if (!parent) continue; // the parent is outside the range: not in these files
        problems.push(
          ...checkJunction(atStart ? list[0] : list[list.length - 1], atStart, end.grade!, parent),
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("T4: every crossing is cleared by 4.5 m + girder, and the ground everywhere outside the climbs from low ends", () => {
    // Low ends recomputed from the run summaries (a ground end, or a junction on a parent still
    // climbing from one), not taken from the compiler.
    const climbs = (id: string) => climbingEnds(runs.get(id)!, runs);
    // A run may miss the assumed standard floor over open ground only by what its allowed
    // below_open_ground_floor diagnostic says (bounded by the allowlist); the crossings exactly.
    const openShort = (id: string) => {
      const d = record.diagnostics.find(
        (x) => x.run === id && x.kind === "below_open_ground_floor" && isAllowed(x),
      );
      return d ? Number(/^([\d.]+) m under/.exec(d.detail)![1]) + 0.01 : 0;
    };
    expect(
      dChunks.flatMap((c) => checkClearance(c, runs.get(c.run)!, climbs(c.run), openShort(c.run))),
    ).toEqual([]);
    expect(meta.counts.crossings).toBeGreaterThan(0);
  });

  it("T5: ground ends meet the DEM ground within 5 cm at its grade", () => {
    const problems: string[] = [];
    for (const r of dRuns) {
      const list = byRun.get(r.id)!;
      problems.push(...checkGroundEnd(list[0], r, true), ...checkGroundEnd(list[list.length - 1], r, false));
    }
    expect(problems).toEqual([]);
  });

  it("T6: no kink, radius at least the floor for the assigned speed, within 1.5 m of OSM", () => {
    expect(dChunks.flatMap((c) => checkPlan(c, runs.get(c.run)!, rampFloor(c.run)).problems)).toEqual([]);
  });

  it("T7: superelevation within 第16条, run in over 第18条's length, composite grade within 第25条", () => {
    expect(dChunks.flatMap(checkSuperelevation)).toEqual([]);
  });

  it("T12 (P9): every tunnel keeps its box and cover under the ground, every cut stays under it, wherever a portal's descent reaches", () => {
    const problems: string[] = [];
    for (const r of dRuns) {
      const list = byRun.get(r.id)!;
      const first = list[0].st;
      const last = list[list.length - 1].st;
      const ends = { z0: first[3], z1: last[last.length - STATION_STRIDE + 3] };
      for (const c of list) problems.push(...checkCover(c, r, ends));
    }
    expect(problems).toEqual([]);
  });
});

// The conditions for shipping the whole ward area (P2.5 review), each recomputed from the files.
describe.runIf(isWholeArea)("全域の出荷条件（--range all の出力）", () => {
  const closed = record.closed;

  it("no main line is left out, and every run end hangs from a run that is in the files", () => {
    expect(closed.filter((c) => c.cls === "expressway")).toEqual([]);
    const missing: string[] = [];
    for (const r of record.runs)
      for (const e of [r.start, r.end])
        if (e.parent !== undefined && !byRun.has(e.parent)) missing.push(`${r.id} → ${e.parent}`);
    expect(missing).toEqual([]);
  });

  it("ramps left out are at most 5 %, each closed with its reason and not in the tiles", () => {
    const rampsIn = record.runs.filter((r) => r.cls === "ramp").length;
    const rampsOut = closed.filter((c) => c.cls === "ramp");
    expect(rampsOut.length / (rampsIn + rampsOut.length)).toBeLessThanOrEqual(0.05);
    for (const c of rampsOut) {
      expect(byRun.has(c.run)).toBe(false);
      expect(record.diagnostics.some((d) => d.run === c.run && d.kind === c.reason)).toBe(true);
    }
  });

  it("no overlap of carriageways the ledger does not accept (recomputed by the grid above)", () => {
    const unallowed = [...brute.keys()].filter((key) => {
      const c = overlapCase(key);
      const isAccepted = c !== undefined && (c.status === "accepted" || c.status === "wontfix");
      return !isAccepted;
    });
    expect(unallowed).toEqual([]);
  });
});
