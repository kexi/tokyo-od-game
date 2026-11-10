import { PARAPET_HEIGHT, PARAPET_WIDTH } from "../expressway/assumptions";
import type { XwChunk, XwSign } from "../expressway/format";
import { carriagewayWidth } from "../expressway/section";
import type { BoardLayout } from "./board/boxes";
import { isPictogram } from "./board/content";
import { BOARD_SCALE, GIRDER_FALLBACK } from "./expresswaySignAssumptions";
import type { MountPlacement } from "./mount";
import { MEMBER_SIZES } from "./mountAssumptions";
import { LEG_CLEAR } from "./mountStandards";

/**
 * How the 都市高速's signs are held on their decks (G6): pure (no three.js, no canvas), so the
 * build's checks (tests/expresswaySigns.test.ts) and the game (src/world/expresswaySigns.ts) resolve
 * the same placement.
 */

/** How a sign on a deck is held, in the mount's frame: its placement and where the frame stands. */
export type DeckMount = {
  placement: MountPlacement;
  /**
   * The frame's origin as a lateral offset from the centre line (m, + left of travel) at the road
   * surface, and the side its +x points to: +1 right of travel (a left 壁高欄 or the gantry), −1
   * left of travel (the right 壁高欄: positions are mirrored across).
   */
  u: number;
  side: 1 | -1;
};

/**
 * The placement of a deck sign of `size` (m, as drawn; for plates their heights in order): pure, so
 * tests/expresswaySigns.test.ts checks the 建築限界 and the 壁高欄 on the data without three.js.
 *
 * - Gantry: the legs stand on the 壁高欄's tops (legBaseM = the parapet's height above the road):
 *   the clear width is set so each leg's axis is on its parapet's centre line. A board is centred
 *   on the carriageway, a 111-B over the exit's lane.
 * - Girder: under the deck above, on its girder, centred on the carriageway.
 * - 壁高欄: the frame's origin on the parapet's inner face (resolveBarrier keeps every face outside).
 */
export function deckMount(
  chunk: Pick<XwChunk, "lanes" | "laneWidth" | "shoulderL" | "shoulderR">,
  sign: Pick<XwSign, "mount" | "side" | "girder" | "lane">,
  plates: ReadonlyArray<{ width: number; height: number }>,
): DeckMount {
  const hw = carriagewayWidth({ ...chunk, median: 0 }) / 2;
  const pw = PARAPET_WIDTH.value;
  if (sign.mount === "gantry") {
    const r = MEMBER_SIZES.value.gantryLegRadius;
    const legAxis = hw + pw / 2;
    const u = legAxis - LEG_CLEAR.value - r;
    const clearWidthM = 2 * u;
    const board = plates[0];
    // Over the exit's lane (111-B), but never past a leg: a board wider than the lane's offset
    // allows is moved toward the centre until it clears the legs (resolveGantry's rule).
    const reach = clearWidthM / 2 + LEG_CLEAR.value - board.width / 2;
    const laneAt = Math.max(-reach, Math.min(reach, laneCentreFor(chunk, sign, hw)));
    return {
      placement: {
        kind: "gantry",
        clearWidthM,
        legBaseM: PARAPET_HEIGHT.value,
        boards: [{ width: board.width, height: board.height, x: u - laneAt }],
      },
      u,
      side: 1,
    };
  }
  if (sign.mount === "girder-mount") {
    const g = sign.girder ?? GIRDER_FALLBACK.value;
    return {
      placement: {
        kind: "girder-mount",
        girderBottomM: g.bottomM,
        girderDepthM: g.depthM,
        board: { width: plates[0].width, height: plates[0].height, x: 0 },
      },
      u: 0,
      side: 1,
    };
  }
  const isRight = sign.side === "right";
  return {
    placement: {
      kind: "barrier-mount",
      barrierTopM: PARAPET_HEIGHT.value,
      barrierWidthM: pw,
      plates: plates.map((p) => ({ width: p.width, height: p.height })),
    },
    u: isRight ? -hw : hw,
    side: isRight ? -1 : 1,
  };
}

/** Where across the board's centre goes (+ left): over the exit's lane for a 111-B, else the centre line. */
function laneCentreFor(
  chunk: Pick<XwChunk, "laneWidth" | "shoulderL" | "shoulderR">,
  sign: Pick<XwSign, "lane">,
  hw: number,
): number {
  if (!sign.lane) return 0;
  const inner = sign.lane === "right" ? -(hw - chunk.shoulderR) : hw - chunk.shoulderL;
  return inner - Math.sign(inner) * (chunk.laneWidth / 2);
}

/**
 * A deck board's size as drawn, m: its layout times BOARD_SCALE (the 案内 enlargement on 高速道路等,
 * 備考一(二)3); 116の4・116の6 are already scaled by their caption (PICTOGRAM_SCALE).
 */
export function boardSizeM(layout: Pick<BoardLayout, "width" | "height" | "content">): {
  width: number;
  height: number;
} {
  const scale = isPictogram(layout.content) ? 1 : BOARD_SCALE.value;
  return { width: (layout.width / 100) * scale, height: (layout.height / 100) * scale };
}
