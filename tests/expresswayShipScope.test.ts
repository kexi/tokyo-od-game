import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpresswayFiles } from "../scripts/expresswayFiles";
import { EXPECTED_EXTRACT_SHA256, EXPECTED_EXTRACT_TIMESTAMP } from "../src/expressway/extract";
import { deckMismatchOf, ReportSchema } from "../src/expressway/report";
import { rampFloorOf } from "../src/expressway/ledger";
import { PROPERTIES, violationsOf } from "../src/expressway/violations";

// The committed baseline scorecard of --range ship (P2.7-1: `just measure-expressway-area` with
// --baseline, no timings) against the default data in public/data/expressway. Rebuild the fixture
// whenever the shipped scope or the compiler changes (knowledge/expressway-generation.md「P2.7-1」).
const DIR = join(import.meta.dirname, "..", "public", "data", "expressway");
// v6: the runs, diagnostics and entrances come from report.json and the tiles (scripts/expresswayFiles.ts).
const meta = readExpresswayFiles(DIR);
const chunks = meta.chunks;
const baseline = ReportSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "expresswayScorecard.ship.json"), "utf8")),
);

describe("出荷範囲の基準スコアカード（tests/fixtures/expresswayScorecard.ship.json）", () => {
  it("is of the pinned extract, has no timings, and is of --range ship with tunnels pruned", () => {
    expect(baseline.extract.timestamp).toBe(EXPECTED_EXTRACT_TIMESTAMP);
    expect(baseline.extract.sha256).toBe(EXPECTED_EXTRACT_SHA256);
    expect(baseline.timings).toBeUndefined();
    expect([baseline.range, baseline.below]).toEqual(["ship", "pruned"]);
  });

  it("ships every main line, ramp and street of the default range (汐留入口, the 臨港道路 included)", () => {
    const wanted = new Set(baseline.scope.wanted);
    const missing = meta.runs.map((r) => r.id).filter((id) => !wanted.has(id));
    expect(missing).toEqual([]);
  });

  it("leaves no ramp of the Rainbow Bridge hanging from a run that is not shipped, and every deck carried", () => {
    // 4848889 (台場出口) ends on the 臨港道路 (45177678), a structure's street.
    expect(baseline.scope.dangling.filter((d) => d.run === "4848889")).toEqual([]);
    expect(baseline.scope.dangling.map((d) => d.parent)).not.toContain("45177678");
    expect(baseline.scope.deckMismatch).toEqual([]);
  });
});

describe("既定データの構造物と検査（P2.7-1 レビュー W1・W3）", () => {
  it("carries every structure deck meta.json lists, and lists every deck carried", () => {
    expect(
      deckMismatchOf(
        meta.runs,
        meta.meta.structures.flatMap((st) => st.decks),
      ),
    ).toEqual([]);
  });

  it("counts no violation of T1〜T7 and T12 on the default data, as the data test finds none", () => {
    // As the build counts them (scripts/expressway.ts): the ledger's ramp floors, and a height build's
    // checks where meta's features name it (S6 PR 7c makes it the default).
    const isHeight = (meta.meta.features ?? []).includes("height-structures");
    const v = violationsOf(meta, chunks, rampFloorOf(meta.ledger), isHeight);
    expect(Object.fromEntries(PROPERTIES.map((p) => [p, v[p].count]))).toEqual(
      Object.fromEntries(PROPERTIES.map((p) => [p, 0])),
    );
  });
});
