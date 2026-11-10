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
  checkVerticalCurves,
} from "../src/expressway/checks";
import type { XwChunk, XwMeta, XwTile } from "../src/expressway/format";
import { tileKey } from "../src/expressway/geo";
import { isAllowed } from "../src/expressway/allowlist";
import { OPERATOR_WORDS } from "../src/expressway/network";
import { deckOverlaps } from "../src/expressway/overlap";

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
        const mid = Math.floor(c.st.length / 12) * 6;
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

  it("T1・T2: grades within 第20条 and vertical curves within 第22条 on every chunk", () => {
    expect(chunks.flatMap((c) => checkGrade(c, runs.get(c.run)!))).toEqual([]);
    expect(chunks.flatMap(checkVerticalCurves)).toEqual([]);
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
    const counts: Record<string, number> = {};
    for (const d of meta.diagnostics) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    expect(counts).toMatchInlineSnapshot(`
      {
        "crossing_over_or_at_grade": 11,
        "deck_overlap": 8,
        "vertical_fallback": 5,
      }
    `);
  });

  it("deck_overlap: decks over or beside one another are either one surface or a level apart, else recorded (P1 records, P3 fixes)", () => {
    // Recomputed from the tiles alone and compared with what the compiler reported.
    const found = deckOverlaps(chunks).map((o) => `${o.a}|${o.b}`);
    const reported = meta.diagnostics
      .filter((d) => d.kind === "deck_overlap")
      .map((d) => `${d.run}|${/^with (\S+):/.exec(d.detail)![1]}`);
    expect(found.sort()).toEqual(reported.sort());
    const stations = deckOverlaps(chunks).reduce((n, o) => n + o.stations, 0);
    expect(stations).toMatchInlineSnapshot(`177`);
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
