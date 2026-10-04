// Loads the asset register (assets/manifest.yml) for tests/assetManifest.test.ts and for the
// asset page (vite.config.ts serves the resolved register as a JSON module).
import { globSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { parse } from "yaml";
import {
  AssetManifestSchema,
  type AssetEntry,
  type AssetManifest,
  type ResolvedAssetEntry,
  type ResolvedAssetManifest,
} from "../src/data/assetManifest.ts";

export const MANIFEST_PATH = "assets/manifest.yml";

/** Folders whose every file must belong to some entry. public/data is open data, not assets. */
export const SCANNED = { roots: ["assets", "public"], skip: ["public/data/", MANIFEST_PATH] };

const toPosix = (p: string) => p.split(sep).join("/");
const isFile = (root: string, p: string) =>
  statSync(join(root, p), { throwIfNoEntry: false })?.isFile() ?? false;
const listOf = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Parsed and schema-checked register (throws with the zod issues when it is malformed). */
export function loadManifest(root: string): AssetManifest {
  return AssetManifestSchema.parse(parse(readFileSync(join(root, MANIFEST_PATH), "utf8")));
}

/** Files (not folders) one path or glob matches, repo-relative and sorted. */
export function matchFiles(root: string, pattern: string): string[] {
  return globSync(pattern, { cwd: root })
    .map(toPosix)
    .filter((p) => isFile(root, p))
    .toSorted();
}

export function resolveEntry(root: string, entry: AssetEntry): ResolvedAssetEntry {
  const paths = [...new Set(entry.files.flatMap((f) => matchFiles(root, f)))].toSorted();
  const generator = entry.generator && {
    scripts: listOf(entry.generator.script),
    recipe: entry.generator.recipe,
  };
  return { ...entry, generator, made_by: listOf(entry.made_by), license: listOf(entry.license), paths };
}

export function resolveManifest(root: string, manifest = loadManifest(root)): ResolvedAssetManifest {
  return { ...manifest, assets: manifest.assets.map((e) => resolveEntry(root, e)) };
}

/** Every file under the scanned folders, repo-relative (Finder's .DS_Store aside). */
export function scannedFiles(root: string): string[] {
  return SCANNED.roots
    .flatMap((dir) => matchFiles(root, `${dir}/**/*`))
    .filter((p) => !SCANNED.skip.some((s) => p === s || p.startsWith(s)))
    .filter((p) => !p.endsWith(".DS_Store"));
}

/** Recipe names the justfile defines (`name args…:` at the start of a line, not `name :=`). */
export function justRecipes(justfile: string): Set<string> {
  const names = justfile
    .split("\n")
    .map((line) => line.match(/^@?([A-Za-z_][\w-]*)[^:\n]*:(?!=)/)?.[1])
    .filter((n): n is string => n !== undefined);
  return new Set(names);
}
