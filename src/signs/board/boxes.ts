import type { BoardContent, Shield, SignName } from "./content";

/**
 * The layouter's middle step: a board as a list of boxes in centimetres from its top-left corner,
 * drawn in order by src/world/guideArt.ts. Pure data (no DOM, no three.js), so the layout is tested
 * and snapshotted without a canvas (tests/guideLayout.test.ts).
 *
 * Text is measured by a `Measure` the caller passes: the canvas's measureText in the game, a fixed
 * advance in the tests. The last squeeze of a text into its box (down to 70 % across) is left to the
 * drawer, at the size it draws: the font's hinting at that size decides it, and the boards drawn
 * before G5 did it so (their pixels must not change).
 */

/** Width in px of `text` in a CSS `font` ("700 120px GuideJP, …"). */
export type Measure = (font: string, text: string) => number;

export type Colour = "blue" | "green" | "white";
export type Point = { x: number; y: number };

/** A box of colour with rounded corners (an expressway's name, a band, the exit number's plate). */
export type FieldBox = {
  type: "field";
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  fill: Colour;
  /** A line round it, cm (at least 1 px when drawn), or null. */
  stroke: { colour: Colour; width: number } | null;
};

/** The whole board: a white rim round the field (縁, at least 1/20 of the letter height). */
export type BackgroundBox = { type: "background"; field: Colour; letter: number };

/** A junction's arrows: the stem from the bottom to the junction and an arm to each tip. */
export type JunctionArrowsBox = {
  type: "junction-arrows";
  colour: Colour;
  letter: number;
  junction: Point;
  stemBottom: number;
  tips: Array<Point & { dx: number; dy: number }>;
};

/** One straight arrow from `tail` to `tip` (105・106, the exits and entrances). */
export type ArrowBox = {
  type: "arrow";
  colour: Colour;
  tail: Point;
  tip: Point;
  /** Shaft width, head width and head length, cm. */
  shaft: number;
  headW: number;
  headL: number;
};

export type ShieldBox = { type: "shield"; x: number; y: number; size: number; shield: Shield };
/** A 通称名 box on an arm: centre, the room it may take, the letter height outside the arrow. */
export type StreetBox = { type: "street"; x: number; y: number; w: number; letter: number; text: string };

export type TextBox = {
  type: "text";
  text: string;
  font: "jp" | "latin";
  /** 日本字: the em; latin: the capital height (the font is sized so its capitals are this tall). */
  cm: number;
  x: number;
  y: number;
  align: "center" | "left" | "right";
  baseline: "top" | "middle" | "alphabetic";
  colour: Colour;
  /** Room across, cm: the drawer squeezes the text down to 70 % to fit; null: drawn as it is. */
  maxW: number | null;
};

export type RuleBox = { type: "rule"; from: Point; to: Point; width: number; colour: Colour };

/**
 * A fixed figure in a box (cm): the 非常電話's receiver on its white square (図 046), the
 * 非常駐車帯's road with the bay (図 048). Drawn as paths in the box's own proportions.
 */
export type PictogramBox = {
  type: "pictogram";
  figure: "phone" | "bay";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoxNode =
  | BackgroundBox
  | FieldBox
  | JunctionArrowsBox
  | ArrowBox
  | ShieldBox
  | StreetBox
  | TextBox
  | RuleBox
  | PictogramBox;

/** A board laid out: its size (cm) and what to draw, in order. */
export type BoardLayout = {
  content: BoardContent;
  width: number;
  height: number;
  nodes: BoxNode[];
};

export type { SignName };
