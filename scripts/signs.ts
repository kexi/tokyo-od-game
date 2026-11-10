// The road sign definitions (src/signs/defs) written out: assets/signs/registry.json (checked
// definitions with their figures and painters, which scripts/textures/sign_textures.py draws from)
// and assets/signs/catalog.json (the older table, in the bytes catalog.py once wrote).
// knowledge/sign-system.md.
// Run: pnpm exec tsx scripts/signs.ts            (just make-sign-registry)
//      pnpm exec tsx scripts/signs.ts coverage   (just show-sign-coverage: undrawn / not placed)
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { log } from "../src/log.ts";
import { formatCatalog } from "../src/signs/catalog.ts";
import { formatCoverage, signCoverage } from "../src/signs/coverage.ts";
import { formatRegistry } from "../src/signs/registry.ts";
import { loadRegistry } from "./signInputs.ts";

const ROOT = join(import.meta.dirname, "..");
const SIGNS_DIR = join(ROOT, "assets", "signs");
const REGISTRY = join(SIGNS_DIR, "registry.json");
const CATALOG = join(SIGNS_DIR, "catalog.json");

const { law, registry } = loadRegistry(ROOT);

async function write(): Promise<void> {
  await writeFile(REGISTRY, formatRegistry(registry));
  await writeFile(CATALOG, formatCatalog(registry));
  const coverage = signCoverage(registry, law);
  log("sign_registry_written", {
    files: [REGISTRY, CATALOG].map((f) => relative(ROOT, f)),
    signs: coverage.total,
    drawn: coverage.drawn,
    lanes: registry.lanes.length,
  });
}

const isCoverage = process.argv[2] === "coverage";
if (isCoverage) process.stdout.write(formatCoverage(signCoverage(registry, law)));
else await write();
