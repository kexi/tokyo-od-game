import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  justRecipes,
  loadManifest,
  matchFiles,
  resolveManifest,
  scannedFiles,
} from "../scripts/assetManifest";

const root = join(import.meta.dirname, "..");
// loadManifest runs the zod schema, so a missing required field fails here with its path.
const manifest = loadManifest(root);
const resolved = resolveManifest(root, manifest);
const exists = (p: string) => existsSync(join(root, p));

describe("asset register (assets/manifest.yml)", () => {
  it("gives every entry the required fields and a unique kebab-case id", () => {
    const ids = manifest.assets.map((e) => e.id);
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicated).toEqual([]);
  });

  it("covers every file in assets/ and public/ (open data aside) with an entry", () => {
    const owned = new Set(resolved.assets.flatMap((e) => [...e.paths, ...(e.docs ?? [])]));
    const unmanaged = scannedFiles(root).filter((f) => !owned.has(f));
    expect(unmanaged).toEqual([]);
  });

  it("gives each file a single owning entry", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const e of resolved.assets) {
      for (const p of e.paths) {
        const other = owner.get(p);
        if (other) clashes.push(`${p}: ${other} / ${e.id}`);
        owner.set(p, e.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("matches at least one file with every files path or glob, and names docs that exist", () => {
    const empty = manifest.assets.flatMap((e) =>
      e.files.filter((f) => matchFiles(root, f).length === 0).map((f) => `${e.id}: ${f}`),
    );
    const missingDocs = manifest.assets.flatMap((e) =>
      (e.docs ?? []).filter((d) => !exists(d)).map((d) => `${e.id}: ${d}`),
    );
    expect(empty).toEqual([]);
    expect(missingDocs).toEqual([]);
  });

  it("names generator scripts that exist and recipes the justfile defines", () => {
    const recipes = justRecipes(readFileSync(join(root, "justfile"), "utf8"));
    const missingScripts = resolved.assets.flatMap((e) =>
      (e.generator?.scripts ?? []).filter((s) => !exists(s)).map((s) => `${e.id}: ${s}`),
    );
    const unknownRecipes = resolved.assets
      .filter((e) => e.generator?.recipe !== undefined && !recipes.has(e.generator.recipe))
      .map((e) => `${e.id}: just ${e.generator?.recipe}`);
    expect(missingScripts).toEqual([]);
    expect(unknownRecipes).toEqual([]);
  });

  it("points used_by at source files, inputs at entries and licences at the licences table", () => {
    const ids = new Set(manifest.assets.map((e) => e.id));
    const missingUsers = resolved.assets.flatMap((e) =>
      e.used_by.filter((u) => !exists(u)).map((u) => `${e.id}: ${u}`),
    );
    const unknownInputs = resolved.assets.flatMap((e) =>
      (e.inputs ?? []).filter((i) => !ids.has(i) || i === e.id).map((i) => `${e.id}: ${i}`),
    );
    const unknownLicences = resolved.assets.flatMap((e) =>
      e.license.filter((l) => !(l in manifest.licenses)).map((l) => `${e.id}: ${l}`),
    );
    expect(missingUsers).toEqual([]);
    expect(unknownInputs).toEqual([]);
    expect(unknownLicences).toEqual([]);
  });

  it("marks an asset unused exactly when nothing loads it and no used asset is built from it", () => {
    const byId = new Map(resolved.assets.map((e) => [e.id, e]));
    const isUsed = (id: string, seen = new Set<string>()): boolean => {
      const e = byId.get(id);
      if (!e || seen.has(id)) return false;
      seen.add(id);
      if (e.status === "unused") return false;
      const isLoaded = e.used_by.length > 0;
      return isLoaded || resolved.assets.some((u) => u.inputs?.includes(id) && isUsed(u.id, seen));
    };
    const wronglyActive = resolved.assets
      .filter((e) => e.status !== "unused" && !isUsed(e.id))
      .map((e) => e.id);
    const wronglyUnused = resolved.assets
      .filter((e) => e.status === "unused" && e.used_by.length > 0)
      .map((e) => e.id);
    expect(wronglyActive).toEqual([]);
    expect(wronglyUnused).toEqual([]);
  });
});
