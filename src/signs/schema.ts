import { z } from "zod";
import { GAME_PICKS, GAME_SIGN_KINDS } from "./game";
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

/**
 * How far 別表第二 lets the plates of a group be drawn larger or smaller than 図示, on roads other
 * than 高速道路等 (the ones the game has signs on): 規制・指示 anywhere from 1/2 to 2 times
 * (備考一(二)9), 警戒 only at 1.3, 1.6 or 2 times (備考一(二)6). 補助標識 are enlarged or reduced
 * by the same ratio as the plate they are attached to (備考二(二)2), so they have no scale of their
 * own. 案内 are laid out per number (G5) and 法定外 are outside the 命令; both are held to the 規制
 * range so a stray value is still caught.
 */
export type Enlargement =
  | { range: readonly [number, number]; law: string }
  | { steps: readonly number[]; law: string }
  | { followsMain: true; law: string };

export const ENLARGEMENT: Record<SignGroup, Enlargement> = {
  規制: { range: [0.5, 2], law: "別表第二 備考一(二)9" },
  指示: { range: [0.5, 2], law: "別表第二 備考一(二)9" },
  警戒: { steps: [1, 1.3, 1.6, 2], law: "別表第二 備考一(二)6" },
  補助: { followsMain: true, law: "別表第二 備考二(二)2（本標識板と同じ比率）" },
  案内: { range: [0.5, 2], law: "規定は番号ごと（G5）。それまで規制と同じ範囲で検査" },
  法定外: { range: [0.5, 2], law: "命令の外。規制と同じ範囲で検査" },
};

/**
 * The road a plate stands on, as far as the enlargement rules ask: 高速道路等 have their own (G6,
 * the urban expressway).
 */
export type EnlargementRoad = { kind: "general" } | { kind: "expressway"; designSpeedKmh: number };
export const GENERAL_ROAD: EnlargementRoad = { kind: "general" };

/**
 * The enlargement a group's plates may take on `road`. On 高速道路等: 警戒 up to 2 times at a design
 * speed of 60 km/h or more and 2.5 times at 100 or more, as a range, not steps (備考一(二)4; below 60
 * no enlargement is given, so 図示 only); 案内 up to 3 times (備考一(二)3); the rest as elsewhere.
 * Only the general road is used until G6 places signs on the expressway.
 */
export function enlargementFor(signGroup: SignGroup, road: EnlargementRoad = GENERAL_ROAD): Enlargement {
  if (road.kind === "general") return ENLARGEMENT[signGroup];
  const isGuide = signGroup === "案内";
  if (isGuide) return { range: [1, 3], law: "別表第二 備考一(二)3" };
  const isWarning = signGroup === "警戒";
  if (!isWarning) return ENLARGEMENT[signGroup];
  const law = "別表第二 備考一(二)4";
  const isFast = road.designSpeedKmh >= 100;
  if (isFast) return { range: [1, 2.5], law };
  const isMedium = road.designSpeedKmh >= 60;
  if (isMedium) return { range: [1, 2], law };
  return { steps: [1], law };
}

/**
 * The scale the game draws a group's plates at, unless a definition gives its own
 * (`displayScale`). Why not real size: at the game's field of view a 60 cm plate cannot be read in
 * time, so 規制・指示 are drawn 1.25× (inside 備考一(二)9); 警戒 cannot be 1.25×, so they take the
 * smallest step, 1.3×. null: drawn at the scale of the plate above (補助).
 */
export const DISPLAY_SCALE: Record<SignGroup, number | null> = {
  規制: 1.25,
  指示: 1.25,
  警戒: 1.3,
  補助: null,
  案内: 1,
  法定外: 1.25,
};

/** Whether `scale` is one the group may be drawn at on `road`; null only where it follows the main plate. */
export function isLawfulScale(
  signGroup: SignGroup,
  scale: number | null,
  road: EnlargementRoad = GENERAL_ROAD,
): boolean {
  const rule = enlargementFor(signGroup, road);
  if ("followsMain" in rule) return scale === null;
  if (scale === null) return false;
  if ("steps" in rule) return rule.steps.includes(scale);
  return scale >= rule.range[0] && scale <= rule.range[1];
}

/** A node name of public/models/signs.glb that holds a plate. */
export type PlateNode = keyof typeof PLATES;
const PLATE_NODES = Object.keys(PLATES) as [PlateNode, ...PlateNode[]];
const PlateNodeSchema = z.enum(PLATE_NODES);

const Mm = z.number().positive();
const CornerMm = z.number().nonnegative();

/**
 * A plate outline as 別表第二 dimensions it (src/signs/plates.ts), in mm. Each shape names its own
 * measures, so no field means one thing on one shape and another on the next (G1a review I3: the
 * old `sizeMm` was the box for every shape but the 菱形, where it was the side).
 */
export const PlateOutlineSchema = z.discriminatedUnion("shape", [
  z.strictObject({ shape: z.literal("circle"), diameterMm: Mm }),
  z.strictObject({ shape: z.literal("triangle_down"), sideMm: Mm, cornerMm: CornerMm }),
  z.strictObject({ shape: z.literal("diamond"), sideMm: Mm, cornerMm: CornerMm }),
  z.strictObject({ shape: z.literal("square"), widthMm: Mm, heightMm: Mm, cornerMm: CornerMm }),
  z.strictObject({ shape: z.literal("rect"), widthMm: Mm, heightMm: Mm, cornerMm: CornerMm }),
  /** 407: an equilateral triangle `widthMm` on a side, standing on a widthMm × baseMm base. */
  z.strictObject({ shape: z.literal("pentagon"), widthMm: Mm, baseMm: Mm, cornerMm: CornerMm }),
]);
export type PlateOutline = z.infer<typeof PlateOutlineSchema>;

/** A plate as registry.json carries it: the outline and the box its texture covers (UV 0–1). */
export type Plate = PlateOutline & { boxMm: [number, number] };

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

/**
 * The placed value (src/world/regulations.ts PlacedSign.value) a face is shown for, on a sign whose
 * game type picks by value: the speed limit; the directions a 指定方向外進行禁止 allows (1 左折,
 * 2 直進, 4 右折, added up).
 */
const GameValue = z.number().int();

export const VariantSchema = z.strictObject({
  /** What tells it apart (`left`, `8-20`, `kyujitsu`). */
  key: z.string().min(1),
  file: PngFile,
  paint: PaintSchema.optional(),
  gameValue: GameValue.optional(),
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
    gameValue: GameValue.optional(),
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
    /** The game's sign type drawn with this number, and how it is shown (assets/signs/game.json). */
    game: z
      .strictObject({
        /** src/signs/game.ts SIGN key. */
        kind: z.enum(GAME_SIGN_KINDS),
        /** How a placed sign picks its face (game.ts GAME_PICKS); omitted: the default face. */
        pick: z.enum(GAME_PICKS).optional(),
        /**
         * Along the street (道路標識設置基準 3-1-4) with the variant `back` on the other side. Only how
         * the plate faces; the supports and their heights (design 4, `mount` of G4) will be a
         * separate field, which this one is then folded into.
         */
        mount: z.literal("parallel").optional(),
        back: z.string().min(1).optional(),
        /** Two copies of the face back to back, one per direction. */
        bothFaces: z.literal(true).optional(),
        /**
         * On a post split in two columns, keep this plate on the column by the carriageway
         * (交通規制基準 第2章 9 (2) イ (ア): 横断歩道 at the bottom, or on the right). src/signs/mount.ts.
         */
        kerbSide: z.literal(true).optional(),
        /**
         * Never hung on a nearby signal pole (信号柱への共架): its place means something (一時停止 at the
         * stop line, 横断歩道 at the crossing), and the pole stands beyond the junction.
         */
        fixedPlace: z.literal(true).optional(),
      })
      .optional(),
    /**
     * The scale the game draws the plate at, when it is not the group's (DISPLAY_SCALE); must be
     * one ENLARGEMENT allows (buildRegistry checks).
     */
    displayScale: z.number().positive().optional(),
    /** Former names of its faces: the game called 311-A's faces turn_3 and turn_6 before it used the number. */
    legacy: z.array(z.string().min(1)).optional(),
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

/** A 補助標識 face drawn ahead of time for the game (src/signs/auxPlates.ts auxPlatesFor). */
export const AuxRenderSchema = z.strictObject({
  /** The 補助標識 number (502 日・時間). */
  sign: z.string().regex(SIGN_ID),
  /** Lines of lettering, top to bottom (1 to 3: the 22, 32 and 44 cm plates). */
  lines: z.array(z.string().min(1)).min(1).max(3),
});
export type AuxRender = z.infer<typeof AuxRenderSchema>;

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
