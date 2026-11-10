import { z } from "zod";

/**
 * 信号灯器 (signal heads), declared once: the game places and lights lamps by `lampLayout`, and
 * scripts/signals.ts writes the same layouts to assets/signals/heads.json, from which
 * scripts/blender/signals.py models each housing (knowledge/signal-system.md).
 *
 * Head coordinates: metres, origin at the centre of the main housing's front face, +X to the
 * right and +Y up for someone facing the head, the lenses looking toward +Z (the signals.glb
 * convention). The dimensions are the ones the game has used since 2026-10-04 (300 mm lenses
 * 0.37 m apart); they stay until the 道路交通法施行規則's 信号機の構造 is read from e-Gov.
 */

/** 施行令第2条's three colours (the law's 青 is the game's "green"). */
export const LampColour = z.enum(["red", "yellow", "green"]);
export type LampColour = z.infer<typeof LampColour>;
/** 矢印 (青色の灯火の矢印) on the row under the main lamps. */
export const ArrowDirection = z.enum(["left", "through", "right"]);
export type ArrowDirection = z.infer<typeof ArrowDirection>;
export type ArrowLamp = `arrow-${ArrowDirection}`;
export type Lamp = LampColour | ArrowLamp;

/** Whether a lens is on the arrow row (rather than a main 赤・黄・青 lamp). */
export const isArrow = (lamp: Lamp): lamp is ArrowLamp => lamp.startsWith("arrow-");
/** Which way an arrow lens points. */
export const arrowDirection = (lamp: ArrowLamp): ArrowDirection =>
  lamp.slice("arrow-".length) as ArrowDirection;

/**
 * Lit colours (sRGB hex), shared by the game's lamps and the Blender review renders. The
 * pedestrian 止まれ is a little more orange than the vehicle red, as the game has drawn it.
 */
export const LAMP_COLOURS = {
  vehicle: { red: 0xff2a1a, yellow: 0xffc21a, green: 0x19e6b4 },
  pedestrian: { red: 0xff3a24, green: 0x19e6b4 },
  off: 0x1d2226,
} as const;
/** Lenses sit this far in front of the housing's face, clear of its bezel (no z-fighting). */
export const LENS_Z_M = 0.003;

/**
 * 施行令第3条第1項: lamps listed from the right (横型) or from the top (縦型). The article sets the
 * order for exactly these two sets (赤・黄・青, 赤・青); it does not forbid other heads (a 1 灯の
 * 点滅 head, say), so a head with other lamps is "not supported yet", not unlawful. Why a fixed
 * list rather than a rule over any colours: within those two sets any other order breaks 第3条.
 */
const LAW_ORDERS: readonly (readonly LampColour[])[] = [
  ["red", "yellow", "green"],
  ["red", "green"],
];
/**
 * The arrow row's order, left to right. Not from 施行令第3条 (it says nothing about arrows): the
 * common practice, unconfirmed against a primary source (道路交通法施行規則, 警察庁の灯器の仕様書).
 */
const ARROW_ORDER: readonly ArrowDirection[] = ["left", "through", "right"];

const metres = z.number().positive();

export const SignalHeadDefSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    /** The housing's node in signals.glb. */
    node: z.string().regex(/^[A-Za-z0-9]+$/),
    name: z.string().min(1),
    use: z.enum(["vehicle", "pedestrian"]),
    orientation: z.enum(["horizontal", "vertical"]),
    lens: z.strictObject({
      shape: z.enum(["round", "square"]),
      /** Lens diameter (round) or side (square). 250 mm vehicle lenses are not used yet: secondary sources only. */
      sizeMm: z.union([z.literal(300), z.literal(250)]),
      /** Black bezel showing round the lens. */
      bezelM: metres,
    }),
    /** Centre-to-centre distance of neighbouring lamps (and of the arrow row's slots). */
    pitchM: metres,
    /** 施行令第3条: from the right (horizontal) or from the top (vertical). */
    lamps: z.array(LampColour),
    /** The arrow row under a horizontal head, left to right. */
    arrows: z.array(ArrowDirection).default([]),
    housing: z.strictObject({ wM: metres, hM: metres, dM: metres, cornerM: metres }),
    /** 庇 over each lamp: how far it sticks out, the arc it covers and its gap round the lens. */
    visor: z.strictObject({ depthM: metres, sweepDeg: z.number().min(90).max(360), gapM: metres }).nullable(),
    /** What holds the housing: a hanger pipe up to an arm, or a bracket back to a pole. */
    fitting: z.enum(["hanger", "bracket"]),
    /** Which mount (src/signals/mounts.ts) the head goes on. */
    mount: z.enum(["arm", "pole"]),
  })
  .superRefine((def, ctx) => {
    const isLawOrder = LAW_ORDERS.some(
      (o) => o.length === def.lamps.length && o.every((c, i) => def.lamps[i] === c),
    );
    if (!isLawOrder)
      ctx.addIssue({
        code: "custom",
        path: ["lamps"],
        message:
          "施行令第3条: 横型は右から、縦型は上から 赤・黄・青（2 灯は 赤・青）。それ以外の灯の組は未対応",
      });
    const hasArrows = def.arrows.length > 0;
    if (!hasArrows) return;
    const isArrowCapable =
      def.use === "vehicle" && def.orientation === "horizontal" && def.lamps.length === 3;
    if (!isArrowCapable)
      ctx.addIssue({
        code: "custom",
        path: ["arrows"],
        message: "未対応: 矢印段は車両用の横型 3 灯の下段だけ作れる（法令の制約ではない）",
      });
    const isOrdered = def.arrows.every(
      (a, i) => i === 0 || ARROW_ORDER.indexOf(def.arrows[i - 1]) < ARROW_ORDER.indexOf(a),
    );
    if (!isOrdered)
      ctx.addIssue({
        code: "custom",
        path: ["arrows"],
        message: "未対応: 矢印は左・直進・右の順に 1 つずつ（慣行に合わせた制約。一次情報は未確認）",
      });
  });
export type SignalHeadDef = z.output<typeof SignalHeadDefSchema>;

/** One lens: what it shows, where its centre is, and how far its artwork turns (arrows, radians). */
export type LampPlace = { lamp: Lamp; x: number; y: number; turn: number };
/** One housing box of a head (the main one, and the arrow row's). */
export type HousingBox = { x: number; y: number; wM: number; hM: number };

/** Gap between the main housing and the arrow row under it (assumed; not from a standard). */
export const ARROW_ROW_GAP = 0.04;
/** The hanger pipe from the housing's top to the arm. */
export const HANGER_M = 0.28;

/** Rounded to the micrometre: 0.28 + 0.2 is 0.48000000000000004 in binary floating point. */
const micro = (m: number) => Math.round(m * 1e6) / 1e6;
const arrowRowY = (def: SignalHeadDef) => micro(-(def.housing.hM + ARROW_ROW_GAP));
/**
 * Arrows sit under the main lamp of their side: left under 青, through under 黄, right under 赤.
 * Common practice, not 施行令第3条; unconfirmed against 施行規則 or 警察庁の灯器の仕様書.
 */
const ARROW_COLUMN: Record<ArrowDirection, LampColour> = { left: "green", through: "yellow", right: "red" };
/** Arrow artwork points up (+Y, through); left and right turn it a quarter. */
const ARROW_TURN: Record<ArrowDirection, number> = { left: Math.PI / 2, through: 0, right: -Math.PI / 2 };

/**
 * Where each lens of `def` sits: the main lamps first (in the order `def.lamps` lists them), then
 * the arrows. 施行令第3条 follows from the listing order: the first lamp is placed rightmost
 * (horizontal) or topmost (vertical).
 */
export function lampLayout(def: SignalHeadDef): LampPlace[] {
  const n = def.lamps.length;
  const isHorizontal = def.orientation === "horizontal";
  const main = def.lamps.map((lamp, i): LampPlace => {
    const along = micro(((n - 1) / 2 - i) * def.pitchM);
    return { lamp, x: isHorizontal ? along : 0, y: isHorizontal ? 0 : along, turn: 0 };
  });
  const columnX = (colour: LampColour) => {
    const column = main.find((p) => p.lamp === colour);
    if (!column) throw new Error(`${def.id}: no ${colour} lamp for an arrow to sit under`);
    return column.x;
  };
  const arrows = def.arrows.map((dir): LampPlace => ({
    lamp: `arrow-${dir}`,
    x: columnX(ARROW_COLUMN[dir]),
    y: arrowRowY(def),
    turn: ARROW_TURN[dir],
  }));
  return [...main, ...arrows];
}

/** The housing boxes: the main one, and the arrow row spanning just its arrows' slots. */
export function housingLayout(def: SignalHeadDef): HousingBox[] {
  const main: HousingBox = { x: 0, y: 0, wM: def.housing.wM, hM: def.housing.hM };
  const arrows = lampLayout(def).filter((p) => isArrow(p.lamp));
  if (arrows.length === 0) return [main];
  const xs = arrows.map((p) => p.x);
  const margin = def.housing.wM - (def.lamps.length - 1) * def.pitchM; // housing beyond the outer lamps' centres
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return [
    main,
    { x: micro((left + right) / 2), y: arrowRowY(def), wM: micro(right - left + margin), hM: def.housing.hM },
  ];
}

/** How far the main housing's centre hangs below the arm (hanger + half the housing). */
export const headHang = (def: SignalHeadDef): number => micro(HANGER_M + def.housing.hM / 2);

const VEHICLE = {
  use: "vehicle",
  lens: { shape: "round", sizeMm: 300, bezelM: 0.018 },
  pitchM: 0.37,
  visor: { depthM: 0.14, sweepDeg: 200, gapM: 0.02 },
  fitting: "hanger",
  mount: "arm",
} as const;
const HORIZONTAL_HOUSING = { wM: 1.15, hM: 0.4, dM: 0.11, cornerM: 0.07 };

/** The head types as written; their ids type SIGNAL_HEADS (parsed and checked below). */
const HEAD_INPUTS = [
  {
    ...VEHICLE,
    id: "vehicle-h3",
    node: "SignalHead",
    name: "車両用 LED 薄型 3 灯横型",
    orientation: "horizontal",
    lamps: ["red", "yellow", "green"],
    housing: HORIZONTAL_HOUSING,
  },
  {
    ...VEHICLE,
    id: "vehicle-v3",
    node: "SignalHeadVertical",
    name: "車両用 3 灯縦型",
    orientation: "vertical",
    lamps: ["red", "yellow", "green"],
    housing: { ...HORIZONTAL_HOUSING, wM: HORIZONTAL_HOUSING.hM, hM: HORIZONTAL_HOUSING.wM },
  },
  {
    ...VEHICLE,
    id: "vehicle-h3-right",
    node: "SignalHeadRightArrow",
    name: "車両用 3 灯横型＋右折矢印",
    orientation: "horizontal",
    lamps: ["red", "yellow", "green"],
    arrows: ["right"],
    housing: HORIZONTAL_HOUSING,
  },
  {
    ...VEHICLE,
    id: "vehicle-h3-arrows",
    node: "SignalHeadArrows",
    name: "車両用 3 灯横型＋左折・直進・右折矢印",
    orientation: "horizontal",
    lamps: ["red", "yellow", "green"],
    arrows: ["left", "through", "right"],
    housing: HORIZONTAL_HOUSING,
  },
  {
    id: "ped-v2",
    node: "PedHead",
    name: "歩行者用 2 灯縦型",
    use: "pedestrian",
    orientation: "vertical",
    lens: { shape: "square", sizeMm: 250, bezelM: 0.015 },
    pitchM: 0.35,
    lamps: ["red", "green"],
    housing: { wM: 0.36, hM: 0.72, dM: 0.1, cornerM: 0.05 },
    visor: { depthM: 0.1, sweepDeg: 160, gapM: 0.03 },
    fitting: "bracket",
    mount: "pole",
  },
] as const;
export type SignalHeadId = (typeof HEAD_INPUTS)[number]["id"];

/** Every head type, by id. */
export const SIGNAL_HEADS = Object.fromEntries(
  HEAD_INPUTS.map((d) => [d.id, SignalHeadDefSchema.parse(d)]),
) as Record<SignalHeadId, SignalHeadDef>;

/**
 * The heads the game places, and the only ones it shows: the 3 灯横型 over each approach and the
 * 2 灯 at each crosswalk end. signalModels.ts loads their housings by `node`.
 */
export const VEHICLE_HEAD = SIGNAL_HEADS["vehicle-h3"];
export const PED_HEAD = SIGNAL_HEADS["ped-v2"];
