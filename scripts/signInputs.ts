// The inputs of the sign registry read from the repository: the law table, the definitions and the
// lane patterns (from the game's assumedLanes and public/data/turnlanes). Shared by scripts/signs.ts
// and tests/signRegistry.test.ts so the freshness check builds exactly what the script writes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGN_DEFS } from "../src/signs/defs/index.ts";
import { laneRenders } from "../src/signs/defs/lanes.ts";
import { buildRegistry, type Registry } from "../src/signs/registry.ts";
import { LawTableSchema, type LawTable, type LaneRender } from "../src/signs/schema.ts";
import { assumedLanes } from "../src/world/regulations.ts";

/** A z14 tile of public/data/turnlanes (meta.json, the tile list, is not one). */
const TILE_FILE = /^\d+-\d+\.json$/;

/** The turn:lanes values of public/data/turnlanes: tiles in file-name order, rows in order. */
export function turnlaneValues(root: string): string[] {
  const dir = join(root, "public", "data", "turnlanes");
  return readdirSync(dir)
    .filter((f) => TILE_FILE.test(f))
    .toSorted()
    .flatMap((f) =>
      (JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<[number, number, number, string]>).map(
        (r) => r[3],
      ),
    );
}

export function readLawTable(root: string): LawTable {
  return LawTableSchema.parse(
    JSON.parse(readFileSync(join(root, "assets", "signs", "law-table.json"), "utf8")),
  );
}

export function signLaneRenders(root: string): LaneRender[] {
  return laneRenders({ turnlanes: turnlaneValues(root), assumed: assumedLanes });
}

export function loadRegistry(root: string): { law: LawTable; registry: Registry } {
  const law = readLawTable(root);
  return { law, registry: buildRegistry(SIGN_DEFS, signLaneRenders(root), law) };
}
