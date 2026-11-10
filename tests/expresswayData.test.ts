import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkChunkJoin,
  checkClearance,
  checkGrade,
  checkGroundEnd,
  checkJunction,
  checkPlan,
  checkSuperelevation,
  checkSurface,
  checkVerticalCurves,
} from "../src/expressway/checks";
import {
  BLOCKED_STRIDE,
  STATION_STRIDE,
  type XwChunk,
  type XwMeta,
  type XwTile,
} from "../src/expressway/format";
import { tileKey } from "../src/expressway/geo";
import { ALLOWLIST, isAllowed } from "../src/expressway/allowlist";
import { OPERATOR_WORDS } from "../src/expressway/network";

// Every generated tile under public/data/expressway (scripts/expressway.ts, just make-expressway-data),
// checked against 設計書 4.4 T1〜T7 and T10.
const DIR = join(import.meta.dirname, "..", "public", "data", "expressway");
const meta = JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) as XwMeta;
const tileFiles = readdirSync(DIR).filter((f) => /^\d+-\d+\.json$/.test(f));
const tiles = new Map(
  tileFiles.map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(DIR, f), "utf8")) as XwTile]),
);
const chunks = [...tiles.values()].flatMap((t) => t.chunks);
const runs = new Map(meta.runs.map((r) => [r.id, r]));
const byRun = new Map<string, XwChunk[]>();
for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
for (const list of byRun.values()) list.sort((a, b) => a.k - b.k);

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

  it("builds the test section: 都心環状線 both ways and the 芝公園 entrance and exit", () => {
    expect(meta.range?.name).toBe("hamazakibashi");
    const refs = new Set(meta.runs.filter((r) => r.cls === "expressway").map((r) => r.ref));
    expect(refs.has("C1")).toBe(true);
    expect(meta.runs.filter((r) => r.cls === "ramp").length).toBeGreaterThanOrEqual(2);
  });

  it("every run of the range is in the files with all its chunks", () => {
    for (const r of meta.runs) expect(byRun.get(r.id)?.map((c) => c.id)).toEqual(r.chunks);
  });

  it("T1・T2: grades within 第20条 and vertical curves within 第22条 on every chunk, between stations too (the Hermite surface)", () => {
    expect(chunks.flatMap((c) => checkGrade(c, runs.get(c.run)!))).toEqual([]);
    expect(chunks.flatMap(checkVerticalCurves)).toEqual([]);
    expect(chunks.flatMap(checkSurface)).toEqual([]);
  });

  it("design speed is per section: a run's chunks may differ, each within the run's highest and its tag", () => {
    for (const r of meta.runs) {
      const speeds = byRun.get(r.id)!.map((c) => c.V);
      expect(Math.max(...speeds)).toBe(r.V);
      expect(r.V).toBeLessThanOrEqual(r.tagV);
    }
  });

  it("T3: chunks join exactly within a run, and runs join their parent at a junction in height, grade and bank", () => {
    const problems: string[] = [];
    for (const list of byRun.values())
      for (let i = 1; i < list.length; i++) problems.push(...checkChunkJoin(list[i - 1], list[i]));
    for (const r of meta.runs) {
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

  it("T4: every crossing is cleared by 4.5 m + girder, and the ground everywhere outside the climbs from ground ends", () => {
    expect(chunks.flatMap((c) => checkClearance(c, runs.get(c.run)!))).toEqual([]);
    expect(meta.counts.crossings).toBeGreaterThan(0);
  });

  it("T5: ground ends meet the DEM ground within 5 cm at its grade", () => {
    const problems: string[] = [];
    for (const r of meta.runs) {
      const list = byRun.get(r.id)!;
      problems.push(...checkGroundEnd(list[0], r, true), ...checkGroundEnd(list[list.length - 1], r, false));
    }
    expect(problems).toEqual([]);
  });

  it("T6: no kink, radius at least the floor for the assigned speed, within 1.5 m of OSM", () => {
    expect(chunks.flatMap((c) => checkPlan(c, runs.get(c.run)!).problems)).toEqual([]);
  });

  it("T7: superelevation within 第16条, run in over 第18条's length, composite grade within 第25条", () => {
    expect(chunks.flatMap(checkSuperelevation)).toEqual([]);
  });

  it("T10: nothing outside the allowlist is left, and the counts of what is reported stay as reviewed", () => {
    // allowed comes from src/expressway/allowlist.ts (with reasons), recomputed here too.
    expect(meta.diagnostics.filter((d) => !d.allowed || !isAllowed(d))).toEqual([]);
    const unsolved = ["vertical_unsolved", "parent_unsolved", "parent_missing"];
    expect(meta.diagnostics.filter((d) => unsolved.includes(d.kind))).toEqual([]);
    const counts: Record<string, number> = {};
    for (const d of meta.diagnostics) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    expect(counts).toMatchInlineSnapshot(`
      {
        "crossing_over_or_at_grade": 32,
        "deck_overlap": 4,
        "ramp_radius": 1,
        "vertical_fallback": 29,
      }
    `);
  });

  // Overlaps recomputed here by brute force, without overlap.ts (the compiler's own detector):
  // every station of a run against every segment of every other run, the other's height the cubic
  // Hermite through its two stations, the bands the carriageways recomputed from 第5・8条 / the ramp
  // assumption (lanes × lane width + shoulders).
  function overlapsByBruteForce() {
    const kx = 111320 * Math.cos((35.65 * Math.PI) / 180);
    const ky = 110574;
    type P = { x: number; y: number; s: number; z: number; g: number; hw: number };
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
    const out = new Map<string, { stations: number; maxDz: number; at: Array<[string, number]> }>();
    for (const [a, pa] of lines) {
      for (const [b, pb] of lines) {
        if (a === b) continue;
        for (const p of pa) {
          let best = { d: Infinity, z: 0, hw: 0 };
          for (let i = 0; i + 1 < pb.length; i++) {
            const q0 = pb[i];
            const q1 = pb[i + 1];
            const ex = q1.x - q0.x;
            const ey = q1.y - q0.y;
            const t = Math.min(1, Math.max(0, ((p.x - q0.x) * ex + (p.y - q0.y) * ey) / (ex * ex + ey * ey)));
            const d = Math.hypot(p.x - q0.x - ex * t, p.y - q0.y - ey * t);
            if (d < best.d) best = { d, z: cubic(q0, q1, q0.s + (q1.s - q0.s) * t), hw: q0.hw };
          }
          const isOver = best.d < p.hw + best.hw;
          if (!isOver) continue;
          const dz = Math.abs(p.z - best.z);
          const isBad = dz > 0.05 && dz < 4.5 + 2.2;
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

  it("deck_overlap: carriageways over one another are one surface or a level apart; the rest are the reported pairs, within their allowlist limits", () => {
    const reported = new Map(
      meta.diagnostics
        .filter((d) => d.kind === "deck_overlap")
        .map((d) => [[d.run, /^with (\S+):/.exec(d.detail)![1]].sort().join("|"), d] as const),
    );
    expect([...brute.keys()].sort()).toEqual([...reported.keys()].sort());
    for (const [key, o] of brute) {
      const [a, b] = key.split("|");
      const entry = ALLOWLIST.find(
        (e) => e.kind === "deck_overlap" && [e.run, e.with].sort().join("|") === [a, b].join("|"),
      );
      expect(entry, key).toBeDefined();
      expect(o.stations).toBeLessThanOrEqual(entry!.maxStations!);
      expect(o.maxDz).toBeLessThanOrEqual(entry!.maxDzM! + 0.005);
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

  it("says which format it is (meta.version 2) and that every joint solve converged", () => {
    expect(meta.version).toBe(2);
    expect(meta.solver.unconverged).toBe(0);
    expect(meta.solver.solves).toBeGreaterThan(0);
    expect(meta.diagnostics.filter((d) => d.kind === "solver_not_converged")).toEqual([]);
  });

  it("records the roads at ground level a low deck does not clear (blocked), one per crossing_over_or_at_grade of a run in the files", () => {
    const blocked: string[] = [];
    for (const c of chunks) {
      for (let i = 0; i < c.blocked.length; i += BLOCKED_STRIDE) {
        const [s, top, z] = c.blocked.slice(i, i + BLOCKED_STRIDE);
        // The deck there is below the clearance over the road (else it would be a crossing).
        expect(z - top).toBeLessThan(4.5 + c.girder);
        blocked.push(`${c.run}@${Math.round(s)}`);
      }
    }
    const reported = meta.diagnostics
      .filter((d) => d.kind === "crossing_over_or_at_grade" && runs.has(d.run))
      .map((d) => `${d.run}@${/ at (\d+) m/.exec(d.detail)![1]}`);
    expect(blocked.sort()).toEqual(reported.sort());
  });

  it("tells a portal (the road goes on into a tunnel or cut) from a touchdown at grade", () => {
    for (const r of meta.runs) {
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
    ].join("\n");
    for (const w of OPERATOR_WORDS) expect(text.toLowerCase()).not.toContain(w.toLowerCase());
  });

  it("stays small: the whole data set is recorded in meta.json and under 1 MB for the test section", () => {
    const total = tileFiles.reduce((n, f) => n + readFileSync(join(DIR, f)).length, 0);
    expect(meta.bytes).toBe(total);
    expect(total).toBeLessThan(1_000_000);
  });
});
