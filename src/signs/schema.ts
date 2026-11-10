import { z } from "zod";
import { PLATES } from "./plates";

/**
 * The shape of a road sign definition (src/signs/defs/*.ts), the one place a sign is described:
 * scripts/signs.ts checks every definition against these schemas and writes them out as
 * assets/signs/registry.json, and from it the older assets/signs/catalog.json (knowledge/sign-system.md).
 *
 * Each face names its PNG and the Pillow function that draws it (`paint`, which
 * scripts/textures/sign_textures.py reads from registry.json); what varies (lanes, numbers, words)
 * is flagged by `variable`. The fuller schema of the design (colours, scale, mount,
 * retroreflection) lands with the phases that read it (G2–G4), so nothing here is a field no one
 * fills.
 */

export const SIGN_GROUPS = ["案内", "警戒", "規制", "指示", "補助", "法定外"] as const;
export type SignGroup = (typeof SIGN_GROUPS)[number];

export const PLATE_SHAPES = ["circle", "triangle_down", "diamond", "square", "rect", "pentagon"] as const;

/** A node name of public/models/signs.glb that holds a plate. */
export type PlateNode = keyof typeof PLATES;
const PLATE_NODES = Object.keys(PLATES) as [PlateNode, ...PlateNode[]];
const PlateNodeSchema = z.enum(PLATE_NODES);

/** [width, height] in mm. */
const SizeMm = z.tuple([z.number().positive(), z.number().positive()]);

export const PlateSchema = z.strictObject({ shape: z.enum(PLATE_SHAPES), sizeMm: SizeMm });
export type Plate = z.infer<typeof PlateSchema>;

/** A file of assets/signs/textures. */
const PngFile = z.string().regex(/^[^/\\\s]+\.png$/, "assets/signs/textures のファイル名にする");

/** 別表第一 numbers (327の7-A, 108の2-C, 327の4の2); x-… for signs outside the 命令. */
export const SIGN_ID = /^(\d{3}(の\d+)*(-[A-Z])?|x-[a-z0-9]+(-[a-z0-9]+)*)$/;
const isNonStatutoryId = (id: string) => id.startsWith("x-");

/** The Python modules of scripts/textures whose functions draw sign faces (registry.json painterModules: sign_textures.py imports only these). */
export const PAINTER_MODULES = [
  "sign_textures",
  "warning",
  "regulatory",
  "instruction",
  "auxiliary",
  "nonstatutory",
] as const;
const PAINTER_NAME = new RegExp(`^(${PAINTER_MODULES.join("|")})\\.[a-z][a-z0-9_]*$`);

/**
 * The Pillow function drawing a face: `module.function` of scripts/textures (sign_textures.py, or
 * signs/<module>.py), called with `args` as keyword arguments. `over` names a PNG drawn earlier in
 * the same run that the function draws on (the hours over 316, 備考一(一)35); it is passed first.
 * Lane renders have none: lanes.lane_sign draws them from their key.
 */
export const PaintSchema = z.strictObject({
  fn: z.string().regex(PAINTER_NAME, "scripts/textures の module.function にする"),
  args: z.record(z.string(), z.json()).optional(),
  over: PngFile.optional(),
});
export type Paint = z.infer<typeof PaintSchema>;

export const VariantSchema = z.strictObject({
  /** What tells it apart (`left`, `8-20`, `kyujitsu`). */
  key: z.string().min(1),
  file: PngFile,
  paint: PaintSchema.optional(),
  /** Its own plate when it is not the sign's (a two-line 補助標識, the old square 407-A). */
  plate: PlateNodeSchema.optional(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const ArtSchema = z.discriminatedUnion("by", [
  /** Drawn: the default face and the other faces of the same number. */
  z.strictObject({
    by: z.literal("texture"),
    file: PngFile,
    /** Required unless the file is a lane render (registry.ts checks). */
    paint: PaintSchema.optional(),
    variants: z.array(VariantSchema).default([]),
  }),
  /** Not drawn, and why. */
  z.strictObject({ by: z.literal("none"), reason: z.string().min(1) }),
]);
export type Art = z.infer<typeof ArtSchema>;

export const SignDefSchema = z
  .strictObject({
    id: z.string().regex(SIGN_ID, "別表第一の番号か x- で始まる名前にする"),
    /** 別表第一の種類 (for 法定外, what the plate is). */
    name: z.string().min(1),
    group: z.enum(SIGN_GROUPS),
    /**
     * null only for signs with no art (案内). May be omitted with `shares`: it is then the shared
     * number's plate (given, it must be that plate; buildRegistry checks).
     */
    plate: PlateNodeSchema.nullable().optional(),
    /** Omitted when `shares` borrows another number's art (and plate). */
    art: ArtSchema.optional(),
    /** The number whose plate this one is shown on, with a 補助標識 under it (備考一(一)34). */
    shares: z.string().regex(SIGN_ID).optional(),
    /** The face depends on the place: a lane list, or a number / words (図示は例示). */
    variable: z.enum(["lanes", "text"]).optional(),
    /** Where the design comes from, for signs outside the 命令 (statutory ones cite the law table). */
    source: z.url().optional(),
    /** Where the size comes from when it is not 別表第二 (補助標識: 交通規制基準). */
    sizeSource: z.url().optional(),
    note: z.string().min(1).optional(),
    /** The game's sign type (regulations.ts SIGN key) drawn with this number. */
    game: z.strictObject({ kind: z.string().min(1) }).optional(),
  })
  .refine((d) => (d.shares === undefined) !== (d.art === undefined), {
    message: "art か shares のどちらか一方だけを書く",
  })
  .refine((d) => d.plate !== null || d.art?.by === "none", {
    message: "図柄のある標識には plate が要る",
  })
  .refine((d) => d.plate !== undefined || d.shares !== undefined, {
    message: "plate を省けるのは shares のときだけ",
  })
  .refine((d) => isNonStatutoryId(d.id) === (d.group === "法定外"), {
    message: "x- の名前は法定外だけに使う",
  })
  .refine((d) => !isNonStatutoryId(d.id) || d.source !== undefined, {
    message: "法定外には source（根拠）が要る",
  });
export type SignDef = z.infer<typeof SignDefSchema>;

/** A definition as written in defs/: the group comes from the file (see `group`). */
export type SignDefInput = Omit<z.input<typeof SignDefSchema>, "group" | "plate"> & {
  plate?: PlateNode | null;
};

/** The definitions of one group, each tagged with it. */
export function group(name: SignGroup, defs: SignDefInput[]): Array<SignDefInput & { group: SignGroup }> {
  return defs.map((d) => ({ ...d, group: name }));
}

/** Lane letters of the pre-rendered 進行方向別通行区分 (scripts/textures/signs/lanes.py slug). */
export const LANE_KEY = new RegExp(`^${laneKeyPart()}(-${laneKeyPart()})*$`);

/** One lane: at least one direction letter (the lookahead), in slug order, then an optional use. */
function laneKeyPart(): string {
  return "(?=[ulthr])u?l?(?:hl)?t?(?:hr)?r?(?:~(?:bus|busp|cyc))?";
}

export const LaneRenderSchema = z.strictObject({
  /** Lanes left to right, joined by "-" (`lt-t-r` = 左折・直進 | 直進 | 右折). */
  lanes: z.string().min(1).regex(LANE_KEY),
  /** The number whose variant it is (327の7-A…D, or 327の4 / 327の5 with a 専用・優先 lane). */
  sign: z.string().regex(SIGN_ID),
});
export type LaneRender = z.infer<typeof LaneRenderSchema>;

/** One row of 別表第一 (ranges such as 311-A〜F expanded), from assets/signs/law-table.json. */
export const LawRowSchema = z.strictObject({
  id: z.string().regex(SIGN_ID),
  name: z.string().min(1),
  group: z.enum(SIGN_GROUPS),
  /** The 別表第二 figure (e-Gov attachment `src` without ./pict/), null where the law shows none. */
  figure: z.string().nullable(),
});

export const LawTableSchema = z.strictObject({
  law: z.strictObject({
    id: z.string(),
    title: z.string(),
    /** e-Gov law_revision_id the table was read from. */
    revision: z.string(),
    url: z.url(),
    /** Attachment URL with `{}` where the figure file goes. */
    figureUrl: z.string().includes("{}"),
  }),
  signs: z.array(LawRowSchema).min(1),
});
export type LawTable = z.infer<typeof LawTableSchema>;
