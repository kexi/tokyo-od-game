// Collects licence texts of third-party code that ends up in the browser bundle, so the
// GitHub Pages build ships THIRD_PARTY_LICENSES.txt (MIT/BSD/Apache-2.0 all require it).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Entry = { name: string; license: string; text: string };

const BUNDLED = [
  "three",
  "3d-tiles-renderer",
  "@dimforge/rapier3d-compat",
  "zod",
  "@mapbox/vector-tile",
  "@mapbox/point-geometry",
  "pbf",
  "pmtiles",
  "fflate",
  "@litert-lm/core",
];

function packageDir(root: string, name: string): string | null {
  const direct = join(root, "node_modules", name);
  if (existsSync(join(direct, "package.json"))) return direct;
  // pnpm keeps transitive deps under node_modules/.pnpm/<name>@<version>/node_modules/<name>.
  const store = join(root, "node_modules", ".pnpm");
  const prefix = `${name.replace("/", "+")}@`;
  const hit = readdirSync(store).find((d) => d.startsWith(prefix));
  return hit ? join(store, hit, "node_modules", name) : null;
}

function readLicense(dir: string): string {
  const file = readdirSync(dir).find((f) => /^(license|licence|copying)(\.|$)/i.test(f));
  return file ? readFileSync(join(dir, file), "utf8").trim() : "(licence file not found in package)";
}

export function collectLicenses(root: string): string {
  const entries: Entry[] = [];
  for (const name of BUNDLED) {
    const dir = packageDir(root, name);
    if (!dir) continue;
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      version: string;
      license?: string;
    };
    entries.push({
      name: `${name}@${pkg.version}`,
      license: pkg.license ?? "UNKNOWN",
      text: readLicense(dir),
    });
  }
  // The Draco decoder is copied from three's examples folder, which carries no licence file.
  const tiles = packageDir(root, "3d-tiles-renderer");
  const apache = tiles ? readLicense(tiles).replace(/^[\s\S]*?(Apache License)/, "$1") : "";
  entries.push({
    name: "Draco 3D decoder (https://github.com/google/draco), Copyright Google LLC",
    license: "Apache-2.0",
    text: apache.replace(/Copyright \d{4} California Institute of Technology\s*$/m, "").trim(),
  });
  const header =
    "TOKYO OPEN DRIVE — third-party software notices\n" +
    "This file lists open-source software bundled in the published web build.\n" +
    "Data sources and their attribution are listed in the in-game 出典 dialog and README.md.\n";
  return [
    header,
    ...entries.map((e) => `${"=".repeat(78)}\n${e.name} — ${e.license}\n${"-".repeat(78)}\n${e.text}\n`),
  ].join("\n");
}
