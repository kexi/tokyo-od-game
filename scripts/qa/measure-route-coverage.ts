// How much of a district a generated drive table drives (R1-5 PR B B3, routeCoverage.ts), one JSON
// line; exit 1 when a written run is left without a route and without a reason.
//   just measure-route-coverage <dir> <table.json>
//   pnpm exec tsx scripts/qa/measure-route-coverage.ts <dir> <table.json>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { districtsOfFiles, readExpresswayFiles } from "../expresswayFiles.ts";
import type { DistrictTable } from "./districtRoutes.ts";
import { routeCoverage } from "./routeCoverage.ts";

const [dirArg, tableArg] = process.argv.slice(2);
const isUsage = dirArg === undefined || tableArg === undefined;
if (isUsage) throw new Error("usage: measure-route-coverage.ts <dir> <table.json>");
const files = readExpresswayFiles(resolve(dirArg));
const table = JSON.parse(readFileSync(tableArg, "utf8")) as DistrictTable;
const coverage = routeCoverage(files, districtsOfFiles(files), table.district, table.routes, table.uncovered);
process.stdout.write(
  `${JSON.stringify({ dir: resolve(dirArg), table: tableArg, district: table.district, ...coverage })}\n`,
);
const hasGap = coverage.undriven.some((u) => u.why.startsWith("no route"));
process.exit(hasGap ? 1 : 0);
