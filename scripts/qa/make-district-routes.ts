// A district's drives as a table (P2.7 R1-5 PR B, districtRoutes.ts) from a data folder, written to
// .qa/district-routes/<label>.json with the routes, the street places (the ramps' feet), the runs no
// route reaches and the round's estimate in real time (routeBundles.ts). Not committed: the table is
// made again from the data it is driven on (R1-7's).
//   just make-district-routes <dir> <district> [label]
//   pnpm exec tsx scripts/qa/make-district-routes.ts <dir> <district> [label]
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { districtsOfFiles, readExpresswayFiles } from "../expresswayFiles.ts";
import { districtRoutes } from "./districtRoutes.ts";
import { estimateRound } from "./routeBundles.ts";

const [dirArg, district, labelArg] = process.argv.slice(2);
const isUsage = dirArg === undefined || district === undefined;
if (isUsage) throw new Error("usage: make-district-routes.ts <dir> <district> [label]");
const dir = resolve(dirArg);
const label = labelArg ?? `${basename(dir)}-${district}`;
const files = readExpresswayFiles(dir);
const table = districtRoutes(files, districtsOfFiles(files), district);
const estimate = estimateRound(table.routes);
const out = join(import.meta.dirname, "..", "..", ".qa", "district-routes", `${label}.json`);
mkdirSync(join(out, ".."), { recursive: true });
writeFileSync(out, `${JSON.stringify({ label, dir, ...table, estimate }, null, 2)}\n`);
const kinds: Record<string, number> = {};
for (const r of table.routes) {
  const kind = r.id.split("-")[0];
  kinds[kind] = (kinds[kind] ?? 0) + 1;
}
process.stdout.write(
  `${JSON.stringify({ label, dir, district, out, routes: table.routes.length, kinds, streetPlaces: table.streetPlaces.length, uncovered: table.uncovered.length, estimate })}\n`,
);
