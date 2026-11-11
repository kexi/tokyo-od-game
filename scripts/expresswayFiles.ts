// Reads a data folder of format 6 (public/data/expressway, or a --out folder) for the tests and the
// tools: meta.json, the tiles it lists, report.json and ledger.json (src/expressway/files.ts puts
// them together). The only reader of XW_DATA_DIR: a test or tool pointed at another folder gets it
// from here, so all of them look at the same one.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleFiles, type XwFiles } from "../src/expressway/files.ts";
import type { XwBuildRecord, XwMeta, XwTile } from "../src/expressway/format.ts";
import type { Ledger } from "../src/expressway/ledger.ts";

export const DEFAULT_DATA_DIR = join(import.meta.dirname, "..", "public", "data", "expressway");

/** The data folder the tests read: XW_DATA_DIR, else public/data/expressway. */
export function expresswayDataDir(): string {
  return process.env.XW_DATA_DIR ?? DEFAULT_DATA_DIR;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** ledger.json of a folder, or null where it has none. */
export function readLedger(dir: string): Ledger | null {
  const path = join(dir, "ledger.json");
  return existsSync(path) ? readJson<Ledger>(path) : null;
}

export function readExpresswayFiles(dir = expresswayDataDir()): XwFiles & { dir: string } {
  const meta = readJson<XwMeta>(join(dir, "meta.json"));
  const tiles = new Map(meta.tiles.map((key) => [key, readJson<XwTile>(join(dir, `${key}.json`))]));
  const record = readJson<XwBuildRecord>(join(dir, "report.json"));
  return { ...assembleFiles(meta, tiles, record, readLedger(dir)), dir };
}
