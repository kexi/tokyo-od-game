import { z } from "zod";

/**
 * Shape of assets/manifest.yml, the asset register: one entry per asset (a model, a texture set,
 * a font …) with its name, purpose, generator, origin and licence. scripts/assetManifest.ts
 * parses it for tests/assetManifest.test.ts and for the asset page (vite.config.ts hands the
 * page the result as JSON, so this module is only imported as types there).
 */
export const ASSET_KINDS = ["model", "texture", "image", "data", "font", "audio"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

// procedural = Claude Code wrote the generator, agy = Antigravity wrote it (then reviewed),
// unknown = no record of who wrote it.
export const MAKERS = ["blender-cli", "procedural", "agy", "external", "unknown"] as const;
export type Maker = (typeof MAKERS)[number];
const GENERATED: readonly Maker[] = ["blender-cli", "procedural", "agy"];

const oneOrMany = <T extends z.ZodType>(item: T) => z.union([item, z.array(item).min(1)]);
const repoPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), "リポジトリ相対のパスにする");

export const LicenseSchema = z.strictObject({
  name: z.string().min(1),
  url: z.string().min(1),
  notes: z.string().optional(),
});

export const AssetEntrySchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case にする"),
    name: z.string().min(1),
    purpose: z.string().min(1),
    kind: z.enum(ASSET_KINDS),
    /** Repo-relative paths or globs (fs.globSync syntax). Empty only for remote-only assets. */
    files: z.array(repoPath),
    /** Fetched instead of committed (fonts): where from, and the pinned hash when there is one. */
    remote: z
      .strictObject({
        url: z.url(),
        sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
      })
      .optional(),
    generator: z
      .strictObject({ script: oneOrMany(repoPath), recipe: z.string().min(1).optional() })
      .optional(),
    made_by: oneOrMany(z.enum(MAKERS)),
    source: z.string().min(1),
    /** Keys of the manifest's licenses table. */
    license: oneOrMany(z.string().min(1)),
    /** Source files that load it at runtime (empty when it only goes into another asset). */
    used_by: z.array(repoPath),
    /** Ids of the assets this one is built from (a model's texture sets). */
    inputs: z.array(z.string()).optional(),
    docs: z.array(repoPath).optional(),
    status: z.enum(["active", "unused"]).optional(),
    notes: z.string().optional(),
  })
  .refine((e) => e.files.length > 0 || e.remote !== undefined, "files か remote のどちらかが要る")
  .refine(
    (e) => e.generator !== undefined || ![e.made_by].flat().some((m) => GENERATED.includes(m)),
    "生成物（blender-cli / procedural / agy）には generator が要る",
  );

export const AssetManifestSchema = z.strictObject({
  version: z.literal(1),
  licenses: z.record(z.string(), LicenseSchema),
  assets: z.array(AssetEntrySchema).min(1),
});

export type AssetLicense = z.infer<typeof LicenseSchema>;
export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

/** An entry as the asset page gets it: one-or-many fields as arrays, globs expanded to files. */
export type ResolvedAssetEntry = Omit<AssetEntry, "generator" | "made_by" | "license"> & {
  generator?: { scripts: string[]; recipe?: string };
  made_by: Maker[];
  license: string[];
  /** Repo-relative files the entry's patterns match, sorted. */
  paths: string[];
};
export type ResolvedAssetManifest = Omit<AssetManifest, "assets"> & { assets: ResolvedAssetEntry[] };
