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
import { heightKmOf, type HeightKm, highDeckStretches } from "../src/expressway/highDeck.ts";
import { MERGE_FULL_DZ, MERGE_MAX_DZ } from "../src/world/expresswayMerge.ts";
import { framesOf, mergeMisses, probeGenerated } from "./expresswaySeams.ts";

export type CountedCase = FoundCase & { district: District; block: string; blockHash: string };

export type Counted = {
  found: CountedCase[];
  seamProbes: number;
  rules: Record<string, number>;
  districts: Map<string, District>;
  heightKm: HeightKm;
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
  const found = [...fromDiagnostics, ...fromDecks, ...highDeckCases(files.byRun)].map((c) => {
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
  };
}
