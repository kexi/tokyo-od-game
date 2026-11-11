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
import { MERGE_MAX_DZ } from "../src/world/expresswayMerge";
import { pairPoints } from "./expresswayPairs";

// Every generated tile under public/data/expressway (scripts/expressway.ts, just make-expressway-data),
// checked against knowledge/road-redesign-plan.md 4.4 T1〜T7 and T10.
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

  it("builds the test section (都心環状線 both ways, the 芝公園 entrance and exit) and the Rainbow Bridge's (11号台場線, the 臨港道路 below)", () => {
    expect(meta.ranges.map((r) => r.name)).toEqual(["hamazakibashi", "rainbow"]);
    const refs = new Set(meta.runs.filter((r) => r.cls === "expressway").map((r) => r.ref));
    expect(refs.has("C1")).toBe(true);
    expect(refs.has("11")).toBe(true);
    expect(meta.runs.filter((r) => r.cls === "ramp").length).toBeGreaterThanOrEqual(2);
    expect(meta.runs.filter((r) => r.cls === "street").length).toBe(2);
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

  it("uses every allowlist entry for a run in the files: an entry no diagnostic meets is stale", () => {
    // Entries for runs outside these files are for --range all (ramp_radius of runs elsewhere).
    const stale = ALLOWLIST.filter((a) => {
      const isHere = a.run === "*" || runs.has(a.run);
      if (!isHere) return false;
      return !meta.diagnostics.some(
        (d) =>
          (a.run === "*" || d.run === a.run) &&
          d.kind === a.kind &&
          (a.with === undefined || d.detail.startsWith(`with ${a.with}:`)),
      );
    });
    expect(stale.map((a) => `${a.run} ${a.kind} ${a.with ?? ""}`)).toEqual([]);
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
        "crossing_over_or_at_grade": 34,
        "deck_overlap": 11,
        "ramp_radius": 1,
        "vertical_fallback": 31,
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

  it("lists where a same-surface stretch misses by more than the game makes one slab (MERGE_MAX_DZ), each with why", () => {
    // Unpadded "same" stretches only, every 0.5 m, against the other run's Hermite surface at the
    // nearest point of its centre line (tests/expresswayPairs.ts): the deck builder leaves these
    // apart and logs expressway_merge_skipped. A new entry, or a larger miss, fails here.
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
    const C1 =
      "C1 の内回り・外回りが二層から並列へ移る区間（allowlist.ts C1_CHANGEOVER_REASON、deck_overlap で許可）";
    const JCT = "浜崎橋 JCT（allowlist.ts HAMAZAKIBASHI_REASON）。羽田線への分岐・羽田線からの連結路の端";
    const DROP =
      "出口ランプが本線の床版の縁から離れる最後の数 m で、地表へ下り始める（車線域はもう重ならない）";
    // The rainbow range's (P7): runs that were first written there.
    const SHIBAURA =
      "1 号羽田線・11 号台場線の上下線が二層から並列へ移る区間（芝浦 JCT・浜崎橋とその南の 1 号の二層部。P7 の rainbow 範囲で初めてファイルに出た run）";
    const DAIBA = "台場側で 11 号台場線の上下線が二層から並列へ移る区間（OSM layer 4 / 3）";
    const NOSE = "分合流のノーズで同一面を 0.7 m 未満外れる所（allowlist.ts NOSE_REASON の類型）";
    const expected: Array<{ chunk: string; with: string; s: [number, number]; maxDzM: number; why: string }> =
      [
        { chunk: "24402611:14", with: "45021976", s: [2237.4, 2309.4], maxDzM: 3.64, why: C1 },
        { chunk: "45021976:16", with: "24402611", s: [2754.5, 2799.5], maxDzM: 1.18, why: C1 },
        { chunk: "45021976:17", with: "24402611", s: [2799.9, 2824.9], maxDzM: 3.49, why: C1 },
        { chunk: "24402611:20", with: "45021976", s: [3740.1, 3816.1], maxDzM: 3.76, why: C1 },
        { chunk: "24402611:20", with: "4848762", s: [3806.8, 3814.8], maxDzM: 0.52, why: JCT },
        { chunk: "24402611:20", with: "813455519", s: [3791.8, 3806.3], maxDzM: 2.64, why: `${C1}。${JCT}` },
        { chunk: "45021976:10", with: "24402611", s: [1241.8, 1263.8], maxDzM: 4.17, why: C1 },
        { chunk: "45021976:11", with: "24402611", s: [1264.3, 1321.8], maxDzM: 1.89, why: C1 },
        { chunk: "45021976:11", with: "813455519", s: [1267.3, 1271.3], maxDzM: 0.37, why: JCT },
        { chunk: "45021976:14", with: "4853798", s: [2132, 2136], maxDzM: 0.39, why: DROP },
        { chunk: "4853798:0", with: "45021976", s: [198.6, 202.1], maxDzM: 0.37, why: DROP },
        { chunk: "813455519:1", with: "24402611", s: [306.7, 316.7], maxDzM: 2.89, why: `${C1}。${JCT}` },
        { chunk: "45019020:36", with: "4848740", s: [3534.2, 3537.2], maxDzM: 0.33, why: NOSE },
        { chunk: "45019020:38", with: "4848740", s: [3814.0, 3814.0], maxDzM: 0.16, why: NOSE },
        { chunk: "45019020:39", with: "45554540", s: [4044.4, 4078.9], maxDzM: 3.74, why: SHIBAURA },
        { chunk: "45019020:4", with: "4848762", s: [842.1, 892.1], maxDzM: 3.48, why: DAIBA },
        { chunk: "45019020:9", with: "4848755", s: [1992.8, 1996.8], maxDzM: 0.36, why: NOSE },
        { chunk: "45021972:1", with: "45554540", s: [332.5, 357.0], maxDzM: 3.28, why: SHIBAURA },
        { chunk: "45021972:2", with: "4848762", s: [587.5, 650.5], maxDzM: 1.72, why: SHIBAURA },
        { chunk: "45021972:22", with: "45554540", s: [6101.9, 6135.4], maxDzM: 1.94, why: SHIBAURA },
        { chunk: "45021976:6", with: "45021972", s: [767.3, 769.8], maxDzM: 0.25, why: NOSE },
        { chunk: "45177681:14", with: "4848889", s: [3300.5, 3302.0], maxDzM: 0.27, why: NOSE },
        { chunk: "45554540:27", with: "45019020", s: [7252.6, 7266.1], maxDzM: 3.1, why: SHIBAURA },
        { chunk: "45554540:28", with: "45019020", s: [7266.6, 7282.6], maxDzM: 1.34, why: SHIBAURA },
        { chunk: "45554540:29", with: "45019020", s: [7519.0, 7522.0], maxDzM: 0.23, why: NOSE },
        { chunk: "45554540:29", with: "813455519", s: [7717.9, 7726.9], maxDzM: 0.67, why: NOSE },
        { chunk: "45554540:30", with: "45021972", s: [7792.9, 7817.4], maxDzM: 3.28, why: SHIBAURA },
        { chunk: "45554540:8", with: "45021972", s: [2022.9, 2057.4], maxDzM: 2.06, why: SHIBAURA },
        { chunk: "4848762:1", with: "45021972", s: [482.5, 483.5], maxDzM: 2.03, why: SHIBAURA },
        { chunk: "4848762:2", with: "45021972", s: [484.0, 549.5], maxDzM: 1.9, why: SHIBAURA },
        { chunk: "4848762:33", with: "4848889", s: [2823.0, 2828.0], maxDzM: 0.43, why: NOSE },
        { chunk: "4848762:38", with: "45019020", s: [3932.4, 3982.4], maxDzM: 3.37, why: SHIBAURA },
      ];
    const got = [...found.values()];
    expect(got.map((g) => `${g.chunk}|${g.with}`).toSorted()).toEqual(
      expected.map((e) => `${e.chunk}|${e.with}`).toSorted(),
    );
    for (const e of expected) {
      const g = found.get(`${e.chunk}|${e.with}`)!;
      expect(g.s0, e.chunk).toBeCloseTo(e.s[0], 0);
      expect(g.s1, e.chunk).toBeCloseTo(e.s[1], 0);
      expect(g.maxDzM, `${e.chunk} × ${e.with}: ${e.why}`).toBeLessThanOrEqual(e.maxDzM);
    }
  });

  it("says which format it is (meta.version 4) and that every joint solve converged", () => {
    expect(meta.version).toBe(4);
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
