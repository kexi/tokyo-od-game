import {
  STATION_STRIDE,
  type XwBuildRecord,
  type XwChunk,
  type XwClosed,
  type XwDiagnostic,
  type XwEntrance,
  type XwMeta,
  type XwRunSummary,
  type XwTile,
  type XwTileRun,
} from "./format";
import { tileKey } from "./geo";
import type { Ledger } from "./ledger";
import { compareChunks } from "./ranges";

/**
 * A data folder of format 6 (public/data/expressway or a --out folder) put together: the one shape
 * the tests and the tools read (P2.7-4). Pure: scripts/expresswayFiles.ts reads the files and hands
 * them here. Why one reader: before v6 every test parsed meta.json itself and took the runs, the
 * diagnostics and the entrances from it; now they live in three places (tiles, report.json, the
 * ledger) and a test reading only one of them would see part of the data.
 */
export type XwFiles = {
  meta: XwMeta;
  /** The tiles by key, in meta's order. */
  tiles: Map<string, XwTile>;
  /** Every chunk, tile by tile. */
  chunks: XwChunk[];
  /** The chunks of each run, by k. */
  byRun: Map<string, XwChunk[]>;
  record: XwBuildRecord;
  /** The full run summaries (report.json) and by id. */
  runs: XwRunSummary[];
  runById: Map<string, XwRunSummary>;
  diagnostics: XwDiagnostic[];
  closed: XwClosed[];
  /** The entrances of every tile, by run. */
  entrances: XwEntrance[];
  /** ledger.json, or null where the folder has none (a measuring folder before the ledger tool). */
  ledger: Ledger | null;
};

export function assembleFiles(
  meta: XwMeta,
  tiles: Map<string, XwTile>,
  record: XwBuildRecord,
  ledger: Ledger | null,
): XwFiles {
  const chunks = [...tiles.values()].flatMap((t) => t.chunks);
  const byRun = new Map<string, XwChunk[]>();
  for (const c of chunks) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  for (const list of byRun.values()) list.sort((a, b) => a.k - b.k);
  const entrances = [...tiles.values()]
    .flatMap((t) => t.entrances ?? [])
    .sort((a, b) => (a.run < b.run ? -1 : a.run > b.run ? 1 : 0));
  return {
    meta,
    tiles,
    chunks,
    byRun,
    record,
    runs: record.runs,
    runById: new Map(record.runs.map((r) => [r.id, r])),
    diagnostics: record.diagnostics,
    closed: record.closed,
    entrances,
    ledger,
  };
}

/** The tile a chunk is filed under: the z14 tile of its middle station. */
export function tileOfChunk(chunk: XwChunk, zoom: number): string {
  const mid = Math.floor(chunk.st.length / (2 * STATION_STRIDE)) * STATION_STRIDE;
  return tileKey(chunk.st[mid + 1], chunk.st[mid + 2], zoom);
}

/** What a tile carries of a run (XwTileRun), its fields in this order. */
export function tileRunOf(r: XwRunSummary): XwTileRun {
  return { id: r.id, cls: r.cls, start: r.start, end: r.end };
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The tiles of format 6 (scripts/expressway.ts writes them as they come): each chunk under its middle
 * station (chunks in compareChunks order, as before v6), the summary of every run with a chunk in
 * the tile (by id), and each entrance under the tile of its ground end (by run; a tile with no chunk
 * is made for it, so the game reads every entrance). Keys sorted.
 */
export function packTiles(
  chunks: readonly XwChunk[],
  runs: readonly XwRunSummary[],
  entrances: readonly XwEntrance[],
  zoom: number,
): Map<string, XwTile> {
  const byKey = new Map<string, { chunks: XwChunk[]; entrances: XwEntrance[] }>();
  const slot = (key: string) => {
    const t = byKey.get(key) ?? { chunks: [], entrances: [] };
    byKey.set(key, t);
    return t;
  };
  for (const c of chunks) slot(tileOfChunk(c, zoom)).chunks.push(c);
  for (const e of entrances) slot(tileKey(e.lon, e.lat, zoom)).entrances.push(e);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const out = new Map<string, XwTile>();
  for (const key of [...byKey.keys()].sort()) {
    const t = byKey.get(key)!;
    t.chunks.sort(compareChunks);
    const ids = [...new Set(t.chunks.map((c) => c.run))];
    const tileRuns = ids
      .map((id) => runById.get(id))
      .filter((r): r is XwRunSummary => r !== undefined)
      .map(tileRunOf)
      .sort(byId);
    const tile: XwTile = { chunks: t.chunks, runs: tileRuns };
    const hasEntrances = t.entrances.length > 0;
    if (hasEntrances)
      tile.entrances = t.entrances.toSorted((a, b) => (a.run < b.run ? -1 : a.run > b.run ? 1 : 0));
    out.set(key, tile);
  }
  return out;
}
