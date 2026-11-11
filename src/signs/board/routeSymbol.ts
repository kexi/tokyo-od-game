/**
 * The frame of a route symbol (118の3 高速道路番号) as src/world/guideArt.ts draws it: a box `size`
 * across is ROUTE_FRAME_ASPECT × size high. Kept here so the layouter sizes a symbol by the
 * frame's height (the 備考一(五)6 caps are on the symbol's height) without importing the drawer.
 */
export const ROUTE_FRAME_ASPECT = 0.78;
