import { z } from "zod";

/**
 * What a 案内標識 says (BoardContent), before any layout: the first of the layouter's three steps
 * (content → a tree of boxes in cm, board/layout.ts → a canvas, src/world/guideArt.ts). Checked by
 * zod so a plan made at run time (src/world/guidePlan.ts) and one written into a road tile at build
 * time (G6) pass the same schema.
 *
 * The template is told by the 別表第一 number (`kind`), not by a field of its own: a 108 board keeps
 * the JSON it had before G5 (the rows scripts/qa/guideBoards.ts compares with the boards before
 * G5). The face's key in the layer pool is boardKey, independent of the property order. knowledge/sign-system.md「案内標識のレイアウタ（G5）」 has the table.
 */

/** A place on a board: 日本字, its English (empty: none), and whether it is an expressway's name. */
export const SignNameSchema = z.strictObject({
  ja: z.string().min(1),
  en: z.string(),
  expressway: z.boolean(),
});
export type SignName = z.infer<typeof SignNameSchema>;

/**
 * A route number on an arrow: 国道番号 (118-A), 都道府県道番号 (118の2-A), or an expressway's route
 * symbol (`route`: drawn in the form of 118の3 高速道路番号, never an operator's own shield).
 */
export const ShieldSchema = z.strictObject({
  kind: z.enum(["national", "prefectural", "route"]),
  number: z.string().min(1),
});
export type Shield = z.infer<typeof ShieldSchema>;

/** Angle of an arrow on the board, degrees from straight up, + to the left (−135 … 135, 45° steps). */
const ArrowAngle = z.number().min(-135).max(135);

/** One arm of a junction's arrow diagram. */
export const ArmSchema = z.strictObject({
  angle: ArrowAngle,
  names: z.array(SignNameSchema).max(2),
  shields: z.array(ShieldSchema).max(2),
  /** 通称名 in the white box on the arm (108の3・108の4), or null. */
  street: z.string().min(1).nullable(),
});
export type ArmSpec = z.infer<typeof ArmSchema>;

/** Height of the Japanese letters, cm (board/letters.ts gives it from the design speed). */
const Letter = z.number().positive().max(90);

/** `junction-diagram`: 108-A・108の2-A・108の3・108の4 (blue, the arrows of the junction). */
export const JunctionContentSchema = z.strictObject({
  kind: z.enum(["108-A", "108の2-A", "108の3", "108の4"]),
  arms: z.array(ArmSchema).min(1).max(6),
  /** 予告: metres to the junction as printed ("300m"); null at the junction. */
  distance: z.number().int().positive().nullable(),
  letter: Letter,
});
export type JunctionContent = z.infer<typeof JunctionContentSchema>;

/** A row of 105 (one direction, its arrow, its place, its distance) or 106 (a place, its distance). */
export const RowSchema = z.strictObject({
  /** The row's own arrow (105); null under 106's one shared arrow. */
  angle: ArrowAngle.nullable(),
  name: SignNameSchema,
  /** km as printed; null: no distance. */
  km: z.number().positive().nullable(),
});
export type Row = z.infer<typeof RowSchema>;

/**
 * `rows`: 105-A〜C 方面、方向及び距離 (a row per direction, white rules between them) and 106-A
 * 方面及び距離 (確認標識: one arrow up the left, the places stacked, the farthest on top).
 */
export const RowsContentSchema = z.strictObject({
  kind: z.enum(["105-A", "105-B", "105-C", "106-A"]),
  rows: z.array(RowSchema).min(1).max(3),
  letter: Letter,
});
export type RowsContent = z.infer<typeof RowsContentSchema>;

/**
 * `expressway-diagram`: 108の2-C〜E on the 都市高速 (green; G6 places them). The arms as in the
 * junction diagram, with route symbols and the distance under the stem.
 */
export const ExpresswayDiagramContentSchema = z.strictObject({
  kind: z.enum(["108の2-C", "108の2-D", "108の2-E"]),
  arms: z.array(ArmSchema).min(1).max(4),
  distance: z.number().int().positive().nullable(),
  letter: Letter,
});
export type ExpresswayDiagramContent = z.infer<typeof ExpresswayDiagramContentSchema>;

/**
 * `exit`: 110-B 方面及び出口の予告, 112-B 方面及び出口, 113-A・B 出口 (green): the places, the exit's
 * name, its number on a white plate with green figures, and a distance or the arrow off.
 */
export const ExitContentSchema = z.strictObject({
  kind: z.enum(["110-B", "112-B", "113-A", "113-B"]),
  names: z.array(SignNameSchema).max(2),
  /** The exit's own name (real: 「西神田」), or null for 113 (出口 EXIT). */
  exitName: SignNameSchema.nullable(),
  /** 出口番号 (white plate, green figures), or null. */
  number: z.string().min(1).nullable(),
  /** 予告: metres to the exit as printed; null: the arrow alone (at the exit). */
  distance: z.number().int().positive().nullable(),
  /** The arrow off the main line, degrees (+ left); 45 is the usual diagonal. */
  angle: ArrowAngle,
  letter: Letter,
});
export type ExitContent = z.infer<typeof ExitContentSchema>;

/**
 * `entrance`: 103-A・B 入口の方向 and 104 入口の予告: an upper white band with green letters (the
 * operator's name by its i18n key — never a real operator's name or mark — the route symbol, the
 * entrance's real name) over a green lower band (the places, the arrow or the distance).
 */
export const EntranceContentSchema = z.strictObject({
  kind: z.enum(["103-A", "103-B", "104"]),
  /** i18n key of the operator's (fictional) name, resolved in Japanese and English on the board. */
  operator: z.literal("guide.operator"),
  route: ShieldSchema.nullable(),
  /** The entrance's real name (「代官町」), or null. */
  entranceName: SignNameSchema.nullable(),
  names: z.array(SignNameSchema).max(2),
  /** 103: the arrow, degrees (+ left); 104: null. */
  angle: ArrowAngle.nullable(),
  /** 104: metres to the entrance as printed. */
  distance: z.number().int().positive().nullable(),
  letter: Letter,
});
export type EntranceContent = z.infer<typeof EntranceContentSchema>;

export const BoardContentSchema = z.union([
  JunctionContentSchema,
  RowsContentSchema,
  ExpresswayDiagramContentSchema,
  ExitContentSchema,
  EntranceContentSchema,
]);
export type BoardContent = z.infer<typeof BoardContentSchema>;
export type BoardKind = BoardContent["kind"];

/** The layout template of each number (knowledge/sign-system.md「案内標識のレイアウタ（G5）」). */
export type Template = "junction-diagram" | "rows" | "expressway-diagram" | "exit" | "entrance";

const TEMPLATE_OF: Record<BoardKind, Template> = {
  "108-A": "junction-diagram",
  "108の2-A": "junction-diagram",
  "108の3": "junction-diagram",
  "108の4": "junction-diagram",
  "105-A": "rows",
  "105-B": "rows",
  "105-C": "rows",
  "106-A": "rows",
  "108の2-C": "expressway-diagram",
  "108の2-D": "expressway-diagram",
  "108の2-E": "expressway-diagram",
  "110-B": "exit",
  "112-B": "exit",
  "113-A": "exit",
  "113-B": "exit",
  "103-A": "entrance",
  "103-B": "entrance",
  "104": "entrance",
};

export const templateOf = (kind: BoardKind): Template => TEMPLATE_OF[kind];

export const isJunction = (c: BoardContent): c is JunctionContent =>
  templateOf(c.kind) === "junction-diagram";
export const isRows = (c: BoardContent): c is RowsContent => templateOf(c.kind) === "rows";
export const isExpresswayDiagram = (c: BoardContent): c is ExpresswayDiagramContent =>
  templateOf(c.kind) === "expressway-diagram";
export const isExit = (c: BoardContent): c is ExitContent => templateOf(c.kind) === "exit";

/**
 * A board's key in the face layer pool: its JSON with every object's keys sorted, so two equal
 * contents built with their properties in another order share one face.
 * Why not JSON.stringify as it is (before the G5 review): its order is the order the properties
 * were written in, which a planner or a road tile is free to change.
 */
export function boardKey(c: BoardContent): string {
  return JSON.stringify(c, (_key, value: unknown) => {
    const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
    if (!isRecord) return value;
    return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

/** Every place a board names (the social feed and the nav read them), in reading order. */
export function boardNames(c: BoardContent): SignName[] {
  if ("arms" in c) return c.arms.flatMap((a) => a.names);
  if ("rows" in c) return c.rows.map((r) => r.name);
  const own = "exitName" in c ? c.exitName : c.entranceName;
  return [...(own ? [own] : []), ...c.names];
}
