import type { BoardLayout, Measure } from "./boxes";
import {
  BoardContentSchema,
  isExit,
  isExpresswayDiagram,
  isJunction,
  isRows,
  type BoardContent,
} from "./content";
import { layoutEntrance, layoutExit, layoutExpresswayDiagram } from "./expressway";
import { layoutJunction } from "./junction";
import { layoutRows } from "./rows";

/**
 * The layouter (knowledge/sign-system.md「案内標識のレイアウタ（G5）」): BoardContent → boxes in cm,
 * by the template of the board's number. Pure: the caller passes how text is measured.
 */
export function layoutBoard(content: BoardContent, measure: Measure): BoardLayout {
  const laid = layoutByTemplate(content, measure);
  return { content, ...laid };
}

function layoutByTemplate(c: BoardContent, measure: Measure) {
  if (isJunction(c))
    return layoutJunction({ arms: c.arms, distance: c.distance, letter: c.letter, field: "blue" }, measure);
  if (isRows(c)) return layoutRows(c, measure);
  if (isExpresswayDiagram(c)) return layoutExpresswayDiagram(c, measure);
  if (isExit(c)) return layoutExit(c, measure);
  return layoutEntrance(c, measure);
}

/** The content checked against the schema (a plan or a road tile's board), or the reasons it fails. */
export function parseBoardContent(input: unknown) {
  return BoardContentSchema.safeParse(input);
}

/** Why a board failed the schema: each issue's path (dotted) and message. */
export type BoardIssue = { path: string; message: string };

/**
 * The items whose `board` passes the schema, in order; each other one is handed to `onInvalid`
 * with its issues (the game warns and leaves it out). The boards themselves are kept as they are,
 * not replaced by zod's output (whose property order is the schema's: the face keys and the
 * scripts/qa/guideBoards.ts rows would change).
 */
export function keepValidBoards<T extends { board: unknown }>(
  items: readonly T[],
  onInvalid: (item: T, issues: BoardIssue[]) => void,
): T[] {
  return items.filter((item) => {
    const parsed = parseBoardContent(item.board);
    if (parsed.success) return true;
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    onInvalid(item, issues);
    return false;
  });
}
