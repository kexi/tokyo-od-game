// The cases of a data folder (P2.7-4), counted as the ledger tool (scripts/expresswayLedger.ts) and
// the ledger test (tests/expresswayLedger.test.ts) both count them: the diagnostics' (deck overlaps,
// tunnel cover, ramp radii, ambiguous crossings, src/expressway/ledger.ts caseOfDiagnostic) and the
// merged decks' (seams, holes, stretches drawn apart, let-go points, scripts/expresswaySeams.ts),
// each with its district (src/expressway/districts.ts) and its blocks' dataHash (report.json); and the
// height budget's (P2.7-5): the high-deck stretches and the km over 15 and 20 m (src/expressway/highDeck.ts).
import RAPIER from "@dimforge/rapier3d-compat";
import { assignDistricts, type District, districtRunsOf } from "../src/expressway/districts.ts";
import type { XwFiles } from "../src/expressway/files.ts";
import {
  blocksOf,
  caseContextOf,
  diagnosticCases,
  type FoundCase,
  ruleCounts,
  seamCases,
} from "../src/expressway/ledger.ts";
import { STATION_STRIDE } from "../src/expressway/format.ts";
import { deckOverlaps } from "../src/expressway/overlap.ts";
import { heightKmOf, type HeightKm, highDeckStretches } from "../src/expressway/highDeck.ts";
import { lowViaductStretches, openGroundStretches } from "../src/expressway/heightStructures.ts";
import { GIRDER_DEPTH } from "../src/expressway/assumptions.ts";
import { MERGE_FULL_DZ, MERGE_MAX_DZ } from "../src/world/expresswayMerge.ts";
import { framesOf, mergeMisses, probeGenerated } from "./expresswaySeams.ts";

export type CountedCase = FoundCase & { district: District; block: string; blockHash: string };

export type Counted = {
  found: CountedCase[];
  seamProbes: number;
  rules: Record<string, number>;
  districts: Map<string, District>;
  heightKm: HeightKm;
  /** Each overlapping pair's stretch per run (overlap.ts deckOverlaps): what a merge_skipped follows. */
  pairSpans: Map<string, Record<string, Array<[number, number]>>>;
};

/** The high-deck cases of the written runs (one per stretch, numbered along the run). */
function highDeckCases(byRun: ReadonlyMap<string, XwFiles["chunks"]>): FoundCase[] {
  const out: FoundCase[] = [];
  for (const run of [...byRun.keys()].sort()) {
    highDeckStretches(byRun.get(run)!).forEach((h, i) => {
      out.push({
        key: `high-deck:${run}|${i}`,
        kind: "high-deck",
        run,
        with: null,
        chunk:
          byRun.get(run)!.find((c) => c.st[0] <= h.s0 && c.st[c.st.length - STATION_STRIDE] >= h.s0)?.id ??
          null,
        measured: { s0: h.s0, s1: h.s1, heightM: h.heightM, spanM: h.spanM },
      });
    });
  }
  return out;
}

/**
 * A height build's cases (P2.7-6 PR 1): each embankment and cut stretch of a viaduct-tagged run
 * (numbered along the run, as high-deck) and each viaduct chunk on a girder thinner than GIRDER_DEPTH.
 * A build by the tags has none.
 */
function structureCases(
  byRun: ReadonlyMap<string, XwFiles["chunks"]>,
  runs: XwFiles["runs"],
  isHeight: boolean,
): FoundCase[] {
  // Only a height build's summaries say which runs are below runs (`below`); otherwise by the chunks.
  const below = new Set(runs.filter((r) => r.below === true).map((r) => r.id));
  // A build by the tags has none (its viaducts low near their ends are no low-viaduct: nothing was classified).
  if (!isHeight) return [];
  const isBelow = (run: string) => below.has(run);
  const atGrade = new Set(runs.filter((r) => r.ground === true).map((r) => r.id));
  const out: FoundCase[] = [];
  for (const run of [...byRun.keys()].sort()) {
    const list = byRun.get(run)!;
    // A run at grade (S6 PR 2) is cuts and embankments by what it is: one case, how far it stands off
    // the ground, by rule within its band (review W6: as the viaducts' stretches 97 were listed).
    const isAtGrade = atGrade.has(run);
    if (isAtGrade) {
      let off = 0;
      for (const c of list)
        for (let i = 0; i < c.st.length; i += STATION_STRIDE)
          off = Math.max(off, Math.abs(c.st[i + 3] - c.st[i + 5]));
      const last = list[list.length - 1];
      out.push({
        key: `ground-stretch:${run}`,
        kind: "ground-stretch",
        run,
        with: null,
        chunk: list[0].id,
        measured: { lengthM: last.st[last.st.length - STATION_STRIDE], heightM: Math.round(off * 100) / 100 },
      });
      continue;
    }
    const numbered = { cut: 0, embankment: 0 };
    for (const h of openGroundStretches(list, isBelow(run))) {
      const kind = h.structure === "cut" ? "cut-stretch" : "embankment-stretch";
      // Both with their depth under the ground (R1: an embankment under it past the band is listed).
      const measured = { s0: h.s0, s1: h.s1, lengthM: h.lengthM, depthM: h.depthM };
      out.push({
        key: `${kind}:${run}|${numbered[h.structure]++}`,
        kind,
        run,
        with: null,
        chunk: h.chunk,
        measured,
      });
    }
    lowViaductStretches(list, isBelow(run)).forEach((h, i) => {
      out.push({
        key: `low-viaduct:${run}|${i}`,
        kind: "low-viaduct",
        run,
        with: null,
        chunk: h.chunk,
        measured: { s0: h.s0, s1: h.s1, lengthM: h.lengthM, heightM: h.lowM },
      });
    });
    for (const c of list) {
      const isThin =
        c.structure === "viaduct" && c.over === null && c.girder > 0 && c.girder < GIRDER_DEPTH.value;
      if (!isThin) continue;
      out.push({
        key: `thin-girder:${c.id}`,
        kind: "thin-girder",
        run,
        with: null,
        chunk: c.id,
        measured: { s0: c.st[0], s1: c.st[c.st.length - STATION_STRIDE], girderM: c.girder },
      });
    }
  }
  return out;
}

/**
 * A case's district: its run's, else its partner's, else that of a written run of the same block
 * (the first by id). Why the block: a run of the needed components outside the range has no chunk to
 * place it (the default data's ramp-radius:203873831), but it is solved with the range's runs.
 */
function caseDistrict(
  runs: readonly string[],
  districts: ReadonlyMap<string, District>,
  files: XwFiles,
): District {
  for (const r of runs) {
    const d = districts.get(r);
    if (d) return d;
  }
  const blockRuns = files.record.blocks
    .filter((b) => runs.some((r) => b.runs.includes(r)))
    .flatMap((b) => b.runs)
    .filter((r) => districts.has(r))
    .sort();
  return blockRuns.length > 0 ? districts.get(blockRuns[0])! : "outside";
}

export async function countCases(files: XwFiles): Promise<Counted> {
  await RAPIER.init();
  const ctx = caseContextOf(files.runs, files.record.untied, files.chunks);
  const fromDiagnostics = diagnosticCases(files.diagnostics, ctx);
  const probed = probeGenerated(files.chunks, files.runs, framesOf(files.tiles, files.meta.zoom));
  const fromDecks = seamCases(probed.seams, probed.cuts, mergeMisses(files.chunks), {
    fullDz: MERGE_FULL_DZ,
    maxDz: MERGE_MAX_DZ,
  });
  for (const w of probed.worlds) w.free();
  const districts = assignDistricts(districtRunsOf(files.runs, files.byRun));
  const found = [
    ...fromDiagnostics,
    ...fromDecks,
    ...highDeckCases(files.byRun),
    ...structureCases(files.byRun, files.runs, (files.meta.features ?? []).includes("height-structures")),
  ].map((c) => {
    const runs = c.with === null ? [c.run] : [c.run, c.with];
    return { ...c, district: caseDistrict(runs, districts, files), ...blocksOf(files.record.blocks, runs) };
  });
  const heightKm = heightKmOf(files.byRun, (run) => districts.get(run) ?? "outside");
  return {
    found,
    seamProbes: probed.seams.length,
    rules: ruleCounts(files.diagnostics),
    districts,
    heightKm,
    pairSpans: new Map(deckOverlaps(files.chunks).map((o) => [`${o.a}|${o.b}`, o.spans])),
  };
}
